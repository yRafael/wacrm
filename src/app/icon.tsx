import { ImageResponse } from 'next/og';
import { createClient } from '@/lib/supabase/server';
import { getBranding } from '@/lib/branding/queries';

// Replaces the default Next.js favicon with the company's mark when it
// has customized its identity (Personalização → brand color + name), or
// the Fire brand mark otherwise.
//
// Because the tab favicon is per-company, this route reads the session
// (cookies) → resolves the caller's account → the account_branding row.
// No branding? Fire red-orange square + flame, exactly as before — the
// white-label feature is opt-in per account and invisible to companies
// that never touched it. A signed-out visitor (auth screens) gets the
// Fire mark too, since there is no account context yet.
//
// This route takes precedence over src/app/favicon.ico.

export const runtime = 'edge';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';
export const dynamic = 'force-dynamic';

function FireMark() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#ea580c', // fire primary (orange-red, matches data-theme="fire")
        borderRadius: 6,
      }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
      </svg>
    </div>
  );
}

export default async function Icon() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('account_id')
        .eq('user_id', user.id)
        .maybeSingle();
      const accountId = profile?.account_id as string | undefined;

      if (accountId) {
        const [branding, accountRow] = await Promise.all([
          getBranding(supabase, accountId),
          supabase
            .from('accounts')
            .select('name')
            .eq('id', accountId)
            .maybeSingle(),
        ]);

        const primary = branding?.config.colors.primary;
        const companyName = (accountRow?.data as { name?: string } | null)
          ?.name;

        if (primary && companyName) {
          const initial = companyName.trim().charAt(0).toUpperCase() || 'F';
          return new ImageResponse(
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: primary,
                borderRadius: 6,
                color: '#ffffff',
                fontFamily: 'sans-serif',
                fontWeight: 800,
                fontSize: 18,
              }}
            >
              {initial}
            </div>,
            { ...size }
          );
        }
      }
    }
  } catch (error) {
    // Never let a branding hiccup take the favicon down — fall back to
    // the Fire mark (session resolution etc. failing on the edge).
    console.warn(
      '[icon] branding favicon failed, falling back to Fire:',
      error
    );
  }

  return new ImageResponse(<FireMark />, { ...size });
}
