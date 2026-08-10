import { describe, expect, it } from "vitest";
import {
  CLIENT_TEMPLATE_DEFAULT,
  buildClientMessage,
  formatExpiryDate,
} from "./message-builder";

const FIELDS = {
  usuario: "95184381",
  senha: "85219891", // present on purpose — must never reach the client
  expiracao: "2026-08-09T20:07:00",
};

describe("buildClientMessage", () => {
  it("fills usuario and expiracao from the stock template", () => {
    const out = buildClientMessage(CLIENT_TEMPLATE_DEFAULT, FIELDS);
    expect(out).toContain("Usuário: 95184381");
    expect(out).toContain("Vencimento: 09/08/2026");
  });

  it("never includes the password, even when it is in context", () => {
    const out = buildClientMessage(CLIENT_TEMPLATE_DEFAULT, FIELDS);
    expect(out).not.toContain("85219891");
  });

  it("keeps {{senha}} literal when a custom template references it", () => {
    const out = buildClientMessage(
      "Usuário: {{usuario}}\nSenha: {{senha}}\nVence: {{expiracao}}",
      FIELDS,
    );
    expect(out).toContain("Senha: {{senha}}");
    expect(out).not.toContain("85219891");
    expect(out).toContain("Usuário: 95184381");
  });

  it("leaves empty or unknown tokens visible so gaps are obvious", () => {
    const out = buildClientMessage(
      "Usuario {{usuario}} valor {{valor}} unknown {{naoExiste}}",
      { usuario: "abc" },
    );
    expect(out).toContain("Usuario abc");
    expect(out).toContain("{{valor}}");
    expect(out).toContain("{{naoExiste}}");
  });

  it("is tolerant of spacing inside the braces", () => {
    const out = buildClientMessage("U: {{ usuario }} E: {{ expiracao }}", {
      usuario: "a",
      expiracao: "2026-08-09T20:07:00",
    });
    expect(out).toContain("U: a");
    expect(out).toContain("E: 09/08/2026");
  });

  it("renders other optional vars when supplied", () => {
    const out = buildClientMessage(
      "Olá {{telefone}} valor {{valor}} pix {{pix}}",
      { telefone: "+55 11 99999-9999", valor: "R$ 35,00", pix: "123" },
    );
    expect(out).toContain("+55 11 99999-9999");
    expect(out).toContain("R$ 35,00");
    expect(out).toContain("pix 123");
  });

  it("stock template only references usuario and expiracao", () => {
    expect(CLIENT_TEMPLATE_DEFAULT).not.toContain("{{senha}}");
    expect(CLIENT_TEMPLATE_DEFAULT).toContain("{{usuario}}");
    expect(CLIENT_TEMPLATE_DEFAULT).toContain("{{expiracao}}");
  });
});

describe("formatExpiryDate", () => {
  it("renders DD/MM/YYYY from a local-time ISO string", () => {
    expect(formatExpiryDate("2026-08-09T20:07:00")).toBe("09/08/2026");
  });

  it("reads local components only (TZ-safe, no shift)", () => {
    // 09 Jan locally — must not render as 08 Jan anywhere.
    expect(formatExpiryDate("2026-01-09T00:00:00")).toBe("09/01/2026");
  });

  it("handles end-of-day defaults from date-only inputs", () => {
    expect(formatExpiryDate("2026-12-31T23:59:59")).toBe("31/12/2026");
  });

  it("returns empty string for junk", () => {
    expect(formatExpiryDate("")).toBe("");
    expect(formatExpiryDate("não é data")).toBe("");
  });
});
