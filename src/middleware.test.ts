import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { signStepUpToken, STEP_UP_COOKIE } from '@/lib/auth/step-up';

// --- Scenario knobs the mock reads -----------------------------------------
// `mockUser`         — what getUser() resolves to (a refreshed session ⇒ user,
//                      or null for the logged-out path).
// `refreshedCookies` — cookies Supabase writes via setAll() during getUser(),
//                      i.e. the freshly *rotated* auth token. The whole point
//                      of the test is that these must survive onto whatever
//                      response the middleware returns — including redirects.
let mockUser: { id: string } | null = null;
let refreshedCookies: Array<{
  name: string;
  value: string;
  options: Record<string, unknown>;
}> = [];

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: { setAll: (c: typeof refreshedCookies) => void };
    }
  ) => ({
    auth: {
      // Mirrors real auth-js: an expired access token is transparently
      // refreshed inside getUser(), which rotates the refresh token and
      // pushes the new cookies through setAll() before resolving.
      getUser: async () => {
        if (refreshedCookies.length) opts.cookies.setAll(refreshedCookies);
        return { data: { user: mockUser } };
      },
    },
  }),
}));

// Imported after the mock is registered.
const { middleware } = await import('./middleware');

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  mockUser = null;
  refreshedCookies = [];
});

afterEach(() => vi.clearAllMocks());

const ROTATED = {
  name: 'sb-test-auth-token',
  value: 'rotated-refresh-token',
  options: { path: '/', httpOnly: true },
};

describe('middleware — refreshed auth cookies survive redirects', () => {
  it('carries the rotated token when redirecting a signed-in user off /login', async () => {
    mockUser = { id: 'user-1' };
    refreshedCookies = [ROTATED];

    const res = await middleware(new NextRequest('https://app.test/login'));

    // Redirect to /dashboard…
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/dashboard');
    // …and the rotated cookie MUST ride along, otherwise the browser keeps
    // replaying the now-consumed refresh token and the session wedges until
    // the user manually clears cookies.
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it('carries the rotated token when redirecting an unauth user to /login', async () => {
    mockUser = null;
    // Even on the logged-out path getUser() may emit cookie writes (e.g.
    // clearing a dead session); those must not be dropped on the redirect.
    refreshedCookies = [{ ...ROTATED, value: 'cleared' }];

    const res = await middleware(new NextRequest('https://app.test/dashboard'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(res.cookies.get(ROTATED.name)?.value).toBe('cleared');
  });

  it('redirects a signed-in user with an invite token to /join/<token>', async () => {
    mockUser = { id: 'user-1' };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest('https://app.test/login?invite=abc123')
    );

    expect(res.headers.get('location')).toContain('/join/abc123');
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it('passes through (no redirect) for a signed-in user on a protected page', async () => {
    mockUser = { id: 'user-1' };
    refreshedCookies = [ROTATED];

    const res = await middleware(new NextRequest('https://app.test/dashboard'));

    // No redirect — the normal NextResponse.next() already carries cookies.
    expect(res.headers.get('location')).toBeNull();
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it('redirects an unauthenticated visitor to /login on the Fire Control path', async () => {
    mockUser = null;
    refreshedCookies = [];

    const res = await middleware(
      new NextRequest('https://app.test/fire-control-x7k29')
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('redirects a signed-in user WITHOUT a step-up grant to /verify', async () => {
    mockUser = { id: 'user-1' };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest('https://app.test/fire-control-x7k29')
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain(
      '/fire-control-x7k29/verify'
    );
    // The rotated auth cookie must survive onto the redirect.
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it('passes a signed-in user with a valid step-up grant through', async () => {
    mockUser = { id: 'user-1' };
    refreshedCookies = [ROTATED];
    const grant = await signStepUpToken();

    const req = new NextRequest('https://app.test/fire-control-x7k29');
    req.cookies.set(STEP_UP_COOKIE, grant);
    const res = await middleware(req);

    expect(res.headers.get('location')).toBeNull();
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it('passes a signed-in user through even without a grant on /verify', async () => {
    mockUser = { id: 'user-1' };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest('https://app.test/fire-control-x7k29/verify')
    );

    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects to /verify when the grant is tampered with', async () => {
    mockUser = { id: 'user-1' };
    refreshedCookies = [ROTATED];
    const grant = await signStepUpToken();

    const req = new NextRequest('https://app.test/fire-control-x7k29');
    req.cookies.set(
      STEP_UP_COOKIE,
      grant.slice(0, -1) + (grant.endsWith('0') ? '1' : '0')
    );
    const res = await middleware(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain(
      '/fire-control-x7k29/verify'
    );
  });

  it('passes a signed-in user through on the Fire Control path (operator gate is server-side)', async () => {
    mockUser = { id: 'user-1' };
    refreshedCookies = [ROTATED];
    const grant = await signStepUpToken();

    const req = new NextRequest('https://app.test/fire-control-x7k29');
    req.cookies.set(STEP_UP_COOKIE, grant);
    const res = await middleware(req);

    expect(res.headers.get('location')).toBeNull();
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });
});
