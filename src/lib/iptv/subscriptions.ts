// ============================================================
// Subscriptions — the company-wide view of client IPTV
// subscriptions (doc Cap. 46, agregado por conta).
//
// There is no `subscriptions` table. The canonical source for a
// client's IPTV subscription is `iptv_credentials` (038): one row per
// active credential, joined with the contact + the company's plan and
// server catalog (043). Everything here is pure + testable — the page
// feeds rows from the authenticated client (RLS scopes by account) and
// these functions classify them. No SQL aggregation in the UI.
//
// `daysUntil` is intentionally distinct from the per-contact variant in
// `client-stats.ts`: this one defaults `now` and returns `null` for an
// unparseable date (a defensive null beats NaN bubbling into a badge).
// ============================================================

import type {
  IptvCredential,
  IptvCredentialStatus,
  Plan,
  Server,
} from '@/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days from `now` (default today) to `expiresAt` (floor; negative
 * when already past). Returns `null` when `expiresAt` doesn't parse — an
 * unparseable row should never crash the aggregate view.
 */
export function daysUntil(
  expiresAt: string,
  now: Date = new Date()
): number | null {
  const target = new Date(expiresAt).getTime();
  if (Number.isNaN(target)) return null;
  return Math.floor((target - now.getTime()) / DAY_MS);
}

/** KPI buckets for the Assinaturas summary. */
export type SubscriptionBucket =
  | 'active' // > 30 days away — no urgency.
  | 'expiring7' // <= 7 days away — a renewal is due this week.
  | 'expiring30' // 8–30 days away — renewals are coming up.
  | 'expired'; // past due.

/**
 * Classify one credential against `now`. Revoked credentials are not
 * live subscriptions (the client was cut off) and are excluded from the
 * buckets — they still appear in the table, but never inflate the KPIs.
 */
export function subscriptionBucket(
  credential: Pick<IptvCredential, 'expires_at' | 'status'>,
  now: Date = new Date()
): SubscriptionBucket | null {
  if (credential.status === 'revoked') return null;
  const d = daysUntil(credential.expires_at, now);
  if (d === null) return null;
  if (d < 0) return 'expired';
  if (d <= 7) return 'expiring7';
  if (d <= 30) return 'expiring30';
  return 'active';
}

/** Counts per bucket for the KPI cards at the top of the page. */
export function countSubscriptionBuckets(
  credentials: Array<Pick<IptvCredential, 'expires_at' | 'status'>>,
  now: Date = new Date()
): Record<SubscriptionBucket, number> {
  const counts: Record<SubscriptionBucket, number> = {
    active: 0,
    expiring7: 0,
    expiring30: 0,
    expired: 0,
  };
  for (const c of credentials) {
    const bucket = subscriptionBucket(c, now);
    if (bucket) counts[bucket] += 1;
  }
  return counts;
}

// ------------------------------------------------------------
// Row shape the Assinaturas table renders (joined reads).
// ------------------------------------------------------------

export interface SubscriptionContact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
}

export interface SubscriptionPlan {
  id: string;
  name: string | null;
  duration_days: number | null;
  price: number | null;
}

export interface SubscriptionRow {
  id: string;
  contact_id: string;
  username: string;
  expires_at: string;
  status: IptvCredentialStatus;
  notes: string | null;
  plan_id: string | null;
  server_id: string | null;
  plan: SubscriptionPlan | null;
  server: Pick<Server, 'id' | 'name'> | null;
  contact: SubscriptionContact | null;
}
