"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarDays, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SkeletonCard } from "@/components/dashboard/skeleton";
import { BarChart } from "@/components/tremor/bar-chart";
import { Badge } from "@/components/ui/badge";
import {
  averageTicket,
  cashBalance,
  delinquency,
  monthlySeries,
  mrr,
  arr,
  revenueByCategory,
  revenueLastDays,
  totalRevenue,
} from "@/lib/iptv/finance";
import type {
  FinancialTransaction,
  Payment,
  Renewal,
} from "@/types";

/**
 * Finance overview — the doc Cap. 44 dashboard (saldo, receita hoje/
 * semana/mês, MRR, inadimplência, contas a receber, projeção).
 *
 * Every query goes through the authenticated client, so RLS scopes the
 * rows to the caller's account — no account_id filter needed. The pure
 * math lives in `src/lib/iptv/finance.ts` (vitest-covered); this
 * component only fetches and renders.
 */
export function FinanceOverview() {
  const t = useTranslations("Finance");
  const { defaultCurrency } = useAuth();

  const [txns, setTxns] = useState<FinancialTransaction[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const db = createClient();
      const [txnRes, payRes, renRes] = await Promise.all([
        db.from("financial_transactions").select("*").order("occurred_at", { ascending: false }),
        db.from("payments").select("*"),
        db.from("renewals").select("*"),
      ]);
      if (cancelled) return;
      if (txnRes.error) console.error("[finance] transactions:", txnRes.error.message);
      if (payRes.error) console.error("[finance] payments:", payRes.error.message);
      if (renRes.error) console.error("[finance] renewals:", renRes.error.message);
      setTxns((txnRes.data as FinancialTransaction[]) ?? []);
      setPayments((payRes.data as Payment[]) ?? []);
      setRenewals((renRes.data as Renewal[]) ?? []);
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const bal = cashBalance(txns);
  const todayRev = totalRevenue(txns, { from: today, to: now.toISOString() });
  const last30 = revenueLastDays(txns, now, 30);
  const monthly = monthlySeries(txns, now, 6);
  const categories = revenueByCategory(txns);
  const del = delinquency(payments, now);
  const avgTicket = averageTicket(payments);
  const mr = mrr(renewals);
  const ar = arr(renewals);

  const categoryEntries = Object.entries(categories).sort((a, b) => b[1] - a[1]);
  const categoryLabels: Record<string, string> = {
    sale: t("categorySale"),
    renewal: t("categoryRenewal"),
    server: t("categoryServer"),
    internet: t("categoryInternet"),
    marketing: t("categoryMarketing"),
    salary: t("categorySalary"),
    taxes: t("categoryTaxes"),
    other: t("categoryOther"),
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title={t("balance")}
          value={formatCurrency(bal, defaultCurrency)}
          icon={Wallet}
          subtitle={t("balanceSub")}
        />
        <MetricCard
          title={t("revenueToday")}
          value={formatCurrency(todayRev, defaultCurrency)}
          icon={TrendingUp}
          subtitle={t("revenueTodaySub")}
        />
        <MetricCard
          title={t("revenue30d")}
          value={formatCurrency(last30, defaultCurrency)}
          icon={CalendarDays}
          subtitle={t("revenue30dSub")}
        />
        <MetricCard
          title={t("mrr")}
          value={formatCurrency(mr, defaultCurrency)}
          icon={TrendingUp}
          subtitle={t("mrrSub", { arr: formatCurrency(ar, defaultCurrency) })}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">{t("trend")}</h3>
            <span className="text-xs text-muted-foreground">{t("last6Months")}</span>
          </div>
          <div className="h-72 w-full">
            <BarChart
              data={monthly}
              index="month"
              categories={["revenue", "expenses"]}
              colors={["emerald", "pink"]}
              valueFormatter={(v: number) => formatCurrency(v, defaultCurrency)}
              showLegend
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-3 text-sm font-semibold text-foreground">{t("revenueByCategory")}</h3>
            {categoryEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noData")}</p>
            ) : (
              <ul className="space-y-2">
                {categoryEntries.map(([cat, value]) => (
                  <li key={cat} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{categoryLabels[cat] ?? cat}</span>
                    <span className="font-medium tabular-nums text-foreground">
                      {formatCurrency(value, defaultCurrency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-3 text-sm font-semibold text-foreground">{t("health")}</h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("avgTicket")}</span>
                <span className="font-medium tabular-nums text-foreground">
                  {formatCurrency(avgTicket, defaultCurrency)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("openReceivables")}</span>
                <span className="font-medium tabular-nums text-foreground">{del.openCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  {t("delinquency")}
                  <Badge
                    variant={del.rate > 0.3 ? "destructive" : del.rate > 0.1 ? "default" : "outline"}
                    className="ml-0"
                  >
                    {Math.round(del.rate * 100)}%
                  </Badge>
                </span>
                <span className="font-medium tabular-nums text-foreground">
                  {formatCurrency(del.overdueAmount, defaultCurrency)}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <TrendingDown className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">{t("arrears")}</h3>
            </div>
            <p className="mt-2 text-[28px] font-bold tabular-nums text-foreground">
              {formatCurrency(del.overdueAmount, defaultCurrency)}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("arrearsSub", { count: del.overdueCount })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
