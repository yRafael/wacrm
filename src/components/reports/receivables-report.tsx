'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { formatDate, formatDateCsv } from '@/lib/reports/format';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Payment } from '@/types';
import { ExportButton } from './export-button';
import { ReportEmpty } from './empty-state';

/** Receivables the customer still owes — everything not yet settled. */
const OPEN_STATUSES: Payment['status'][] = ['pending', 'late', 'partial'];

/**
 * Recebíveis — accounts receivable, most overdue first. Derived from
 * the same payments table the finance tab reads; only open statuses
 * (pending/late/partial) appear here.
 */
export function ReceivablesReport({ payments }: { payments: Payment[] }) {
  const t = useTranslations('Reports');
  const tr = useTranslations('Renewals');
  const locale = useLocale();
  const { defaultCurrency } = useAuth();

  const open = payments
    .filter((p) => OPEN_STATUSES.includes(p.status))
    .sort((a, b) => a.due_at.localeCompare(b.due_at));

  if (open.length === 0) {
    return <ReportEmpty label={t('emptyReceivables')} />;
  }

  const name = (p: Payment) =>
    p.contact?.name ?? p.contact?.phone ?? tr('noContact');

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton
          filename="receivables.csv"
          headers={[tr('contact'), tr('dueAt'), tr('amount'), t('status')]}
          rows={open.map((p) => [
            name(p),
            formatDateCsv(p.due_at),
            p.amount,
            tr(`status.${p.status}`),
          ])}
        />
      </div>

      <div className="border-border bg-card rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tr('contact')}</TableHead>
              <TableHead>{tr('dueAt')}</TableHead>
              <TableHead className="text-right">{tr('amount')}</TableHead>
              <TableHead>{t('status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {open.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{name(p)}</TableCell>
                <TableCell>{formatDate(p.due_at, locale)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(p.amount, defaultCurrency)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={p.status === 'late' ? 'destructive' : 'outline'}
                  >
                    {tr(`status.${p.status}`)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
