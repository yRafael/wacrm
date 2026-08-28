import { NextResponse, type NextRequest } from 'next/server';
import { requirePlatformOperator } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Manual subscription grant (Fire Control).
 *
 * POST — Creates or updates a subscription for an account with:
 *   status: ACTIVE
 *   subscription_type: 'manual' | 'courtesy' | 'promotional'
 *   granted_by: <operator's account_id>
 *   granted_reason: <text>
 *   expires_at: calculated from duration, or null for indefinite
 *
 * Requires PLATFORM_OWNER or PLATFORM_OPERATOR role (validated in backend).
 */

interface GrantBody {
  account_id: string;
  subscription_type: 'manual' | 'courtesy' | 'promotional';
  duration_days?: number | null; // null = indefinite
  reason: string;
  plan_id?: string; // optional, defaults to fire_user
}

export async function POST(request: NextRequest) {
  // RBAC: only platform operators can grant access
  let caller;
  try {
    caller = await requirePlatformOperator();
  } catch {
    return NextResponse.json(
      { error: 'Apenas operadores da plataforma podem conceder acesso.' },
      { status: 403 }
    );
  }

  let body: GrantBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  // Validate required fields
  if (!body.account_id || !body.subscription_type || !body.reason?.trim()) {
    return NextResponse.json(
      { error: 'account_id, subscription_type e reason são obrigatórios.' },
      { status: 400 }
    );
  }

  if (!['manual', 'courtesy', 'promotional'].includes(body.subscription_type)) {
    return NextResponse.json(
      { error: 'subscription_type inválido.' },
      { status: 400 }
    );
  }

  if (body.reason.trim().length < 3) {
    return NextResponse.json(
      { error: 'O motivo deve ter pelo menos 3 caracteres.' },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();

  // Verify target account exists
  const { data: targetAccount, error: accErr } = await admin
    .from('accounts')
    .select('id, name')
    .eq('id', body.account_id)
    .maybeSingle();

  if (accErr || !targetAccount) {
    return NextResponse.json(
      { error: 'Conta não encontrada.' },
      { status: 404 }
    );
  }

  // Resolve plan_id — default to fire_user
  let planId = body.plan_id;
  if (!planId) {
    const { data: plan } = await admin
      .from('platform_plans')
      .select('id')
      .eq('code', 'fire_user')
      .maybeSingle();
    planId = plan?.id;
  }

  if (!planId) {
    return NextResponse.json(
      { error: 'Plano padrão não encontrado.' },
      { status: 500 }
    );
  }

  // Calculate expiry
  const expiresAt =
    body.duration_days && body.duration_days > 0
      ? new Date(Date.now() + body.duration_days * 86400000).toISOString()
      : null;

  // Upsert subscription — if one exists, update it; otherwise create
  const { data: existingSub } = await admin
    .from('platform_subscriptions')
    .select('id')
    .eq('account_id', body.account_id)
    .order('created_at', { ascending: false })
    .maybeSingle();

  let subResult;
  if (existingSub) {
    subResult = await admin
      .from('platform_subscriptions')
      .update({
        status: 'ACTIVE',
        subscription_type: body.subscription_type,
        plan_id: planId,
        granted_by: caller.accountId,
        granted_reason: body.reason.trim(),
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingSub.id)
      .select('id')
      .maybeSingle();
  } else {
    subResult = await admin
      .from('platform_subscriptions')
      .insert({
        account_id: body.account_id,
        plan_id: planId,
        status: 'ACTIVE',
        subscription_type: body.subscription_type,
        granted_by: caller.accountId,
        granted_reason: body.reason.trim(),
        started_at: new Date().toISOString(),
        expires_at: expiresAt,
      })
      .select('id')
      .maybeSingle();
  }

  if (subResult.error) {
    console.error('[grant-access] subscription error:', subResult.error);
    return NextResponse.json(
      { error: 'Erro ao criar/atualizar assinatura.' },
      { status: 500 }
    );
  }

  // Audit log
  await admin.from('audit_logs').insert({
    actor_user_id: caller.userId,
    actor_account_id: caller.accountId,
    target_account_id: body.account_id,
    action: 'subscription.manual_grant',
    metadata: {
      subscription_id: subResult.data?.id,
      subscription_type: body.subscription_type,
      duration_days: body.duration_days ?? null,
      expires_at: expiresAt,
      reason: body.reason.trim(),
    },
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  return NextResponse.json({
    ok: true,
    subscription_id: subResult.data?.id,
    expires_at: expiresAt,
  });
}
