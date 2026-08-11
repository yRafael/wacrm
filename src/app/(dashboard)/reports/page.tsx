"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Skeleton } from "@/components/dashboard/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FinancialTransaction, Payment, Renewal } from "@/types";
import { SalesReport } from "@/components/reports/sales-report";
import { TopClientsReport } from "@/components/reports/top-clients-report";
import { RenewalsReport } from "@/components/reports/renewals-report";
import { ReceivablesReport } from "@/components/reports/receivables-report";

type ReportTab = "sales" | "clients" | "renewals" | "receivables";

/**
 * Reports — the CAP 52 reporting hub: Vendas | Clientes | Renovações |
 * Recebíveis. One fetch feeds all four tabs; each tab only derives and
 * renders. No account_id filter — RLS scopes every query to the caller.
 */
export default function ReportsPage() {
  const t = useTranslations("Reports");
  const [tab, setTab] = useState<ReportTab>("sales");
  const [txns, setTxns] = useState<FinancialTransaction[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [loading, setLoading] = useState(true);

  // Cadeia de .then() (não async/await): o setState fica dentro dos
  // callbacks, fora do caminho da regra react-hooks/set-state-in-effect
  // (mesmo padrão de dashboard/page.tsx e fire-hero.tsx).
  const load = useCallback(() => {
    const db = createClient();
    return Promise.all([
      db
        .from("financial_transactions")
        .select("*, contact:contacts(*)")
        .order("occurred_at", { ascending: false }),
      db.from("payments").select("*, contact:contacts(*)"),
      db.from("renewals").select("*, contact:contacts(*)"),
    ]).then(([txnRes, payRes, renRes]) => {
      if (txnRes.error)
        console.error("[reports] transactions:", txnRes.error.message);
      if (payRes.error) console.error("[reports] payments:", payRes.error.message);
      if (renRes.error) console.error("[reports] renewals:", renRes.error.message);
      setTxns((txnRes.data as FinancialTransaction[]) ?? []);
      setPayments((payRes.data as Payment[]) ?? []);
      setRenewals((renRes.data as Renewal[]) ?? []);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    void load().catch((err) => console.error("[reports] load failed:", err));
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-9 w-full max-w-md" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as ReportTab)}>
          <TabsList>
            <TabsTrigger value="sales">{t("tabSales")}</TabsTrigger>
            <TabsTrigger value="clients">{t("tabClients")}</TabsTrigger>
            <TabsTrigger value="renewals">{t("tabRenewals")}</TabsTrigger>
            <TabsTrigger value="receivables">{t("tabReceivables")}</TabsTrigger>
          </TabsList>
          <TabsContent value="sales" className="mt-4">
            <SalesReport txns={txns} payments={payments} renewals={renewals} />
          </TabsContent>
          <TabsContent value="clients" className="mt-4">
            <TopClientsReport txns={txns} />
          </TabsContent>
          <TabsContent value="renewals" className="mt-4">
            <RenewalsReport renewals={renewals} />
          </TabsContent>
          <TabsContent value="receivables" className="mt-4">
            <ReceivablesReport payments={payments} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
