// ============================================================
// Report aggregates — pure top-N rollups for /reports (CAP 52).
//
// No DB access: pages feed plain arrays and get back plain rows, so
// the whole module is deterministic and vitest-covered (same contract
// as `src/lib/iptv/finance.ts`).
// ============================================================

import type { FinancialTransaction } from '@/types';

export interface ClientRevenue {
  /** Display name — `contact.name`, else `contact.phone`, else a dash. */
  name: string;
  /** Lifetime income booked for this client. */
  revenue: number;
  /** Share of total income revenue, 0–100, rounded to one decimal. */
  pct: number;
}

/** Fallback label when an income row has no resolvable name or phone. */
export const UNKNOWN_CLIENT = '—';

/**
 * Rank clients by lifetime revenue. Only `income` transactions count —
 * refunds and expenses never add here (ledger semantics: the SIGN lives
 * in `type`). Revenue is attributed by `contact_id`; the embedded
 * contact supplies the display name.
 */
export function topClientsByRevenue(
  txns: FinancialTransaction[],
  limit = 10,
): ClientRevenue[] {
  const byClient = new Map<string, number>();
  let total = 0;

  for (const t of txns) {
    if (t.type !== 'income') continue;
    total += t.amount;
    if (!t.contact_id) continue;
    byClient.set(t.contact_id, (byClient.get(t.contact_id) ?? 0) + t.amount);
  }

  // Resolve a display name from the first income row seen per client.
  const nameById = new Map<string, string>();
  for (const t of txns) {
    if (t.type !== 'income' || !t.contact_id || nameById.has(t.contact_id)) {
      continue;
    }
    const name = t.contact?.name ?? t.contact?.phone;
    nameById.set(
      t.contact_id,
      name && name.trim() ? name : UNKNOWN_CLIENT,
    );
  }

  return [...byClient.entries()]
    .map(([contactId, revenue]) => ({
      name: nameById.get(contactId) ?? UNKNOWN_CLIENT,
      revenue,
      pct: total > 0 ? Math.round((revenue / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}
