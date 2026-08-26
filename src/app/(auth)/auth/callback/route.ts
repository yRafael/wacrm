import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Server-side auth callback.
 *
 * Supabase PKCE flow sends the user here with a `code` query param.
 * This route exchanges the code for a session (setting cookies) and
 * redirects to the `next` param (defaults to `/dashboard`).
 *
 * Used by:
 *  - forgot-password → redirect to /reset-password
 *  - email confirmation → redirect to /dashboard
 *  - future OAuth providers
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabaseResponse = NextResponse.next({ request });

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
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const url = new URL(next, origin);
      return NextResponse.redirect(url);
    }
  }

  // Fallback: redirect to login with error
  const url = new URL('/login', origin);
  url.searchParams.set('error', 'auth_callback_failed');
  return NextResponse.redirect(url);
}
