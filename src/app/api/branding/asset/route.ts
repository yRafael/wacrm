import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { getBranding } from '@/lib/branding/queries';
import { BRAND_MIME_BY_TYPE, detectImageType } from '@/lib/branding/assets';

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

export async function GET(request: Request) {
  // The account comes from the SESSION — `getCurrentAccount` resolves
  // user → profile → account server-side and throws 401/403 for missing
  // session/profile. Never from the URL: a caller can only ever reach
  // assets under their own account folder.
  let ctx;
  try {
    ctx = await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }
  const { supabase, accountId } = ctx;

  try {
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind');
    const pathParam = url.searchParams.get('path');

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

    // Content type comes from the real bytes. An object that isn't a
    // valid PNG/JPEG/WebP is refused — combined with `nosniff` below,
    // a stale or hand-placed file in the bucket can never be served as
    // a different content type.
    const bytes = new Uint8Array(await data.arrayBuffer());
    const detected = detectImageType(bytes);
    if (!detected) {
      return NextResponse.json(
        { error: 'Asset is not a valid image' },
        { status: 415 }
      );
    }

    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': BRAND_MIME_BY_TYPE[detected],
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
