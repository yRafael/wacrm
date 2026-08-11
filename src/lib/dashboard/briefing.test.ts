import { describe, expect, it } from "vitest";
import {
  buildBriefing,
  greetingForHour,
  mascotExpressionFor,
} from "./briefing";
import type { BriefingInput } from "./briefing";
import type { MetricsBundle } from "./types";
import type { PulseMetrics } from "@/lib/pulse/types";

// ------------------------------------------------------------
// Fixtures — dados de leitura realistas da operação.
// ------------------------------------------------------------

function pulse(overrides: Partial<PulseMetrics> = {}): PulseMetrics {
  return {
    atendimento: 4,
    atendimentoAguardando: 0,
    tempoMedioAguardando: 0,
    atendimentosEmAndamento: 4,
    renovacoesHoje: 0,
    vencendoHoje: 0,
    vencendoAmanha: 2,
    vencendoAtrasadas: 0,
    clientesAtivos: 0,
    novosClientes: 0,
    clientesVencidos: 0,
    clientesProximos: 0,
    vendasDoMes: 0,
    valorRecebido: 0,
    renovacoesMes: 0,
    ticketMedio: 0,
    ...overrides,
  };
}

function metrics(): MetricsBundle {
  return {
    activeConversations: { current: 10, previous: 8 },
    newContactsToday: { current: 3, previous: 5 },
    openDealsValue: 1250,
    openDealsCount: 2,
    messagesSentToday: { current: 24, previous: 30 },
  };
}

function input(overrides: Partial<BriefingInput> = {}): BriefingInput {
  return {
    pulse: pulse(),
    metrics: metrics(),
    weeklyRevenue: 0,
    ...overrides,
  };
}

// ------------------------------------------------------------

describe("greetingForHour", () => {
  it("morning between 05:00 and 11:59", () => {
    expect(greetingForHour(5)).toBe("morning");
    expect(greetingForHour(8)).toBe("morning");
    expect(greetingForHour(11)).toBe("morning");
  });

  it("afternoon between 12:00 and 17:59", () => {
    expect(greetingForHour(12)).toBe("afternoon");
    expect(greetingForHour(15)).toBe("afternoon");
    expect(greetingForHour(17)).toBe("afternoon");
  });

  it("evening from 18:00 through 04:59", () => {
    expect(greetingForHour(18)).toBe("evening");
    expect(greetingForHour(23)).toBe("evening");
    expect(greetingForHour(0)).toBe("evening");
    expect(greetingForHour(4)).toBe("evening");
  });
});

describe("mascotExpressionFor", () => {
  it("busy when a customer message is waiting", () => {
    expect(mascotExpressionFor({ atendimentoAguardando: 1 }, 0)).toBe("busy");
    expect(mascotExpressionFor({ atendimentoAguardando: 5 }, 500)).toBe("busy");
  });

  it("happy when there was weekly revenue and nothing pending", () => {
    expect(mascotExpressionFor({ atendimentoAguardando: 0 }, 120)).toBe("happy");
  });

  it("normal when quiet and no sales", () => {
    expect(mascotExpressionFor({ atendimentoAguardando: 0 }, 0)).toBe("normal");
  });
});

describe("buildBriefing", () => {
  it("greets by the passed hour (deterministic)", () => {
    expect(buildBriefing(input(), 9).greetingKey).toBe("morning");
    expect(buildBriefing(input(), 14).greetingKey).toBe("afternoon");
    expect(buildBriefing(input(), 22).greetingKey).toBe("evening");
  });

  it("defaults to the busy phrase when atendimento is waiting", () => {
    const b = buildBriefing(input({ pulse: pulse({ atendimentoAguardando: 3 }) }), 10);
    expect(b.phraseKey).toBe("phrase.busy");
    expect(b.phraseValues).toEqual({ conversas: 3 });
    expect(b.mascotExpression).toBe("busy");
  });

  it("says renewals completed today before a sale", () => {
    const b = buildBriefing(
      input({ pulse: pulse({ renovacoesHoje: 2 }), weeklyRevenue: 300 }),
      10,
    );
    expect(b.phraseKey).toBe("phrase.renewals");
    expect(b.phraseValues).toEqual({ renewals: 2 });
  });

  it("says sold this week when there is revenue and nothing more urgent", () => {
    const b = buildBriefing(input({ weeklyRevenue: 1250 }), 10);
    expect(b.phraseKey).toBe("phrase.sold");
    expect(b.phraseValues).toEqual({ vendas: 1250 });
    expect(b.mascotExpression).toBe("happy");
  });

  it("says expiring today when due but no sales", () => {
    const b = buildBriefing(input({ pulse: pulse({ vencendoHoje: 4 }) }), 10);
    expect(b.phraseKey).toBe("phrase.expiring");
    expect(b.phraseValues).toEqual({ vencendo: 4 });
  });

  it("falls back to a quiet phrase in a calm operation", () => {
    const b = buildBriefing(input(), 10);
    expect(b.phraseKey).toBe("phrase.quiet");
    expect(b.phraseValues).toEqual({});
    expect(b.mascotExpression).toBe("normal");
  });

  it("always exposes the four stats chips in order", () => {
    const b = buildBriefing(
      input({ pulse: pulse({ atendimentoAguardando: 1, renovacoesHoje: 5, vencendoHoje: 2 }), weeklyRevenue: 99 }),
      10,
    );
    expect(b.stats.map((s) => s.id)).toEqual([
      "conversasAguardando",
      "vendasSemana",
      "vencendoHoje",
      "renovacoesHoje",
    ]);
    expect(b.stats[0].value).toBe(1);
    expect(b.stats[1].value).toBe(99);
    expect(b.stats[1].format).toBe("currency");
    expect(b.stats[2].value).toBe(2);
    expect(b.stats[3].value).toBe(5);
  });
});
