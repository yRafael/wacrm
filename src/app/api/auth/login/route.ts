import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

/**
 * POST /api/auth/login
 *
 * Server-side login endpoint with per-IP rate limiting.
 * The client-side login page calls this instead of directly calling
 * supabase.auth.signInWithPassword() to enforce brute-force protection.
 *
 * Rate limit: 5 attempts per minute per IP (same as stepUp).
 * After 5 failed attempts, the client receives 429 with Retry-After.
 */
export async function POST(request: Request) {
  try {
    // Per-IP rate limit for login attempts
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      'unknown';

    const limit = checkRateLimit(`login:${ip}`, RATE_LIMITS.stepUp);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const body = await request.json();
    const { email, password } = body ?? {};

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // Don't leak whether the email exists — return generic message
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Return success — the Supabase client will have set cookies via the
    // server-side client. The caller should do a full page navigation to
    // /dashboard to pick up the session cookies.
    return NextResponse.json({
      success: true,
      user: { id: data.user.id, email: data.user.email },
    });
  } catch (error) {
    console.error('[/api/auth/login] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
