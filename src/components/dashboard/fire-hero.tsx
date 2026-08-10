"use client"

// ============================================================
// FireHero — o painel "vivo" da Fire Play
//
// Card no topo do Dashboard que fala com o operador: saudação por
// hora do dia, frase viva com os acontecimentos de agora (conversas
// aguardando, renovações, vendas da semana, vencimentos) e chips de
// estatísticas com contadores que sobem (AnimatedNumber). Um dot
// pulsante + Realtime deixam claro que o painel está vivo.
//
// Dados: loadPulseMetrics + loadMetrics + financial_transactions
// (para revenueLastDays). Realtime recarrega com debounce quando
// algo muda nas tabelas do pulso.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { useTranslations } from 'next-intl'
import { formatCurrency } from '@/lib/currency'

import { loadPulseMetrics } from '@/lib/pulse/queries'
import type { PulseMetrics } from '@/lib/pulse/types'
import { loadMetrics } from '@/lib/dashboard/queries'
import type { MetricsBundle } from '@/lib/dashboard/types'
import { revenueLastDays } from '@/lib/iptv/finance'
import { buildBriefing } from '@/lib/dashboard/briefing'
import type { Briefing } from '@/lib/dashboard/briefing'
import type { FinancialTransaction } from '@/types'

import { FlameMascot } from '@/components/brand/flame-mascot'
import { DecorativeFlames } from '@/components/brand/decorative-flames'
import { AnimatedNumber } from '@/components/ui/animated-number'

// Tabelas cuja mudança deve atualizar o hero (mesmo conjunto do Pulse).
const LIVE_TABLES = [
  'conversations',
  'payments',
  'renewals',
  'iptv_credentials',
] as const

/** Coalesce bursts (Realtime costuma disparar vários eventos juntos). */
const RELOAD_DEBOUNCE_MS = 800

/** Skeleton inline do hero enquanto os dados carregam. */
function HeroSkeleton() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center gap-5">
        <div className="h-24 w-24 animate-pulse rounded-full bg-muted" />
        <div className="flex-1 space-y-3">
          <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          <div className="h-4 w-80 max-w-full animate-pulse rounded bg-muted" />
          <div className="flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 w-28 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function FireHero() {
  const t = useTranslations('Hero')
  const { defaultCurrency } = useAuth()
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [loading, setLoading] = useState(true)

  const loadAll = useCallback(async () => {
    const db = createClient()
    const [pulse, metrics, txnsRes] = await Promise.all([
      loadPulseMetrics(db),
      loadMetrics(db),
      db.from('financial_transactions').select('amount, type, occurred_at'),
    ])
    const txns = (txnsRes.data ?? []) as FinancialTransaction[]
    const weeklyRevenue = revenueLastDays(txns, new Date(), 7)
    setBriefing(buildBriefing({ pulse, metrics, weeklyRevenue }, new Date().getHours()))
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadAll().catch((err) => console.error('[fire-hero] load failed:', err))
  }, [loadAll])

  // Realtime: um único canal escuta as tabelas do pulso e recarrega
  // com debounce — o hero "acorda" quando algo muda na operação.
  useEffect(() => {
    const supabase = createClient()

    const scheduleReload = () => {
      if (reloadTimerRef.current) return
      reloadTimerRef.current = setTimeout(() => {
        reloadTimerRef.current = null
        void loadAll().catch((err) => console.error('[fire-hero] reload failed:', err))
      }, RELOAD_DEBOUNCE_MS)
    }

    const channel = supabase.channel('fire-hero-live')
    for (const table of LIVE_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleReload)
    }
    channel.subscribe()

    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
      supabase.removeChannel(channel)
    }
  }, [loadAll, reloadTimerRef])

  if (loading || !briefing) return <HeroSkeleton />

  const { greetingKey, mascotExpression, stats, phraseKey, phraseValues } = briefing

  // A frase de venda interpola moeda no meio do texto — pré-formata
  // para o next-intl receber a string pronta.
  const resolvedValues: Record<string, string | number> = { ...phraseValues }
  if (phraseKey === 'phrase.sold') {
    resolvedValues.vendas = formatCurrency(Number(phraseValues.vendas ?? 0), defaultCurrency)
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-flame-1/10 via-transparent to-transparent">
      {/* Chaminhas decorativas nos cantos */}
      <DecorativeFlames />

      <div className="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
        {/* Mascote + fala */}
        <div className="flex items-center gap-4">
          <FlameMascot size={96} expression={mascotExpression} ariaLabel={t('mascot.aria')} />
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-foreground">
              {t(`greeting.${greetingKey}`)} 🔥
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {t(phraseKey, resolvedValues)}
            </p>
          </div>
        </div>

        {/* Chips de estatísticas + indicador ao vivo */}
        <div className="flex flex-1 flex-col items-end gap-3">
          <div className="flex items-center gap-1.5 rounded-full border border-primary/20 bg-card-2/60 px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-flame-1 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-flame-1" />
            </span>
            {t('live.alive')}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.id}
                className="rounded-xl border border-primary/20 bg-card-2/60 px-4 py-3 text-center"
              >
                <p className="text-[11px] font-medium text-muted-foreground">
                  {t(`stats.${stat.id}`)}
                </p>
                <p className="mt-1 text-xl font-bold text-foreground">
                  <AnimatedNumber
                    value={stat.value}
                    formatter={
                      stat.format === 'currency'
                        ? (n) => formatCurrency(n, defaultCurrency)
                        : undefined
                    }
                  />
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
