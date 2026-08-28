import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Security event logging endpoint.
// Receives client-side security events and writes them to audit_logs.
// Authentication required — events are tied to the calling user's session.
// Uses supabaseAdmin for INSERT because audit_logs has no INSERT policy
// (append-only ledger, doc §5.5).

const VALID_ACTIONS = [
  'SECURITY_DEVTOOLS_DETECTED',
  'SECURITY_SUSPICIOUS_REQUEST',
  'SECURITY_SUBSCRIPTION_BYPASS_ATTEMPT',
  'SECURITY_IDOR_ATTEMPT',
  'SECURITY_UNUSUAL_ACTIVITY',
] as const;

export async function POST(request: NextRequest) {
  // Auth check — must be logged in to log events (tied to user)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { action?: string; metadata?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.action || !VALID_ACTIONS.includes(body.action as (typeof VALID_ACTIONS)[number])) {
    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    );
  }

  // Resolve account_id from profile
  const admin = supabaseAdmin();
  const { data: profile } = await admin
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle();

  // Insert into audit_logs using service role (no INSERT policy)
  const { error } = await admin.from('audit_logs').insert({
    actor_user_id: user.id,
    actor_account_id: profile?.account_id ?? null,
    target_account_id: profile?.account_id ?? user.id,
    action: body.action,
    metadata: {
      ...body.metadata,
      userAgent: request.headers.get('user-agent'),
      timestamp: new Date().toISOString(),
    },
    ip:
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      null,
  });

  if (error) {
    console.error('[security/events] insert error:', error);
    return NextResponse.json(
      { error: 'Failed to log event' },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
