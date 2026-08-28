// ============================================================
// Client stats — the aggregated Perfil 360° view (doc Cap. 46).
//
// One contact's IPTV story in a single object: active credential +
// expiry, last payment, next due, lifetime revenue, renewal history.
// The contact-detail-view renders this; no page re-implements the
// queries. All lookups are scoped to (account_id, contact_id) — the
// tenancy rule applies even here, where the caller already owns the
// contact.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  FinancialTransaction,
  IptvCredential,
  Payment,
  Renewal,
  Server,
} from '@/types';

export type ExpiryStatus = 'active' | 'expiring_soon' | 'expired' | 'none';

export interface ClientStats {
  /** Active credential (deleted_at IS NULL), if any. */
  credential: IptvCredential | null;
  /** Hydrated server from the credential's server_id FK. */
  server: Server | null;
  /** expires_at of the active credential. */
  expiresAt: string | null;
  /** Whole days until expiry (negative when past). Null with no credential. */
  daysUntilExpiry: number | null;
  status: ExpiryStatus;
  /** Most recently paid receivable. */
  lastPayment: Payment | null;
  /** Earliest still-open receivable (pending/late/partial). */
  nextDuePayment: Payment | null;
  /** Sum of income booked against this contact. */
  lifetimeRevenue: number;
  /** Completed renewals for this contact. */
  renewalCount: number;
  firstRenewalAt: string | null;
  lastRenewalAt: string | null;
}

/** Whole days from `now` to `dateIso` (floor; negative when past). */
export function daysUntil(dateIso: string, now: Date): number {
  return Math.floor(
    (new Date(dateIso).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
  );
}

/**
 * Classify an expiry vs `now`. "expiring_soon" = within 7 days (a
 * renewal is due this week — the operational window).
 */
export function expiryStatus(
  expiresAt: string | null,
  now: Date
): ExpiryStatus {
  if (!expiresAt) return 'none';
  const days = daysUntil(expiresAt, now);
  if (days < 0) return 'expired';
  if (days <= 7) return 'expiring_soon';
  return 'active';
}

export async function getClientStats(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<ClientStats> {
  // Parallel — the four reads are independent.
  const [
    credResult,
    lastPaidResult,
    nextDueResult,
    incomeResult,
    renewalsResult,
  ] = await Promise.all([
    db
      .from('iptv_credentials')
      .select('*, server:servers!iptv_credentials_server_id_fkey(*)')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('payments')
      .select('*')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'paid')
      .order('paid_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('payments')
      .select('*')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .in('status', ['pending', 'late', 'partial'])
      .order('due_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    db
      .from('financial_transactions')
      .select('amount')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('type', 'income'),
    db
      .from('renewals')
      .select('created_at')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false }),
  ]);

  const credential = (credResult.data as IptvCredential | null) ?? null;
  const server = credential?.server ?? null;
  if (credResult.error) {
    console.error(
      '[client-stats] credential lookup failed:',
      credResult.error.message
    );
  }
  const lastPayment = (lastPaidResult.data as Payment | null) ?? null;
  if (lastPaidResult.error) {
    console.error(
      '[client-stats] last payment lookup failed:',
      lastPaidResult.error.message
    );
  }
  const nextDuePayment = (nextDueResult.data as Payment | null) ?? null;
  if (nextDueResult.error) {
    console.error(
      '[client-stats] next due lookup failed:',
      nextDueResult.error.message
    );
  }

  const incomeRows =
    (incomeResult.data as Pick<FinancialTransaction, 'amount'>[]) ?? [];
  const lifetimeRevenue = incomeRows.reduce((acc, r) => acc + r.amount, 0);

  const renewals = (renewalsResult.data as Pick<Renewal, 'created_at'>[]) ?? [];
  const lastRenewalAt = renewals[0]?.created_at ?? null;
  const firstRenewalAt = renewals[renewals.length - 1]?.created_at ?? null;

  const expiresAt = credential?.expires_at ?? null;
  const now = new Date();

  return {
    credential,
    server,
    expiresAt,
    daysUntilExpiry: expiresAt ? daysUntil(expiresAt, now) : null,
    status: expiryStatus(expiresAt, now),
    lastPayment,
    nextDuePayment,
    lifetimeRevenue,
    renewalCount: renewals.length,
    firstRenewalAt,
    lastRenewalAt,
  };
}
