/**
 * Client-facing message builder (workspace doc Cap. 15 / Cap. 36).
 *
 * The operator pastes the panel message, the parser extracts
 * usuario/senha/vencimento, and this module turns those fields into the
 * polished message they send to the customer. Pure functions, no I/O.
 *
 * Binding rule (user decision): the customer-facing message NEVER contains
 * the password. `{{senha}}` is intentionally not resolved — the token stays
 * literal in the output so it can't leak even if someone hand-types it into
 * a custom template. Passwords are stored encrypted and shown only inside
 * the workspace.
 */

export interface MessageContext {
  /** Credential username (cliente). */
  usuario?: string;
  /** Local-time ISO expiry, e.g. "2026-08-09T20:07:00". */
  expiracao?: string;
  /** Value/renewal amount, e.g. "R$ 35,00". */
  valor?: string;
  /** PIX key / QR hint. */
  pix?: string;
  /** Contact phone, e.g. "+5511999999999". */
  telefone?: string;
  /** Present so the type stays symmetric with the UI, but never substituted. */
  senha?: string;
}

/**
 * The stock renewal message. No `{{senha}}` by design — see header.
 */
export const CLIENT_TEMPLATE_DEFAULT = `Olá!

Sua renovação foi concluída com sucesso!

Usuário: {{usuario}}
Vencimento: {{expiracao}}

Muito obrigado pela preferência!
Equipe Fire Play`;

const VAR_RE = /\{\{\s*([a-z]+)\s*\}\}/gi;

/**
 * Domain-aware token resolution. `{{expiracao}}` always renders as the
 * customer-facing DD/MM/YYYY, so a caller can hand over the raw local ISO
 * and still get a polished message. Already-formatted values pass through
 * unchanged (formatExpiryDate returns "" for them, so we keep the raw).
 */
function resolveToken(key: string, value: string): string {
  if (key === 'expiracao') {
    // Already customer-facing DD/MM/YYYY — pass through untouched. (We must
    // check the shape first: "09/08/2026" would otherwise re-parse as
    // MM/DD/YYYY and come back reversed.)
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;
    const formatted = formatExpiryDate(value);
    if (formatted) return formatted;
  }
  return value;
}

/**
 * Replace `{{var}}` tokens with the values from `ctx`. Tokens that are
 * empty, unknown, or that name a field we never expose (`senha`) are left
 * literal so the operator can see what's still missing.
 */
export function buildClientMessage(
  template: string,
  ctx: MessageContext
): string {
  return template.replace(VAR_RE, (match, rawName) => {
    const key = rawName.toLowerCase();
    if (key === 'senha') return match; // never leak the password
    const raw = (ctx as Record<string, string | undefined>)[key];
    if (!raw) return match;
    return resolveToken(key, raw);
  });
}

/**
 * Render a local-time ISO expiry (`2026-08-09T20:07:00`) as the pt-BR
 * `DD/MM/YYYY` the customer expects. Reads local components only, so the
 * result never shifts with the host timezone. Empty string for junk input.
 */
export function formatExpiryDate(expiresAt: string): string {
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}
