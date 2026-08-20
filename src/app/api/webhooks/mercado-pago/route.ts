import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { MercadoPagoProvider } from '@/lib/payment/mercado-pago';

/**
 * Mercado Pago webhook endpoint.
 *
 * POST — Receives payment events (preapproval status changes)
 * and updates the corresponding subscription.
 *
 * Security: validates webhook signature via MERCADO_PAGO_WEBHOOK_SECRET.
 * Idempotent: checks payment_events for duplicate provider_event_id.
 */
const provider = new MercadoPagoProvider();

export async function POST(request: NextRequest) {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: 'Failed to read body' }, { status: 400 });
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Extract headers for signature validation
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // Process via provider
  let result;
  try {
    result = await provider.handleWebhook(rawPayload, headers);
  } catch (err) {
    console.error('[mercado-pago-webhook] Processing error:', err);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 400 }
    );
  }

  const { providerSubscriptionId, newStatus, eventType, currentPeriodEnd } = result;

  if (!providerSubscriptionId) {
    // Unknown event type — acknowledge but don't process
    return NextResponse.json({ ok: true, skipped: true });
  }

  const admin = supabaseAdmin();

  // Idempotency check — use x-request-id from MP or stable hash of subscription+event
  const eventId = headers['x-request-id'] ?? `${providerSubscriptionId}:${eventType}`;

  const { data: existing } = await admin
    .from('payment_events')
    .select('id')
    .eq('provider', 'mercado_pago')
    .eq('provider_event_id', eventId)
    .maybeSingle();

  if (existing) {
    // Already processed
    return NextResponse.json({ ok: true, duplicate: true });
  }

  // Find the subscription by provider_subscription_id
  let { data: sub } = await admin
    .from('platform_subscriptions')
    .select('id, account_id, status')
    .eq('provider_subscription_id', providerSubscriptionId)
    .maybeSingle();

  // If no subscription exists yet, create one from the webhook data.
  // This handles the case where checkout didn't pre-create a row.
  if (!sub) {
    const raw = rawPayload as Record<string, unknown>;
    const externalRef = raw.external_reference
      ?? (raw.data as Record<string, unknown> | undefined)?.external_reference;
    const accountId = typeof externalRef === 'string' ? externalRef : null;

    if (!accountId) {
      console.error('[mercado-pago-webhook] No account_id (external_reference) for:', providerSubscriptionId);
      return NextResponse.json({ error: 'No account reference' }, { status: 400 });
    }

    // Find the account's most recent plan or default to fire_user
    const { data: plan } = await admin
      .from('platform_plans')
      .select('id')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle();

    const now = new Date().toISOString();
    const expiresAt = currentPeriodEnd
      ? new Date(currentPeriodEnd).toISOString()
      : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year fallback

    const { data: created, error: createErr } = await admin
      .from('platform_subscriptions')
      .insert({
        account_id: accountId,
        plan_id: plan?.id ?? null,
        status: newStatus,
        subscription_type: 'automatic',
        payment_provider: 'mercado_pago',
        provider_subscription_id: providerSubscriptionId,
        started_at: now,
        expires_at: expiresAt,
      })
      .select('id, account_id, status')
      .maybeSingle();

    if (createErr || !created) {
      console.error('[mercado-pago-webhook] Failed to create subscription:', createErr);
      return NextResponse.json({ error: 'Failed to create subscription' }, { status: 500 });
    }

    sub = created;
  }

  // Update subscription status
  const updateData: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  };
  if (currentPeriodEnd) {
    updateData.current_period_end = currentPeriodEnd;
    // Also extend expires_at when payment is confirmed (ACTIVE status)
    // This ensures the subscription doesn't expire after successful renewal
    if (newStatus === 'ACTIVE') {
      updateData.expires_at = currentPeriodEnd;
    }
  }

  const { error: updateErr } = await admin
    .from('platform_subscriptions')
    .update(updateData)
    .eq('id', sub.id);

  if (updateErr) {
    console.error('[mercado-pago-webhook] Update error:', updateErr);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  // Log payment event for audit trail
  await admin.from('payment_events').insert({
    subscription_id: sub.id,
    provider: 'mercado_pago',
    event_type: eventType,
    provider_event_id: eventId,
    raw_payload: rawPayload,
    processed_at: new Date().toISOString(),
  });

  // Audit log
  await admin.from('audit_logs').insert({
    actor_user_id: null,
    actor_account_id: null,
    target_account_id: sub.account_id,
    action: 'subscription.payment_event',
    metadata: {
      provider: 'mercado_pago',
      event_type: eventType,
      provider_subscription_id: providerSubscriptionId,
      previous_status: sub.status,
      new_status: newStatus,
    },
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  return NextResponse.json({ ok: true });
}
