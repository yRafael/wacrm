'use client';

// ============================================================
// Fire Pulse — "o que está acontecendo?"
//
// The operator's live operations panel. Where the Dashboard asks
// "como estamos?" (trends, history), Pulse answers "o que está
// acontecendo agora?": the four headline numbers, the two priority
// lists, a merged activity feed and the on-duty roster with
// presence. A debounced Realtime subscription on the pulse tables
// keeps it live without re-fetching on every keystroke.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  AlertTriangle,
  CalendarClock,
  Clock3,
  Headphones,
  Hourglass,
  Inbox,
  MessageSquare,
  MessageSquareText,
  Receipt,
  RefreshCw,
  TrendingUp,
  UserPlus,
  Users,
  UserX,
  Wallet,
} from 'lucide-react';

import { formatCurrency } from '@/lib/currency';
import { useAuth } from '@/hooks/use-auth';

import {
  loadOperators,
  loadPulseActivity,
  loadPulseMetrics,
  loadPulsePriorities,
} from '@/lib/pulse/queries';
import type {
  PulseActivityItem,
  PulseMetrics,
  PulseOperators,
  PulsePriorities,
} from '@/lib/pulse/types';

import { MetricCard } from '@/components/dashboard/metric-card';
import { SkeletonCard } from '@/components/dashboard/skeleton';
import { PulsePriorities as PrioritiesPanel } from '@/components/pulse/pulse-priorities';
import { PulseActivity } from '@/components/pulse/pulse-activity';
import { PulseOperations } from '@/components/pulse/pulse-operations';

import { useTranslations } from 'next-intl';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';

// The pulse tables whose changes should refresh the panel. The
// dashboard is static; Pulse is meant to feel alive.
const LIVE_TABLES = [
  'conversations',
  'payments',
  'renewals',
  'iptv_credentials',
  'notifications',
] as const;

/** Coalesce bursts (Realtime often fires several events at once). */
const RELOAD_DEBOUNCE_MS = 800;

export default function PulsePage() {
  const t = useTranslations('Pulse');
  const unreadAlerts = useUnreadNotifications();
  const { defaultCurrency } = useAuth();
  // Debounce timer for the Realtime coalescing effect below.
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [metrics, setMetrics] = useState<PulseMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);

  const [priorities, setPriorities] = useState<PulsePriorities | null>(null);
  const [prioritiesLoading, setPrioritiesLoading] = useState(true);

  const [activity, setActivity] = useState<PulseActivityItem[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);

  const [operators, setOperators] = useState<PulseOperators | null>(null);
  const [operatorsLoading, setOperatorsLoading] = useState(true);

  const loadAll = useCallback(() => {
    const db = createClient();

    void loadPulseMetrics(db)
      .then((m) => setMetrics(m))
      .catch((err) => console.error('[pulse] metrics failed:', err))
      .finally(() => setMetricsLoading(false));

    void loadPulsePriorities(db)
      .then((p) => setPriorities(p))
      .catch((err) => console.error('[pulse] priorities failed:', err))
      .finally(() => setPrioritiesLoading(false));

    void loadPulseActivity(db)
      .then((a) => setActivity(a))
      .catch((err) => console.error('[pulse] activity failed:', err))
      .finally(() => setActivityLoading(false));

    void loadOperators(db)
      .then((o) => setOperators(o))
      .catch((err) => console.error('[pulse] operators failed:', err))
      .finally(() => setOperatorsLoading(false));
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Live refresh: subscribe to every pulse table and coalesce changes
  // into a single reload. `loadAll` is stable, so the channel is set
  // up once and the debounce timer is torn down on unmount.
  useEffect(() => {
    const supabase = createClient();

    const scheduleReload = () => {
      if (reloadTimerRef.current) return;
      reloadTimerRef.current = setTimeout(() => {
        reloadTimerRef.current = null;
        loadAll();
      }, RELOAD_DEBOUNCE_MS);
    };

    const channel = supabase.channel('pulse-live');
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

  const vencendoSubtitle =
    (metrics?.vencendoAtrasadas ?? 0) > 0
      ? t('metrics.vencendoOverdue', { count: metrics?.vencendoAtrasadas ?? 0 })
      : t('metrics.vencendoTomorrow', { count: metrics?.vencendoAmanha ?? 0 });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-foreground text-2xl font-bold tracking-tight">
          <span className="fire-gradient-text">{t('title')}</span>
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('description')}</p>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading || !metrics ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t('metrics.atendimento')}
              value={metrics.atendimento.toLocaleString()}
              icon={MessageSquare}
              subtitle={t('metrics.atendimentoSubtitle', {
                count: metrics.atendimentoAguardando,
              })}
              variant="pulse"
            />
            <MetricCard
              title={t('metrics.renovacoes')}
              value={metrics.renovacoesHoje.toLocaleString()}
              icon={RefreshCw}
              subtitle={t('metrics.renovacoesSubtitle')}
              variant="pulse"
            />
            <MetricCard
              title={t('metrics.vencendo')}
              value={metrics.vencendoHoje.toLocaleString()}
              icon={Clock3}
              subtitle={vencendoSubtitle}
              variant="pulse"
            />
            <MetricCard
              title={t('metrics.alertas')}
              value={unreadAlerts.toLocaleString()}
              icon={AlertTriangle}
              subtitle={t('metrics.alertasSubtitle')}
              variant="pulse"
            />
          </>
        )}
      </div>

      {/* Item 23 — the three metric groups (Atendimento · Clientes · Financeiro) */}
      <section className="space-y-4">
        <h2 className="text-foreground text-lg font-semibold">
          {t('metricGroups.title')}
        </h2>

        {/* Atendimento */}
        <section>
          <h3 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            {t('metricGroups.atendimento')}
          </h3>
          <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {metricsLoading || !metrics ? (
              Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
            ) : (
              <>
                <MetricCard
                  title={t('metrics.atendimentoConversas')}
                  value={metrics.atendimento.toLocaleString()}
                  icon={Inbox}
                />
                <MetricCard
                  title={t('metrics.atendimentoNaoRespondidas')}
                  value={metrics.atendimentoAguardando.toLocaleString()}
                  icon={MessageSquareText}
                />
                <MetricCard
                  title={t('metrics.tempoMedio')}
                  value={`${metrics.tempoMedioAguardando.toLocaleString()} ${t(
                    'metrics.tempoMedioUnit'
                  )}`}
                  icon={Hourglass}
                />
                <MetricCard
                  title={t('metrics.atendimentoAndamento')}
                  value={metrics.atendimentosEmAndamento.toLocaleString()}
                  icon={Headphones}
                />
              </>
            )}
          </div>
        </section>

        {/* Clientes */}
        <section>
          <h3 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            {t('metricGroups.clientes')}
          </h3>
          <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {metricsLoading || !metrics ? (
              Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
            ) : (
              <>
                <MetricCard
                  title={t('metrics.clientesAtivos')}
                  value={metrics.clientesAtivos.toLocaleString()}
                  icon={Users}
                />
                <MetricCard
                  title={t('metrics.clientesNovos')}
                  value={metrics.novosClientes.toLocaleString()}
                  icon={UserPlus}
                  subtitle={t('metrics.clientesNovosSub')}
                />
                <MetricCard
                  title={t('metrics.clientesVencidos')}
                  value={metrics.clientesVencidos.toLocaleString()}
                  icon={UserX}
                />
                <MetricCard
                  title={t('metrics.clientesProximos')}
                  value={metrics.clientesProximos.toLocaleString()}
                  icon={CalendarClock}
                  subtitle={t('metrics.clientesProximosSub')}
                />
              </>
            )}
          </div>
        </section>

        {/* Financeiro */}
        <section>
          <h3 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            {t('metricGroups.financeiro')}
          </h3>
          <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {metricsLoading || !metrics ? (
              Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
            ) : (
              <>
                <MetricCard
                  title={t('metrics.vendasMes')}
                  value={formatCurrency(metrics.vendasDoMes, defaultCurrency)}
                  icon={TrendingUp}
                  subtitle={t('metrics.vendasMesSub')}
                  variant="pulse"
                />
                <MetricCard
                  title={t('metrics.valorRecebido')}
                  value={formatCurrency(metrics.valorRecebido, defaultCurrency)}
                  icon={Wallet}
                  subtitle={t('metrics.valorRecebidoSub')}
                  variant="pulse"
                />
                <MetricCard
                  title={t('metrics.renovacoesMes')}
                  value={metrics.renovacoesMes.toLocaleString()}
                  icon={RefreshCw}
                  subtitle={t('metrics.renovacoesMesSub')}
                  variant="pulse"
                />
                <MetricCard
                  title={t('metrics.ticketMedio')}
                  value={formatCurrency(metrics.ticketMedio, defaultCurrency)}
                  icon={Receipt}
                  subtitle={t('metrics.ticketMedioSub')}
                  variant="pulse"
                />
              </>
            )}
          </div>
        </section>
      </section>

      {/* 🔴 Vencendo hoje · 🟡 Aguardando pagamento */}
      <PrioritiesPanel priorities={priorities} loading={prioritiesLoading} />

      {/* Atividade recente · Operação */}
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
