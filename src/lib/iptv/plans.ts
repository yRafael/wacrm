// ============================================================
// Plans — the company's subscription catalog (migration 043).
//
// Multi-tenant: every plan row carries account_id and is scoped by RLS
// via is_account_member, so João/Maria/Carlos each see only their own
// company's plans. The conversation header selector (Plano [Mensal ▼])
// and the ⚡ Ações plan picker read through here.
//
// ensureDefaultPlans calls the `ensure_default_plans` SECURITY DEFINER
// RPC (043) which seeds Mensal/Trimestral/Semestral/Anual for accounts
// with no catalog yet. The RPC is admin-tier (settings config), so an
// agent calling it gets a permission error — we fail soft and just
// return whatever the account has.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { IptvCredential, Plan } from '@/types';

/**
 * Fallback labels for a credential whose `duration_days` has no catalog
 * plan (legacy rows created before 043, or accounts whose catalog was
 * never seeded). Mirrors the seeded default plan names so the header
 * selector and the subscription card agree even before the owner
 * configures anything.
 */
export const FALLBACK_PLAN_LABEL_BY_DAYS: Record<number, string> = {
  30: 'Mensal',
  90: 'Trimestral',
  120: 'Quadrimestral',
  180: 'Semestral',
  365: 'Anual',
};

/**
 * Resolve the human plan name for a credential. Catalog match wins
 * (`plan_id` → plans.name — the configured, i18n-free company name);
 * otherwise fall back to the duration map so pre-catalog credentials
 * still show "Mensal" instead of "—". Null when neither applies.
 */
export function resolvePlanName(
  credential:
    Pick<IptvCredential, 'plan_id' | 'duration_days'> | null | undefined,
  plans: Plan[]
): string | null {
  if (!credential) return null;
  if (credential.plan_id) {
    const match = plans.find((p) => p.id === credential.plan_id);
    if (match) return match.name;
  }
  if (credential.duration_days) {
    return FALLBACK_PLAN_LABEL_BY_DAYS[credential.duration_days] ?? null;
  }
  return null;
}

export interface ListPlansOptions {
  /** Include inactive plans too (admin Settings catalog). Default false. */
  includeInactive?: boolean;
}

/**
 * The account's plans, active-first then by sort_order. Active plans
 * (the ones the operator can assign from a conversation) when
 * `includeInactive` is false; the full catalog when true (Settings).
 */
export async function listPlans(
  db: SupabaseClient,
  accountId: string,
  opts: ListPlansOptions = {}
): Promise<Plan[]> {
  let query = db
    .from('plans')
    .select('*')
    .eq('account_id', accountId)
    .order('is_active', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (!opts.includeInactive) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) {
    console.error('[plans] listPlans failed:', error.message);
    return [];
  }
  return (data as Plan[]) ?? [];
}

/**
 * Seed the spec-defined default plans (Mensal/Trimestral/Semestral/
 * Anual) for an account that has no catalog yet. Idempotent server-side.
 * Fail-soft: a non-admin caller is denied by the RPC and we simply log —
 * the caller still gets listPlans()'s result below.
 */
export async function ensureDefaultPlans(
  db: SupabaseClient,
  accountId: string
): Promise<void> {
  const { error } = await db.rpc('ensure_default_plans', {
    p_account_id: accountId,
  });
  if (error) {
    // Admin-tier RPC — an agent opening a thread is expected to be denied.
    console.warn('[plans] ensure_default_plans skipped:', error.message);
  }
}

export interface ApplyPlanInput {
  accountId: string;
  contactId: string;
  planId: string;
  /** The plan's span in days — written into duration_days (renewal span). */
  durationDays: number;
}

/**
 * Assign a company plan to the contact's active credential. Sets both
 * `plan_id` (catalog link) and `duration_days` (the span complete_renewal
 * extends by), so a plan change keeps the two in lockstep. Returns the
 * update result — RLS enforces agent+ on write; an account with no
 * credential updates zero rows.
 */
export function applyPlanToCredential(
  db: SupabaseClient,
  input: ApplyPlanInput
) {
  const { accountId, contactId, planId, durationDays } = input;
  return db
    .from('iptv_credentials')
    .update({
      plan_id: planId,
      duration_days: durationDays,
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .is('deleted_at', null);
}
