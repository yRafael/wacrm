// ============================================================
// Branding queries — read/write `account_branding` (migration 045).
//
// Multi-tenant by construction: every row is keyed by account_id and
// RLS gates it with is_account_member (members read, admins write —
// same tier as plans/servers). The functions here always resolve the
// row for a specific account, so João can never read Maria's config.
//
// The JSONB `config` column is normalized through fromRawConfig on the
// way out, so consumers always get valid clamped values.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { fromRawConfig, type Branding, type BrandingConfig } from './types';

function rowToBranding(row: Record<string, unknown> | null): Branding | null {
  if (!row) return null;
  return {
    id: row.id as string,
    account_id: row.account_id as string,
    logo_path: (row.logo_path as string | null) ?? null,
    banner_path: (row.banner_path as string | null) ?? null,
    config: fromRawConfig(row.config),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/**
 * The company's branding config, or null when it has never customized
 * anything. Members read (RLS); a non-member gets null.
 */
export async function getBranding(
  db: SupabaseClient,
  accountId: string
): Promise<Branding | null> {
  const { data, error } = await db
    .from('account_branding')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    console.warn('[branding] getBranding failed:', error.message);
    return null;
  }
  return rowToBranding((data as Record<string, unknown>) ?? null);
}

export interface SaveBrandingPatch {
  logo_path?: string | null;
  banner_path?: string | null;
  config?: BrandingConfig;
}

/**
 * Create or update the company's branding (upsert on account_id). The
 * row exists only once a company saves — before that, getBranding
 * returns null and the app uses the Fire identity. Admin-tier RLS
 * rejects agents/viewers on write.
 */
export async function saveBranding(
  db: SupabaseClient,
  accountId: string,
  patch: SaveBrandingPatch
): Promise<Branding | null> {
  const row: Record<string, unknown> = {
    account_id: accountId,
    updated_at: new Date().toISOString(),
  };
  if (patch.logo_path !== undefined) row.logo_path = patch.logo_path;
  if (patch.banner_path !== undefined) row.banner_path = patch.banner_path;
  if (patch.config !== undefined) row.config = patch.config;

  const { data, error } = await db
    .from('account_branding')
    .upsert(row, { onConflict: 'account_id' })
    .select('*')
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return rowToBranding((data as Record<string, unknown>) ?? null);
}

/**
 * Delete the company's branding — "Restaurar padrão". Admin-tier. The
 * caller is responsible for cleaning up stored assets first.
 */
export async function deleteBranding(
  db: SupabaseClient,
  accountId: string
): Promise<void> {
  const { error } = await db
    .from('account_branding')
    .delete()
    .eq('account_id', accountId);
  if (error) throw new Error(error.message);
}
