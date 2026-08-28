// ============================================================
// POST /api/platform/step-up
//
// The second factor of the Fire Control funnel (doc §2.3): even a
// logged-in platform operator must re-enter their password before
// the panel opens. On success we mint a short-lived `fc_step_up`
// grant cookie (HttpOnly + Secure + SameSite=Strict, 15 min) that
// the middleware checks on every /fire-control-x7k29 request.
//
// The password is verified with a THROWAWAY auth client whose
// cookie handlers are no-ops — we want proof-of-credential, NOT a
// session change. The operator's real session is left untouched.
//
// Refusal contract:
//   - Unauthorized / Forbidden (not authed / not operator / not
//     ACTIVE) → mapped by `toErrorResponse`.
//   - 400 → malformed body or missing password.
//   - 401 → password does not match.
//   - 429 → too many attempts (per IP).
// ============================================================

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { requirePlatformOperator, toErrorResponse } from '@/lib/auth/account';
import {
  signStepUpToken,
  STEP_UP_COOKIE,
  stepUpCookieOptions,
} from '@/lib/auth/step-up';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xri = request.headers.get('x-real-ip');
  if (xri) return xri.trim();
  return 'unknown';
}

export async function POST(request: NextRequest) {
  // Tight per-IP budget BEFORE any DB round trip — the primary abuse
  // surface is brute-forcing the operator's password.
  const ip = getClientIp(request);
  const limit = checkRateLimit(`stepup:${ip}`, RATE_LIMITS.stepUp);
  if (!limit.success) return rateLimitResponse(limit);

  let body: { password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const password = body?.password;
  if (typeof password !== 'string' || password.length === 0) {
    return NextResponse.json({ error: 'Missing password' }, { status: 400 });
  }

  try {
    // Auth + status blocking + operator flag — the backend gate. The
    // frontend/URL are never trusted for who may hold a grant.
    const ctx = await requirePlatformOperator();

    const { data: authUser, error: userErr } =
      await ctx.supabase.auth.admin.getUserById(ctx.userId);
    if (userErr || !authUser.user?.email) {
      console.error('[step-up] operator lookup error:', userErr);
      return NextResponse.json(
        { error: 'Could not verify identity' },
        { status: 500 }
      );
    }

    // Proof-of-credential without touching the real session.
    const verifyClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => [], setAll: () => {} } }
    );
    const { error: signInErr } = await verifyClient.auth.signInWithPassword({
      email: authUser.user.email,
      password,
    });
    if (signInErr) {
      return NextResponse.json(
        { error: 'Password does not match' },
        { status: 401 }
      );
    }

    const token = await signStepUpToken();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(STEP_UP_COOKIE, token, stepUpCookieOptions());
    return res;
  } catch (err) {
    return toErrorResponse(err);
  }
}