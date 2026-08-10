import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveAccountId, clearSessionAuthDir } from '@/lib/whatsapp/sessions'

/**
 * POST /api/whatsapp/sessions/[id]/refresh
 *
 * Requests a fresh connection attempt (and QR, when pairing is needed).
 * The worker connects the socket on its next sweep:
 *
 *   - DISCONNECTED  → reconnect (valid on-disk creds resume silently;
 *                     no QR needed unless the number was logged out).
 *   - ERROR         → logged out: the on-disk auth state is deleted here
 *                     so Baileys issues a brand-new QR (re-pair).
 *   - CONNECTING/QR_CODE/RECONNECTING → no-op state-wise; the worker is
 *                     already on it.
 *   - CONNECTED     → rejected; a live session has nothing to refresh.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'Session id is required' }, { status: 400 })
    }

    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const { data: session, error: fetchError } = await supabase
      .from('whatsapp_sessions')
      .select('id, status')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (fetchError || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    if (session.status === 'CONNECTED') {
      return NextResponse.json(
        { error: 'Session is already connected.' },
        { status: 400 },
      )
    }

    // Logged out — the saved creds are dead. Wipe the auth dir so the
    // worker's next connect issues a fresh QR instead of replaying the
    // logged-out state.
    if (session.status === 'ERROR') {
      clearSessionAuthDir(accountId, id)
    }

    const { data: updated, error } = await supabase
      .from('whatsapp_sessions')
      .update({
        status: 'CONNECTING',
        qr_data: null,
        qr_expires_at: null,
        connected_at: null,
        last_error: null,
        // Tell the worker to rebuild its socket — the route runs in a
        // different process and can't drop the in-memory socket itself,
        // so it stamps this and the sweep acts on it.
        refresh_requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id')
      .maybeSingle()

    if (error || !updated) {
      console.error('Error refreshing whatsapp_session:', error)
      return NextResponse.json({ error: 'Failed to refresh session' }, { status: 500 })
    }

    return NextResponse.json({ success: true, status: 'CONNECTING' })
  } catch (error) {
    console.error('Error in WhatsApp session refresh POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
