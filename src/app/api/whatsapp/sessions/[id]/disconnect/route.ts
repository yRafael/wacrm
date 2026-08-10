import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveAccountId } from '@/lib/whatsapp/sessions'

/**
 * POST /api/whatsapp/sessions/[id]/disconnect
 *
 * Pauses a session: status → DISCONNECTED, QR/connection cleared. The
 * worker drops the socket on its next sweep (~15s). The row stays so
 * the operator can re-pair later via /refresh — deleting the row is the
 * permanent removal.
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

    const { data: updated, error } = await supabase
      .from('whatsapp_sessions')
      .update({
        status: 'DISCONNECTED',
        qr_data: null,
        qr_expires_at: null,
        connected_at: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('Error disconnecting whatsapp_session:', error)
      return NextResponse.json({ error: 'Failed to disconnect session' }, { status: 500 })
    }

    if (!updated) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, status: 'DISCONNECTED' })
  } catch (error) {
    console.error('Error in WhatsApp session disconnect POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
