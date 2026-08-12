import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getBranding } from '@/lib/branding/queries';

// ============================================================
// /api/branding/asset — the ONLY way the browser reads brand assets.
//
// The `branding` bucket is PRIVATE: nothing is ever served as a public
// URL. This session-authenticated proxy resolves the caller's account
// from the session (never from the URL) and streams a storage object
// back. Cross-company reads are impossible — the account comes from
// the JWT, so Maria's browser asking for João's object either hits a
// foreign prefix (403) or a missing row (404).
//
//   ?kind=logo|banner|chat  → canonical asset from the account_branding
//                             row (logo_path / banner_path /
//                             config.chat.background.path).
//   ?path=<object>          → any object in the caller's folder,
//                             re-verified to be `account-<accountId>/…`.
//
// Query params are the UI convention (stable, cached URL); the session
// is the source of truth for ownership.
// ============================================================

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { accountId: null as string | null, status: 401 as const };
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const accountId = profile?.account_id as string | undefined;
  if (!accountId) {
    return { accountId: null as string | null, status: 403 as const };
  }
  return { accountId, status: 200 as const };
}

function contentTypeForPath(path: string, fallback: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? fallback;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind');
    const pathParam = url.searchParams.get('path');

    const supabase = await createClient();
    const { accountId, status } = await resolveAccountId(supabase);
    if (status !== 200 || !accountId) {
      return NextResponse.json(
        {
          error:
            status === 401
              ? 'Unauthorized'
              : 'Your profile is not linked to an account.',
        },
        { status }
      );
    }

    // Resolve the object path from the request.
    let objectPath: string | null = null;

    if (kind === 'logo' || kind === 'banner' || kind === 'chat') {
      const branding = await getBranding(supabase, accountId);
      if (kind === 'logo') objectPath = branding?.logo_path ?? null;
      else if (kind === 'banner') objectPath = branding?.banner_path ?? null;
      else {
        // Chat background only has a stored object when kind === 'image'.
        const bg = branding?.config.chat.background;
        objectPath = bg?.kind === 'image' ? (bg.path ?? null) : null;
      }
    } else if (pathParam) {
      // Verify the requested object belongs to the caller's account —
      // the account comes from the session, so a foreign prefix is a 403.
      if (!pathParam.startsWith(`account-${accountId}/`)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      objectPath = pathParam;
    }

    if (!objectPath) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data, error } = await supabase.storage
      .from('branding')
      .download(objectPath);
    if (error || !data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const bytes = await data.arrayBuffer();
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': contentTypeForPath(
          objectPath,
          data.type || 'application/octet-stream'
        ),
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Error in branding asset GET:', error);
    return NextResponse.json(
      { error: 'Failed to fetch asset' },
      { status: 500 }
    );
  }
}
