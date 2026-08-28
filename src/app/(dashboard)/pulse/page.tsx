'use client';

// ============================================================
// Fire Radar — painel visual simplificado
//
// Renamed from Fire Pulse. The Dashboard asks "como estamos?"
// (trends, history); Radar answers "o que está acontecendo agora?"
// with a clean, visual layout: KPI cards, line chart, donut,
// priorities, and activity feed. Designed for non-technical users
// to understand their operation at a glance.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  AlertTriangle,
  Clock3,
  Headphones,
  MessageSquare,
  RefreshCw,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';

import { formatCurrency } from '@/lib/currency';
import { useAuth } from '@/hooks/use-auth';

import {
  loadOperators,
  loadPulseActivity,
  loadPulseMetrics,
  loadPulsePriorities,
  loadRadarTimeSeries,
  loadRadarDistribution,
} from '@/lib/pulse/queries';
import type {
  PulseActivityItem,
  PulseMetrics,
  PulseOperators,
  PulsePriorities,
  RadarTimeSeries,
  RadarDistribution,
} from '@/lib/pulse/types';

import { MetricCard } from '@/components/dashboard/metric-card';
import { SkeletonCard } from '@/components/dashboard/skeleton';
import { PulsePriorities as PrioritiesPanel } from '@/components/pulse/pulse-priorities';
import { PulseActivity } from '@/components/pulse/pulse-activity';
import { PulseOperations } from '@/components/pulse/pulse-operations';

import { useTranslations } from 'next-intl';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';

const LIVE_TABLES = [
  'conversations',
  'payments',
  'renewals',
  'iptv_credentials',
  'notifications',
] as const;

const RELOAD_DEBOUNCE_MS = 800;

function RadarTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-amber-500/20 bg-zinc-900 px-3 py-2 shadow-xl">
      <p className="text-muted-foreground text-xs">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} className="text-sm font-medium" style={{ color: entry.color }}>
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

function DonutChart({ data, colors }: { data: { name: string; value: number }[]; colors: string[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">Sem dados</div>;

  const radius = 60;
  const strokeWidth = 20;
  const circumference = 2 * Math.PI * radius;
  let accumulated = 0;

  return (
    <div className="flex items-center gap-6">
      <svg width={160} height={160} viewBox="0 0 160 160">
        {data.map((item, i) => {
          const pct = item.value / total;
          const dashArray = `${pct * circumference} ${circumference}`;
          const dashOffset = -accumulated * circumference;
          accumulated += pct;
          return (
            <circle
              key={i}
              cx={80}
              cy={80}
              r={radius}
              fill="none"
              stroke={colors[i % colors.length]}
              strokeWidth={strokeWidth}
              strokeDasharray={dashArray}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              className="transition-all duration-500"
            />
          );
        })}
        <text x={80} y={76} textAnchor="middle" className="fill-foreground text-2xl font-bold">
          {total}
        </text>
        <text x={80} y={96} textAnchor="middle" className="fill-muted-foreground text-xs">
          total
        </text>
      </svg>
      <div className="space-y-2">
        {data.map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: colors[i % colors.length] }} />
            <span className="text-muted-foreground">{item.name}</span>
            <span className="font-medium">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PulsePage() {
  const t = useTranslations('Pulse');
  const unreadAlerts = useUnreadNotifications();
  const { defaultCurrency } = useAuth();
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [metrics, setMetrics] = useState<PulseMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);

  const [priorities, setPriorities] = useState<PulsePriorities | null>(null);
  const [prioritiesLoading, setPrioritiesLoading] = useState(true);

  const [activity, setActivity] = useState<PulseActivityItem[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);

  const [operators, setOperators] = useState<PulseOperators | null>(null);
  const [operatorsLoading, setOperatorsLoading] = useState(true);

  const [timeSeries, setTimeSeries] = useState<RadarTimeSeries[]>([]);
  const [distribution, setDistribution] = useState<RadarDistribution | null>(null);

  const loadAll = useCallback(() => {
    const db = createClient();

    void loadPulseMetrics(db)
      .then((m) => setMetrics(m))
      .catch((err) => console.error('[radar] metrics failed:', err))
      .finally(() => setMetricsLoading(false));

    void loadPulsePriorities(db)
      .then((p) => setPriorities(p))
      .catch((err) => console.error('[radar] priorities failed:', err))
      .finally(() => setPrioritiesLoading(false));

    void loadPulseActivity(db)
      .then((a) => setActivity(a))
      .catch((err) => console.error('[radar] activity failed:', err))
      .finally(() => setActivityLoading(false));

    void loadOperators(db)
      .then((o) => setOperators(o))
      .catch((err) => console.error('[radar] operators failed:', err))
      .finally(() => setOperatorsLoading(false));

    void loadRadarTimeSeries(db)
      .then((ts) => setTimeSeries(ts))
      .catch((err) => console.error('[radar] timeseries failed:', err));

    void loadRadarDistribution(db)
      .then((d) => setDistribution(d))
      .catch((err) => console.error('[radar] distribution failed:', err));
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const supabase = createClient();

    const scheduleReload = () => {
      if (reloadTimerRef.current) return;
      reloadTimerRef.current = setTimeout(() => {
        reloadTimerRef.current = null;
        loadAll();
      }, RELOAD_DEBOUNCE_MS);
    };

    const channel = supabase.channel('radar-live');
    for (const table of LIVE_TABLES) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        scheduleReload
      );
    }
    channel.subscribe();

    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [loadAll, reloadTimerRef]);

  const convDistribution = distribution?.conversations.map((d) => ({
    name: d.status === 'open' ? 'Em andamento' : d.status === 'closed' ? 'Concluído' : d.status,
    value: d.count,
  })) ?? [];

  const paymentDistribution = distribution?.payments.map((d) => ({
    name: d.status === 'paid' ? 'Pago' : d.status === 'pending' ? 'Pendente' : 'Atrasado',
    value: d.count,
  })) ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-foreground text-2xl font-bold tracking-tight">
          <span className="fire-gradient-text">{t('title')}</span>
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('description')}</p>
      </div>

      {/* KPI Cards — 4 headline metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading || !metrics ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t('metrics.atendimento')}
              value={metrics.atendimento.toLocaleString()}
              icon={MessageSquare}
              subtitle={`${metrics.atendimentoAguardando} aguardando`}
              variant="pulse"
            />
            <MetricCard
              title={t('metrics.clientesAtivos')}
              value={metrics.clientesAtivos.toLocaleString()}
              icon={Users}
              subtitle={`${metrics.novosClientes} novos este mês`}
              variant="pulse"
            />
            <MetricCard
              title={t('metrics.tempoMedio')}
              value={`${metrics.tempoMedioAguardando} min`}
              icon={Clock3}
              subtitle="tempo médio de resposta"
              variant="pulse"
            />
            <MetricCard
              title={t('metrics.vendasMes')}
              value={formatCurrency(metrics.vendasDoMes, defaultCurrency)}
              icon={TrendingUp}
              subtitle={`${metrics.renovacoesMes} renovações`}
              variant="pulse"
            />
          </>
        )}
      </div>

      {/* Charts row — Line chart + Donut */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Line chart — Evolution over 7 days */}
        <div className="rounded-xl border border-amber-500/15 bg-gradient-to-br from-amber-500/[0.04] to-transparent p-5 lg:col-span-2">
          <h3 className="text-foreground mb-4 text-sm font-semibold">Evolução — Últimos 7 dias</h3>
          {timeSeries.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={timeSeries}>
                <defs>
                  <linearGradient id="goldGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f2c94c" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#f2c94c" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#a1a1aa', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#a1a1aa', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                />
                <Tooltip content={<RadarTooltip />} />
                <Area
                  type="monotone"
                  dataKey="total"
                  name="Conversas"
                  stroke="#f2c94c"
                  strokeWidth={2}
                  fill="url(#goldGradient)"
                />
                <Area
                  type="monotone"
                  dataKey="active"
                  name="Ativas"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  fill="transparent"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-muted-foreground flex h-[220px] items-center justify-center text-sm">
              Carregando dados...
            </div>
          )}
        </div>

        {/* Donut — Conversation status */}
        <div className="rounded-xl border border-purple-500/15 bg-gradient-to-br from-purple-500/[0.04] to-transparent p-5">
          <h3 className="text-foreground mb-4 text-sm font-semibold">Status dos Atendimentos</h3>
          <DonutChart
            data={convDistribution}
            colors={['#f2c94c', '#a78bfa', '#34d399', '#f87171']}
          />
        </div>
      </div>

      {/* Priorities — due today + pending payments */}
      <PrioritiesPanel priorities={priorities} loading={prioritiesLoading} />

      {/* Activity + Operations */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="h-full lg:col-span-3">
          <PulseActivity items={activity} loading={activityLoading} />
        </div>
        <div className="h-full lg:col-span-2">
          <PulseOperations operators={operators} loading={operatorsLoading} />
        </div>
      </div>
    </div>
  );
}
