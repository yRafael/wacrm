// ============================================================
// Contact-deal — the lead<->deal operations shared by the inbox's
// operational panel (⚡ Ações) and the /pipelines board.
//
// Centralizes what used to live in two places:
//   - the private createLeadForNewContact in inbound-process.ts (auto
//     lead for a brand-new contact, keyed ONLY on wasCreated)
//   - the find-stage-by-name + move logic in pipelines/page.tsx
//
// User restriction: NEVER classify by conversation content. A lead is
// created automatically only for a brand-new contact (wasCreated);
// every stage move past that point is manual — the quick actions ARE
// that manual movement, done from inside the conversation. All writes
// go through RLS (agent+ on deals), so the board reflects them on mount.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Contact, Deal, PipelineStage } from '@/types';

/**
 * The contact's open lead in the account's "Leads" pipeline, or null.
 * The canonical survivor is the oldest row (oldest-first ordering), the
 * same convention the conversation dedup migration (036) keeps.
 */
export async function getContactLead(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<Deal | null> {
  // Resolve the account's "Leads" pipeline id (case-insensitive, matching
  // the 042 seed and the auto-lead path).
  const { data: pipeline, error: pipeError } = await db
    .from('pipelines')
    .select('id')
    .eq('account_id', accountId)
    .ilike('name', 'leads')
    .limit(1)
    .maybeSingle();

  if (pipeError || !pipeline) {
    if (pipeError)
      console.error(
        '[contact-deal] lead pipeline lookup failed:',
        pipeError.message
      );
    return null;
  }

  const { data, error } = await db
    .from('deals')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('pipeline_id', pipeline.id)
    .eq('status', 'open')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[contact-deal] getContactLead failed:', error.message);
    return null;
  }
  return (data as Deal | null) ?? null;
}

/**
 * Ensure the contact has an open lead in the account's "Leads" pipeline,
 * creating it in the first stage ("Novo Lead") when missing. Idempotent —
 * returns the existing lead when one is already open, so clicking
 * "Marcar como Lead" twice is a no-op.
 *
 * Fail-soft: if the account has no "Leads" pipeline yet (the 042 RPC
 * seeds one, but a fresh account may not have called it) or no first
 * stage, we log and return null rather than throw — the caller can show
 * a neutral toast.
 */
export async function ensureContactLead(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  contact: Contact
): Promise<Deal | null> {
  const existing = await getContactLead(db, accountId, contact.id);
  if (existing) return existing;

  const { data: pipeline, error: pipeError } = await db
    .from('pipelines')
    .select('id')
    .eq('account_id', accountId)
    .ilike('name', 'leads')
    .limit(1)
    .maybeSingle();
  if (pipeError || !pipeline) {
    console.warn(
      '[contact-deal] no Leads pipeline; skipping lead',
      pipeError?.message
    );
    return null;
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
      '[contact-deal] no first stage on Leads pipeline; skipping lead',
      stageError?.message
    );
    return null;
  }

  const { data: deal, error } = await db
    .from('deals')
    .insert({
      user_id: ownerUserId,
      account_id: accountId,
      pipeline_id: pipeline.id,
      stage_id: firstStage.id,
      contact_id: contact.id,
      title: contact.name || contact.phone || 'Novo lead',
      value: 0,
      currency: 'USD',
      status: 'open',
    })
    .select('*')
    .single();

  if (error) {
    // Lost a race: a concurrent delivery created the lead between our
    // lookup and insert. Re-resolve instead of erroring the action.
    if ((error as { code?: string }).code === '23505') {
      const raced = await getContactLead(db, accountId, contact.id);
      return raced;
    }
    console.error('[contact-deal] error creating lead:', error.message);
    return null;
  }

  return deal as Deal;
}

/**
 * Find a stage by name in a pipeline. The "find stage by name" helper
 * today duplicated in pipelines/page.tsx — moving onto "Convertido" or
 * "Em Teste" is always by name, never by id.
 */
export async function findStageByName(
  db: SupabaseClient,
  pipelineId: string,
  name: string
): Promise<PipelineStage | null> {
  const { data, error } = await db
    .from('pipeline_stages')
    .select('*')
    .eq('pipeline_id', pipelineId)
    .ilike('name', name)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(
      `[contact-deal] findStageByName(${name}) failed:`,
      error.message
    );
    return null;
  }
  return (data as PipelineStage | null) ?? null;
}

/**
 * Move a deal to a stage. Returns the update result; RLS enforces agent+
 * on write. Moving onto "Convertido" triggers the on_deal_converted DB
 * trigger (marks won + notifies the owner).
 */
export function moveDealToStage(
  db: SupabaseClient,
  dealId: string,
  stageId: string
) {
  return db.from('deals').update({ stage_id: stageId }).eq('id', dealId);
}

/**
 * Move a deal to its pipeline's "Convertido" stage — the conversion
 * action taken after a payment is recorded. Fires the on_deal_converted
 * trigger. Mirrors pipelines/page.tsx handlePaymentRecorded.
 *
 * Returns { moved } so the caller can toast; `error` carries a human
 * message when the stage doesn't exist.
 */
export async function moveDealToConvertido(
  db: SupabaseClient,
  deal: Deal
): Promise<{ moved: boolean; error?: string }> {
  if (!deal.pipeline_id) {
    return { moved: false, error: 'Deal has no pipeline' };
  }
  const target = await findStageByName(db, deal.pipeline_id, 'Convertido');
  if (!target) {
    return { moved: false, error: 'no-convertido-stage' };
  }
  const { error } = await moveDealToStage(db, deal.id, target.id);
  if (error) {
    console.error('[contact-deal] move to Convertido failed:', error.message);
    return { moved: false, error: error.message };
  }
  return { moved: true };
}
