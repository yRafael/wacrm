import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentAccount } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { MercadoPagoProvider, hasAccountCredentials } from '@/lib/payment/mercado-pago';

/**
 * Subscription checkout endpoint.
 *
 * POST — Creates a Mercado Pago preapproval and returns the
 * checkout URL for the user to complete payment.
 *
 * Body: { plan_id: string }
 */
export async function POST(request: NextRequest) {
  let body: { plan_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!body.plan_id) {
    return NextResponse.json({ error: 'plan_id é obrigatório' }, { status: 400 });
  }

  // Authenticate the user
  let caller;
  try {
    caller = await getCurrentAccount();
  } catch {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const admin = supabaseAdmin();

  // Fetch the plan
  const { data: plan, error: planErr } = await admin
    .from('platform_plans')
    .select('id, code, name, price_monthly, account_type')
    .eq('id', body.plan_id)
    .eq('is_active', true)
    .maybeSingle();

  if (planErr || !plan) {
    return NextResponse.json({ error: 'Plano não encontrado' }, { status: 404 });
  }

  // Fetch the user's email and name from profile
  const { data: profile } = await admin
    .from('profiles')
    .select('email, full_name')
    .eq('user_id', caller.userId)
    .maybeSingle();

  const customerEmail = profile?.email ?? '';
  const customerName = profile?.full_name ?? caller.account.name ?? '';

  if (!customerEmail) {
    return NextResponse.json(
      { error: 'Email do usuário não encontrado' },
      { status: 400 }
    );
  }

  // Build URLs
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? request.headers.get('origin') ?? 'http://localhost:3000';
  const successUrl = `${baseUrl}/pricing?checkout=success`;
  const failureUrl = `${baseUrl}/pricing?checkout=failure`;
  const pendingUrl = `${baseUrl}/pricing?checkout=pending`;

  // For RESELLER accounts, require own Mercado Pago credentials
  const accountType = caller.account.account_type ?? 'USER';
  if (accountType === 'RESELLER') {
    const hasOwn = await hasAccountCredentials(caller.accountId);
    if (!hasOwn) {
      return NextResponse.json(
        {
          error: 'Configure suas credenciais do Mercado Pago antes de criar assinaturas.',
          code: 'MP_CREDENTIALS_REQUIRED',
        },
        { status: 400 }
      );
    }
  }

  // Create checkout session
  const provider = new MercadoPagoProvider();
  try {
    const result = await provider.createSubscription({
      accountId: caller.accountId,
      planCode: plan.code,
      priceMonthly: plan.price_monthly,
      customerEmail,
      customerName,
      successUrl,
      failureUrl,
      pendingUrl,
    });

    // Store the provider subscription ID on the account's subscription
    const { data: existingSub } = await admin
      .from('platform_subscriptions')
      .select('id')
      .eq('account_id', caller.accountId)
      .order('created_at', { ascending: false })
      .maybeSingle();

    if (existingSub) {
      await admin
        .from('platform_subscriptions')
        .update({
          payment_provider: 'mercado_pago',
          provider_subscription_id: result.providerSubscriptionId,
          plan_id: plan.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingSub.id);
    }
    // When no existing subscription, don't create a row here with a
    // fake status — the webhook will create it once payment is confirmed.

    // Audit log
    await admin.from('audit_logs').insert({
      actor_user_id: caller.userId,
      actor_account_id: caller.accountId,
      target_account_id: caller.accountId,
      action: 'subscription.checkout_created',
      metadata: {
        plan_id: plan.id,
        plan_code: plan.code,
        price_monthly: plan.price_monthly,
        provider: 'mercado_pago',
        provider_subscription_id: result.providerSubscriptionId,
      },
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    });

    return NextResponse.json({
      ok: true,
      checkoutUrl: result.checkoutUrl,
    });
  } catch (err) {
    console.error('[checkout] Mercado Pago error:', err);
    return NextResponse.json(
      { error: 'Erro ao criar sessão de pagamento' },
      { status: 500 }
    );
  }
}
