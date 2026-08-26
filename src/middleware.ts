import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { hasValidStepUp } from '@/lib/auth/step-up';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // getUser() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges — the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie);
    });
    return response;
  };

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (
    user &&
    (request.nextUrl.pathname === '/login' ||
      request.nextUrl.pathname === '/signup' ||
      request.nextUrl.pathname === '/forgot-password' ||
      request.nextUrl.pathname === '/reset-password')
  ) {
    const url = request.nextUrl.clone();
    const inviteToken = request.nextUrl.searchParams.get('invite');
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`;
      url.search = '';
    } else {
      url.pathname = '/dashboard';
      url.search = '';
    }
    return withRefreshedCookies(NextResponse.redirect(url));
  }

  // Protected pages - redirect to login if not authenticated.
  // Every dashboard page must be listed here so unauthenticated users
  // get a clean redirect at the edge instead of a server error from
  // the (dashboard)/layout.tsx getCurrentAccount() throw.
  const protectedPaths = [
    '/dashboard',
    '/inbox',
    '/contacts',
    '/pipelines',
    '/broadcasts',
    '/automations',
    '/settings',
    '/subscriptions',
    '/reports',
    '/queue',
    '/pulse',
    '/finance',
    '/renewals',
    '/flows',
    '/agents',
    '/clients',
    '/notifications',
    '/iptv',
    // Fire Control — non-obvious URL, but still behind the auth
    // layer. The platform-operator authorization gate lives in
    // requirePlatformOperator() on the page/API (backend), not here.
    '/fire-control-x7k29',
  ];
  if (
    !user &&
    protectedPaths.some((path) => request.nextUrl.pathname.startsWith(path))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return withRefreshedCookies(NextResponse.redirect(url));
  }

  // Step-up auth (doc §2.3) — the Fire Control needs MORE than a
  // logged-in session: the operator must have re-authenticated and
  // received a short-lived `fc_step_up` grant. The grant check lives
  // here at the edge (fast, no DB round trip); the authorization
  // (is_platform_operator) stays in the backend on the page/API.
  // `/verify` is where the grant is issued, so it must NOT be gated.
  const isFireControl = request.nextUrl.pathname.startsWith(
    '/fire-control-x7k29'
  );
  const isFireControlVerify =
    request.nextUrl.pathname === '/fire-control-x7k29/verify';
  if (user && isFireControl && !isFireControlVerify) {
    if (!(await hasValidStepUp(request))) {
      const url = request.nextUrl.clone();
      url.pathname = '/fire-control-x7k29/verify';
      url.search = '';
      return withRefreshedCookies(NextResponse.redirect(url));
    }
  }

  // Subscription gating (doc §4) — block workspace access when the
  // subscription is in a blocking state (SUSPENDED, CANCELED, EXPIRED)
  // or missing entirely. Allowed statuses: TRIAL, ACTIVE, PAST_DUE.
  // PLATFORM internal accounts (is_internal_account) bypass this check.
  // Exempted paths: /pricing, /billing, /support, /login, /signup,
  // /forgot-password, /fire-control-x7k29/*, /api/*, /join/*.
  const isExemptPath =
    request.nextUrl.pathname.startsWith('/pricing') ||
    request.nextUrl.pathname.startsWith('/billing') ||
    request.nextUrl.pathname.startsWith('/support') ||
    request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/signup') ||
    request.nextUrl.pathname.startsWith('/forgot-password') ||
    request.nextUrl.pathname.startsWith('/reset-password') ||
    request.nextUrl.pathname.startsWith('/fire-control-x7k29') ||
    request.nextUrl.pathname.startsWith('/api/') ||
    request.nextUrl.pathname.startsWith('/join/');
  const isProtectedPage =
    user && !isExemptPath &&
    protectedPaths.some((path) => request.nextUrl.pathname.startsWith(path));

  if (isProtectedPage) {
    // Look up the user's account_id and subscription status.
    // Two lightweight queries: profiles (indexed by user_id) and
    // platform_subscriptions (indexed by account_id + created_at).
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profile?.account_id) {
      // Check if this is an internal (PLATFORM) account — bypass
      const { data: account } = await supabase
        .from('accounts')
        .select('is_internal_account')
        .eq('id', profile.account_id)
        .maybeSingle();

      if (!account?.is_internal_account) {
        // Check subscription status
        const { data: sub } = await supabase
          .from('platform_subscriptions')
          .select('status, expires_at')
          .eq('account_id', profile.account_id)
          .order('created_at', { ascending: false })
          .maybeSingle();

        const blockedStatuses = ['SUSPENDED', 'CANCELED', 'EXPIRED'];
        const hasBlockedStatus = sub && blockedStatuses.includes(sub.status);
        const hasExpiredTrial =
          sub &&
          sub.status === 'TRIAL' &&
          sub.expires_at &&
          new Date(sub.expires_at).getTime() <= Date.now();
        const noSubscription = !sub;

        if (hasBlockedStatus || hasExpiredTrial || noSubscription) {
          const url = request.nextUrl.clone();
          url.pathname = '/pricing';
          url.search = '';
          return withRefreshedCookies(NextResponse.redirect(url));
        }
      }
    }
  }

  // API routes that need auth (not webhooks or public API).
  // Defense-in-depth: most API route handlers also call requireRole()
  // or requireApiKey(), but blocking unauthenticated requests at the
  // edge avoids unnecessary DB round-trips and keeps the logs clean.
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/');
  // Exact match for the known webhook endpoint — avoids accidentally
  // exempting future routes that contain the substring "webhook".
  const isWebhook =
    request.nextUrl.pathname === '/api/whatsapp/webhook';
  const isPublicApi = request.nextUrl.pathname.startsWith('/api/v1/');
  // Auth routes (login, signup, etc.) must be accessible without a session.
  const isAuthApi = request.nextUrl.pathname.startsWith('/api/auth/');
  if (!user && isApiRoute && !isWebhook && !isPublicApi && !isAuthApi) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    );
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
