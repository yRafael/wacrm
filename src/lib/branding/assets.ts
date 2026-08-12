// ============================================================
// Branding assets — upload/serve for the private `branding` bucket.
//
// UNLIKE flow-media/chat-media (public buckets whose URLs Meta fetches
// directly), the branding bucket is PRIVATE: nothing is ever served as
// a public URL. The app reads through `/api/branding/asset`, a
// session-authenticated proxy that resolves the caller's account and
// refuses anything outside `account-<accountId>/`. Cross-company reads
// are impossible — the account comes from the session, never the URL.
//
// The path convention matches every account-scoped bucket in the repo
// (upload-media.ts): `account-<uuid>/<kind>-<timestamp>-<base>.<ext>`.
// RLS on storage.objects (migration 045) only allows that shape.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export type BrandAssetKind = 'logo' | 'banner' | 'chat' | 'gallery';

/** 5 MB — mirrors the branding bucket's file_size_limit (migration 045). */
export const BRAND_MAX_BYTES = 5 * 1024 * 1024;

/** Accepted mime-types — mirrors the bucket's allowed_mime_types. */
export const BRAND_ACCEPT = 'image/png,image/jpeg,image/webp';

/**
 * Build the account-scoped object path for a branding upload. Pure +
 * exported so it can be unit-tested without Supabase. Bare names keep a
 * sensible default extension (`png`) since an image is always expected.
 */
export function buildBrandAssetPath(
  accountId: string,
  kind: BrandAssetKind,
  fileName: string,
  now: number = Date.now()
): string {
  const hasExt = /\.[^.]+$/.test(fileName);
  const ext = hasExt ? fileName.split('.').pop()!.toLowerCase() : 'png';
  const safeBase =
    fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .slice(0, 40) || kind;
  return `account-${accountId}/${kind}-${now}-${safeBase}.${ext}`;
}

export interface UploadBrandAssetResult {
  /** Storage object path (account-scoped). */
  path: string;
}

/**
 * Upload an image into the company's private branding folder. RLS
 * (admin-tier) rejects non-admins and cross-account paths client-side.
 * Throws a user-facing message — callers surface it via a toast.
 */
export async function uploadBrandAsset(
  db: SupabaseClient,
  accountId: string,
  file: File,
  kind: BrandAssetKind
): Promise<UploadBrandAssetResult> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files are supported.');
  }
  const path = buildBrandAssetPath(accountId, kind, file.name);
  const { error } = await db.storage.from('branding').upload(path, file, {
    cacheControl: '3600',
    upsert: true,
    contentType: file.type,
  });
  if (error) throw new Error(error.message);
  return { path };
}

/**
 * Delete a previously-uploaded brand asset. Gated by the same
 * account-scoped admin RLS as the upload. Best-effort for callers that
 * fire-and-forget; the panel awaits it so a failed cleanup surfaces.
 */
export async function removeBrandAsset(
  db: SupabaseClient,
  path: string
): Promise<void> {
  if (!path) return;
  const { error } = await db.storage.from('branding').remove([path]);
  if (error) throw new Error(error.message);
}

/**
 * All object paths in the company's branding folder (logo/banner/chat/
 * gallery live flat under `account-<uuid>/`). Used by the Imagens
 * library. Fail-soft: returns [] so a listing hiccup never blocks the
 * panel.
 */
export async function listBrandAssets(
  db: SupabaseClient,
  accountId: string
): Promise<string[]> {
  const folder = `account-${accountId}`;
  const { data, error } = await db.storage.from('branding').list(folder);
  if (error) {
    console.warn('[branding] listBrandAssets failed:', error.message);
    return [];
  }
  return (data ?? []).map((o) => `${folder}/${o.name}`);
}

// ------------------------------------------------------------
// URLs — the ONLY way the browser reads brand assets: the authenticated
// proxy. `kind` resolves the canonical asset (logo/banner/chat); `path`
// serves any object, but the proxy re-verifies it belongs to the session's
// account before streaming.
// ------------------------------------------------------------

export function brandAssetUrl(kind: 'logo' | 'banner' | 'chat'): string {
  return `/api/branding/asset?kind=${kind}`;
}

export function brandAssetPathUrl(path: string): string {
  return `/api/branding/asset?path=${encodeURIComponent(path)}`;
}
