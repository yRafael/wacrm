'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { topClientsByRevenue } from '@/lib/reports/aggregates';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { FinancialTransaction } from '@/types';
import { ExportButton } from './export-button';
import { ReportEmpty } from './empty-state';

/**
 * Clientes — lifetime revenue ranked by contact, from the pure
 * `topClientsByRevenue` rollup. Only income rows count; refunds and
 * expenses never enter the ranking.
 */
export function TopClientsReport({ txns }: { txns: FinancialTransaction[] }) {
  const t = useTranslations('Reports');
  const { defaultCurrency } = useAuth();
  const rows = topClientsByRevenue(txns, 10);

  if (rows.length === 0) {
    return <ReportEmpty label={t('emptyClients')} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">{t('clientsHint')}</p>
        <ExportButton
          filename="top-clients.csv"
          headers={[t('rank'), t('client'), t('revenue'), t('pctOfTotal')]}
          rows={rows.map((r, i) => [i + 1, r.name, r.revenue, `${r.pct}%`])}
        />
      </div>

      <div className="border-border bg-card rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">{t('rank')}</TableHead>
              <TableHead>{t('client')}</TableHead>
              <TableHead className="text-right">{t('revenue')}</TableHead>
              <TableHead className="text-right">{t('pctOfTotal')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r.name}>
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(r.revenue, defaultCurrency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.pct}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
