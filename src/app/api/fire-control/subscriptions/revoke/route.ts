import { NextResponse, type NextRequest } from 'next/server';
import { requirePlatformOperator } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Manual subscription revoke (Fire Control).
 *
 * POST — Sets a subscription to EXPIRED or CANCELED, revoking access.
 * Requires PLATFORM_OWNER or PLATFORM_OPERATOR role.
 */

interface RevokeBody {
  account_id: string;
  reason: string;
  status?: 'EXPIRED' | 'CANCELED'; // default EXPIRED
}

export async function POST(request: NextRequest) {
  let caller;
  try {
    caller = await requirePlatformOperator();
  } catch {
    return NextResponse.json(
      { error: 'Apenas operadores da plataforma podem revogar acesso.' },
      { status: 403 }
    );
  }

  let body: RevokeBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!body.account_id || !body.reason?.trim()) {
    return NextResponse.json(
      { error: 'account_id e reason são obrigatórios.' },
      { status: 400 }
    );
  }

  const revokeStatus = body.status === 'CANCELED' ? 'CANCELED' : 'EXPIRED';

  const admin = supabaseAdmin();

  // Find active subscription
  const { data: sub, error: findErr } = await admin
    .from('platform_subscriptions')
    .select('id, status')
    .eq('account_id', body.account_id)
    .not('status', 'in', '(EXPIRED,CANCELED)')
    .order('created_at', { ascending: false })
    .maybeSingle();

  if (findErr || !sub) {
    return NextResponse.json(
      { error: 'Nenhuma assinativa ativa encontrada para esta conta.' },
      { status: 404 }
    );
  }

  // Update subscription
  const { error: updateErr } = await admin
    .from('platform_subscriptions')
    .update({
      status: revokeStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sub.id);

  if (updateErr) {
    console.error('[revoke-access] update error:', updateErr);
    return NextResponse.json(
      { error: 'Erro ao revogar assinatura.' },
      { status: 500 }
    );
  }

  // Audit log
  await admin.from('audit_logs').insert({
    actor_user_id: caller.userId,
    actor_account_id: caller.accountId,
    target_account_id: body.account_id,
    action: 'subscription.manual_revoke',
    metadata: {
      subscription_id: sub.id,
      previous_status: sub.status,
      new_status: revokeStatus,
      reason: body.reason.trim(),
    },
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  return NextResponse.json({ ok: true, status: revokeStatus });
}
