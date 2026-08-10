/**
 * IPTV panel-message parser.
 *
 * The operator receives a message from their IPTV panel when a customer
 * pays (usuário/senha/vencimento) and pastes it here. This module turns
 * that free-form text into structured fields WITHOUT any network call —
 * pure functions, so they're trivially testable and safe to run in the
 * browser on every keystroke.
 *
 * Philosophy (workspace doc Cap. 36 + user decision):
 *   - The tool extracts, the operator confirms. It NEVER sends anything.
 *   - Only fields that actually appear in the text are reported. A
 *     promotional message (the `indication=` example) yields nothing.
 *   - Confidence is a simple additive score (username 40 / password 40 /
 *     expiry 20) so the UI can tell "solid" from "guessy" at a glance.
 *
 * Passwords are returned here in plaintext because this is the extraction
 * step; encryption happens at the save boundary (`/api/iptv/parser/save`).
 */

export type IptvFieldStatus = "success" | "partial" | "unknown";

export interface ParsedIptvFields {
  username?: string;
  password?: string;
  /**
   * Local-time ISO string with no zone suffix, e.g. "2026-08-09T20:07:00".
   * When the panel gave only a date the time defaults to 23:59:59 so the
   * credential stays valid through the stated expiry day. Construct a
   * `Date` from it to get UTC for the DB (`new Date(s).toISOString()`).
   */
  expiresAt?: string;
}

export interface ParseResult {
  status: IptvFieldStatus;
  /** 0–100 additive score (see header comment). */
  confidence: number;
  fields: ParsedIptvFields;
  /** Human-readable labels that actually matched (for operator debug). */
  matchedLabels: string[];
  /** Where the credentials came from. */
  source: "labels" | "url" | "mixed" | "none";
  /** Non-fatal problems worth surfacing, e.g. an unparsable expiry date. */
  errors: string[];
  /** Best-effort panel family hint, purely informational. */
  panelType: "xtream" | "sigma" | "xui" | "horus" | "generic";
}

// ---------------------------------------------------------------------------
// Label dictionary. Labels are stored ACCENT-FREE and matched with an
// accent-insensitive pattern, so "Usuário" and "Senha" are found without
// enumerating every diacritic variant. Order matters: `matchField` walks
// the list and uses the FIRST hit per line, so more specific labels
// (e.g. "assinatura vence dia") must precede their shorter parents
// ("vence dia", "vence") — enforced by sorting on length at load.
// ---------------------------------------------------------------------------

type IptvField = keyof ParsedIptvFields;

interface LabelDef {
  field: IptvField;
  raw: string;
}

const LABEL_DEFS: LabelDef[] = [
  // username
  { field: "username", raw: "usuario" },
  { field: "username", raw: "username" },
  { field: "username", raw: "user" },
  { field: "username", raw: "login" },
  { field: "username", raw: "utilizador" },
  // password
  { field: "password", raw: "password" },
  { field: "password", raw: "senha" },
  { field: "password", raw: "pass" },
  { field: "password", raw: "clave" },
  { field: "password", raw: "contrasena" },
  // expiry — most specific first; the sort below re-orders anyway
  { field: "expiresAt", raw: "assinatura vence dia" },
  { field: "expiresAt", raw: "valid until" },
  { field: "expiresAt", raw: "expira dia" },
  { field: "expiresAt", raw: "expira em" },
  { field: "expiresAt", raw: "expiration" },
  { field: "expiresAt", raw: "expiracao" },
  { field: "expiresAt", raw: "vence dia" },
  { field: "expiresAt", raw: "vence em" },
  { field: "expiresAt", raw: "valido ate" },
  { field: "expiresAt", raw: "valida ate" },
  { field: "expiresAt", raw: "expires" },
  { field: "expiresAt", raw: "expiry" },
  { field: "expiresAt", raw: "validade" },
  { field: "expiresAt", raw: "expira" },
  { field: "expiresAt", raw: "vence" },
  { field: "expiresAt", raw: "ate" },
];
// Sort length-descending so the most specific labels ("assinatura vence
// dia") match before their shorter parents ("vence", "ate"). Sorted in
// place — done on a separate statement so the annotation on the literal
// above keeps `field` narrowed (typing through `.sort()` would widen it).
LABEL_DEFS.sort((a, b) => b.raw.length - a.raw.length);

// Accent family for each base letter. Building a character class lets one
// dictionary entry match every diacritic variant without a full regex per
// locale.
const ACCENT_CLASS: Record<string, string> = {
  a: "aáàâãäAÁÀÂÃÄ",
  c: "cçCÇ",
  e: "eéèêëEÉÈÊË",
  i: "iíìîïIÍÌÎÏ",
  n: "nñNÑ",
  o: "oóòôõöOÓÒÔÕÖ",
  u: "uúùûüUÚÙÛÜ",
};

/** Accent-insensitive regex source for a (accent-free) label. */
function labelPattern(raw: string): string {
  return `(?:^|\\s)${raw
    .split("")
    .map((ch) => {
      const family = ACCENT_CLASS[ch];
      return family ? `[${family}]` : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("")}\\s*[:=]?\\s*(.+?)\\s*$`;
}

const COMPILED_LABELS = LABEL_DEFS.map((def) => ({
  def,
  re: new RegExp(labelPattern(def.raw), "i"),
}));

/** Which field does this line's label map to, and what is its value? */
function matchLabel(line: string): { field: IptvField; raw: string; value: string } | null {
  for (const { def, re } of COMPILED_LABELS) {
    const m = re.exec(line);
    if (m) {
      const value = cleanValue(m[1]);
      if (value) return { field: def.field, raw: def.raw, value };
    }
  }
  return null;
}

/** Strip markdown bold / quotes / trailing punctuation from a value. */
function cleanValue(raw: string): string {
  let v = raw.trim();
  v = v.replace(/^[*_]+/, "").replace(/[*_]+$/, "");
  v = v.replace(/^[`"'“”]+/, "").replace(/[`"'“”]+$/, "");
  v = v.replace(/[,;:]+$/, "");
  return v.trim();
}

// ---------------------------------------------------------------------------
// Date normalisation. Panels write pt-BR `DD/MM/YYYY [HH:MM]`; we also
// accept `MM/DD/YYYY` when the first component can't be a day, and the
// textual `9 de agosto de 2026` form. Output is local-time ISO without a
// zone, so the browser and the save route agree on what "expires" means.
// ---------------------------------------------------------------------------

const PT_MONTHS: Record<string, number> = {
  janeiro: 0, jan: 0,
  fevereiro: 1, fev: 1,
  marco: 2, mar: 2, março: 2,
  abril: 3, abr: 3,
  maio: 4, mai: 4,
  junho: 5, jun: 5,
  julho: 6, jul: 6,
  agosto: 7, ago: 7,
  setembro: 8, set: 8,
  outubro: 9, out: 9,
  novembro: 10, nov: 10,
  dezembro: 11, dez: 11,
};

const NUMERIC_DATE_RE =
  /(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
const TEXT_DATE_RE = /(\d{1,2})\s+de\s+([a-zç]+)\.?\s+(?:de\s+)?(\d{4})/i;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Parse an expiry value into `YYYY-MM-DDTHH:MM:SS` (local, no zone), or
 * null when no usable date is present. Day/month disambiguation defaults
 * to DD/MM (Brazilian panels) and only flips to MM/DD when the first
 * component is unambiguously not a day (>12).
 */
export function parseDate(value: string): string | null {
  let m = NUMERIC_DATE_RE.exec(value);
  if (m) {
    let d1 = Number(m[1]);
    let d2 = Number(m[2]);
    let year = Number(m[3]);
    const hour = m[4] ? Number(m[4]) : 23;
    const minute = m[5] ? Number(m[5]) : 59;
    // A time like "20:07" means 20:07:00 — only pad seconds to 59 when the
    // panel gave a bare date (end of the expiry day).
    const second = m[6] ? Number(m[6]) : m[4] ? 0 : 59;

    if (d1 > 12 && d2 <= 12) {
      // d1 can't be a month → DD/MM
    } else if (d2 > 12 && d1 <= 12) {
      // d2 can't be a month → MM/DD
      const tmp = d1;
      d1 = d2;
      d2 = tmp;
    }
    // else: both ≤ 12 → default DD/MM (Brazilian panels).

    if (year < 100) year += 2000;
    if (hour > 23 || minute > 59 || second > 59) return null;

    const dt = new Date(year, d2 - 1, d1, hour, minute, second);
    if (
      dt.getFullYear() !== year ||
      dt.getMonth() !== d2 - 1 ||
      dt.getDate() !== d1
    ) {
      return null; // impossible date (e.g. 31/02)
    }
    return `${year}-${pad2(d2)}-${pad2(d1)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
  }

  m = TEXT_DATE_RE.exec(value);
  if (m) {
    const day = Number(m[1]);
    const month = PT_MONTHS[m[2].toLowerCase().replace(/̀/g, "")];
    const year = Number(m[3]);
    if (month === undefined || day < 1 || day > 31) return null;
    const dt = new Date(year, month, day, 23, 59, 59);
    if (dt.getFullYear() !== year || dt.getMonth() !== month || dt.getDate() !== day) {
      return null;
    }
    return `${year}-${pad2(month + 1)}-${pad2(day)}T23:59:59`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// get.php URL fallback. Only URLs that carry BOTH `username=` and
// `password=` count as credentials — a promotional `indication=` link must
// never be mistaken for one. This covers the "M3U HLS" block many panels
// append even when the label lines are missing.
// ---------------------------------------------------------------------------

const GET_PHP_URL_RE = /[^\s"']*get\.php\?[^\s"']*/gi;

function extractFromUrls(text: string): { username?: string; password?: string } {
  const out: { username?: string; password?: string } = {};
  // `matchAll` clones the regex but inherits its `lastIndex` (spec:
  // RegExp.prototype[@@matchAll] copies it into the clone), so a stale cursor
  // left by a previous `.test()` would start the scan mid-string and silently
  // skip matches. Reset the cursor to keep this function stateless.
  GET_PHP_URL_RE.lastIndex = 0;
  for (const m of text.matchAll(GET_PHP_URL_RE)) {
    const qs = m[0].split("?")[1];
    if (!qs) continue;
    const params = new URLSearchParams(qs);
    const u = params.get("username");
    const p = params.get("password");
    if (u && p) {
      if (!out.username) out.username = u;
      if (!out.password) out.password = p;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------------

/**
 * Parse a panel message into structured fields. Pure and side-effect free:
 * runs in the browser for instant feedback and again on the server at save
 * time so the `parser_logs` record reflects the same logic the UI showed.
 */
export function parsePanelText(text: string): ParseResult {
  const fields: ParsedIptvFields = {};
  const matchedLabels: string[] = [];
  const labelFields = new Set<IptfField>();
  const errors: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const hit = matchLabel(line);
    if (!hit) continue;

    if (hit.field === "expiresAt") {
      const parsed = parseDate(hit.value);
      if (!parsed) {
        errors.push(`Couldn't read the expiry date near "${hit.value}"`);
      } else if (!fields.expiresAt) {
        fields.expiresAt = parsed;
      }
    } else {
      if (!(hit.field in fields)) {
        fields[hit.field] = hit.value;
      }
      labelFields.add(hit.field);
    }
    matchedLabels.push(hit.raw);
  }

  // URL fallback fills only fields the labels didn't produce.
  const urlCreds = extractFromUrls(text);
  const urlUser = Boolean(urlCreds.username);
  const urlPass = Boolean(urlCreds.password);
  if (urlUser && !fields.username) fields.username = urlCreds.username;
  if (urlPass && !fields.password) fields.password = urlCreds.password;

  // Additive confidence.
  let confidence = 0;
  if (fields.username) confidence += 40;
  if (fields.password) confidence += 40;
  if (fields.expiresAt) confidence += 20;

  const hasUser = Boolean(fields.username);
  const hasPass = Boolean(fields.password);
  const status: IptvFieldStatus =
    hasUser && hasPass
      ? "success"
      : hasUser || hasPass || fields.expiresAt
        ? "partial"
        : "unknown";

  // `source` reflects where the username/password actually came from.
  // Resolve each field's origin independently so a message whose labels
  // only gave one credential and the URL gave the other is truly "mixed",
  // while a partial label-only message still reads as "labels".
  const labelUser = labelFields.has("username");
  const labelPass = labelFields.has("password");
  const userSrc = labelUser ? "label" : urlUser ? "url" : null;
  const passSrc = labelPass ? "label" : urlPass ? "url" : null;
  let source: ParseResult["source"];
  if (!userSrc && !passSrc) source = "none";
  else if (userSrc && !passSrc) source = userSrc === "label" ? "labels" : "url";
  else if (passSrc && !userSrc) source = passSrc === "label" ? "labels" : "url";
  else source = userSrc === passSrc ? (userSrc === "label" ? "labels" : "url") : "mixed";

  // Panel family hint — informational only, never used for matching. A fresh
  // non-global literal keeps `.test()` stateless (a `g` regex would advance
  // `lastIndex` and skew the next caller's `matchAll` scan).
  const panelType = /[^\s"']*get\.php\?[^\s"']*/i.test(text)
    ? "xtream"
    : "generic";

  return {
    status,
    confidence,
    fields,
    matchedLabels,
    source,
    errors,
    panelType,
  };
}

// `labelFields` is a Set of IptvField; alias for readability above.
type IptfField = IptvField;
