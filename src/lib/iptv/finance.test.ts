import { describe, expect, it } from 'vitest';

import {
  arr,
  averageTicket,
  cashBalance,
  delinquency,
  monthlySeries,
  mrr,
  netCashFlow,
  revenueByCategory,
  revenueLastDays,
  simpleProjection,
  sumByType,
  totalExpenses,
  totalRevenue,
} from './finance';
import type {
  FinancialTransaction,
  Payment,
  Renewal,
} from '@/types';

const T = (partial: Partial<FinancialTransaction>): FinancialTransaction => ({
  id: 't1',
  account_id: 'acct',
  type: 'income',
  category: 'renewal',
  amount: 100,
  method: 'pix',
  occurred_at: '2026-07-15T12:00:00.000Z',
  created_at: '2026-07-15T12:00:00.000Z',
  ...partial,
});

const P = (partial: Partial<Payment>): Payment => ({
  id: 'p1',
  account_id: 'acct',
  contact_id: 'c1',
  amount: 120,
  method: 'pix',
  status: 'paid',
  due_at: '2026-07-01T00:00:00.000Z',
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  ...partial,
});

const R = (partial: Partial<Renewal>): Renewal => ({
  id: 'r1',
  account_id: 'acct',
  contact_id: 'c1',
  new_expires_at: '2026-08-01T00:00:00.000Z',
  amount: 120,
  duration_days: 30,
  renewal_type: 'manual',
  status: 'renewed',
  created_at: '2026-07-01T00:00:00.000Z',
  ...partial,
});

const NOW = new Date('2026-08-09T12:00:00.000Z');

describe('sumByType / totalRevenue / totalExpenses', () => {
  it('sums only the requested type', () => {
    const txns = [
      T({ type: 'income', amount: 100 }),
      T({ type: 'income', amount: 50 }),
      T({ type: 'expense', amount: 30 }),
      T({ type: 'refund', amount: 20 }),
    ];
    expect(sumByType(txns, 'income')).toBe(150);
    expect(sumByType(txns, 'expense')).toBe(30);
  });

  it('totalExpenses counts refunds as money out', () => {
    const txns = [
      T({ type: 'expense', amount: 40 }),
      T({ type: 'refund', amount: 25 }),
      T({ type: 'transfer', amount: 999 }),
    ];
    expect(totalExpenses(txns)).toBe(65);
  });

  it('respects a date range (inclusive bounds)', () => {
    const txns = [
      T({ amount: 10, occurred_at: '2026-07-01T00:00:00.000Z' }),
      T({ amount: 20, occurred_at: '2026-07-15T00:00:00.000Z' }),
      T({ amount: 30, occurred_at: '2026-07-31T23:59:59.999Z' }),
      T({ amount: 40, occurred_at: '2026-08-01T00:00:00.000Z' }),
    ];
    expect(totalRevenue(txns, { from: '2026-07-01', to: '2026-07-31' })).toBe(60);
  });
});

describe('netCashFlow / cashBalance', () => {
  it('income minus expenses minus refunds; transfers/adjustments neutral', () => {
    const txns = [
      T({ type: 'income', amount: 500 }),
      T({ type: 'expense', amount: 150 }),
      T({ type: 'refund', amount: 50 }),
      T({ type: 'transfer', amount: 1000 }),
      T({ type: 'adjustment', amount: 7 }),
    ];
    expect(netCashFlow(txns)).toBe(300);
    expect(cashBalance(txns)).toBe(300);
  });
});

describe('revenueLastDays', () => {
  it('only counts income in the trailing window', () => {
    const txns = [
      T({ amount: 100, occurred_at: '2026-08-08T00:00:00.000Z' }),
      T({ amount: 50, occurred_at: '2026-06-01T00:00:00.000Z' }),
    ];
    expect(revenueLastDays(txns, NOW, 30)).toBe(100);
  });
});

describe('mrr / arr', () => {
  it('amortizes renewals over the duration they buy', () => {
    const renewals = [
      R({ amount: 120, duration_days: 30 }), // R$120/mês
      R({ amount: 180, duration_days: 90 }), // R$60/mês
      R({ amount: 365, duration_days: 365 }), // R$30/mês
    ];
    expect(mrr(renewals)).toBeCloseTo(210, 5);
    expect(arr(renewals)).toBeCloseTo(2520, 5);
  });

  it('skips renewals outside the range', () => {
    const renewals = [
      R({ amount: 120, duration_days: 30, created_at: '2026-07-01T00:00:00.000Z' }),
      R({ amount: 300, duration_days: 30, created_at: '2025-01-01T00:00:00.000Z' }),
    ];
    expect(mrr(renewals, { from: '2026-06-01' })).toBe(120);
  });
});

describe('averageTicket', () => {
  it('averages paid payments by default', () => {
    const payments = [
      P({ amount: 120, status: 'paid' }),
      P({ amount: 240, status: 'paid' }),
      P({ amount: 500, status: 'pending' }),
    ];
    expect(averageTicket(payments)).toBe(180);
  });

  it('can average all receivables including open ones', () => {
    const payments = [
      P({ amount: 120, status: 'paid' }),
      P({ amount: 240, status: 'pending' }),
    ];
    expect(averageTicket(payments, { paidOnly: false })).toBe(180);
  });

  it('returns 0 for an empty pool', () => {
    expect(averageTicket([])).toBe(0);
  });
});

describe('delinquency', () => {
  it('open = pending/late/partial; overdue = those past due', () => {
    const payments = [
      P({ amount: 100, status: 'pending', due_at: '2026-07-20T00:00:00.000Z' }), // overdue
      P({ amount: 200, status: 'late', due_at: '2026-07-25T00:00:00.000Z' }), // overdue
      P({ amount: 300, status: 'partial', due_at: '2026-09-01T00:00:00.000Z' }), // open, not overdue
      P({ amount: 400, status: 'paid' }),
      P({ amount: 500, status: 'canceled' }),
    ];
    const d = delinquency(payments, NOW);
    expect(d.openCount).toBe(3);
    expect(d.overdueCount).toBe(2);
    expect(d.overdueAmount).toBe(300);
    expect(d.rate).toBeCloseTo(2 / 3, 5);
  });

  it('rate is 0 with no open receivables', () => {
    expect(delinquency([P({ status: 'paid' })], NOW).rate).toBe(0);
    expect(delinquency([], NOW).rate).toBe(0);
  });
});

describe('revenueByCategory', () => {
  it('groups income by category, ignores non-income', () => {
    const txns = [
      T({ type: 'income', category: 'renewal', amount: 100 }),
      T({ type: 'income', category: 'renewal', amount: 50 }),
      T({ type: 'income', category: 'sale', amount: 30 }),
      T({ type: 'expense', category: 'server', amount: 999 }),
    ];
    expect(revenueByCategory(txns)).toEqual({ renewal: 150, sale: 30 });
  });
});

describe('monthlySeries', () => {
  it('zero-fills gaps so the trend is continuous', () => {
    const txns = [
      T({ type: 'income', amount: 100, occurred_at: '2026-08-05T00:00:00.000Z' }),
      T({ type: 'expense', amount: 20, occurred_at: '2026-08-05T00:00:00.000Z' }),
    ];
    const series = monthlySeries(txns, NOW, 3);
    expect(series).toHaveLength(3);
    expect(series[2]).toEqual({ month: '2026-08', revenue: 100, expenses: 20, net: 80 });
    expect(series[0]).toEqual({ month: '2026-06', revenue: 0, expenses: 0, net: 0 });
    expect(series[1].month).toBe('2026-07');
  });
});

describe('simpleProjection', () => {
  it('extrapolates trailing daily average over the horizon', () => {
    const txns = [
      T({ amount: 300, occurred_at: '2026-08-08T00:00:00.000Z' }),
    ];
    // 300 over 30 lookback days = 10/day → R$300 over 30-day horizon.
    expect(simpleProjection(txns, NOW, { lookbackDays: 30, horizonDays: 30 })).toBe(300);
  });
});
