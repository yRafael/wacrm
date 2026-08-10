// ============================================================
// WhatsApp worker — the long-running Baileys process.
//
// Started alongside `next dev` via `concurrently` (`npm run dev`
// already wires it; standalone: `npm run wa`). It holds one live
// socket per `whatsapp_sessions` row and owns everything that must
// NOT run inside a Next.js request:
//
//   inbound  → Baileys events → normalize → media download/upload →
//              processInboundMessage (find-or-create contact/conv)
//   outbound → polls `whatsapp_outbox`, sends over the socket,
//              persists the `messages` row + conversation update
//   sessions → QR data URL + status writes, auto-reconnect tracking
//
// The worker uses the service-role client (RLS is bypassed) but EVERY
// query is filtered by `account_id` — the tenancy rule from the doc.
//
// Run: `npx tsx src/whatsapp/worker.ts`
// ============================================================

import { DisconnectReason } from '@whiskeysockets/baileys'
import type { WASocket, ConnectionState } from '@whiskeysockets/baileys'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { supabaseAdmin } from '@/lib/flows/admin-client'
import { processInboundMessage } from '@/lib/whatsapp/inbound-process'
import { clearSessionAuthDir } from '@/lib/whatsapp/sessions'
import {
  connectSession,
  getSession,
  listSessionIds,
  unregisterSession,
  qrToDataUrl,
  sessionAuthDir,
} from '@/lib/whatsapp/baileys/session-manager'
import {
  normalizeInboundMessage,
  requiresMediaDownload,
  extractLidJid,
} from '@/lib/whatsapp/baileys/events'
import { downloadAndUploadInboundMedia } from '@/lib/whatsapp/baileys/media'
import { sendViaBaileys, type QuoteInfo } from '@/lib/whatsapp/baileys/send'
import type {
  BaileysMessageLike,
  InboundMessagePayload,
  WhatsAppOutboxRow,
  WhatsAppSessionRow,
  SessionStatus,
} from '@/lib/whatsapp/baileys/types'

// ------------------------------------------------------------
// Env bootstrap — tsx does not load .env.local automatically.
// ------------------------------------------------------------

function loadDotEnv(file: string): void {
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq < 0) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (key && process.env[key] === undefined) process.env[key] = value
    }
  } catch {
    // Missing env file is fine — vars may come from the shell instead.
  }
}

loadDotEnv('.env.local')
loadDotEnv('.env')

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------

const OUTBOX_POLL_MS = 1000
const SESSION_SWEEP_MS = 15_000
const QR_TTL_MS = 120_000
const MAX_SEND_ATTEMPTS = 3
// A Baileys send that can't complete (degraded request/response channel,
// dead-but-registered socket) must NOT block the outbox poll forever —
// after this long the attempt is abandoned and the row retried/failed.
const SEND_TIMEOUT_MS = 45_000
// Resolving a LID→PN can hit the keystore/USync — bound it so a cold
// store can't stall the inbound sweep.
const LID_RESOLVE_TIMEOUT_MS = 15_000

/** Race a promise against a timer — rejects with a labelled timeout. */
function withTimeout<T>(ms: number, label: string, p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

// ------------------------------------------------------------
// LID (Linked ID) → phone resolution
// ------------------------------------------------------------

/**
 * Resolve a full `@lid` JID to its PN JID (`<pn>:<device>@s.whatsapp.net`
 * or `@hosted`) via the socket's LID↔PN store. Returns null when the
 * store is unavailable or has no mapping — the caller falls back to the
 * LID as-is.
 */
async function resolveLidToPn(sock: WASocket, lidJid: string): Promise<string | null> {
  const lidMapping = (sock as unknown as {
    signalRepository?: { lidMapping?: { getPNForLID?: (jid: string) => Promise<string | null> } }
  }).signalRepository?.lidMapping
  if (!lidMapping?.getPNForLID) return null
  try {
    const pn = await lidMapping.getPNForLID(lidJid)
    return pn ?? null
  } catch (err) {
    console.warn(`[wa:worker] LID→PN resolve failed for ${lidJid}:`, err)
    return null
  }
}

/** Digits of the user part of a `user:device@domain` PN JID. */
function phoneDigitsFromJid(jid: string): string | null {
  const user = jid.split('@')[0]?.split(':')[0] ?? null
  if (!user || !/^\d+$/.test(user)) return null
  return user
}

// ------------------------------------------------------------
// Session ↔ DB status writes
// ------------------------------------------------------------

async function writeSessionStatus(
  sessionId: string,
  status: SessionStatus,
  extra: {
    qrData?: string | null
    error?: string | null
    connectedAt?: string | null
  } = {},
): Promise<void> {
  // Build the patch key-by-key: `undefined` means "leave the column
  // untouched" (so a QR survives a status-only flip), while `null` means
  // "explicitly clear" (qr_data is wiped on CONNECTED / logged out).
  const patch: Record<string, unknown> = {
    status,
    last_activity: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  if (extra.qrData !== undefined) {
    patch.qr_data = extra.qrData
    patch.qr_expires_at = extra.qrData
      ? new Date(Date.now() + QR_TTL_MS).toISOString()
      : null
  }
  if (extra.error !== undefined) patch.last_error = extra.error
  if (extra.connectedAt !== undefined) patch.connected_at = extra.connectedAt

  const { error } = await supabaseAdmin()
    .from('whatsapp_sessions')
    .update(patch)
    .eq('id', sessionId)
  if (error) {
    console.error(`[wa:worker] status write failed (${sessionId}):`, error.message)
  }
}

function isLoggedOut(update: Partial<ConnectionState>): boolean {
  const err = update.lastDisconnect?.error as { status?: number } | undefined
  return Boolean(err && err.status === DisconnectReason.loggedOut)
}

/**
 * True when creds.json carries a paired number (`me.id`). Baileys only
 * sets `me` in `configureSuccessfulPairing`, so this is the durable
 * signal that a QR scan COMPLETED — as opposed to the generated-but-
 * unregistered creds Baileys also persists, which never get a `me`.
 * It survives worker restarts, so a freshly-rebuilt login socket gives
 * the same answer as the pairing socket that wrote the creds.
 */
function credsHavePairedNumber(credsPath: string): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(credsPath, 'utf8')) as {
      me?: { id?: string } | null
    }
    return Boolean(parsed.me?.id)
  } catch {
    return false
  }
}

async function handleConnectionUpdate(
  sessionId: string,
  _sock: WASocket,
  update: Partial<ConnectionState>,
): Promise<void> {
  const session = getSession(sessionId)
  if (!session?.accountId) return

  // QR frames arrive on connection.update with a `qr` string.
  if (update.qr) {
    try {
      const dataUrl = await qrToDataUrl(update.qr)
      await writeSessionStatus(sessionId, 'QR_CODE', { qrData: dataUrl })
    } catch (err) {
      console.error('[wa:worker] QR render failed:', err)
    }
    return
  }

  const conn = update.connection
  if (!conn) return

  switch (conn) {
    case 'connecting':
      await writeSessionStatus(sessionId, 'CONNECTING')
      break

    case 'open':
      console.log(`[wa:worker] session ${sessionId} connected`)
      // Clear any leftover QR — the migration documents qr_data is
      // cleared on CONNECTED.
      await writeSessionStatus(sessionId, 'CONNECTED', {
        connectedAt: new Date().toISOString(),
        qrData: null,
      })
      break

    case 'close': {
      // A logged-out session is terminal — Baileys will NOT reconnect.
      // The operator must pair again (the sessions UI exposes this).
      const loggedOut = isLoggedOut(update)
      const reason =
        update.lastDisconnect?.error instanceof Error
          ? update.lastDisconnect.error.message
          : loggedOut
            ? 'logged_out'
            : 'disconnected'

      if (loggedOut) {
        console.warn(`[wa:worker] session ${sessionId} closed (logged out):`, reason)
        await writeSessionStatus(sessionId, 'ERROR', { error: 'logged_out', qrData: null })
        // Dead socket — drop it from the registry so the sweep treats the
        // row as paused until the operator re-pairs ("Atualizar QR").
        unregisterSession(sessionId)
        break
      }

      // Transient close. When the number was never paired (no
      // connected_at), the close is just the QR-refresh cycle giving up
      // ("QR refs attempts ended") — Baileys retries and emits a fresh QR.
      // Stay in QR_CODE so the sessions UI keeps showing a scannable QR
      // instead of flipping to RECONNECTING and hiding it.
      const { data: row } = await supabaseAdmin()
        .from('whatsapp_sessions')
        .select('connected_at')
        .eq('id', sessionId)
        .maybeSingle()
      if (!row?.connected_at) {
        // The number never reached CONNECTED in this lifecycle. Three
        // sub-cases, decided by what's on disk:
        //
        // 1. creds.json with a paired number (`me`) — the scan COMPLETED:
        //    Baileys saved the auth, then the server forces a restart
        //    ("Stream Errored (restart required)", code 515) to switch
        //    from pairing to login mode. This close is that expected
        //    restart. KEEP the creds, drop the socket, and the sweep
        //    rebuilds one that logs straight in — no QR.
        //
        // 2. creds.json WITHOUT a paired number — a zombie: an earlier
        //    failed scan wrote generated-but-unregistered creds, so
        //    Baileys believes it is registered and will never emit a QR
        //    (it keeps dying at decodeFrame). Wipe + rebuild for a
        //    clean pairing socket.
        //
        // 3. No creds at all — a normal QR-refresh cycle. Stay QR_CODE.
        const authDir = sessionAuthDir(session.accountId, sessionId)
        const credsPath = path.join(authDir, 'creds.json')
        const hasCreds = fs.existsSync(credsPath)
        const paired = hasCreds && credsHavePairedNumber(credsPath)
        if (paired) {
          console.warn(
            `[wa:worker] session ${sessionId} closed with paired creds — restarting to log in`,
          )
          await writeSessionStatus(sessionId, 'CONNECTING', { qrData: null })
          unregisterSession(sessionId)
        } else if (hasCreds) {
          console.warn(
            `[wa:worker] session ${sessionId} closed with unpaired creds — wiping auth dir for fresh pairing`,
          )
          clearSessionAuthDir(session.accountId, sessionId)
          unregisterSession(sessionId)
        } else {
          console.warn(`[wa:worker] session ${sessionId} QR cycle closed — next QR coming`)
          await writeSessionStatus(sessionId, 'QR_CODE')
        }
        break
      }

      console.warn(`[wa:worker] session ${sessionId} closed:`, reason)
      await writeSessionStatus(sessionId, 'RECONNECTING', { error: String(reason) })
      break
    }
  }
}

// ------------------------------------------------------------
// Inbound handling
// ------------------------------------------------------------

async function accountOwnerUserId(accountId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle()
  if (error || !data?.owner_user_id) {
    console.error('[wa:worker] could not resolve account owner:', error?.message ?? 'none')
    return null
  }
  return data.owner_user_id as string
}

/**
 * One Baileys `messages.upsert` event → normalized inbound → persisted.
 * Media is downloaded + uploaded to Storage HERE (the raw Baileys
 * message is still in scope), then the public URL is stamped onto the
 * normalized payload before `processInboundMessage`.
 */
async function handleUpsert(
  sessionId: string,
  sock: WASocket,
  messages: BaileysMessageLike[],
): Promise<void> {
  const session = getSession(sessionId)
  if (!session?.accountId) return
  const accountId = session.accountId

  // Sender-of-record for contact/conversation inserts: the account
  // owner (there is no per-session user in the Baileys world).
  const ownerUserId = await accountOwnerUserId(accountId)
  if (!ownerUserId) return

  for (const raw of messages) {
    const normalized = normalizeInboundMessage(raw)
    if (!normalized) continue

    // Baileys v7 can deliver a 1:1 chat addressed by LID (Linked ID)
    // instead of a phone number. Resolve the real phone so the contact
    // is stored and later sent-to under a PN JID; keep the LID so
    // inbound-process can migrate a contact already stored under the
    // LID. Fall back to the LID digits as the phone when resolution
    // fails (still better than dropping the message).
    const lidJid = extractLidJid(raw.key.remoteJid)
    if (lidJid) {
      const pnJid = await withTimeout(
        LID_RESOLVE_TIMEOUT_MS,
        `lid→pn ${lidJid}`,
        resolveLidToPn(sock, lidJid),
      ).catch(() => null)
      const realPhone = pnJid ? phoneDigitsFromJid(pnJid) : null
      if (realPhone) {
        normalized.lid = lidJid.split('@')[0] ?? null
        normalized.from = realPhone
      }
    }

    // Resolve media before persisting so media_url is a public URL.
    if (requiresMediaDownload(normalized)) {
      const media = await downloadAndUploadInboundMedia(
        sock,
        raw,
        accountId,
        normalized.mediaMime,
        normalized.mediaFilename,
      )
      if (media) {
        normalized.mediaUrl = media.url
        normalized.mediaMime = media.mime ?? normalized.mediaMime
      }
      // Bytes are consumed regardless of upload success — the message
      // is stored with media_url null rather than retried forever.
      ;(normalized as InboundMessagePayload).mediaAvailable = false
    }

    const ok = await processInboundMessage(
      supabaseAdmin(),
      {
        accountId,
        configOwnerUserId: ownerUserId,
        contactName: normalized.pushName ?? undefined,
      },
      normalized,
    )
    if (!ok) {
      console.warn('[wa:worker] inbound message not persisted:', normalized.id)
    }
  }
}

// ------------------------------------------------------------
// Outbound — the outbox consumer
// ------------------------------------------------------------

async function sendOutboxRow(row: WhatsAppOutboxRow): Promise<void> {
  // Resolve a CONNECTED socket for this account. Multiple sessions are
  // allowed, so we pin to the most recently connected one — a future
  // phase can route per-contact.
  const { data: sessionRows, error: sessionErr } = await supabaseAdmin()
    .from('whatsapp_sessions')
    .select('id')
    .eq('account_id', row.account_id)
    .eq('status', 'CONNECTED')
    .order('connected_at', { ascending: false })
    .limit(1)

  if (sessionErr) {
    console.error('[wa:worker] outbox session lookup failed:', sessionErr.message)
    return // leave pending, retry next cycle
  }
  const sessionRow = sessionRows?.[0]
  if (!sessionRow) {
    // No connected session — keep pending so a reconnect drains it.
    // The inbox shows a "WhatsApp desconectado" banner in the meantime.
    console.warn(
      `[wa:worker] outbox row ${row.id} deferred — no CONNECTED whatsapp_session for account ${row.account_id}`,
    )
    return
  }

  const active = getSession(sessionRow.id)
  if (!active?.socket) {
    console.warn(
      `[wa:worker] outbox row ${row.id} deferred — session ${sessionRow.id} is CONNECTED in DB but has no live socket`,
    )
    return
  }

  // Dedupe: if a previous attempt already delivered (crash after send,
  // before DB write), the wamid is stamped and we must NOT re-send.
  if (row.wamid) return

  // Stamp 'sending' so a concurrent poll (or a second worker) won't
  // double-send. The guard is IN (pending, sending) — not just pending —
  // so a row left stranded in 'sending' by a crashed worker is recovered
  // on the next cycle. The `.select().maybeSingle()` check makes the lock
  // atomic: a row already taken by another poll matches zero rows and is
  // skipped instead of double-sent.
  const { data: locked, error: lockErr } = await supabaseAdmin()
    .from('whatsapp_outbox')
    .update({ status: 'sending', session_id: sessionRow.id, attempts: row.attempts + 1 })
    .eq('id', row.id)
    .in('status', ['pending', 'sending'])
    .select('id')
    .maybeSingle()
  if (lockErr || !locked) {
    if (lockErr) console.error('[wa:worker] outbox lock failed:', lockErr.message)
    return
  }

  try {
    const quoted = await resolveQuote(row)
    const payload = row.payload as {
      text?: string
      mediaUrl?: string
      caption?: string
      filename?: string
      ptt?: boolean
      replyToMessageId?: string
    } | null

    console.log(
      `[wa:worker] outbox row ${row.id} sending → ${row.to_phone} (${row.message_type}) attempt ${row.attempts + 1}`,
    )
    const wamid = await withTimeout(SEND_TIMEOUT_MS, `send to ${row.to_phone}`, sendViaBaileys(active.socket, {
      to: row.to_phone,
      messageType: row.message_type,
      payload: row.payload,
      quoted,
    }))
    console.log(`[wa:worker] outbox row ${row.id} delivered → wamid ${wamid}`)

    // Reactions are state, not messages — never a `messages` row.
    if (row.message_type !== 'reaction') {
      await persistSentMessage(row, payload, wamid)
    }

    const { error: sentErr } = await supabaseAdmin()
      .from('whatsapp_outbox')
      .update({ status: 'sent', wamid, sent_at: new Date().toISOString() })
      .eq('id', row.id)
    if (sentErr) {
      console.error('[wa:worker] outbox sent-write failed:', sentErr.message)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[wa:worker] outbox row ${row.id} send failed:`, message)

    // `row.attempts` is the pre-lock count; the lock above bumped it, so
    // `attempts + 1` is how many times this row has actually been tried.
    if (row.attempts + 1 >= MAX_SEND_ATTEMPTS) {
      const { error: failErr } = await supabaseAdmin()
        .from('whatsapp_outbox')
        .update({ status: 'failed', error: message, attempts: row.attempts + 1 })
        .eq('id', row.id)
      if (failErr) console.error('[wa:worker] outbox fail-write failed:', failErr.message)
    } else {
      // Back to pending for the next cycle (attempts already bumped by the lock).
      const { error: retryErr } = await supabaseAdmin()
        .from('whatsapp_outbox')
        .update({ status: 'pending', error: message })
        .eq('id', row.id)
      if (retryErr) console.error('[wa:worker] outbox retry-write failed:', retryErr.message)
    }
  }
}

/**
 * Resolve the internal reply target into the transport-side quote
 * context Baileys needs. Returns null when there's nothing to quote or
 * the parent can't be found (renders without a reply bubble).
 */
async function resolveQuote(row: WhatsAppOutboxRow): Promise<QuoteInfo | null> {
  const replyTo = (row.payload as { replyToMessageId?: string } | null)?.replyToMessageId
  if (!replyTo || !row.conversation_id) return null

  const { data, error } = await supabaseAdmin()
    .from('messages')
    .select('message_id, sender_type, content_text')
    .eq('id', replyTo)
    .eq('conversation_id', row.conversation_id)
    .maybeSingle()

  if (error || !data?.message_id) {
    console.warn('[wa:worker] quote parent not found; sending without quote')
    return null
  }
  return {
    id: data.message_id as string,
    fromMe: (data.sender_type as string) === 'agent',
    text: (data.content_text as string | null) ?? null,
  }
}

/**
 * Persist the delivered outbound message — the same insert the old Meta
 * path performed, now done by the worker after the socket confirms
 * delivery so a Next.js request never holds a socket.
 */
async function persistSentMessage(
  row: WhatsAppOutboxRow,
  payload: {
    text?: string
    mediaUrl?: string
    caption?: string
    filename?: string
    ptt?: boolean
    replyToMessageId?: string
  } | null,
  wamid: string,
): Promise<void> {
  const isMedia =
    row.message_type === 'image' ||
    row.message_type === 'video' ||
    row.message_type === 'audio' ||
    row.message_type === 'document'

  const contentText = isMedia ? payload?.caption ?? null : payload?.text ?? null
  const lastMessageText =
    contentText ?? (isMedia ? `[${row.message_type}]` : '[text]')

  const { error: msgError } = await supabaseAdmin().from('messages').insert({
    conversation_id: row.conversation_id,
    sender_type: 'agent',
    content_type: row.message_type,
    content_text: contentText,
    media_url: isMedia ? payload?.mediaUrl ?? null : null,
    message_id: wamid,
    status: 'sent',
    reply_to_message_id: payload?.replyToMessageId ?? null,
  })
  if (msgError) {
    console.error('[wa:worker] error inserting sent message:', msgError.message)
  }

  if (row.conversation_id) {
    const { error: convError } = await supabaseAdmin()
      .from('conversations')
      .update({
        last_message_text: lastMessageText,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.conversation_id)
    if (convError) {
      console.error('[wa:worker] error updating conversation:', convError.message)
    }
  }
}

async function pollOutbox(): Promise<void> {
  const { data: rows, error } = await supabaseAdmin()
    .from('whatsapp_outbox')
    .select('*')
    .in('status', ['pending', 'sending'])
    .order('created_at', { ascending: true })
    .limit(25)

  if (error) {
    console.error('[wa:worker] outbox poll failed:', error.message)
    return
  }
  for (const row of rows ?? []) {
    await sendOutboxRow(row as WhatsAppOutboxRow)
  }
}

// ------------------------------------------------------------
// Session registry sweep — connect new rows, drop removed ones
// ------------------------------------------------------------

async function sweepSessions(): Promise<void> {
  const { data: rows, error } = await supabaseAdmin()
    .from('whatsapp_sessions')
    .select('id, account_id, name, status, refresh_requested_at, qr_expires_at')

  if (error) {
    console.error('[wa:worker] session sweep failed:', error.message)
    return
  }

  // Paused = no socket should exist: DISCONNECTED (operator turned it
  // off) and ERROR (logged out — terminal until re-pair). Every other
  // status — CONNECTING / QR_CODE / CONNECTED / RECONNECTING — is
  // worker-managed, including freshly-created rows, which start as
  // CONNECTING so pairing begins immediately.
  const pausedStatuses = new Set<SessionStatus>(['DISCONNECTED', 'ERROR'])
  const wanted = new Set<string>()
  const paused = new Set<string>()

  for (const row of (rows ?? []) as Array<WhatsAppSessionRow>) {
    wanted.add(row.id)
    if (pausedStatuses.has(row.status)) {
      paused.add(row.id)
      continue
    }
    // A refresh request newer than the live socket means the operator
    // clicked "Atualizar QR / Reconnect" — the API route (separate
    // process) stamps refresh_requested_at. Drop the possibly-stuck
    // socket and rebuild below so a fresh QR is emitted. Skipped for
    // CONNECTED rows (nothing to refresh; avoids a needless blip).
    const existing = getSession(row.id)
    const refreshNewer =
      existing &&
      row.status !== 'CONNECTED' &&
      row.refresh_requested_at &&
      new Date(row.refresh_requested_at).getTime() > existing.createdAt
    if (refreshNewer) {
      console.log(`[wa:worker] refresh requested for ${row.id} — rebuilding socket`)
      unregisterSession(row.id)
    } else if (
      // Self-renewing QR: Baileys emits fresh codes while it stays in the
      // pairing loop, but if the socket died (QR-refs exhausted, no
      // auto-reconnect) the last code goes stale. Rebuild so a new code
      // is emitted instead of leaving an expired QR on screen.
      existing &&
      row.status === 'QR_CODE' &&
      row.qr_expires_at &&
      new Date(row.qr_expires_at).getTime() < Date.now()
    ) {
      console.log(`[wa:worker] QR expired for ${row.id} — rebuilding socket for fresh QR`)
      unregisterSession(row.id)
    }

    if (!getSession(row.id)) {
      await connectSession(row.id, row.account_id, {
        onQr: () => {}, // QR handled via onConnectionUpdate (update.qr)
        onConnectionUpdate: handleConnectionUpdate,
        onUpsert: (sessionId, sock, msgs) => void handleUpsert(sessionId, sock, msgs),
      })
      console.log(`[wa:worker] connected socket for session ${row.id} (${row.name})`)
    }
  }

  // Drop sockets for rows that were deleted from the DB OR paused. A
  // paused socket must not linger — the sessions UI shows "Disconnected"
  // and re-pairing (Atualizar QR → CONNECTING) must start from a clean
  // registry or the old socket would swallow the new connection.
  for (const sessionId of listSessionIds()) {
    if (!wanted.has(sessionId) || paused.has(sessionId)) {
      console.log(
        `[wa:worker] unregistering session ${sessionId}` +
          (wanted.has(sessionId) ? ' (paused)' : ' (removed)'),
      )
      unregisterSession(sessionId)
    }
  }
}

// ------------------------------------------------------------
// Main loop
// ------------------------------------------------------------

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error(
      '[wa:worker] missing SUPABASE env vars. Check .env.local has NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    )
    process.exit(1)
  }

  console.log('[wa:worker] starting…')

  // Initial connect + periodic sweep.
  await sweepSessions()
  setInterval(() => void sweepSessions(), SESSION_SWEEP_MS)
  setInterval(() => void pollOutbox(), OUTBOX_POLL_MS)

  const shutdown = () => {
    console.log('[wa:worker] shutting down…')
    for (const id of listSessionIds()) unregisterSession(id)
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('[wa:worker] fatal:', err)
  process.exit(1)
})
