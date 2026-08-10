// ============================================================
// Baileys transport types — mirror the doc's session states
// (Cap. 41) and the `whatsapp_sessions` / `whatsapp_outbox` tables
// from migration 037.
//
// Baileys' own types are intentionally NOT imported here. The worker
// is the only boundary that touches `@whiskeysockets/baileys`; every
// other module (events, inbound-process, the API routes) works
// against these plain structural shapes so they stay unit-testable
// without a socket and the app bundle never drags Baileys in.
// ============================================================

export const SESSION_STATUSES = [
  'DISCONNECTED',
  'CONNECTING',
  'QR_CODE',
  'CONNECTED',
  'RECONNECTING',
  'ERROR',
  'BLOCKED',
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const OUTBOX_STATUSES = ['pending', 'sending', 'sent', 'failed'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const OUTBOX_MESSAGE_TYPES = [
  'text',
  'image',
  'video',
  'audio',
  'document',
  'reaction',
] as const;
export type OutboxMessageType = (typeof OUTBOX_MESSAGE_TYPES)[number];

// ------------------------------------------------------------
// DB row shapes (the columns we read/write)
// ------------------------------------------------------------

export interface WhatsAppSessionRow {
  id: string;
  account_id: string;
  name: string;
  phone: string | null;
  status: SessionStatus;
  provider: string;
  session_identifier: string | null;
  qr_data: string | null;
  qr_expires_at: string | null;
  connected_at: string | null;
  last_activity: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Stamped by the /refresh route so the worker can force a fresh
   * socket (the route runs in Next.js and can't touch the worker's
   * in-memory registry). The sweep rebuilds when this is newer than
   * the live socket.
   */
  refresh_requested_at: string | null;
}

export interface WhatsAppOutboxRow {
  id: string;
  account_id: string;
  session_id: string | null;
  conversation_id: string | null;
  to_phone: string;
  message_type: OutboxMessageType;
  payload: OutboxPayload | null;
  status: OutboxStatus;
  error: string | null;
  attempts: number;
  wamid: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

// ------------------------------------------------------------
// Outbox payloads
// ------------------------------------------------------------

export interface OutboxTextPayload {
  text: string;
  /** Internal UUID of the message being quoted (reply). */
  replyToMessageId?: string;
}

export interface OutboxMediaPayload {
  mediaUrl: string;
  caption?: string;
  filename?: string;
  /** audio only: send as a voice note (ptt). */
  ptt?: boolean;
  /** Internal UUID of the message being quoted (reply). */
  replyToMessageId?: string;
}

export interface OutboxReactionPayload {
  /** Meta-side message id of the target message. */
  messageId: string;
  /** Empty string removes the reaction. */
  emoji: string;
}

export type OutboxPayload =
  | OutboxTextPayload
  | OutboxMediaPayload
  | OutboxReactionPayload
  | Record<string, unknown>;

// ------------------------------------------------------------
// Normalized inbound message — produced by events.ts from a
// Baileys upsert and consumed by inbound-process.ts. Media is
// already downloaded + uploaded to Storage by then; `mediaUrl` is a
// public Supabase Storage URL (the same `media_url` shape the inbox
// renders today).
// ------------------------------------------------------------

export type InboundContentType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'location'
  | 'reaction';

export interface InboundMessagePayload {
  /** Baileys message key id (message.key.id). */
  id: string;
  /**
   * Sender phone (digits only, no country-prefix assumptions). When
   * the chat arrived `@lid` and the worker resolved a real phone, this
   * holds the real phone; otherwise it falls back to the LID digits.
   */
  from: string;
  /**
   * WhatsApp LID digits when the message arrived in a `@lid`-addressed
   * chat. Lets inbound-process migrate a contact that was previously
   * stored under the LID phone to the real phone (no duplicate).
   */
  lid?: string | null;
  /** Unix seconds. */
  timestamp: number;
  type: InboundContentType;
  /** Nullable — the mapper emits `null` when a media message has no caption. */
  text?: string | null;
  /** Contact display name from the WhatsApp profile (pushName). */
  pushName?: string | null;
  /**
   * Public Storage URL, stamped by the worker after download+upload.
   * Null until then (media messages are normalized without it).
   */
  mediaUrl?: string | null;
  mediaMime?: string | null;
  /** For document messages — shown as caption when no caption given. */
  mediaFilename?: string | null;
  /**
   * True when the message carried downloadable bytes. The worker only
   * attempts a download when this is set (missing media = already
   * deleted / too old to fetch).
   */
  mediaAvailable?: boolean;
  /** For reactions — the target message id + emoji. */
  reaction?: { messageId: string; emoji: string };
  /** Set when the inbound is a swipe-reply to one of our messages. */
  replyToMessageId?: string | null;
}

// ------------------------------------------------------------
// Minimal Baileys message shape (for events.ts mapping). Only the
// fields the mapper reads; cast at the socket boundary.
// ------------------------------------------------------------

export interface BaileysMessageLike {
  key: {
    id: string;
    remoteJid: string;
    fromMe: boolean;
    participant?: string;
  };
  message?: {
    conversation?: string;
    extendedTextMessage?: {
      text?: string;
      contextInfo?: {
        stanzaId?: string;
        quotedMessage?: unknown;
      };
    };
    imageMessage?: { caption?: string; mimetype?: string; url?: string };
    videoMessage?: { caption?: string; mimetype?: string; url?: string };
    audioMessage?: { mimetype?: string; seconds?: number; url?: string; ptt?: boolean };
    documentMessage?: { fileName?: string; mimetype?: string; caption?: string; url?: string };
    stickerMessage?: { mimetype?: string; url?: string };
    locationMessage?: { degreesLatitude?: number; degreesLongitude?: number; name?: string };
    reactionMessage?: { key?: { id?: string }; text?: string };
    protocolMessage?: { type?: number };
    [key: string]: unknown;
  };
  messageTimestamp?: number | { low: number; high: number };
  pushName?: string;
  messageStubType?: number;
}
