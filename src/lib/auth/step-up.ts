// ============================================================
// Step-up authentication for the Fire Control (doc §2.3).
//
// Accessing the panel requires MORE than being logged in: the
// operator must re-authenticate (re-enter their password) and is
// then granted a short-lived cookie. This module holds the token
// primitives + cookie contract, shared between the middleware
// (edge gate), the step-up API route (grant) and the Fire Control
// page (defense-in-depth).
//
// Token
// -----
//   `exp.nonce.mac`
// where `mac` is HMAC-SHA256(ENCRYPTION_KEY, "exp.nonce") in hex.
// The expiry lives IN the token so the grant survives restart and
// there's no server-side store to GC. `ENCRYPTION_KEY` is the same
// 64-hex secret used by the WhatsApp encryption layer.
//
// Edge-safety: this module must stay importable from the middleware
// (edge runtime). It uses only Web Crypto (`crypto.subtle` +
// `crypto.randomUUID`) and `Buffer` (polyfilled by Next on edge),
// never `node:crypto`.
// ============================================================

/** Cookie name — deliberately internal, no "admin" phrasing. */
export const STEP_UP_COOKIE = 'fc_step_up';

/** Short-lived Fire Control session (doc §2.3: 15–30 min). */
export const STEP_UP_TTL_SECONDS = 15 * 60;

function hmacKey(): Promise<CryptoKey> {
  const raw = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function toHex(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString('hex');
}

// Constant-time hex compare — no `crypto.timingSafeEqual` (Node-only,
// unavailable in the edge runtime the middleware runs on), so a manual
// XOR loop over the decoded bytes.
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

/**
 * Mint a fresh grant. Pure — the TTL is computed from `now`
 * (defaults to the current time) so tests can pin the clock.
 */
export async function signStepUpToken(now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + STEP_UP_TTL_SECONDS;
  const nonce = crypto.randomUUID();
  const payload = `${exp}.${nonce}`;
  const key = await hmacKey();
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload)
  );
  return `${payload}.${toHex(mac)}`;
}

/**
 * True iff `token` is a grant signed by our key that has not
 * expired. Anything malformed, expired or tampered is false.
 */
export async function verifyStepUpToken(
  token: string,
  now = Date.now()
): Promise<boolean> {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [expStr, nonce, macHex] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Math.floor(now / 1000)) return false;

  const payload = `${expStr}.${nonce}`;
  const key = await hmacKey();
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload)
  );
  return safeEqualHex(macHex, toHex(mac));
}

/** Cookie attributes for the grant (doc §2.3: HttpOnly + Secure +
 *  SameSite=Strict). Scoped to the panel path so it never leaks
 *  onto the public site. */
export function stepUpCookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/fire-control-x7k29',
    maxAge: STEP_UP_TTL_SECONDS,
  };
}

/**
 * Convenience for route handlers / middleware: does the incoming
 * request carry a valid, unexpired grant?
 */
export async function hasValidStepUp(
  request: { cookies: { get(name: string): { value: string } | undefined } },
  now = Date.now()
): Promise<boolean> {
  const token = request.cookies.get(STEP_UP_COOKIE)?.value;
  if (!token) return false;
  return verifyStepUpToken(token, now);
}