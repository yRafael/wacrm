// ============================================================
// Sessions API helpers — shared by the `/api/whatsapp/sessions*`
// routes. No `@whiskeysockets/baileys` import (the worker owns the
// sockets); these routes only orchestrate the `whatsapp_sessions`
// rows + the on-disk auth state, and the worker picks the changes up
// on its next sweep (~15s) or connection update.
//
// Lifecycle contract with the worker:
//   create       → status 'CONNECTING'  (worker connects → QR_CODE)
//   refresh      → status 'CONNECTING'  (re-pair; clears auth dir if
//                 the session logged out so a fresh QR is issued)
//   disconnect   → status 'DISCONNECTED' (worker drops the socket)
//   delete       → row removed           (worker drops the socket)
//
// The worker only keeps a socket for rows whose status is NOT
// DISCONNECTED / ERROR (see sweepSessions in worker.ts).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';

import { sessionAuthDir } from '@/lib/whatsapp/baileys/paths';

/** Resolve the caller's account_id from their profile. Null when the
 * user has no profile/account — callers treat that as forbidden. */
export async function resolveAccountId(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data?.account_id) return null;
  return data.account_id as string;
}

/**
 * Delete the on-disk Baileys auth state for a session (best-effort).
 * Used when forcing a fresh QR after a logout and on session delete so
 * stale creds never get reused. The worker writes these dirs under
 * `wa-sessions/<accountId>/<sessionId>/`; deleting while a socket
 * still holds the state in memory is safe — the caller is expected to
 * have already marked the row DISCONNECTED/removed it so the worker
 * drops the socket first.
 */
export function clearSessionAuthDir(
  accountId: string,
  sessionId: string
): void {
  try {
    fs.rmSync(sessionAuthDir(accountId, sessionId), {
      recursive: true,
      force: true,
    });
  } catch (err) {
    console.error(
      '[whatsapp/sessions] auth-dir cleanup failed:',
      err instanceof Error ? err.message : err
    );
  }
}
