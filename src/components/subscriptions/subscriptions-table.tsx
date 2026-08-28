'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Search,
  Tv,
  XCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  countSubscriptionBuckets,
  subscriptionBucket,
  type SubscriptionBucket,
  type SubscriptionRow,
} from '@/lib/iptv/subscriptions';
import type { IptvCredentialStatus } from '@/types';
import { MetricCard } from '@/components/dashboard/metric-card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SkeletonCard } from '@/components/dashboard/skeleton';
import { formatCurrency } from '@/lib/currency';

type StatusFilter = 'all' | IptvCredentialStatus;

const STATUS_BADGE: Record<
  IptvCredentialStatus,
  { variant: 'default' | 'destructive' | 'secondary'; labelKey: string }
> = {
  active: { variant: 'default', labelKey: 'statusActive' },
  expired: { variant: 'destructive', labelKey: 'statusExpired' },
  revoked: { variant: 'secondary', labelKey: 'statusRevoked' },
};

// Expiry-cell tone derives from the BUCKET (computed from expires_at vs
// today), not from the stored status — a row that is still flagged "active"
// but whose date already passed reads as overdue. Revoked/unparseable rows
// stay muted.
function expiryTone(bucket: SubscriptionBucket | null): string {
  if (bucket === 'expired') return 'font-medium text-red-400';
  if (bucket === 'expiring7') return 'font-medium text-amber-400';
  return 'text-muted-foreground';
}

export function SubscriptionsTable() {
  const t = useTranslations('Subscriptions');
  const [rows, setRows] = useState<SubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');

  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const db = createClient();
    setError(null);
    return Promise.resolve(
      db
        .from('iptv_credentials')
        .select(
          '*, contact:contacts!iptv_credentials_contact_id_fkey(id, name, phone, email), plan:plans!iptv_credentials_plan_id_fkey(id, name, duration_days, price), server:servers!iptv_credentials_server_id_fkey(id, name)'
        )
        .is('deleted_at', null)
        .order('expires_at', { ascending: false })
    ).then(({ data, error }) => {
      if (error) {
        console.error('[subscriptions] load:', error.message);
        setError(t('loadError'));
      }
      setRows((data as SubscriptionRow[]) ?? []);
      setLoading(false);
    });
  }, [t]);

  useEffect(() => {
    void load().catch((err) =>
      console.error('[subscriptions] load failed:', err)
    );
  }, [load]);

  const counts = useMemo(() => countSubscriptionBuckets(rows), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = new Date();
    return rows
      .filter((r) => {
        if (filter !== 'all' && r.status !== filter) return false;
        if (q) {
          const haystack = [
            r.contact?.name ?? '',
            r.contact?.phone ?? '',
            r.username,
          ]
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .map((r) => ({ row: r, bucket: subscriptionBucket(r, now) }));
  }, [rows, query, filter]);

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

  const filters: { key: StatusFilter; labelKey: string; count: number }[] = [
    { key: 'all', labelKey: 'filterAll', count: rows.length },
    { key: 'active', labelKey: 'filterActive', count: counts.active },
    { key: 'expired', labelKey: 'filterExpired', count: counts.expired },
    {
      key: 'revoked',
      labelKey: 'filterRevoked',
      count: rows.filter((r) => r.status === 'revoked').length,
    },
  ];

  return (
    <div className="space-y-6">
      {/* KPIs — summary of the whole account (buckets from daysUntil). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title={t('kpiActive')}
          value={String(counts.active)}
          icon={CheckCircle2}
        />
        <MetricCard
          title={t('kpiExpiring7')}
          value={String(counts.expiring7)}
          icon={AlertCircle}
        />
        <MetricCard
          title={t('kpiExpiring30')}
          value={String(counts.expiring30)}
          icon={CalendarClock}
        />
        <MetricCard
          title={t('kpiExpired')}
          value={String(counts.expired)}
          icon={XCircle}
        />
      </div>

      {/* Search + status filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="border-border bg-card text-foreground pl-8"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
                filter === f.key
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              {t(f.labelKey)}
              <span className="text-xs tabular-nums opacity-70">{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
          <button
            onClick={() => load()}
            className="text-primary ml-auto cursor-pointer text-xs underline hover:no-underline"
          >
            {t('retry')}
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="border-border flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
          <Tv className="text-muted-foreground/50 size-8" />
          <p className="text-muted-foreground text-sm">{t('empty')}</p>
        </div>
      ) : (
        <div className="border-border bg-card overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left text-xs tracking-wider uppercase">
                  <th className="px-4 py-3 font-medium">{t('colClient')}</th>
                  <th className="px-4 py-3 font-medium">{t('colUsername')}</th>
                  <th className="px-4 py-3 font-medium">{t('colServer')}</th>
                  <th className="px-4 py-3 font-medium">{t('colPlan')}</th>
                  <th className="px-4 py-3 font-medium">{t('colPrice')}</th>
                  <th className="px-4 py-3 font-medium">{t('colExpires')}</th>
                  <th className="px-4 py-3 font-medium">{t('colStatus')}</th>
                  <th className="px-4 py-3 font-medium">{t('colNotes')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ row, bucket }) => {
                  const badge = STATUS_BADGE[row.status];
                  return (
                    <tr
                      key={row.id}
                      className="border-border/60 hover:bg-muted/40 border-b last:border-0"
                    >
                      <td className="px-4 py-3">
                        <span className="text-foreground block font-medium">
                          {row.contact?.name || t('noName')}
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          {row.contact?.phone || '—'}
                        </span>
                      </td>
                      <td className="text-muted-foreground px-4 py-3 font-mono text-xs">
                        {row.username || '—'}
                      </td>
                      <td className="text-muted-foreground px-4 py-3">
                        {row.server?.name || '—'}
                      </td>
                      <td className="text-muted-foreground px-4 py-3">
                        {row.plan?.name || '—'}
                      </td>
                      <td className="text-muted-foreground px-4 py-3 tabular-nums">
                        {row.plan?.price != null
                          ? formatCurrency(row.plan.price)
                          : '—'}
                      </td>
                      <td
                        className={`px-4 py-3 tabular-nums ${expiryTone(bucket)}`}
                      >
                        {row.expires_at ? formatDate(row.expires_at) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={badge.variant}>
                          {t(badge.labelKey)}
                        </Badge>
                      </td>
                      <td className="text-muted-foreground max-w-[14rem] truncate px-4 py-3">
                        {row.notes || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
