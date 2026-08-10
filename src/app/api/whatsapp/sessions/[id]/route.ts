import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveAccountId, clearSessionAuthDir } from '@/lib/whatsapp/sessions'

/**
 * DELETE /api/whatsapp/sessions/[id]
 *
 * Removes the session. The worker drops the socket on its next sweep;
 * the on-disk Baileys auth state is also deleted so stale creds are
 * never reused by a future session. Account-scoped + RLS (admin-only),
 * so a member can only delete their own account's session.
 */
export async function DELETE(
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

    const { data: deleted, error } = await supabase
      .from('whatsapp_sessions')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id, account_id')
      .maybeSingle()

    if (error) {
      console.error('Error deleting whatsapp_session:', error)
      return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 })
    }

    if (!deleted) {
      // No row matched — either the id doesn't exist or the caller isn't
      // an admin for that account (RLS filtered it out). Same status to
      // avoid leaking which.
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Best-effort: remove the on-disk auth state. Safe here because the
    // row is already gone — the worker will drop the socket on its next
    // sweep, and a socket that's still alive just holds the creds in
    // memory until then.
    clearSessionAuthDir(deleted.account_id as string, deleted.id as string)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp sessions DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
