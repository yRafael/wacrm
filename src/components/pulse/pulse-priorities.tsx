'use client';

// ============================================================
// PulsePriorities — the two "what needs eyes on it now" panels:
//   🔴 Vencendo hoje  — active credentials overdue or expiring today
//   🟡 Aguardando     — open receivables (pending/late/partial)
//
// Rows link through to the pages where the operator can act
// (/clients for credentials, /renewals for payments). Empty states
// are deliberately quiet: an empty pulse is a good pulse.
// ============================================================

import Link from 'next/link';
import { CircleDollarSign, Clock3, Hourglass } from 'lucide-react';
import type { ComponentType } from 'react';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { Skeleton } from '@/components/dashboard/skeleton';
import type {
  DueCredential,
  PendingPayment,
  PulsePriorities,
} from '@/lib/pulse/types';

interface PulsePrioritiesProps {
  priorities: PulsePriorities | null;
  loading: boolean;
}

type Tone = 'danger' | 'warning';

export function PulsePriorities({ priorities, loading }: PulsePrioritiesProps) {
  const t = useTranslations('Pulse.priorities');
  const { defaultCurrency } = useAuth();

  const due = priorities?.due ?? [];
  const payments = priorities?.payments ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* 🔴 Vencendo hoje */}
      <PriorityPanel
        tone="danger"
        title={t('dueToday')}
        count={loading ? null : due.length}
        icon={Hourglass}
      >
        {loading ? (
          <SkeletonRows rows={4} />
        ) : due.length === 0 ? (
          <EmptyPanel hint={t('dueTodayEmptyHint')}>
            {t('dueTodayEmpty')}
          </EmptyPanel>
        ) : (
          <ul className="divide-border divide-y">
            {due.map((item) => (
              <DueRow key={item.id} item={item} t={t} />
            ))}
          </ul>
        )}
        {!loading && due.length > 0 && (
          <PanelFooter href="/clients">{t('viewAll')}</PanelFooter>
        )}
      </PriorityPanel>

      {/* 🟡 Aguardando pagamento */}
      <PriorityPanel
        tone="warning"
        title={t('payments')}
        count={loading ? null : payments.length}
        icon={CircleDollarSign}
      >
        {loading ? (
          <SkeletonRows rows={4} />
        ) : payments.length === 0 ? (
          <EmptyPanel hint={t('paymentsEmptyHint')}>
            {t('paymentsEmpty')}
          </EmptyPanel>
        ) : (
          <ul className="divide-border divide-y">
            {payments.map((item) => (
              <PaymentRow
                key={item.id}
                item={item}
                currency={defaultCurrency}
                t={t}
              />
            ))}
          </ul>
        )}
        {!loading && payments.length > 0 && (
          <PanelFooter href="/renewals">{t('viewAll')}</PanelFooter>
        )}
      </PriorityPanel>
    </div>
  );
}

// ------------------------------------------------------------

function PriorityPanel({
  tone,
  title,
  count,
  icon: Icon,
  children,
}: {
  tone: Tone;
  title: string;
  count: number | null;
  icon: ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  const toneClass =
    tone === 'danger'
      ? 'bg-red-500/10 text-red-400'
      : 'bg-amber-500/10 text-amber-400';
  return (
    <section className="border-border bg-card flex flex-col rounded-xl border">
      <header className="border-border flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-md ${toneClass}`}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <h2 className="text-foreground text-sm font-semibold">{title}</h2>
        </div>
        {count !== null && (
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">
            {count}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

function DueRow({
  item,
  t,
}: {
  item: DueCredential;
  t: ReturnType<typeof useTranslations<'Pulse.priorities'>>;
}) {
  const dotClass = item.overdue ? 'bg-red-500' : 'bg-amber-400';
  return (
    <li>
      <Link
        href="/clients"
        className="hover:bg-muted/50 flex items-center justify-between gap-3 px-4 py-3 transition-colors"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
          <span className="text-foreground truncate text-sm font-medium">
            {item.contactName}
          </span>
        </span>
        <span
          className={`shrink-0 text-xs tabular-nums ${
            item.overdue
              ? 'font-semibold text-red-400'
              : 'text-muted-foreground'
          }`}
        >
          {item.overdue
            ? t('dueOverdue', { date: fmtShortDate(item.expiresAt) })
            : t('dueAtTime', { time: fmtTime(item.expiresAt) })}
        </span>
      </Link>
    </li>
  );
}

function PaymentRow({
  item,
  currency,
  t,
}: {
  item: PendingPayment;
  currency: string;
  t: ReturnType<typeof useTranslations<'Pulse.priorities'>>;
}) {
  return (
    <li>
      <Link
        href="/renewals"
        className="hover:bg-muted/50 flex items-center justify-between gap-3 px-4 py-3 transition-colors"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Clock3
            className={`h-4 w-4 shrink-0 ${
              item.overdue ? 'text-red-400' : 'text-muted-foreground'
            }`}
          />
          <span className="text-foreground truncate text-sm font-medium">
            {item.contactName}
          </span>
          {item.overdue && (
            <span className="shrink-0 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-400">
              {t('late')}
            </span>
          )}
        </span>
        <span className="shrink-0 text-right">
          <span className="text-foreground block text-sm font-semibold tabular-nums">
            {formatCurrency(item.amount, currency)}
          </span>
          <span className="text-muted-foreground block text-xs tabular-nums">
            {t('paymentDue', { date: fmtShortDate(item.dueAt) })}
          </span>
        </span>
      </Link>
    </li>
  );
}

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div className="space-y-3 px-4 py-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

function EmptyPanel({
  hint,
  children,
}: {
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-8 text-center">
      <p className="text-muted-foreground text-sm">{children}</p>
      <p className="text-muted-foreground/70 text-xs">{hint}</p>
    </div>
  );
}

function PanelFooter({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border border-t px-4 py-2">
      <Link
        href={href}
        className="text-primary hover:text-primary/80 text-xs font-medium"
      >
        {children}
      </Link>
    </div>
  );
}

function fmtShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
