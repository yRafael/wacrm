// ============================================================
// Baileys outbound sender — maps a `whatsapp_outbox` row to a
// socket `sendMessage` call.
//
// This module lives at the socket boundary (it is only ever
// imported by the worker), so it imports Baileys freely. Everything
// else works against the structural shapes in types.ts.
//
// Media is passed as a public Storage URL — Baileys downloads the
// bytes itself from `{ url }` during send, so the worker never has
// to stream the file through its own memory.
// ============================================================

import type { WASocket, AnyMessageContent, WAMessage } from '@whiskeysockets/baileys'

import type { OutboxMessageType, OutboxPayload } from './types'

/**
 * WhatsApp LIDs are 15-digit identifiers, not E.164 phone numbers.
 * Baileys v7 can address a 1:1 chat by LID, and when the contact's
 * stored "phone" is actually a LID (see worker handleUpsert — inbound
 * arrives @lid) routing it to the PN namespace (`<digits>@s.whatsapp.net`)
 * targets a JID that does not exist, so the message is silently dropped.
 * Send to `<digits>@lid` instead — Baileys resolves the recipient's
 * devices via USync at send time (messages-send.js withLIDProtocol).
 */
const LID_NUMBER_RE = /^\d{15}$/

export function phoneToJid(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (LID_NUMBER_RE.test(digits)) return `${digits}@lid`
  return `${digits}@s.whatsapp.net`
}

export interface QuoteInfo {
  /** Transport-side message id of the quoted message. */
  id: string;
  /** True when the quoted message was sent by us. */
  fromMe: boolean;
  text?: string | null;
  /** Baileys content-type key (e.g. 'conversation' | 'imageMessage'). */
  type?: string | null;
}

export interface SendViaBaileysOptions {
  /** Phone (digits, with country code). */
  to: string;
  messageType: OutboxMessageType;
  payload: OutboxPayload | null;
  /** Resolved reply-quote context, optional. */
  quoted?: QuoteInfo | null;
}

/**
 * Send one outbox message over the socket. Returns the WhatsApp
 * message id (the wamid) so the worker can store it for reply-mapping
 * and dedupe-on-retry.
 *
 * Throws on network/socket errors — the caller owns retry policy.
 */
export async function sendViaBaileys(
  sock: WASocket,
  options: SendViaBaileysOptions,
): Promise<string> {
  const { to, messageType, payload, quoted } = options
  const jid = phoneToJid(to)
  const content = buildContent(jid, messageType, payload)
  const extra = quoted ? { quoted: buildQuotedMessage(jid, quoted) } : undefined

  const sent = await sock.sendMessage(jid, content, extra)
  return sent?.key?.id ?? ''
}

function buildContent(
  jid: string,
  messageType: OutboxMessageType,
  payload: OutboxPayload | null,
): AnyMessageContent {
  switch (messageType) {
    case 'text': {
      const text = (payload as { text?: string } | null)?.text ?? ''
      return { text }
    }

    case 'reaction': {
      const { messageId, emoji } = (payload as {
        messageId: string;
        emoji: string;
      }) ?? { messageId: '', emoji: '' };
      return {
        react: {
          text: emoji || '',
          key: { remoteJid: jid, id: messageId, fromMe: false },
        },
      };
    }

    case 'image': {
      const p = payload as { mediaUrl?: string; caption?: string } | null;
      return { image: { url: p?.mediaUrl ?? '' }, caption: p?.caption };
    }

    case 'video': {
      const p = payload as { mediaUrl?: string; caption?: string } | null;
      return { video: { url: p?.mediaUrl ?? '' }, caption: p?.caption };
    }

    case 'audio': {
      const p = payload as { mediaUrl?: string; ptt?: boolean } | null;
      return { audio: { url: p?.mediaUrl ?? '' }, ptt: p?.ptt ?? true };
    }

    case 'document': {
      const p = payload as {
        mediaUrl?: string;
        caption?: string;
        filename?: string;
      } | null;
      // In Baileys v7 `document` is a bare WAMediaUpload; fileName,
      // caption and mimetype are siblings of it (Message.d.ts).
      return {
        document: { url: p?.mediaUrl ?? '' },
        mimetype: 'application/octet-stream',
        fileName: p?.filename ?? 'arquivo',
        caption: p?.caption,
      };
    }
  }
}

/**
 * Build the `quoted` structure Baileys uses to render a reply bubble.
 * The quoted message's content is reconstructed from the internal
 * `messages` row (resolved by the worker) so the recipient sees the
 * text they replied to — the transport id drives the highlight.
 */
function buildQuotedMessage(jid: string, q: QuoteInfo): WAMessage {
  return {
    key: { remoteJid: jid, id: q.id, fromMe: q.fromMe },
    message: { conversation: q.text ?? '' },
  };
}
