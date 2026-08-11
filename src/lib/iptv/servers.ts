// ============================================================
// Servers — the company's IPTV server catalog (migration 043).
//
// Reverses the migration-038 scope decision ("servers stay outside the
// workspace"): the operator now switches a customer's server from inside
// the conversation (⚡ Ações → 📺 Alterar servidor), so the company
// needs its own catalog. Multi-tenant like plans — account_id + RLS
// via is_account_member.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Server } from '@/types';

export interface ListServersOptions {
  /** Include inactive servers too (admin Settings catalog). Default false. */
  includeInactive?: boolean;
}

/**
 * The account's servers, active-first then by sort_order.
 */
export async function listServers(
  db: SupabaseClient,
  accountId: string,
  opts: ListServersOptions = {}
): Promise<Server[]> {
  let query = db
    .from('servers')
    .select('*')
    .eq('account_id', accountId)
    .order('is_active', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (!opts.includeInactive) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) {
    console.error('[servers] listServers failed:', error.message);
    return [];
  }
  return (data as Server[]) ?? [];
}

export interface ApplyServerInput {
  accountId: string;
  contactId: string;
  serverId: string;
}

/**
 * Assign a company server to the contact's active credential. Returns
 * the update result — RLS enforces agent+ on write; an account with no
 * credential updates zero rows.
 */
export function applyServerToCredential(
  db: SupabaseClient,
  input: ApplyServerInput
) {
  const { accountId, contactId, serverId } = input;
  return db
    .from('iptv_credentials')
    .update({
      server_id: serverId,
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .is('deleted_at', null);
}
