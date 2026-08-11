// ============================================================
// Inbound WhatsApp processing — shared by every transport.
//
// Extracted from the Meta webhook route (which is now deactivated)
// so the Baileys worker can reuse the exact same find-or-create and
// persist logic without duplicating ~400 lines. The function is
// transport-agnostic: it takes a `SupabaseClient` and a *normalized*
// message (`InboundMessagePayload`), so Meta and Baileys both feed
// it the same shape. Media is expected to be already downloaded and
// uploaded to Storage by the caller — `mediaUrl` is a public URL.
//
// Deliberately does NOT dispatch to Flows / Automations / AI reply /
// webhook fan-out: those features are out of scope for the manual-
// operator CRM (the doc's "never send automatically" philosophy), so
// they stay dormant. The core responsibilities here are:
//   1. find-or-create the contact + conversation,
//   2. handle reactions (never a `messages` row),
//   3. persist the message + update the conversation.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import type { InboundMessagePayload } from '@/lib/whatsapp/baileys/types';

/**
 * Persist an inbound reaction. WhatsApp reactions are not new messages —
 * they're per-(target, actor) state. We upsert / delete on
 * `message_reactions`, never write a row into `messages`.
 */
async function handleReaction(
  db: SupabaseClient,
  conversationId: string,
  contactId: string,
  messageId: string,
  emoji: string
): Promise<void> {
  if (!messageId) return;

  const targetInternalId = await lookupInternalIdByMetaId(
    db,
    messageId,
    conversationId
  );
  if (!targetInternalId) {
    console.warn(
      '[inbound] reaction target message not found; skipping',
      messageId
    );
    return;
  }

  // Empty emoji = removal.
  if (!emoji) {
    const { error: delError } = await db
      .from('message_reactions')
      .delete()
      .eq('message_id', targetInternalId)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId);
    if (delError) {
      console.error('[inbound] reaction delete failed:', delError.message);
    }
    return;
  }

  const { error: upsertError } = await db.from('message_reactions').upsert(
    {
      message_id: targetInternalId,
      conversation_id: conversationId,
      actor_type: 'customer',
      actor_id: contactId,
      emoji,
    },
    { onConflict: 'message_id,actor_type,actor_id' }
  );
  if (upsertError) {
    console.error('[inbound] reaction upsert failed:', upsertError.message);
  }
}

/**
 * Resolve a transport-side message id into the matching internal UUID,
 * scoped to one conversation. Returns null when we never received the
 * parent (e.g. a swipe-reply to a message older than this CRM install).
 */
export async function lookupInternalIdByMetaId(
  db: SupabaseClient,
  transportMessageId: string,
  conversationId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('message_id', transportMessageId)
    .eq('conversation_id', conversationId)
    .maybeSingle();
  if (error) {
    console.error('[inbound] lookupInternalIdByMetaId failed:', error.message);
    return null;
  }
  return data?.id ?? null;
}

interface ContactOutcome {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contact: any;
  /** True when this call created the row. */
  wasCreated: boolean;
}

async function findOrCreateContact(
  db: SupabaseClient,
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name?: string,
  lid?: string | null
): Promise<ContactOutcome | null> {
  // Pre-filters in SQL by the last-8-digit suffix then applies the
  // strict `phonesMatch` in JS on the small candidate set — the same
  // helper backs the manual contact form and CSV import, so all paths
  // agree on what "same number" means.
  const existingContact = await findExistingContact(db, accountId, phone);

  if (existingContact) {
    if (name && name !== existingContact.name) {
      await db
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existingContact.id);
    }
    return { contact: existingContact, wasCreated: false };
  }

  // A chat that previously arrived `@lid` may have created the contact
  // with the LID as its phone (before LID→PN resolution existed). The
  // real phone just resolved — migrate that row so we don't create a
  // duplicate, and so future outbound sends use the PN JID. `phone_normalized`
  // is a STORED generated column, so it stays in lockstep with `phone`.
  // If a real-phone contact already existed we'd have found it above,
  // so this update can't collide on the (account_id, phone_normalized)
  // unique index.
  if (lid) {
    const lidContact = await findExistingContact(db, accountId, lid);
    if (lidContact) {
      const patch: Record<string, string> = {
        updated_at: new Date().toISOString(),
      };
      if (lidContact.phone !== phone) patch.phone = phone;
      if (name && name !== lidContact.name) patch.name = name;
      const { error: migrateError } = await db
        .from('contacts')
        .update(patch)
        .eq('id', lidContact.id);
      if (!migrateError) {
        return { contact: { ...lidContact, ...patch }, wasCreated: false };
      }
      console.error('[inbound] LID→PN contact migration failed:', migrateError);
      // Fall through to the normal insert — the message is still stored,
      // just under the LID phone, matching pre-fix behaviour.
    }
  }

  const { data: newContact, error: createError } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name: name || phone,
    })
    .select()
    .single();

  if (createError) {
    // Lost a race: a concurrent delivery created the contact between
    // our lookup and insert. Re-resolve instead of dropping the message.
    if (isUniqueViolation(createError)) {
      const raced = await findExistingContact(db, accountId, phone);
      if (raced) return { contact: raced, wasCreated: false };
    }
    console.error('[inbound] error creating contact:', createError);
    return null;
  }

  return { contact: newContact, wasCreated: true };
}

async function findOrCreateConversation(
  db: SupabaseClient,
  accountId: string,
  configOwnerUserId: string,
  contactId: string
) {
  // Oldest-first so the lookup resolves to the canonical survivor the
  // dedup migration (036) keeps; takes one row rather than `.single()`
  // because `.single()` errors on both 0 and ≥2 rows.
  const { data: existingRows, error: findError } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (findError) {
    console.error('[inbound] error finding conversation:', findError);
    return null;
  }

  if (existingRows && existingRows.length > 0) {
    return { conversation: existingRows[0], created: false };
  }

  const { data: newConv, error: createError } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId,
    })
    .select()
    .single();

  if (createError) {
    if (isUniqueViolation(createError)) {
      const { data: raced } = await db
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1);
      if (raced && raced.length > 0) {
        return { conversation: raced[0], created: false };
      }
    }
    console.error('[inbound] error creating conversation:', createError);
    return null;
  }

  return { conversation: newConv, created: true };
}

/**
 * Land a brand-new contact into the account's "Leads" pipeline as an
 * automatic lead in its first stage ("Novo Lead").
 *
 * The ONLY signal for this is `wasCreated` (a contact that never existed
 * before arrived via inbound WhatsApp) — per the user's hard restriction
 * we NEVER classify by conversation content. Stage movement after this
 * point is manual ([Em Teste], [Registrar pagamento], drag & drop).
 *
 * Fail-soft: if the account has no Leads pipeline yet (the RPC in
 * migration 041/042 seeds one, but a fresh account may not have called
 * it), or no first stage, we log and skip rather than block the message
 * from persisting. Runs with the service-role client, so no RLS/auth
 * concerns.
 */
async function createLeadForNewContact(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contact: any
): Promise<void> {
  try {
    const { data: pipeline, error: pipelineError } = await db
      .from('pipelines')
      .select('id')
      .eq('account_id', accountId)
      .ilike('name', 'leads')
      .limit(1)
      .maybeSingle();
    if (pipelineError || !pipeline) {
      console.warn(
        '[inbound] no Leads pipeline; skipping auto lead',
        pipelineError?.message
      );
      return;
    }

    const { data: firstStage, error: stageError } = await db
      .from('pipeline_stages')
      .select('id')
      .eq('pipeline_id', pipeline.id)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (stageError || !firstStage) {
      console.warn(
        '[inbound] no first stage on Leads pipeline; skipping auto lead',
        stageError?.message
      );
      return;
    }

    const { error: insertError } = await db.from('deals').insert({
      user_id: ownerUserId,
      account_id: accountId,
      pipeline_id: pipeline.id,
      stage_id: firstStage.id,
      contact_id: contact.id,
      title: contact.name || contact.phone || 'Novo lead',
      value: 0,
      currency: 'USD',
      status: 'open',
    });
    if (insertError) {
      console.error('[inbound] error creating auto lead:', insertError);
    }
  } catch (err) {
    console.error('[inbound] error creating auto lead:', err);
  }
}

export interface ProcessInboundOptions {
  /** Tenancy — drives every contact / conversation lookup. */
  accountId: string;
  /**
   * Sender-of-record for inserts that need a NOT NULL user_id FK
   * (contacts, conversations). Always the admin who owns the session;
   * the choice is arbitrary post-017 but stable.
   */
  configOwnerUserId: string;
  /** Contact display name (from the WhatsApp profile), optional. */
  contactName?: string;
}

/**
 * Persist one inbound message for a conversation. Returns true when the
 * message was stored (a reaction short-circuits before the insert).
 */
export async function processInboundMessage(
  db: SupabaseClient,
  options: ProcessInboundOptions,
  message: InboundMessagePayload
): Promise<boolean> {
  const { accountId, configOwnerUserId, contactName } = options;
  const senderPhone = normalizePhone(message.from);
  if (!senderPhone) {
    console.warn('[inbound] message with no sender phone dropped');
    return false;
  }

  const contactOutcome = await findOrCreateContact(
    db,
    accountId,
    configOwnerUserId,
    senderPhone,
    contactName,
    message.lid
  );
  if (!contactOutcome) return false;
  const contact = contactOutcome.contact;

  const convResult = await findOrCreateConversation(
    db,
    accountId,
    configOwnerUserId,
    contact.id
  );
  if (!convResult) return false;
  const conversation = convResult.conversation;

  // Reactions short-circuit — never insert into `messages`, never bump
  // unread_count, never touch last_message_text.
  if (message.type === 'reaction') {
    if (message.reaction) {
      await handleReaction(
        db,
        conversation.id,
        contact.id,
        message.reaction.messageId,
        message.reaction.emoji
      );
    }
    return true;
  }

  // Map the normalized type to the closest allowed content_type
  // (the messages.content_type CHECK constraint).
  const contentType = message.type === 'location' ? 'location' : message.type;

  // Resolve swipe-reply context if present. A missing parent is fine —
  // we store NULL and the UI renders without a quote.
  let replyToInternalId: string | null = null;
  if (message.replyToMessageId) {
    replyToInternalId = await lookupInternalIdByMetaId(
      db,
      message.replyToMessageId,
      conversation.id
    );
    if (!replyToInternalId) {
      console.warn(
        '[inbound] reply context parent not found:',
        message.replyToMessageId
      );
    }
  }

  const contentText =
    message.text ??
    (message.type === 'document' ? message.mediaFilename : null) ??
    (message.type === 'location' ? message.text : null);

  const { error: msgError } = await db.from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: contentType,
    content_text: contentText,
    media_url: message.mediaUrl ?? null,
    message_id: message.id,
    status: 'delivered',
    created_at: new Date(message.timestamp * 1000).toISOString(),
    reply_to_message_id: replyToInternalId,
  });

  if (msgError) {
    console.error('[inbound] error inserting message:', msgError);
    return false;
  }

  const { error: convError } = await db
    .from('conversations')
    .update({
      last_message_text: contentText || `[${message.type}]`,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id);

  if (convError) {
    console.error('[inbound] error updating conversation:', convError);
  }

  // A brand-new contact is an automatic lead. Keyed ONLY on wasCreated
  // (never on message content — user restriction); stage movement from
  // here is manual. Fail-soft so a missing Leads pipeline can't block
  // the message that just persisted above.
  if (contactOutcome.wasCreated) {
    await createLeadForNewContact(db, accountId, configOwnerUserId, contact);
  }

  return true;
}
