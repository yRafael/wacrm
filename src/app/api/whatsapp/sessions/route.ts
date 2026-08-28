import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { resolveAccountId } from '@/lib/whatsapp/sessions';
import { triggerSweep } from '@/lib/whatsapp/sweep-trigger';

/**
 * GET /api/whatsapp/sessions
 *
 * Lists the account's WhatsApp sessions (oldest first). Rows carry
 * `status` + `qr_data` (a data URL, rendered by the sessions UI) and
 * update live over Supabase Realtime as the worker changes them.
 *
 * Requires at least the 'viewer' role (any user can view WhatsApp sessions in a CRM).
 */
export async function GET() {
  try {
    const ctx = await requireRole('viewer');

    const accountId = await resolveAccountId(ctx.supabase, ctx.userId);
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('whatsapp_sessions')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error listing whatsapp_sessions:', error);
      return NextResponse.json(
        { error: 'Failed to list sessions' },
        { status: 500 }
      );
    }

    return NextResponse.json({ sessions: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/whatsapp/sessions
 *
 * Creates a new named session for the account. It starts as CONNECTING
 * so the worker connects a socket on its next sweep and the session
 * emits a QR (Baileys pairing) almost immediately — the UI shows the QR
 * once `qr_data` lands via Realtime.
 *
 * Requires at least the 'viewer' role (any user can connect WhatsApp in a CRM).
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('viewer');

    const accountId = await resolveAccountId(ctx.supabase, ctx.userId);
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('whatsapp_sessions')
      .insert({
        account_id: accountId,
        name,
        // CONNECTING tells the worker "pair me now" — a freshly created
        // row must connect immediately to emit a QR. DISCONNECTED is the
        // paused state the operator opts into via the disconnect action.
        status: 'CONNECTING',
        provider: 'baileys',
      })
      .select('*')
      .single();

    if (error || !data) {
      console.error('Error creating whatsapp_session:', error);
      return NextResponse.json(
        {
          error: `Failed to create session: ${error?.message ?? 'unknown error'}`,
        },
        { status: 500 }
      );
    }

    // Trigger an immediate worker sweep so the new session connects
    // right away instead of waiting up to 15s for the next sweep.
    triggerSweep();

    return NextResponse.json({ session: data }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
