// ============================================================
// Briefing — lógica pura do "painel vivo"
//
// Converte os dados de leitura (Pulse + Dashboard + receita) em um
// briefing pronto para o hero da página inicial: saudação por hora,
// expressão do mascote, frase viva e chips de estatísticas.
//
// Nenhuma dependência de navegador/DB aqui — tudo é função pura e
// determinística, coberta por vitest. O componente FireHero chama
// essas funções e traduz as chaves com next-intl.
// ============================================================

import type { MetricsBundle } from './types';
import type { PulseMetrics } from '@/lib/pulse/types';

export type GreetingKey = 'morning' | 'afternoon' | 'evening';
export type MascotExpression = 'normal' | 'happy' | 'busy';

/** 5–11 manhã · 12–17 tarde · 18–4 noite. */
export function greetingForHour(hour: number): GreetingKey {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

/**
 * Expressão do mascote:
 * · `busy`   → há atendimento aguardando resposta (prioridade máxima)
 * · `happy`  → houve venda na semana
 * · `normal` → nenhum dos dois (operação tranquila)
 */
export function mascotExpressionFor(
  pulse: Pick<PulseMetrics, 'atendimentoAguardando'>,
  weeklyRevenue: number
): MascotExpression {
  if (pulse.atendimentoAguardando > 0) return 'busy';
  if (weeklyRevenue > 0) return 'happy';
  return 'normal';
}

export type StatFormat = 'number' | 'currency';

export interface BriefingStat {
  /** id único — vira a chave de tradução Hero.stats.<id>. */
  id: string;
  /** Valor bruto para o AnimatedNumber (moeda em centavos/unidade). */
  value: number;
  /** Como o chip formata o valor (moeda → formatCurrency). */
  format: StatFormat;
}

export interface Briefing {
  greetingKey: GreetingKey;
  mascotExpression: MascotExpression;
  /** Chips do hero, na ordem de exibição. */
  stats: BriefingStat[];
  /** Chave da frase viva (Hero.phrase.*). */
  phraseKey: string;
  /**
   * Variáveis interpoladas na frase ({conversas} etc.). Números podem
   * ser trocados por strings já formatadas (ex.: moeda) no componente
   * antes de passar ao next-intl.
   */
  phraseValues: Record<string, number | string>;
}

export interface BriefingInput {
  pulse: PulseMetrics;
  metrics: MetricsBundle;
  /** Receita dos últimos 7 dias (revenueLastDays já calculado). */
  weeklyRevenue: number;
}

/**
 * Prioridade da frase viva — a situação mais urgente fala primeiro:
 * 1. atendimento aguardando   → "X conversas esperando você"
 * 2. renovações hoje          → "X renovações concluídas hoje"
 * 3. venda na semana          → "essa semana vendemos R$ X"
 * 4. vencendo hoje            → "X clientes vencem hoje"
 * 5. nenhum                   → frase tranquila padrão
 */
function pickPhrase(
  pulse: PulseMetrics,
  weeklyRevenue: number
): { phraseKey: string; phraseValues: Record<string, number> } {
  if (pulse.atendimentoAguardando > 0) {
    return {
      phraseKey: 'phrase.busy',
      phraseValues: { conversas: pulse.atendimentoAguardando },
    };
  }
  if (pulse.renovacoesHoje > 0) {
    return {
      phraseKey: 'phrase.renewals',
      phraseValues: { renewals: pulse.renovacoesHoje },
    };
  }
  if (weeklyRevenue > 0) {
    return {
      phraseKey: 'phrase.sold',
      phraseValues: { vendas: weeklyRevenue },
    };
  }
  if (pulse.vencendoHoje > 0) {
    return {
      phraseKey: 'phrase.expiring',
      phraseValues: { vencendo: pulse.vencendoHoje },
    };
  }
  return { phraseKey: 'phrase.quiet', phraseValues: {} };
}

/**
 * Monta o briefing completo. `hour` é passado explicitamente para os
 * testes serem determinísticos; o FireHero passa new Date().getHours().
 */
export function buildBriefing(input: BriefingInput, hour: number): Briefing {
  const { pulse, weeklyRevenue } = input;
  const { phraseKey, phraseValues } = pickPhrase(pulse, weeklyRevenue);

  const stats: BriefingStat[] = [
    {
      id: 'conversasAguardando',
      value: pulse.atendimentoAguardando,
      format: 'number',
    },
    {
      id: 'vendasSemana',
      value: weeklyRevenue,
      format: 'currency',
    },
    {
      id: 'vencendoHoje',
      value: pulse.vencendoHoje,
      format: 'number',
    },
    {
      id: 'renovacoesHoje',
      value: pulse.renovacoesHoje,
      format: 'number',
    },
  ];

  return {
    greetingKey: greetingForHour(hour),
    mascotExpression: mascotExpressionFor(pulse, weeklyRevenue),
    stats,
    phraseKey,
    phraseValues,
  };
}
