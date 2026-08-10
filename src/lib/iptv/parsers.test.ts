import { describe, expect, it } from "vitest";
import { parseDate, parsePanelText } from "./parsers";

// Real messages the operator pasted from their panels (doc Cap. 36 fixtures).
const PANEL_MSG = `*Bem-vindo a fire tv*

Usuario: 95184381
Senha: 85219891
Sua assinatura vence dia: 09/08/2026 20:07

✅  *Web Player para PC navegador:*

✅ URL DNS para aplicativo universal:
⚠http://cdn.truedtv.com.br
⚠http://iptv.truedtv.com.br
⚠http://tv.rgtvhd.com
⚠http://iptv.rgtvhd.com
⚠http://cdn.rgtvhd.com
⚠ http://cdn.rgtvv.com

Link M3U HLS:
http://cdn.truedtv.com.br/get.php?username=95184381&password=85219891&type=m3u_plus&output=hls

Link M3U MPEGTS:
http://cdn.truedtv.com.br/get.php?username=95184381&password=85219891&type=m3u_plus&output=ts

LINK SSIPTV:
https://iptvpainel.rgtvhd.com/e/Sw2r

*Att.:* fire tv`;

// A promotional broadcast with a `indication=` link but NO credentials. It
// must never be mistaken for a paid credential message.
const PROMO_MSG = `==================

╭── *INDIQUE PARA UM AMIGO!*
├● 📡 ➤ https://alerquina.zeb2.top/t/MTE2NTI1?indication=p72nz7p3

=================================

╭── *Canal do Telegram*
├● https://t.me/+r_iZ5jbkqoYzMGQx

=================================

_Qualquer dúvida..._
*_Estaremos à disposição!_*`;

describe("parsePanelText", () => {
  it("extracts username, password and expiry from a real panel message", () => {
    const res = parsePanelText(PANEL_MSG);
    expect(res.status).toBe("success");
    expect(res.confidence).toBe(100);
    expect(res.fields.username).toBe("95184381");
    expect(res.fields.password).toBe("85219891");
    expect(res.fields.expiresAt).toBe("2026-08-09T20:07:00");
    expect(res.source).toBe("labels");
    expect(res.matchedLabels).toContain("usuario");
    expect(res.matchedLabels).toContain("senha");
    expect(res.matchedLabels).toContain("assinatura vence dia");
    expect(res.errors).toEqual([]);
  });

  it("returns unknown/empty for a promotional message with no credentials", () => {
    const res = parsePanelText(PROMO_MSG);
    expect(res.status).toBe("unknown");
    expect(res.confidence).toBe(0);
    expect(res.fields).toEqual({});
    expect(res.source).toBe("none");
    expect(res.matchedLabels).toEqual([]);
    expect(res.errors).toEqual([]);
  });

  it("never treats an indication= link as a credential URL", () => {
    // The promo link carries no username/password params; the get.php
    // fallback must stay silent.
    const res = parsePanelText(PROMO_MSG);
    expect(res.fields.username).toBeUndefined();
    expect(res.fields.password).toBeUndefined();
  });

  it("is accent-insensitive (Usuário / Senha)", () => {
    const res = parsePanelText("Usuário: abc123\nSenha: xyz789");
    expect(res.fields.username).toBe("abc123");
    expect(res.fields.password).toBe("xyz789");
    expect(res.status).toBe("success");
  });

  it("fills only the fields the URL provides", () => {
    const res = parsePanelText(
      "Acesso:\nhttp://cdn.x.com.br/get.php?username=u123&password=p456&type=m3u_plus",
    );
    expect(res.status).toBe("success");
    expect(res.confidence).toBe(80); // no expiry
    expect(res.fields.username).toBe("u123");
    expect(res.fields.password).toBe("p456");
    expect(res.source).toBe("url");
  });

  it("falls back to the URL for the field the labels missed (mixed)", () => {
    // Labels give only the username; the password lives in the get.php link.
    const res = parsePanelText(
      "Usuario: u123\nLink M3U:\nhttp://x/get.php?username=u123&password=p456",
    );
    expect(res.status).toBe("success");
    expect(res.fields.username).toBe("u123");
    expect(res.fields.password).toBe("p456");
    expect(res.source).toBe("mixed");
  });

  it("reports partial for a message with only some fields", () => {
    const res = parsePanelText("Senha: 1234\nVence: 30/08/2026");
    expect(res.status).toBe("partial");
    expect(res.confidence).toBe(60); // password 40 + expiry 20
    expect(res.fields.password).toBe("1234");
    expect(res.fields.expiresAt).toBe("2026-08-30T23:59:59");
    expect(res.fields.username).toBeUndefined();
  });

  it("records an error when the expiry date can't be read", () => {
    const res = parsePanelText("Usuario: u\nSenha: p\nVence: 31/02/2026");
    expect(res.fields.expiresAt).toBeUndefined();
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatch(/expiry date/i);
    // user+pass still extracted, just no 20-point bonus
    expect(res.confidence).toBe(80);
    expect(res.status).toBe("success");
  });

  it("reads the textual month-name date form", () => {
    const res = parsePanelText("Usuario: u\nSenha: p\nVence: 09 de agosto de 2026");
    expect(res.fields.expiresAt).toBe("2026-08-09T23:59:59");
  });

  it("ignores an expiry label whose value has no usable date", () => {
    const res = parsePanelText("Usuario: u\nSenha: p\nValidade: ligar depois");
    expect(res.fields.expiresAt).toBeUndefined();
    expect(res.errors).toHaveLength(1);
  });

  it("detects an xtream panel from get.php URLs", () => {
    const res = parsePanelText("http://x/get.php?username=a&password=b");
    expect(res.panelType).toBe("xtream");
    expect(parsePanelText("texto comum").panelType).toBe("generic");
  });
});

describe("parseDate", () => {
  it("parses DD/MM/YYYY with an explicit time", () => {
    expect(parseDate("09/08/2026 20:07")).toBe("2026-08-09T20:07:00");
  });

  it("defaults to end-of-day when only a date is given", () => {
    expect(parseDate("30/08/2026")).toBe("2026-08-30T23:59:59");
  });

  it("flips to MM/DD when the first component can't be a day", () => {
    expect(parseDate("03/14/2026")).toBe("2026-03-14T23:59:59");
  });

  it("keeps DD/MM default when both components are valid days", () => {
    expect(parseDate("25/12/2026")).toBe("2026-12-25T23:59:59");
  });

  it("accepts dotted and dashed separators", () => {
    expect(parseDate("09.08.2026")).toBe("2026-08-09T23:59:59");
    expect(parseDate("09-08-2026")).toBe("2026-08-09T23:59:59");
  });

  it("expands 2-digit years to 20xx", () => {
    expect(parseDate("09/08/26")).toBe("2026-08-09T23:59:59");
  });

  it("rejects impossible dates (31/02)", () => {
    expect(parseDate("31/02/2026")).toBeNull();
  });

  it("rejects non-dates", () => {
    expect(parseDate("ligar depois")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});
