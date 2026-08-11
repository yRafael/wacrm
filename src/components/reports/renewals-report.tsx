"use client";

import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { formatDate, formatDateCsv } from "@/lib/reports/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Renewal } from "@/types";
import { ExportButton } from "./export-button";
import { ReportEmpty } from "./empty-state";

/**
 * Renovações — the renewal ledger: who renewed, when, for how much,
 * which kind, and the new expiry. Newest first.
 */
export function RenewalsReport({ renewals }: { renewals: Renewal[] }) {
  const t = useTranslations("Reports");
  const tr = useTranslations("Renewals");
  const locale = useLocale();
  const { defaultCurrency } = useAuth();

  const sorted = [...renewals].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );

  if (sorted.length === 0) {
    return <ReportEmpty label={t("emptyRenewals")} />;
  }

  const name = (r: Renewal) =>
    r.contact?.name ?? r.contact?.phone ?? tr("noContact");

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton
          filename="renewals.csv"
          headers={[tr("contact"), t("date"), tr("amount"), t("type"), tr("expiresAt")]}
          rows={sorted.map((r) => [
            name(r),
            formatDateCsv(r.created_at),
            r.amount,
            tr(`renewalType.${r.renewal_type}`),
            formatDateCsv(r.new_expires_at),
          ])}
        />
      </div>

      <div className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tr("contact")}</TableHead>
              <TableHead>{t("date")}</TableHead>
              <TableHead className="text-right">{tr("amount")}</TableHead>
              <TableHead>{t("type")}</TableHead>
              <TableHead>{tr("expiresAt")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{name(r)}</TableCell>
                <TableCell>{formatDate(r.created_at, locale)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(r.amount, defaultCurrency)}
                </TableCell>
                <TableCell>{tr(`renewalType.${r.renewal_type}`)}</TableCell>
                <TableCell>{formatDate(r.new_expires_at, locale)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
