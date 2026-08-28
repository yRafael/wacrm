/**
 * Server-side security event logger.
 *
 * Writes to audit_logs using supabaseAdmin (service role) because
 * the audit_logs table has no INSERT policy (append-only ledger).
 * Called from server components and API route handlers.
 *
 * Failures are logged to console but never thrown — logging must
 * never break the request flow.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';

interface ServerSecurityEventPayload {
  action: string;
  actorUserId?: string;
  actorAccountId?: string;
  targetAccountId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export async function logServerSecurityEvent(
  payload: ServerSecurityEventPayload
): Promise<void> {
  try {
    const admin = supabaseAdmin();
    const { error } = await admin.from('audit_logs').insert({
      actor_user_id: payload.actorUserId ?? null,
      actor_account_id: payload.actorAccountId ?? null,
      target_account_id: payload.targetAccountId ?? payload.actorAccountId ?? null,
      action: payload.action,
      metadata: {
        ...payload.metadata,
        serverTimestamp: new Date().toISOString(),
      },
      ip: payload.ip ?? null,
    });

    if (error) {
      console.error('[logServerSecurityEvent] insert error:', error);
    }
  } catch (err) {
    console.error('[logServerSecurityEvent] unexpected error:', err);
  }
}
