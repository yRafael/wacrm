// ============================================================
// Renewals — data access for the renewal cycle (doc Cap. 45).
//
// The UI layer's only gateway to payments/renewals/credentials:
//   - listDuePayments / listRecentRenewals  → the /renewals agenda
//   - createPayment                         → agent opens a receivable
//   - completeRenewal                       → the atomic paid transition
//
// completeRenewal is the ONE path that marks a payment paid — it calls
// the `complete_renewal` SECURITY DEFINER RPC (migration 040), which in
// a single transaction marks the payment, appends immutable renewals
// history, extends iptv_credentials.expires_at, books the income ledger
// entry, and notifies the account owner. The client never UPDATEs a
// payment to 'paid' directly, so the ledger and the credential can't
// drift apart.
//
// All queries go through the authenticated client, so RLS still gates
// every row by is_account_member.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  Payment,
  PaymentMethod,
  Renewal,
} from '@/types';

/** The renewal durations the UI offers (default = current span). */
export const RENEWAL_DURATIONS = [30, 90, 180, 365] as const;

const PAYMENT_WITH_CONTACT = '*, contact:contacts(*)';

export interface CreatePaymentInput {
  accountId: string;
  contactId: string;
  amount: number;
  method?: PaymentMethod;
  dueAt: string;
  notes?: string;
}

/**
 * Open receivables (pending/late/partial) for the account, earliest
 * due first — the "vencendo hoje/amanhã/semana/mês" agenda. Optional
 * `dueBefore` narrows to a window (e.g. the next 7 days).
 */
export async function listDuePayments(
  db: SupabaseClient,
  accountId: string,
  opts: { dueBefore?: string } = {},
): Promise<Payment[]> {
  let query = db
    .from('payments')
    .select(PAYMENT_WITH_CONTACT)
    .eq('account_id', accountId)
    .in('status', ['pending', 'late', 'partial'])
    .order('due_at', { ascending: true });

  if (opts.dueBefore) query = query.lte('due_at', opts.dueBefore);

  const { data, error } = await query;
  if (error) {
    console.error('[renewals] listDuePayments failed:', error.message);
    return [];
  }
  return (data as Payment[]) ?? [];
}

/**
 * Most recent completed renewals with their contact, for the history
 * list on /renewals.
 */
export async function listRecentRenewals(
  db: SupabaseClient,
  accountId: string,
  limit = 50,
): Promise<Renewal[]> {
  const { data, error } = await db
    .from('renewals')
    .select('*, contact:contacts(*)')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[renewals] listRecentRenewals failed:', error.message);
    return [];
  }
  return (data as Renewal[]) ?? [];
}

/**
 * Open a receivable. Returns { data, error } so the caller can toast
 * precisely; agent role is enforced by RLS on insert.
 */
export async function createPayment(
  db: SupabaseClient,
  input: CreatePaymentInput,
) {
  const { accountId, contactId, amount, method = 'pix', dueAt, notes } = input;
  return db
    .from('payments')
    .insert({
      account_id: accountId,
      contact_id: contactId,
      amount,
      method,
      due_at: dueAt,
      notes,
    })
    .select()
    .single();
}

export interface CompleteRenewalInput {
  paymentId: string;
  /** Defaults server-side to the credential's current span. */
  durationDays?: number;
  notes?: string;
}

/**
 * Mark a payment paid and complete the renewal — atomic via the
 * `complete_renewal` RPC. Returns the new renewals row id, or throws
 * an Error built from the RPC's message/code so the page can surface
 * e.g. "Contact has no active IPTV credential...".
 */
export async function completeRenewal(
  db: SupabaseClient,
  input: CompleteRenewalInput,
): Promise<string> {
  const { error, data } = await db.rpc('complete_renewal', {
    p_payment_id: input.paymentId,
    p_duration_days: input.durationDays ?? null,
    p_notes: input.notes ?? null,
  });

  if (error) {
    throw new Error(error.message, error.code ? { cause: error.code } : undefined);
  }
  if (typeof data !== 'string') {
    throw new Error('complete_renewal returned no renewal id');
  }
  return data;
}
