"use client"

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

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  AlertTriangle,
  Clock3,
  MessageSquare,
  RefreshCw,
} from 'lucide-react'

import {
  loadOperators,
  loadPulseActivity,
  loadPulseMetrics,
  loadPulsePriorities,
} from '@/lib/pulse/queries'
import type {
  PulseActivityItem,
  PulseMetrics,
  PulseOperators,
  PulsePriorities,
} from '@/lib/pulse/types'

import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { PulsePriorities as PrioritiesPanel } from '@/components/pulse/pulse-priorities'
import { PulseActivity } from '@/components/pulse/pulse-activity'
import { PulseOperations } from '@/components/pulse/pulse-operations'

import { useTranslations } from 'next-intl'
import { useUnreadNotifications } from '@/hooks/use-unread-notifications'

// The pulse tables whose changes should refresh the panel. The
// dashboard is static; Pulse is meant to feel alive.
const LIVE_TABLES = [
  'conversations',
  'payments',
  'renewals',
  'iptv_credentials',
  'notifications',
] as const

/** Coalesce bursts (Realtime often fires several events at once). */
const RELOAD_DEBOUNCE_MS = 800

export default function PulsePage() {
  const t = useTranslations('Pulse')
  const unreadAlerts = useUnreadNotifications()
  // Debounce timer for the Realtime coalescing effect below.
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [metrics, setMetrics] = useState<PulseMetrics | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)

  const [priorities, setPriorities] = useState<PulsePriorities | null>(null)
  const [prioritiesLoading, setPrioritiesLoading] = useState(true)

  const [activity, setActivity] = useState<PulseActivityItem[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)

  const [operators, setOperators] = useState<PulseOperators | null>(null)
  const [operatorsLoading, setOperatorsLoading] = useState(true)

  const loadAll = useCallback(() => {
    const db = createClient()

    void loadPulseMetrics(db)
      .then((m) => setMetrics(m))
      .catch((err) => console.error('[pulse] metrics failed:', err))
      .finally(() => setMetricsLoading(false))

    void loadPulsePriorities(db)
      .then((p) => setPriorities(p))
      .catch((err) => console.error('[pulse] priorities failed:', err))
      .finally(() => setPrioritiesLoading(false))

    void loadPulseActivity(db)
      .then((a) => setActivity(a))
      .catch((err) => console.error('[pulse] activity failed:', err))
      .finally(() => setActivityLoading(false))

    void loadOperators(db)
      .then((o) => setOperators(o))
      .catch((err) => console.error('[pulse] operators failed:', err))
      .finally(() => setOperatorsLoading(false))
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Live refresh: subscribe to every pulse table and coalesce changes
  // into a single reload. `loadAll` is stable, so the channel is set
  // up once and the debounce timer is torn down on unmount.
  useEffect(() => {
    const supabase = createClient()

    const scheduleReload = () => {
      if (reloadTimerRef.current) return
      reloadTimerRef.current = setTimeout(() => {
        reloadTimerRef.current = null
        loadAll()
      }, RELOAD_DEBOUNCE_MS)
    }

    const channel = supabase.channel('pulse-live')
    for (const table of LIVE_TABLES) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        scheduleReload,
      )
    }
    channel.subscribe()

    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
      supabase.removeChannel(channel)
    }
  }, [loadAll, reloadTimerRef])

  const vencendoSubtitle =
    (metrics?.vencendoAtrasadas ?? 0) > 0
      ? t('metrics.vencendoOverdue', { count: metrics?.vencendoAtrasadas ?? 0 })
      : t('metrics.vencendoTomorrow', { count: metrics?.vencendoAmanha ?? 0 })

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('description')}
        </p>
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
            />
            <MetricCard
              title={t('metrics.renovacoes')}
              value={metrics.renovacoesHoje.toLocaleString()}
              icon={RefreshCw}
              subtitle={t('metrics.renovacoesSubtitle')}
            />
            <MetricCard
              title={t('metrics.vencendo')}
              value={metrics.vencendoHoje.toLocaleString()}
              icon={Clock3}
              subtitle={vencendoSubtitle}
            />
            <MetricCard
              title={t('metrics.alertas')}
              value={unreadAlerts.toLocaleString()}
              icon={AlertTriangle}
              subtitle={t('metrics.alertasSubtitle')}
            />
          </>
        )}
      </div>

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
  )
}
