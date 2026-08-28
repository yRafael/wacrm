import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { resolveAccountId } from '@/lib/whatsapp/sessions';
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

/**
 * POST /api/whatsapp/react
 *
 * Body: { message_id: <internal UUID>, emoji: <single emoji or "" to remove> }
 *
 * Agent reactions are queued on `whatsapp_outbox` as a `reaction` row for
 * the Baileys worker: the worker sends it over the socket as a `react`
 * message (payload.messageId = transport-side target id, payload.emoji =
 * react.text) and marks the row `sent`. Reactions are state, not messages,
 * so the worker never writes a `messages` row for them.
 *
 * The DB mirror into `message_reactions` (actor_type = 'agent') is written
 * here so the thread stays in sync over Realtime. It's optimistic — the
 * worker doesn't persist agent reactions — so if the worker later fails to
 * deliver (e.g. session dropped), the outbox row lands on `failed` and the
 * stale reaction should be reconciled manually. That's an acceptable
 * trade-off in a manual-ops workspace, where failed sends are rare.
 */
export async function POST(request: Request) {
  try {
    // Reacting is a write (queues an outbox row + DB mirror) — require
    // `agent`; viewers are read-only.
    let ctx;
    try {
      ctx = await requireRole('agent');
    } catch (err) {
      return toErrorResponse(err);
    }
    const supabase = ctx.supabase;

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const limit = checkRateLimit(`react:${user.id}`, RATE_LIMITS.react);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 }
      );
    }

    const body = (await request.json()) as {
      message_id?: string;
      emoji?: string;
    };
    const { message_id, emoji } = body;

    if (typeof message_id !== 'string' || typeof emoji !== 'string') {
      return NextResponse.json(
        { error: 'message_id and emoji are required' },
        { status: 400 }
      );
    }

    // Resolve target message within this account's conversations.
    const { data: targetMessage, error: msgError } = await supabase
      .from('messages')
      .select('id, message_id, conversation_id')
      .eq('id', message_id)
      .maybeSingle();

    if (msgError || !targetMessage) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    if (!targetMessage.message_id) {
      // No transport-side id yet (usually a still-sending/failed agent
      // message) — WhatsApp can't react to something never delivered.
      return NextResponse.json(
        {
          error: 'Cannot react to a message that has not been sent to WhatsApp',
        },
        { status: 400 }
      );
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, contact:contacts(phone)')
      .eq('id', targetMessage.conversation_id)
      .eq('account_id', accountId)
      .maybeSingle();

    if (convError || !conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    const contact = Array.isArray(conversation.contact)
      ? conversation.contact[0]
      : conversation.contact;
    if (!contact?.phone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 }
      );
    }

    // Queue the reaction for the Baileys worker.
    const { error: enqueueError } = await supabase
      .from('whatsapp_outbox')
      .insert({
        account_id: accountId,
        conversation_id: targetMessage.conversation_id,
        to_phone: sanitizePhoneForMeta(contact.phone),
        message_type: 'reaction',
        payload: { messageId: targetMessage.message_id, emoji },
        status: 'pending',
      });

    if (enqueueError) {
      console.error(
        '[whatsapp/react] outbox enqueue failed:',
        enqueueError.message
      );
      return NextResponse.json(
        { error: `Failed to queue reaction: ${enqueueError.message}` },
        { status: 500 }
      );
    }

    // Mirror into DB. Empty emoji = removal. This keeps the thread in sync
    // over Realtime for other connected agents.
    if (emoji === '') {
      const { error: delError } = await supabase
        .from('message_reactions')
        .delete()
        .eq('message_id', targetMessage.id)
        .eq('actor_type', 'agent')
        .eq('actor_id', user.id);

      if (delError) {
        console.error('[whatsapp/react] DB delete failed:', delError.message);
        return NextResponse.json(
          { error: 'Reaction queued but DB delete failed' },
          { status: 500 }
        );
      }
    } else {
      // Upsert. The unique constraint (message_id, actor_type, actor_id)
      // lets us swap emoji in a single statement.
      const { error: upsertError } = await supabase
        .from('message_reactions')
        .upsert(
          {
            message_id: targetMessage.id,
            conversation_id: targetMessage.conversation_id,
            actor_type: 'agent',
            actor_id: user.id,
            emoji,
          },
          { onConflict: 'message_id,actor_type,actor_id' }
        );

      if (upsertError) {
        console.error(
          '[whatsapp/react] DB upsert failed:',
          upsertError.message
        );
        return NextResponse.json(
          { error: 'Reaction queued but DB upsert failed' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in WhatsApp react POST:', error);
    return NextResponse.json(
      { error: 'Failed to react to message' },
      { status: 500 }
    );
  }
}
