import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentAccount } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { encrypt } from '@/lib/whatsapp/encryption';

/**
 * GET — List MP credentials for the current account.
 * POST — Create/update MP credentials for the current account.
 * DELETE — Remove MP credentials for the current account.
 */

export async function GET() {
  let caller;
  try {
    caller = await getCurrentAccount();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('account_mercado_pago_credentials')
    .select('id, is_active, created_at, updated_at')
    .eq('account_id', caller.accountId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 });
  }

  return NextResponse.json({
    configured: !!data,
    is_active: data?.is_active ?? false,
    created_at: data?.created_at ?? null,
    updated_at: data?.updated_at ?? null,
  });
}

export async function POST(request: NextRequest) {
  let caller;
  try {
    caller = await getCurrentAccount();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { access_token?: string; webhook_secret?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!body.access_token) {
    return NextResponse.json(
      { error: 'access_token é obrigatório' },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();

  // Validate the token by making a test API call to Mercado Pago
  try {
    const testRes = await fetch('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${body.access_token}` },
    });
    if (!testRes.ok) {
      return NextResponse.json(
        { error: 'Token do Mercado Pago inválido' },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: 'Não foi possível validar o token do Mercado Pago' },
      { status: 500 }
    );
  }

  const encryptedToken = encrypt(body.access_token);
  const encryptedSecret = body.webhook_secret ? encrypt(body.webhook_secret) : null;

  // Upsert credentials
  const { data: existing } = await admin
    .from('account_mercado_pago_credentials')
    .select('id')
    .eq('account_id', caller.accountId)
    .maybeSingle();

  if (existing) {
    const updateData: Record<string, unknown> = {
      access_token_encrypted: encryptedToken,
      is_active: true,
      updated_at: new Date().toISOString(),
    };
    if (encryptedSecret !== null) {
      updateData.webhook_secret_encrypted = encryptedSecret;
    }
    await admin
      .from('account_mercado_pago_credentials')
      .update(updateData)
      .eq('id', existing.id);
  } else {
    await admin.from('account_mercado_pago_credentials').insert({
      account_id: caller.accountId,
      access_token_encrypted: encryptedToken,
      webhook_secret_encrypted: encryptedSecret,
      is_active: true,
    });
  }

  // Audit log
  await admin.from('audit_logs').insert({
    actor_user_id: caller.userId,
    actor_account_id: caller.accountId,
    target_account_id: caller.accountId,
    action: 'mp_credentials.updated',
    metadata: { has_webhook_secret: !!body.webhook_secret },
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  let caller;
  try {
    caller = await getCurrentAccount();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const { error } = await admin
    .from('account_mercado_pago_credentials')
    .delete()
    .eq('account_id', caller.accountId);

  if (error) {
    return NextResponse.json({ error: 'Failed to delete credentials' }, { status: 500 });
  }

  // Audit log
  await admin.from('audit_logs').insert({
    actor_user_id: caller.userId,
    actor_account_id: caller.accountId,
    target_account_id: caller.accountId,
    action: 'mp_credentials.deleted',
    metadata: {},
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  return NextResponse.json({ ok: true });
}
