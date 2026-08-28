import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * POST /api/renewals/reminders/batch
 *
 * Enqueue batch reminders for selected payments. The worker processes
 * the queue with a configurable interval between sends.
 *
 * Body: { payment_ids: string[], interval_minutes?: number }
 */
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireRole('agent');
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unauthorized';
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const paymentIds: string[] = body.payment_ids;
  const intervalMinutes = Math.max(
    1,
    Math.min(30, Number(body.interval_minutes) || 5)
  );

  if (!Array.isArray(paymentIds) || paymentIds.length === 0) {
    return NextResponse.json(
      { error: 'payment_ids is required and must be a non-empty array' },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();

  // Fetch the payments to get contact_id and due_at for each.
  const { data: payments, error: fetchError } = await admin
    .from('payments')
    .select('id, contact_id, due_at')
    .eq('account_id', ctx.accountId)
    .in('id', paymentIds)
    .in('status', ['pending', 'late', 'partial']);

  if (fetchError) {
    return NextResponse.json(
      { error: 'Failed to fetch payments' },
      { status: 500 }
    );
  }
  if (!payments || payments.length === 0) {
    return NextResponse.json(
      { error: 'No matching pending payments found' },
      { status: 404 }
    );
  }

  // Check for already-queued reminders for these payments in this cycle.
  const existingPaymentIds = payments.map((p) => p.id);
  const { data: existing } = await admin
    .from('reminder_queue')
    .select('payment_id')
    .eq('account_id', ctx.accountId)
    .in('payment_id', existingPaymentIds)
    .in('status', ['pending', 'sending', 'sent']);

  const existingSet = new Set(
    (existing ?? []).map((e) => e.payment_id as string)
  );

  // Build queue items with staggered scheduled_for times.
  const now = Date.now();
  const queueItems = payments
    .filter((p) => !existingSet.has(p.id))
    .map((p, i) => ({
      account_id: ctx.accountId,
      contact_id: p.contact_id,
      payment_id: p.id,
      status: 'pending' as const,
      scheduled_for: new Date(now + i * intervalMinutes * 60_000).toISOString(),
    }));

  if (queueItems.length === 0) {
    return NextResponse.json(
      { error: 'All selected payments already have pending reminders' },
      { status: 409 }
    );
  }

  const { error: insertError } = await admin
    .from('reminder_queue')
    .insert(queueItems);

  if (insertError) {
    console.error('[reminders-batch] insert failed:', insertError);
    return NextResponse.json(
      { error: 'Failed to enqueue reminders' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    queued: queueItems.length,
    skipped: payments.length - queueItems.length,
    interval_minutes: intervalMinutes,
    first_send_at: queueItems[0]?.scheduled_for,
    last_send_at: queueItems[queueItems.length - 1]?.scheduled_for,
  });
}
