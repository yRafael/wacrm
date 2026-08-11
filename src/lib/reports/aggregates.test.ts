import { describe, expect, it } from "vitest";

import { topClientsByRevenue, UNKNOWN_CLIENT } from "./aggregates";
import type { FinancialTransaction } from "@/types";

/** Fixture mínimo — só os campos que o agregado consome. */
function txn(overrides: Partial<FinancialTransaction>): FinancialTransaction {
  return {
    id: "tx-1",
    account_id: "acc-1",
    type: "income",
    category: "sale",
    amount: 100,
    method: "pix",
    occurred_at: "2026-07-01T00:00:00Z",
    created_at: "2026-07-01T00:00:00Z",
    contact_id: null,
    contact: undefined,
    ...overrides,
  };
}

describe("topClientsByRevenue", () => {
  it("soma a receita por cliente e ordena desc", () => {
    const rows = topClientsByRevenue([
      txn({ contact_id: "c1", contact: { name: "Ana" } as never, amount: 100 }),
      txn({ contact_id: "c2", contact: { name: "Bia" } as never, amount: 250 }),
      txn({ contact_id: "c1", contact: { name: "Ana" } as never, amount: 50 }),
    ]);

    expect(rows.map((r) => r.name)).toEqual(["Bia", "Ana"]);
    expect(rows.map((r) => r.revenue)).toEqual([250, 150]);
  });

  it("ignora refunds e despesas", () => {
    const rows = topClientsByRevenue([
      txn({ contact_id: "c1", contact: { name: "Ana" } as never, amount: 100 }),
      txn({
        contact_id: "c1",
        contact: { name: "Ana" } as never,
        amount: 30,
        type: "refund",
      }),
      txn({
        contact_id: "c2",
        contact: { name: "Bia" } as never,
        amount: 200,
        type: "expense",
      }),
    ]);

    expect(rows.map((r) => r.revenue)).toEqual([100]);
  });

  it("usa name sobre phone quando ambos existem", () => {
    const rows = topClientsByRevenue([
      txn({
        contact_id: "c1",
        contact: { name: "Ana", phone: "5511999999999" } as never,
        amount: 100,
      }),
    ]);
    expect(rows[0].name).toBe("Ana");
  });

  it("cai para o phone quando não há name", () => {
    const rows = topClientsByRevenue([
      txn({ contact_id: "c1", contact: { phone: "5511999999999" } as never, amount: 100 }),
    ]);
    expect(rows[0].name).toBe("5511999999999");
  });

  it("usa UNKNOWN_CLIENT quando não há nome nem telefone", () => {
    const rows = topClientsByRevenue([
      txn({ contact_id: "c1", contact: undefined, amount: 100 }),
    ]);
    expect(rows[0].name).toBe(UNKNOWN_CLIENT);
  });

  it("aplica o limite (limit)", () => {
    const rows = topClientsByRevenue(
      [
        txn({ contact_id: "c1", contact: { name: "A" } as never, amount: 100 }),
        txn({ contact_id: "c2", contact: { name: "B" } as never, amount: 200 }),
        txn({ contact_id: "c3", contact: { name: "C" } as never, amount: 300 }),
      ],
      2,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("C");
  });

  it("pct é a fatia do total de receita (uma casa decimal)", () => {
    const rows = topClientsByRevenue([
      txn({ contact_id: "c1", contact: { name: "A" } as never, amount: 150 }),
      txn({ contact_id: "c2", contact: { name: "B" } as never, amount: 50 }),
    ]);
    // total = 200 → A = 75%, B = 25%
    expect(rows[0].pct).toBe(75);
    expect(rows[1].pct).toBe(25);
  });

  it("pct é 0 quando não há receita", () => {
    const rows = topClientsByRevenue([
      txn({ contact_id: "c1", contact: { name: "A" } as never, amount: 0 }),
    ]);
    expect(rows[0].pct).toBe(0);
  });

  it("lista vazia produz lista vazia", () => {
    expect(topClientsByRevenue([])).toEqual([]);
  });
});
