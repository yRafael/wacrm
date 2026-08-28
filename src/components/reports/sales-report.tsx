'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Repeat, TrendingUp, Wallet } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/currency';
import { MetricCard } from '@/components/dashboard/metric-card';
import { BarChart } from '@/components/tremor/bar-chart';
import {
  arr,
  averageTicket,
  monthlySeries,
  mrr,
  totalRevenue,
} from '@/lib/iptv/finance';
import type { FinancialTransaction, Payment, Renewal } from '@/types';
import { ExportButton } from './export-button';

/** Period selector — the monthly window the chart buckets into. */
const PERIODS = [
  { value: '30', labelKey: 'period30', months: 1 },
  { value: '90', labelKey: 'period90', months: 3 },
  { value: '12m', labelKey: 'period12m', months: 12 },
] as const;

type Period = (typeof PERIODS)[number]['value'];

interface SalesReportProps {
  txns: FinancialTransaction[];
  payments: Payment[];
  renewals: Renewal[];
}

/**
 * Vendas — revenue × expenses trend, headline metrics and a CSV export.
 * All math comes from the pure `src/lib/iptv/finance.ts` module; this
 * component only picks the window and renders.
 */
export function SalesReport({ txns, payments, renewals }: SalesReportProps) {
  const t = useTranslations('Reports');
  const { defaultCurrency } = useAuth();
  const [period, setPeriod] = useState<Period>('30');

  const months = PERIODS.find((p) => p.value === period)?.months ?? 1;
  const now = new Date();
  const monthly = monthlySeries(txns, now, months);

  // The chart legend renders the `categories` strings literally, so use
  // the localized labels as both the data keys and the categories.
  const revenueLabel = t('revenue');
  const expensesLabel = t('expenses');
  const chartData = monthly.map((p) => ({
    month: p.month,
    [revenueLabel]: p.revenue,
    [expensesLabel]: p.expenses,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">{t('period')}</span>
          <div className="bg-muted flex gap-1 rounded-lg p-1">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriod(p.value)}
                className={cn(
                  'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                  period === p.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t(p.labelKey)}
              </button>
            ))}
          </div>
        </div>
        <ExportButton
          filename={`sales-${period}.csv`}
          headers={[t('month'), revenueLabel, expensesLabel, t('net')]}
          rows={monthly.map((p) => [p.month, p.revenue, p.expenses, p.net])}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title={t('totalRevenue')}
          value={formatCurrency(totalRevenue(txns), defaultCurrency)}
          icon={TrendingUp}
        />
        <MetricCard
          title={t('avgTicket')}
          value={formatCurrency(averageTicket(payments), defaultCurrency)}
          icon={Wallet}
        />
        <MetricCard
          title={t('mrr')}
          value={formatCurrency(mrr(renewals), defaultCurrency)}
          icon={Repeat}
        />
        <MetricCard
          title={t('arr')}
          value={formatCurrency(arr(renewals), defaultCurrency)}
          icon={TrendingUp}
        />
      </div>

      <div className="border-border bg-card rounded-xl border p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-foreground text-sm font-semibold">
            {t('cashFlowTrend')}
          </h3>
          <span className="text-muted-foreground text-xs">
            {t('monthsCount', { count: months })}
          </span>
        </div>
        <div className="h-72 w-full">
          <BarChart
            data={chartData}
            index="month"
            categories={[revenueLabel, expensesLabel]}
            colors={['emerald', 'pink']}
            valueFormatter={(v: number) => formatCurrency(v, defaultCurrency)}
            showLegend
          />
        </div>
      </div>
    </div>
  );
}
