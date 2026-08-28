import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Reminder cron + batch queue processor.
 *
 * GET  — Daily auto-reminders for expiring credentials (original behavior).
 * POST — Process pending items in the `reminder_queue` table (batch send
 *        from the Renovações page). Processes up to 10 items per invocation
 *        so the cron can interleave both jobs without exceeding timeouts.
 *
 * Requires `SUBSCRIPTION_REMINDER_CRON_SECRET` env var.
 */
export const maxDuration = 60;

const DAYS_AHEAD = parseInt(
  process.env.SUBSCRIPTION_REMINDER_DAYS_AHEAD ?? '3',
  10
);

export async function GET(request: Request) {
  const expected = process.env.SUBSCRIPTION_REMINDER_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = supabaseAdmin();

  // Find all expiring credentials across all accounts.
  const { data: credentials, error } = await admin.rpc(
    'find_expiring_credentials',
    { p_account_id: null, p_days_ahead: DAYS_AHEAD }
  );

  if (error) {
    console.error('[reminders-cron] query failed:', error);
    return NextResponse.json(
      { error: 'Failed to query expiring credentials' },
      { status: 500 }
    );
  }
  if (!credentials || credentials.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  let sent = 0;
  let failed = 0;

  for (const cred of credentials) {
    try {
      // Look up the WhatsApp config for this account to get the
      // phone number ID needed for template sends.
      const { data: config } = await admin
        .from('whatsapp_config')
        .select('phone_number_id')
        .eq('account_id', cred.account_id)
        .maybeSingle();

      if (!config?.phone_number_id) {
        console.warn(
          `[reminders-cron] no whatsapp config for account ${cred.account_id}, skipping credential ${cred.credential_id}`
        );
        failed++;
        continue;
      }

      // Find or create a conversation for this contact to send the
      // template message through the existing outbox path.
      const { data: conversation } = await admin
        .from('conversations')
        .select('id')
        .eq('account_id', cred.account_id)
        .eq('contact_id', cred.contact_id)
        .maybeSingle();

      let conversationId = conversation?.id;

      if (!conversationId) {
        const { data: newConv } = await admin
          .from('conversations')
          .insert({
            account_id: cred.account_id,
            contact_id: cred.contact_id,
            channel: 'whatsapp',
          })
          .select('id')
          .maybeSingle();
        conversationId = newConv?.id;
      }

      if (!conversationId) {
        console.error(
          `[reminders-cron] could not create conversation for contact ${cred.contact_id}`
        );
        failed++;
        continue;
      }

      // Build the reminder message text. If a Meta-approved Utility
      // template exists, use template_name + params instead. For now
      // we send a free-text reminder via the outbox (works with
      // Baileys; Meta Cloud API would need the approved template).
      const daysText =
        cred.days_until === 0
          ? 'hoje'
          : cred.days_until === 1
            ? 'amanhã'
            : `em ${cred.days_until} dias`;

      const messageText =
        `Olá ${cred.contact_name ?? ' cliente'}, seu plano ${cred.plan_name ?? 'IPTV'} ` +
        `vence ${daysText}. ` +
        `Renove para continuar aproveitando!`;

      // Enqueue via the outbox (same path as manual sends).
      const { error: insertError } = await admin.from('whatsapp_outbox').insert({
        account_id: cred.account_id,
        conversation_id: conversationId,
        contact_id: cred.contact_id,
        phone_number_id: config.phone_number_id,
        message_type: 'text',
        text_body: messageText,
        status: 'pending',
      });

      if (insertError) {
        console.error(
          `[reminders-cron] outbox insert failed for credential ${cred.credential_id}:`,
          insertError
        );
        failed++;
        continue;
      }

      // Mark as reminded to avoid duplicates.
      const { error: markError } = await admin.rpc('mark_reminder_sent', {
        p_credential_id: cred.credential_id,
      });

      if (markError) {
        console.error(
          `[reminders-cron] mark_reminder_sent failed for ${cred.credential_id}:`,
          markError
        );
        // Message was enqueued; don't count as failed.
      }

      sent++;
    } catch (err) {
      console.error(
        `[reminders-cron] unexpected error for credential ${cred.credential_id}:`,
        err
      );
      failed++;
    }
  }

  // Audit log entry.
  await admin.from('audit_logs').insert({
    account_id: null, // cross-tenant job
    user_id: null,
    action: 'subscription.reminders_cron',
    details: {
      found: credentials.length,
      sent,
      failed,
      days_ahead: DAYS_AHEAD,
    },
  });

  return NextResponse.json({
    processed: credentials.length,
    sent,
    failed,
  });
}

/**
 * POST — Process pending items from the `reminder_queue` table.
 * Called by the same cron that runs the GET auto-reminder job.
 * Processes up to 10 items per run to stay within timeout limits.
 */
export async function POST(request: Request) {
  const expected = process.env.SUBSCRIPTION_REMINDER_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const now = new Date().toISOString();

  // Pick up to 10 pending items whose scheduled_for has arrived.
  const { data: items, error: fetchError } = await admin
    .from('reminder_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', now)
    .order('scheduled_for', { ascending: true })
    .limit(10);

  if (fetchError) {
    console.error('[reminders-queue] fetch failed:', fetchError);
    return NextResponse.json(
      { error: 'Failed to fetch queue' },
      { status: 500 }
    );
  }
  if (!items || items.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  let sent = 0;
  let failed = 0;

  for (const item of items) {
    // Claim the row.
    const { data: claimed } = await admin
      .from('reminder_queue')
      .update({ status: 'sending', updated_at: now })
      .eq('id', item.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (!claimed) continue; // Another worker claimed it.

    try {
      // Look up WhatsApp config for this account.
      const { data: config } = await admin
        .from('whatsapp_config')
        .select('phone_number_id')
        .eq('account_id', item.account_id)
        .maybeSingle();

      if (!config?.phone_number_id) {
        await admin
          .from('reminder_queue')
          .update({
            status: 'failed',
            error: 'No WhatsApp config',
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id);
        failed++;
        continue;
      }

      // Find or create conversation.
      const { data: conversation } = await admin
        .from('conversations')
        .select('id')
        .eq('account_id', item.account_id)
        .eq('contact_id', item.contact_id)
        .maybeSingle();

      let conversationId = conversation?.id;
      if (!conversationId) {
        const { data: newConv } = await admin
          .from('conversations')
          .insert({
            account_id: item.account_id,
            contact_id: item.contact_id,
            channel: 'whatsapp',
          })
          .select('id')
          .maybeSingle();
        conversationId = newConv?.id;
      }

      if (!conversationId) {
        await admin
          .from('reminder_queue')
          .update({
            status: 'failed',
            error: 'Could not create conversation',
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id);
        failed++;
        continue;
      }

      // Fetch contact name for personalization.
      const { data: contact } = await admin
        .from('contacts')
        .select('name')
        .eq('id', item.contact_id)
        .maybeSingle();

      // Fetch payment info for days-until text.
      let daysText = 'em breve';
      let planName = 'IPTV';
      if (item.payment_id) {
        const { data: payment } = await admin
          .from('payments')
          .select('due_at')
          .eq('id', item.payment_id)
          .maybeSingle();
        if (payment?.due_at) {
          const diff = Math.ceil(
            (new Date(payment.due_at).getTime() - Date.now()) /
              (24 * 60 * 60 * 1000)
          );
          daysText =
            diff === 0 ? 'hoje' : diff === 1 ? 'amanhã' : `em ${diff} dias`;
        }
      }

      const messageText =
        `Olá ${contact?.name ?? ' cliente'}, seu plano ${planName} ` +
        `vence ${daysText}. Renove para continuar aproveitando!`;

      // Enqueue via outbox.
      const { error: insertError } = await admin.from('whatsapp_outbox').insert({
        account_id: item.account_id,
        conversation_id: conversationId,
        contact_id: item.contact_id,
        phone_number_id: config.phone_number_id,
        message_type: 'text',
        text_body: messageText,
        status: 'pending',
      });

      if (insertError) {
        await admin
          .from('reminder_queue')
          .update({
            status: 'failed',
            error: insertError.message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id);
        failed++;
        continue;
      }

      // Mark as sent.
      await admin
        .from('reminder_queue')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id);

      sent++;
    } catch (err) {
      console.error(`[reminders-queue] error for item ${item.id}:`, err);
      await admin
        .from('reminder_queue')
        .update({
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error',
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id);
      failed++;
    }
  }

  return NextResponse.json({ processed: items.length, sent, failed });
}
