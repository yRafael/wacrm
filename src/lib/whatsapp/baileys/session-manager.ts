// ============================================================
// Baileys session manager — socket factory + live registry.
//
// Worker-only (imports @whiskeysockets/baileys + qrcode). Holds one
// live socket per `whatsapp_sessions` row. The worker owns the
// database side (status writes, outbox, inbound persistence) and
// wires it in via the handlers; this module stays pure socket logic
// so nothing else in the app ever needs Baileys.
//
// Auth state is persisted to disk (`useMultiFileAuthState`) under
//   <WA_SESSION_DIR>/<accountId>/<sessionId>/
// which is gitignored. A restart re-uses those creds, so the number
// does NOT need a new QR scan — the socket reconnects on its own.
// ============================================================

import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
} from '@whiskeysockets/baileys'
import type { WASocket, ConnectionState } from '@whiskeysockets/baileys'
import { toDataURL } from 'qrcode'

import type { BaileysMessageLike } from './types'
import { sessionAuthDir } from './paths'

// Path logic lives in `./paths` (no Baileys import) so a Next.js route
// can read/clear the auth dir without pulling Baileys into the bundle.
// The re-export below exposes the helpers to consumers of this module;
// the import above brings `sessionAuthDir` into local scope for line 89.
export { WA_SESSION_DIR, sessionAuthDir } from './paths';

export interface WaSessionHandlers {
  /** Emitted when Baileys produces a new QR string. */
  onQr: (sessionId: string, qrString: string) => void;
  /** Emitted on every socket state change (open/close/connecting…). */
  onConnectionUpdate: (
    sessionId: string,
    sock: WASocket,
    update: Partial<ConnectionState>,
  ) => void;
  /** Emitted for new (or edited) messages from the socket. */
  onUpsert: (
    sessionId: string,
    sock: WASocket,
    messages: BaileysMessageLike[],
    type: 'notify' | 'append',
  ) => void;
}

export interface ActiveSession {
  socket: WASocket;
  /** Set by the worker after the session row is loaded. */
  accountId?: string;
  /** Unix ms the socket was created — the sweep compares it against
   * `whatsapp_sessions.refresh_requested_at` to detect stale sockets. */
  createdAt: number;
}

const liveSockets = new Map<string, ActiveSession>();

export function getSession(sessionId: string): ActiveSession | null {
  return liveSockets.get(sessionId) ?? null;
}

/** All session ids that currently have a live socket registered. */
export function listSessionIds(): string[] {
  return [...liveSockets.keys()];
}

export function setSessionAccount(sessionId: string, accountId: string): void {
  const entry = liveSockets.get(sessionId);
  if (entry) entry.accountId = accountId;
}

export function unregisterSession(sessionId: string): void {
  const entry = liveSockets.get(sessionId);
  if (entry?.socket) {
    entry.socket.end(undefined);
  }
  liveSockets.delete(sessionId);
}

/**
 * Create + register one socket. Reconnects automatically when creds
 * exist on disk (Baileys handles the retry internally); a fresh number
 * emits a QR through the `connection.update` handler.
 */
export async function connectSession(
  sessionId: string,
  accountId: string,
  handlers: WaSessionHandlers,
): Promise<WASocket> {
  const authDir = sessionAuthDir(accountId, sessionId);
  // `useMultiFileAuthState` is a Baileys helper (loads persisted creds
  // from disk), not a React hook — the react-hooks rule only fires because
  // of the "use" prefix.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    browser: Browsers.windows('Fire Workspace'),
    printQRInTerminal: false,
    markOnlineOnConnect: true,
    syncFullHistory: false,
    // No logger aqui: o Baileys aplica o pino default dele, que tem
    // `.child(...)` — passar `undefined` quebra o makeNoiseHandler
    // (TypeError reading 'child').
  });

  liveSockets.set(sessionId, { socket: sock, accountId, createdAt: Date.now() });

  // Persist the refreshed creds after every auth mutation — this is what
  // makes restarts QR-free.
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) =>
    handlers.onConnectionUpdate(sessionId, sock, update),
  );

  sock.ev.on('messages.upsert', ({ messages, type }) =>
    handlers.onUpsert(sessionId, sock, messages as unknown as BaileysMessageLike[], type),
  );

  return sock;
}

/** Convert a raw QR string into the data URL the browser renders. */
export function qrToDataUrl(qr: string): Promise<string> {
  return toDataURL(qr, { width: 300, margin: 2 });
}
