// ============================================================
// Outbound message send — the core that both the dashboard's
// `/api/whatsapp/send` route and the public `/api/v1/messages`
// endpoint call.
//
// Given a conversation and message params, this:
//   1. validates the params for the message type,
//   2. loads the conversation + contact,
//   3. resolves the reply context,
//   4. ENQUEUES a `whatsapp_outbox` row (status `pending`) and returns.
//
// The actual delivery is owned by the Baileys worker, which polls the
// outbox, sends over the socket, and persists the `messages` row + the
// conversation update. This keeps a Next.js request from ever holding a
// socket and lets sends survive an app restart mid-flight (migration 037).
//
// `template` and `interactive` are Meta-Cloud-API-only payloads that
// Baileys cannot send — they are rejected here and stay dormant.
//
// It is transport-agnostic: it takes a `SupabaseClient` and an
// `accountId` and throws `SendMessageError` on failure. The callers
// own auth, rate-limiting, body parsing, and mapping the error to
// their respective response shapes (internal `{ error }` vs the v1
// envelope).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  validateInteractivePayload,
  type InteractiveMessagePayload,
} from '@/lib/whatsapp/interactive';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import type { OutboxPayload } from '@/lib/whatsapp/baileys/types';

export const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const VALID_MESSAGE_TYPES = [
  'text',
  'template',
  'interactive',
  ...MEDIA_KINDS,
] as const;

/**
 * Typed failure with a machine `code` and a suggested HTTP `status`.
 * Callers map it to their own response shape (`toErrorResponse` for
 * the dashboard route, the v1 envelope for the public endpoint).
 */
export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Legacy positional body params (only used if messageParams.body unset). */
  templateParams?: string[];
  /** Structured template params (header/body/buttons). */
  templateMessageParams?: unknown;
  /** Structured payload for `messageType === 'interactive'`. */
  interactivePayload?: InteractiveMessagePayload | null;
  replyToMessageId?: string | null;
}

export interface SendMessageResult {
  /**
   * The enqueued `whatsapp_outbox.id`. The `messages` row is created
   * later by the worker once the socket confirms delivery.
   */
  messageId: string;
  /**
   * Empty for a queued send. The worker writes the real WhatsApp id
   * back onto the outbox row (`wamid`) and the persisted message.
   */
  whatsappMessageId: string;
}

/**
 * Send a message in an existing conversation by enqueueing it on the
 * outbox.
 *
 * `db` may be an RLS-scoped user client (dashboard) or the service-
 * role client (public API) — every query is filtered by `accountId`
 * either way, so tenancy holds regardless of which client is passed.
 */
/**
 * Validate the message-shape params (type, required content, caption
 * cap) independently of any DB state, throwing `SendMessageError` on a
 * bad payload. Exported so a caller can reject a malformed request
 * *before* it finds-or-creates a contact/conversation — otherwise an
 * invalid payload leaves an orphan empty conversation behind. The send
 * core calls this too, so validation can't be skipped.
 */
export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
  interactivePayload?: InteractiveMessagePayload | null;
}): void {
  const {
    messageType,
    contentText,
    mediaUrl,
    templateName,
    interactivePayload,
  } = params;

  if (!messageType) {
    throw new SendMessageError('bad_request', 'message_type is required', 400);
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendMessageError(
      'bad_request',
      `Tipo de mensagem não suportado "${messageType}"`,
      400
    );
  }

  if (messageType === 'text' && !contentText) {
    throw new SendMessageError(
      'bad_request',
      'content_text é obrigatório para mensagens de texto',
      400
    );
  }

  if (messageType === 'template' && !templateName) {
    throw new SendMessageError(
      'bad_request',
      'template_name é obrigatório para mensagens de template',
      400
    );
  }

  // Interactive: validate the full structured payload against Meta's
  // limits up front so a bad payload 400s before we touch Meta.
  if (messageType === 'interactive') {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      throw new SendMessageError('bad_request', result.error, 400);
    }
  }

  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError(
      'bad_request',
      `media_url é obrigatório para mensagens de ${messageType}`,
      400
    );
  }

  // Meta caps media captions at 1024 chars (audio carries none).
  if (
    isMediaKind &&
    messageType !== 'audio' &&
    typeof contentText === 'string' &&
    contentText.length > 1024
  ) {
    throw new SendMessageError(
      'bad_request',
      'A legenda excede o limite de 1024 caracteres',
      400
    );
  }
}

export async function sendMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams
): Promise<SendMessageResult> {
  const {
    conversationId,
    messageType,
    contentText,
    mediaUrl,
    filename,
    templateName,
    interactivePayload,
    replyToMessageId,
  } = params;

  if (!conversationId) {
    throw new SendMessageError(
      'bad_request',
      'conversation_id é obrigatório',
      400
    );
  }

  validateSendMessageParams({
    messageType,
    contentText,
    mediaUrl,
    templateName,
    interactivePayload,
  });

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  // Conversation + contact, account-scoped.
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (convError || !conversation) {
    throw new SendMessageError('not_found', 'Conversa não encontrada', 404);
  }

  const contact = conversation.contact;
  if (!contact?.phone) {
    throw new SendMessageError(
      'bad_request',
      'Telefone do contato não encontrado',
      400
    );
  }

  const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
  if (!isValidE164(sanitizedPhone)) {
    throw new SendMessageError(
      'bad_request',
      'Formato de número de telefone inválido',
      400
    );
  }

  // The reply target must belong to this same conversation — otherwise a
  // caller could quote messages they can't see by guessing UUIDs. The
  // internal id travels in the outbox payload; the worker resolves the
  // transport id when building the socket quote.
  if (replyToMessageId) {
    const { data: parent, error: parentError } = await db
      .from('messages')
      .select('id')
      .eq('id', replyToMessageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (parentError || !parent) {
      throw new SendMessageError(
        'bad_request',
        'reply_to_message_id não encontrado nesta conversa',
        400
      );
    }
  }

  // Meta-only payloads Baileys cannot send. The outbox schema has no
  // type for them, so reject early rather than leaving a row that can
  // never be delivered (Meta message templates stay dormant).
  if (messageType === 'template' || messageType === 'interactive') {
    throw new SendMessageError(
      'unsupported_type',
      `message_type "${messageType}" exige a Meta Cloud API, que este workspace não utiliza.`,
      400
    );
  }

  // Build the transport-agnostic outbox payload. The worker maps it to
  // a Baileys sendMessage and persists the resulting `messages` row +
  // conversation update (the socket send must not run inside a request).
  const payload: OutboxPayload | null = isMediaKind
    ? {
        mediaUrl: mediaUrl!,
        caption: contentText ?? undefined,
        filename: filename ?? undefined,
        ptt: messageType === 'audio' ? true : undefined,
        replyToMessageId: replyToMessageId ?? undefined,
      }
    : {
        text: contentText ?? '',
        replyToMessageId: replyToMessageId ?? undefined,
      };

  const { data: outboxRow, error: outboxError } = await db
    .from('whatsapp_outbox')
    .insert({
      account_id: accountId,
      conversation_id: conversationId,
      to_phone: sanitizedPhone,
      message_type: messageType,
      payload,
      status: 'pending',
    })
    .select('id')
    .single();

  if (outboxError || !outboxRow) {
    console.error('[send-message] error enqueueing outbox row:', outboxError);
    throw new SendMessageError(
      'db_error',
      `Falha ao enfileirar a mensagem: ${outboxError?.message ?? 'erro desconhecido'}`,
      500
    );
  }

  // Pause any active Flow run for this contact — the agent stepping in
  // is the strongest "yield, human is here" signal. Best-effort.
  try {
    const { error: pauseErr } = await supabaseAdmin()
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .eq('status', 'active');
    if (pauseErr) {
      console.error('[flows] pause-on-agent-send failed:', pauseErr.message);
    }
  } catch (err) {
    console.error(
      '[flows] pause-on-agent-send threw:',
      err instanceof Error ? err.message : err
    );
  }

  return { messageId: outboxRow.id, whatsappMessageId: '' };
}
