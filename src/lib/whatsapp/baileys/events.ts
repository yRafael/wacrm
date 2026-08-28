// ============================================================
// Baileys inbound mapping — pure event → normalized message.
//
// These functions are the ONLY place that knows how a Baileys
// upsert becomes an `InboundMessagePayload`. They take plain
// structural shapes (types.ts) and never touch a socket, so they are
// trivially unit-testable and the app bundle never drags Baileys in.
//
// Media is deliberately left unresolved here: the worker downloads
// the bytes, uploads them to Storage, and stamps the public `mediaUrl`
// onto the payload before calling `processInboundMessage`. This keeps
// the mapping pure (no I/O) and the storage decision in one place.
// ============================================================

import type { BaileysMessageLike, InboundMessagePayload } from './types';

// ------------------------------------------------------------
// JID helpers
// ------------------------------------------------------------

const PERSONAL_JID_SUFFIX = '@s.whatsapp.net';
const LID_SUFFIX = '@lid';

/** True when the remote is a personal (1:1) chat we can serve. */
export function isPersonalChat(jid?: string | null): jid is string {
  if (!jid) return false;
  if (jid.endsWith(PERSONAL_JID_SUFFIX)) return true;
  if (jid.endsWith(LID_SUFFIX)) return true;
  return false;
}

/**
 * Extract the customer phone from a 1:1 chat JID. Returns null for
 * groups / status / broadcast so the worker never creates contacts
 * for non-personal chats. Note: for a `@lid` JID this returns the
 * LID digits, not a real phone — call `extractLidJid` and resolve
 * via the socket's LID↔PN store when you need a phone.
 */
export function extractPhoneFromJid(jid?: string | null): string | null {
  if (!isPersonalChat(jid)) return null;
  return jid.split('@')[0] ?? null;
}

/**
 * Full LID JID (`<lid>@lid`) when the chat is LID-addressed, else
 * null. Baileys v7 delivers 1:1 chats with `@lid` remoteJids; the
 * worker uses this to resolve the real phone before persisting.
 */
export function extractLidJid(jid?: string | null): string | null {
  if (!jid || !jid.endsWith(LID_SUFFIX)) return null;
  return jid;
}

// ------------------------------------------------------------
// Field extractors — each returns null when the field is absent
// ------------------------------------------------------------

function extractText(msg: BaileysMessageLike): string | null {
  const m = msg.message;
  if (!m) return null;
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  return null;
}

interface ExtractedMedia {
  type: 'image' | 'video' | 'audio' | 'document';
  mime?: string | null;
  filename?: string | null;
  caption?: string | null;
  ptt?: boolean;
  /** True when a `url` was present — the worker will download it. */
  hasDownload: boolean;
}

function extractMedia(msg: BaileysMessageLike): ExtractedMedia | null {
  const m = msg.message;
  if (!m) return null;

  if (m.imageMessage) {
    return {
      type: 'image',
      mime: m.imageMessage.mimetype ?? 'image/jpeg',
      caption: m.imageMessage.caption ?? null,
      hasDownload: Boolean(m.imageMessage.url),
    };
  }
  if (m.videoMessage) {
    return {
      type: 'video',
      mime: m.videoMessage.mimetype ?? 'video/mp4',
      caption: m.videoMessage.caption ?? null,
      hasDownload: Boolean(m.videoMessage.url),
    };
  }
  if (m.audioMessage) {
    return {
      type: 'audio',
      mime: m.audioMessage.mimetype ?? 'audio/ogg',
      ptt: Boolean(m.audioMessage.ptt),
      hasDownload: Boolean(m.audioMessage.url),
    };
  }
  if (m.documentMessage) {
    return {
      type: 'document',
      mime: m.documentMessage.mimetype ?? null,
      filename: m.documentMessage.fileName ?? null,
      caption: m.documentMessage.caption ?? null,
      hasDownload: Boolean(m.documentMessage.url),
    };
  }
  return null;
}

function extractReaction(msg: BaileysMessageLike): {
  messageId: string;
  emoji: string;
} | null {
  const r = msg.message?.reactionMessage;
  if (!r) return null;
  return {
    messageId: r.key?.id ?? '',
    emoji: r.text ?? '',
  };
}

/** Quoted-message id (the stanzaId of the parent) — for swipe replies. */
function extractReplyToMessageId(msg: BaileysMessageLike): string | null {
  const ci = msg.message?.extendedTextMessage?.contextInfo;
  if (!ci) return null;
  if (!ci.quotedMessage) return null;
  return ci.stanzaId ?? null;
}

function extractTimestamp(ts?: number | { low: number; high: number }): number {
  if (typeof ts === 'number') return ts;
  if (ts && typeof ts.low === 'number') return ts.low;
  return Math.floor(Date.now() / 1000);
}

function extractLocation(msg: BaileysMessageLike): string | null {
  const loc = msg.message?.locationMessage;
  if (!loc) return null;
  const lat = loc.degreesLatitude;
  const lng = loc.degreesLongitude;
  if (lat == null || lng == null) return null;
  return `https://maps.google.com/?q=${lat},${lng}`;
}

// ------------------------------------------------------------
// Normalization
// ------------------------------------------------------------

/**
 * Convert one inbound Baileys message into the normalized payload.
 * Returns null for messages that should be skipped:
 *   - group/status/broadcast traffic,
 *   - protocol traffic (revokes, ephemeral settings),
 *   - unsupported payloads.
 *
 * Messages sent by the connected account (fromMe) are included so the
 * worker can persist outbound echoes from WhatsApp Web/App — the caller
 * marks these with `sender_type: 'agent'`.
 */
export function normalizeInboundMessage(
  msg: BaileysMessageLike
): InboundMessagePayload | null {
  if (!isPersonalChat(msg.key.remoteJid)) return null;

  const from = extractPhoneFromJid(msg.key.remoteJid);
  if (!from) return null;

  // Protocol messages carry no user content — ignore.
  if (msg.message?.protocolMessage) return null;

  // Skip empty payloads (e.g. delete "for everyone" placeholders).
  if (!msg.message || Object.keys(msg.message).length === 0) return null;

  const base = {
    id: msg.key.id,
    from,
    timestamp: extractTimestamp(msg.messageTimestamp),
    pushName: msg.pushName ?? null,
    fromMe: msg.key.fromMe,
  };

  // Reactions are a separate state, not a message.
  const reaction = extractReaction(msg);
  if (reaction) {
    return { ...base, type: 'reaction', reaction };
  }

  const media = extractMedia(msg);
  if (media) {
    return {
      ...base,
      type: media.type,
      text: media.caption ?? null,
      mediaMime: media.mime ?? null,
      mediaFilename: media.filename ?? null,
      mediaAvailable: media.hasDownload,
      replyToMessageId: extractReplyToMessageId(msg),
    };
  }

  const location = extractLocation(msg);
  if (location) {
    return { ...base, type: 'location', text: location };
  }

  const text = extractText(msg);
  if (text) {
    return {
      ...base,
      type: 'text',
      text,
      replyToMessageId: extractReplyToMessageId(msg),
    };
  }

  // Sticker / other unsupported → null (skip silently).
  return null;
}

// ------------------------------------------------------------
// Type refinement for the worker's media branch
// ------------------------------------------------------------

/** True when the payload's media bytes still need downloading. */
export function requiresMediaDownload(
  message: InboundMessagePayload
): message is InboundMessagePayload & { mediaAvailable: true } {
  return (
    (message.type === 'image' ||
      message.type === 'video' ||
      message.type === 'audio' ||
      message.type === 'document') &&
    Boolean(message.mediaAvailable)
  );
}
