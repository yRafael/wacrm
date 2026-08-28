import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Trial expiration cron.
 *
 * Finds all platform_subscriptions where:
 *   status = 'TRIAL' AND expires_at <= now()
 * and updates them to 'EXPIRED'.
 *
 * The middleware already blocks expired trials at the edge, so this
 * cron is purely for audit trail consistency — the row status should
 * reflect reality, not rely on a runtime check.
 *
 * GET — triggered by Vercel Cron (daily at 00:05 UTC).
 * Also callable manually via POST with the cron secret.
 *
 * Requires SUBSCRIPTION_EXPIRE_CRON_SECRET env var.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  return handleExpire(request);
}

export async function POST(request: Request) {
  return handleExpire(request);
}

async function handleExpire(request: Request) {
  const expected = process.env.SUBSCRIPTION_EXPIRE_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied =
    request.headers.get('x-cron-secret') ??
    new URL(request.url).searchParams.get('secret') ??
    '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = supabaseAdmin();

  // Find expired trials
  const { data: expired, error: findErr } = await admin
    .from('platform_subscriptions')
    .select('id, account_id, expires_at')
    .eq('status', 'TRIAL')
    .not('expires_at', 'is', null)
    .lte('expires_at', new Date().toISOString());

  if (findErr) {
    console.error('[expire-trial] query error:', findErr);
    return NextResponse.json({ error: 'Query failed' }, { status: 500 });
  }

  if (!expired || expired.length === 0) {
    return NextResponse.json({ ok: true, expired: 0 });
  }

  // Update all expired trials
  const ids = expired.map((s) => s.id);
  const { error: updateErr } = await admin
    .from('platform_subscriptions')
    .update({
      status: 'EXPIRED',
      updated_at: new Date().toISOString(),
    })
    .in('id', ids);

  if (updateErr) {
    console.error('[expire-trial] update error:', updateErr);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  // Log each expiration for audit
  for (const sub of expired) {
    await admin.from('audit_logs').insert({
      actor_user_id: null,
      actor_account_id: null,
      target_account_id: sub.account_id,
      action: 'subscription.trial_expired',
      metadata: {
        subscription_id: sub.id,
        expired_at: sub.expires_at,
        processed_at: new Date().toISOString(),
      },
      ip: null,
    });
  }

  return NextResponse.json({ ok: true, expired: expired.length });
}
