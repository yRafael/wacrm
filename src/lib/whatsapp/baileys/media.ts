// ============================================================
// Inbound media pipeline — Baileys bytes → public Storage URL.
//
// Worker-only (imports @whiskeysockets/baileys). Downloads the
// media payload of an inbound message and uploads it to the
// `chat-media` bucket under the account-scoped path from migration
// 023. The public URL is what `processInboundMessage` stores as
// `media_url` — the exact same shape the inbox renders for outbound
// attachments, so the UI needs no new branches.
// ============================================================

import { downloadMediaMessage } from '@whiskeysockets/baileys'
import type { WASocket, WAMessage } from '@whiskeysockets/baileys'

import { supabaseAdmin } from '@/lib/flows/admin-client'
import { buildMediaPath } from '@/lib/storage/upload-media'
import type { BaileysMessageLike } from './types'

const CHAT_MEDIA_BUCKET = 'chat-media'

/** Map a MIME type to a file extension the bucket will accept. */
function extensionFromMime(mime?: string | null): string {
  switch (mime?.toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'video/mp4':
      return 'mp4';
    case 'video/3gpp':
      return '3gp';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/aac':
      return 'aac';
    case 'audio/mp4':
      return 'm4a';
    case 'audio/amr':
      return 'amr';
    case 'application/pdf':
      return 'pdf';
    default:
      return 'bin';
  }
}

export interface InboundMediaResult {
  /** Public URL stored on the message row. */
  url: string;
  mime?: string | null;
}

/**
 * Download an inbound media message and upload it to Storage. Returns
 * null when the bytes can't be obtained (already-deleted media, old
 * message) or the upload is rejected (MIME not allow-listed) — the
 * caller stores the message with `media_url` null rather than dropping
 * the whole conversation.
 */
export async function downloadAndUploadInboundMedia(
  sock: WASocket,
  msg: BaileysMessageLike,
  accountId: string,
  mime?: string | null,
  filename?: string | null,
): Promise<InboundMediaResult | null> {
  try {
    // `reuploadRequest` lets Baileys re-request the media from the server
    // when the cached URL has expired — otherwise old messages fail to
    // download after ~a day. Both `reuploadRequest` and `logger` are
    // required by the download ctx: the socket's `updateMediaMessage`
    // re-requests the bytes, and the socket's own `logger` reports them.
    const buffer = await downloadMediaMessage(
      // BaileysMessageLike is our structural view of the raw event; the
      // runtime value IS a WAMessage straight from the socket, so this
      // cast is type-only.
      msg as WAMessage,
      'buffer',
      {},
      {
        logger: sock.logger,
        reuploadRequest: (message) => sock.updateMediaMessage(message),
      },
    );

    const ext = extensionFromMime(mime);
    const baseName = filename?.replace(/[^a-zA-Z0-9._-]/g, '_') || `media.${ext}`;
    const path = buildMediaPath(accountId, baseName);

    const { error: uploadError } = await supabaseAdmin()
      .storage.from(CHAT_MEDIA_BUCKET)
      .upload(path, buffer, {
        cacheControl: '3600',
        upsert: false,
        contentType: mime || undefined,
      });

    if (uploadError) {
      console.error(
        '[wa:media] upload failed (MIME allow-listed?):',
        uploadError.message,
        { mime, filename },
      );
      return null;
    }

    const { data: { publicUrl } } = supabaseAdmin()
      .storage.from(CHAT_MEDIA_BUCKET)
      .getPublicUrl(path);

    return { url: publicUrl, mime };
  } catch (err) {
    console.error('[wa:media] download failed:', (err as Error).message);
    return null;
  }
}
