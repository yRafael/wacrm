'use client';

// ============================================================
// PulseActivity — the newest operations events, merged and sorted by
// the loader: completed renewals, opened receivables, alerts
// (notifications) and saved credentials. Mirrors the dashboard
// ActivityFeed's stripe + relative-time conventions but with the
// pulse's own kinds (money and ops events, not every message).
// ============================================================

import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  CircleDollarSign,
  FileKey,
  RefreshCw,
  Zap,
} from 'lucide-react';
import type { ComponentType } from 'react';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { Skeleton } from '@/components/dashboard/skeleton';
import { EmptyState } from '@/components/dashboard/empty-state';
import type { PulseActivityItem, PulseActivityKind } from '@/lib/pulse/types';

interface PulseActivityProps {
  items: PulseActivityItem[] | null;
  loading: boolean;
}

const KIND_META: Record<
  PulseActivityKind,
  { icon: ComponentType<{ className?: string }>; badge: string }
> = {
  renewal: { icon: RefreshCw, badge: 'bg-primary/10 text-primary' },
  payment: {
    icon: CircleDollarSign,
    badge: 'bg-emerald-500/10 text-emerald-500',
  },
  alert: { icon: AlertTriangle, badge: 'bg-amber-500/10 text-amber-500' },
  credential: { icon: FileKey, badge: 'bg-sky-500/10 text-sky-500' },
};

export function PulseActivity({ items, loading }: PulseActivityProps) {
  const t = useTranslations('Pulse.activity');
  const { defaultCurrency } = useAuth();

  return (
    <section className="border-border bg-card flex h-full flex-col rounded-xl border">
      <header className="border-border flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Zap className="text-muted-foreground h-4 w-4" />
          <h2 className="text-foreground text-sm font-semibold">
            {t('title')}
          </h2>
        </div>
      </header>

      {loading || !items ? (
        <div className="space-y-4 px-4 py-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={t('empty')}
          hint={t('emptyHint')}
          className="rounded-none border-0"
        />
      ) : (
        <ul className="divide-border flex-1 divide-y">
          {items.map((item) => {
            const meta = KIND_META[item.kind];
            const Icon = meta.icon;
            const label = itemLabel(item, t, defaultCurrency);
            return (
              <li key={item.id}>
                <Link
                  href={item.href ?? '#'}
                  className={`hover:bg-muted/50 flex items-center gap-3 px-4 py-3 transition-colors ${
                    item.href ? '' : 'cursor-default'
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.badge}`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                    {label}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {relativeTime(item.at, t)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------

function itemLabel(
  item: PulseActivityItem,
  t: ReturnType<typeof useTranslations<'Pulse.activity'>>,
  currency: string
): string {
  switch (item.kind) {
    case 'renewal':
      return t('renewal', {
        contact: item.contactName ?? '—',
        amount: formatCurrency(item.amount ?? 0, currency),
      });
    case 'payment':
      return t('payment', {
        contact: item.contactName ?? '—',
        amount: formatCurrency(item.amount ?? 0, currency),
      });
    case 'alert':
      return item.title ?? item.body ?? t('alert');
    case 'credential':
      return t('credential', { contact: item.contactName ?? '—' });
  }
}

function relativeTime(
  iso: string,
  t: ReturnType<typeof useTranslations<'Pulse.activity'>>
): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const sec = Math.round(diff / 1000);
  if (sec < 60) return t('timeS', { sec });
  const min = Math.round(sec / 60);
  if (min < 60) return t('timeM', { min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t('timeH', { hr });
  return t('timeD', { day: Math.round(hr / 24) });
}
