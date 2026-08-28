// ============================================================
// Finance — pure, testable IPTV finance calculations (doc Cap. 44).
//
// No DB access: every function takes plain arrays (`FinancialTransaction[]`,
// `Payment[]`, `Renewal[]`) and returns numbers, so the whole module is
// deterministic and covered by vitest. The pages fetch the rows with
// supabase-js and feed them here — no SQL aggregation scattered across
// the UI.
//
// Ledger semantics (migration 040): `amount` is always >= 0; the SIGN
// lives in `type`. So:
//   income    → cash in  (+)
//   expense   → cash out (−)
//   refund    → cash out (−)  (a payment given back to a customer)
//   transfer  → internal move, cash-neutral
//   adjustment→ correction row, cash-neutral (fixes an existing entry;
//                never a new flow of money)
// MRR/ARR use the AMORTIZED view of `renewals` (amount spread over the
// duration it buys), which is the honest recurring figure for a
// subscription business — a R$120 / 365-day renewal is R$10/month, not
// R$120 this month.
// ============================================================

import type { FinancialTransaction, Payment, Renewal } from '@/types';

export interface DateRange {
  /** ISO timestamp (inclusive). */
  from?: string;
  /** ISO timestamp (inclusive). */
  to?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Date-only `YYYY-MM-DD` (no time component). */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize an inclusive upper bound. A date-only `to` (`YYYY-MM-DD`)
 * parses as UTC midnight, which would silently exclude the rest of that
 * day; treat it as end-of-day so `to: '2026-07-31'` means "through July
 * 31", not "at midnight on July 31".
 */
function endOfDayBound(to: string): string {
  return DATE_ONLY_RE.test(to) ? `${to}T23:59:59.999Z` : to;
}

function isInRange(dateIso: string | undefined, range: DateRange): boolean {
  if (!dateIso) return false;
  const t = new Date(dateIso).getTime();
  if (Number.isNaN(t)) return false;
  if (range.from && t < new Date(range.from).getTime()) return false;
  if (range.to && t > new Date(endOfDayBound(range.to)).getTime()) return false;
  return true;
}

/** Sum of `amount` for transactions matching `type` within `range`. */
export function sumByType(
  txns: FinancialTransaction[],
  type: FinancialTransaction['type'],
  range: DateRange = {}
): number {
  return txns
    .filter((t) => t.type === type && isInRange(t.occurred_at, range))
    .reduce((acc, t) => acc + t.amount, 0);
}

/** Total cash-in: income only. */
export function totalRevenue(
  txns: FinancialTransaction[],
  range: DateRange = {}
): number {
  return sumByType(txns, 'income', range);
}

/** Total cash-out: expenses + refunds (money leaving the business). */
export function totalExpenses(
  txns: FinancialTransaction[],
  range: DateRange = {}
): number {
  return sumByType(txns, 'expense', range) + sumByType(txns, 'refund', range);
}

/**
 * Net cash flow over the period — what actually moved. Transfers and
 * adjustments are cash-neutral by design and excluded.
 */
export function netCashFlow(
  txns: FinancialTransaction[],
  range: DateRange = {}
): number {
  return totalRevenue(txns, range) - totalExpenses(txns, range);
}

/** All-time net balance of the ledger. */
export function cashBalance(txns: FinancialTransaction[]): number {
  return netCashFlow(txns);
}

/** Revenue booked in the trailing `days` (default 30) ending at `now`. */
export function revenueLastDays(
  txns: FinancialTransaction[],
  now: Date,
  days = 30
): number {
  const from = new Date(now.getTime() - days * DAY_MS).toISOString();
  return totalRevenue(txns, { from, to: now.toISOString() });
}

/**
 * Amortized monthly recurring revenue: each renewal contributes
 * amount × (30 / duration_days) — the share of one month the payment
 * buys. ARR is that × 12.
 *
 * Optional `range` scopes to renewals completed in a window (e.g. only
 * renewals still within their bought window), otherwise all history.
 */
export function mrr(renewals: Renewal[], range: DateRange = {}): number {
  return renewals
    .filter((r) => r.duration_days > 0 && isInRange(r.created_at, range))
    .reduce((acc, r) => acc + (r.amount * 30) / r.duration_days, 0);
}

export function arr(renewals: Renewal[], range: DateRange = {}): number {
  return mrr(renewals, range) * 12;
}

/**
 * Average ticket — mean of `payments` (default: paid only, i.e. money
 * actually received). Pass `paidOnly: false` to average all receivables
 * including still-open ones.
 */
export function averageTicket(
  payments: Payment[],
  opts: { paidOnly?: boolean } = {}
): number {
  const pool =
    opts.paidOnly === false
      ? payments
      : payments.filter((p) => p.status === 'paid');
  if (pool.length === 0) return 0;
  return pool.reduce((acc, p) => acc + p.amount, 0) / pool.length;
}

export interface Delinquency {
  /** Open receivables that are past due (status pending/late/partial). */
  overdueCount: number;
  /** Sum of overdue amounts. */
  overdueAmount: number;
  /** Open receivables (pending/late/partial), past due or not. */
  openCount: number;
  /** overdueCount / openCount — 0 when there are no open receivables. */
  rate: number;
}

/**
 * Inadimplência — share of open receivables that are past due.
 * "Open" excludes paid/canceled/refunded (those are no longer owed).
 */
export function delinquency(payments: Payment[], now: Date): Delinquency {
  const open = payments.filter(
    (p) =>
      p.status === 'pending' || p.status === 'late' || p.status === 'partial'
  );
  const overdue = open.filter(
    (p) => new Date(p.due_at).getTime() < now.getTime()
  );
  const overdueAmount = overdue.reduce((acc, p) => acc + p.amount, 0);
  return {
    overdueCount: overdue.length,
    overdueAmount,
    openCount: open.length,
    rate: open.length === 0 ? 0 : overdue.length / open.length,
  };
}

/** Revenue grouped by `category` — for the finance dashboard's pie. */
export function revenueByCategory(
  txns: FinancialTransaction[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of txns) {
    if (t.type !== 'income') continue;
    out[t.category] = (out[t.category] ?? 0) + t.amount;
  }
  return out;
}

export interface MonthlyPoint {
  /** ISO month key, e.g. "2026-07". */
  month: string;
  revenue: number;
  expenses: number;
  net: number;
}

/**
 * Bucket the ledger into the last `months` calendar months ending at
 * `now` — one point per month for the dashboard trend chart. Missing
 * months are zero-filled so the series is continuous.
 */
export function monthlySeries(
  txns: FinancialTransaction[],
  now: Date,
  months = 6
): MonthlyPoint[] {
  const points: MonthlyPoint[] = [];
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i = 0; i < months; i++) {
    const start = new Date(
      cursor.getFullYear(),
      cursor.getMonth() - (months - 1 - i),
      1
    );
    const end = new Date(
      start.getFullYear(),
      start.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );
    const range: DateRange = {
      from: start.toISOString(),
      to: end.toISOString(),
    };
    const revenue = totalRevenue(txns, range);
    const expenses = totalExpenses(txns, range);
    points.push({
      month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
      revenue,
      expenses,
      net: revenue - expenses,
    });
  }
  return points;
}

/**
 * Simple projection — the trailing `lookbackDays` average daily income
 * extrapolated over `horizonDays`. A rough "where is the month heading"
 * number, explicitly not a subscription-aware forecast.
 */
export function simpleProjection(
  txns: FinancialTransaction[],
  now: Date,
  opts: { lookbackDays?: number; horizonDays?: number } = {}
): number {
  const lookbackDays = opts.lookbackDays ?? 30;
  const horizonDays = opts.horizonDays ?? 30;
  const recent = revenueLastDays(txns, now, lookbackDays);
  const perDay = recent / lookbackDays;
  return perDay * horizonDays;
}

// ============================================================
// IPTV Structure Costs — cost / revenue / profit per server
// ============================================================

export type StructureCostType = 'server' | 'panel' | 'other';
export type BillingCycle = 'monthly' | 'yearly';

export interface StructureCost {
  id: string;
  account_id: string;
  name: string;
  type: StructureCostType;
  amount: number;
  billing_cycle: BillingCycle;
  capacity: number | null;
  is_active: boolean;
  notes: string | null;
}

/**
 * Normalize a cost to its monthly equivalent. Yearly costs are
 * divided by 12 so the dashboard always shows a comparable monthly
 * figure.
 */
export function monthlyEquivalent(cost: StructureCost): number {
  if (cost.billing_cycle === 'yearly') return cost.amount / 12;
  return cost.amount;
}

/** Total monthly cost across all active structure costs. */
export function totalMonthlyCost(costs: StructureCost[]): number {
  return costs
    .filter((c) => c.is_active)
    .reduce((sum, c) => sum + monthlyEquivalent(c), 0);
}

/** Monthly cost broken down by type. */
export function costByType(
  costs: StructureCost[]
): Record<StructureCostType, number> {
  const result: Record<StructureCostType, number> = {
    server: 0,
    panel: 0,
    other: 0,
  };
  for (const c of costs.filter((c) => c.is_active)) {
    result[c.type] += monthlyEquivalent(c);
  }
  return result;
}

/**
 * Revenue per server — derived from active iptv_credentials joined
 * with plans.price. Each credential's plan price is amortized to
 * monthly (price / duration_days * 30).
 */
export interface ServerRevenue {
  server_id: string;
  server_name: string;
  revenue: number;
  active_count: number;
  capacity: number | null;
}

export function revenuePerServer(
  credentials: Array<{
    server_id: string | null;
    server_name: string | null;
    plan_price: number | null;
    plan_duration_days: number | null;
  }>,
  costs: StructureCost[]
): ServerRevenue[] {
  const map = new Map<string, ServerRevenue>();

  // Seed from active server costs so servers with 0 revenue still appear.
  for (const c of costs.filter(
    (c) => c.type === 'server' && c.is_active
  )) {
    map.set(c.id, {
      server_id: c.id,
      server_name: c.name,
      revenue: 0,
      active_count: 0,
      capacity: c.capacity,
    });
  }

  for (const cred of credentials) {
    if (!cred.server_id || !cred.plan_price) continue;
    const entry = map.get(cred.server_id) ?? {
      server_id: cred.server_id,
      server_name: cred.server_name ?? 'Servidor',
      revenue: 0,
      active_count: 0,
      capacity: null,
    };
    const duration = cred.plan_duration_days ?? 30;
    entry.revenue += (cred.plan_price / duration) * 30;
    entry.active_count++;
    map.set(cred.server_id, entry);
  }

  return Array.from(map.values());
}

export interface ProfitSummary {
  totalCost: number;
  totalRevenue: number;
  profit: number;
  margin: number; // 0–100 percent
  byServer: Array<{
    server_id: string;
    server_name: string;
    cost: number;
    revenue: number;
    profit: number;
    capacity_used: number | null;
    capacity_total: number | null;
  }>;
}

/**
 * Cross cost × revenue to produce the profit-per-server breakdown.
 */
export function profitSummary(
  costs: StructureCost[],
  serverRevenues: ServerRevenue[]
): ProfitSummary {
  const totalCost = totalMonthlyCost(costs);
  const totalRevenue = serverRevenues.reduce((s, r) => s + r.revenue, 0);
  const profit = totalRevenue - totalCost;
  const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;

  // Distribute server costs to match revenue entries.
  const costByServer = new Map<string, number>();
  for (const c of costs.filter(
    (c) => c.type === 'server' && c.is_active
  )) {
    costByServer.set(c.id, monthlyEquivalent(c));
  }
  // Non-server costs (panel, other) are spread proportionally to revenue.
  const nonServerCost = costs
    .filter((c) => c.type !== 'server' && c.is_active)
    .reduce((s, c) => s + monthlyEquivalent(c), 0);
  const revenueShare = totalRevenue > 0 ? nonServerCost / totalRevenue : 0;

  const byServer = serverRevenues.map((r) => {
    const serverCost = (costByServer.get(r.server_id) ?? 0) + r.revenue * revenueShare;
    return {
      server_id: r.server_id,
      server_name: r.server_name,
      cost: serverCost,
      revenue: r.revenue,
      profit: r.revenue - serverCost,
      capacity_used: r.active_count,
      capacity_total: r.capacity,
    };
  });

  return { totalCost, totalRevenue, profit, margin, byServer };
}
