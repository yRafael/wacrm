// ============================================================
// Subtree access — the code-side half of the reseller-tree
// authorization rule (doc §5.6).
//
// The rule: a reseller may only read/modify accounts that are
// DESCENDANTS of their own account — never ancestors, never
// sibling branches, even if the attacker knows the target's UUID
// (the multi-tenant BOLA/IDOR equivalent, but hierarchical).
//
// Two layers, always:
//   1. RLS: `is_account_in_subtree(ancestor, target)` (migration
//      046) — the database blocks alone, without waiting for a
//      route to remember the check.
//   2. Code: this module, for the service-role paths (Fire Control
//      and anything acting on a reseller's behalf), where RLS is
//      bypassed by definition.
//
// `isDescendant` is pure (unit-tested against the doc's IDOR/BOLA
// matrix); `requireSubtreeAccess` is the I/O wrapper that fetches
// the tree and throws `ForbiddenError` when the rule is violated.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { ForbiddenError } from './account';

/** One edge of the reseller tree (`account_relationships`). */
export interface RelationshipEdge {
  parent_account_id: string;
  child_account_id: string;
}

/**
 * Build a `parent → [children]` adjacency map from the raw edges.
 * Pure — shared by the descendant check and the tree renderer.
 */
export function buildChildrenMap(
  edges: RelationshipEdge[]
): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    const list = children.get(edge.parent_account_id) ?? [];
    list.push(edge.child_account_id);
    children.set(edge.parent_account_id, list);
  }
  return children;
}

/**
 * True iff `targetAccountId` is `ancestorAccountId` itself or a
 * descendant of it. Mirrors the SQL `is_account_in_subtree` so JS
 * and DB speak the same language.
 */
export function isDescendant(
  edges: RelationshipEdge[],
  ancestorAccountId: string,
  targetAccountId: string
): boolean {
  if (ancestorAccountId === targetAccountId) return true;

  const children = buildChildrenMap(edges);
  const stack = [ancestorAccountId];
  const seen = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of children.get(current) ?? []) {
      if (child === targetAccountId) return true;
      if (seen.has(child)) continue;
      seen.add(child);
      stack.push(child);
    }
  }
  return false;
}

/**
 * Return every account id strictly below `ancestorAccountId`
 * (descendants, not the ancestor itself). Used by the read-only
 * tree view to enumerate a reseller's reachable set.
 */
export function listDescendants(
  edges: RelationshipEdge[],
  ancestorAccountId: string
): string[] {
  const children = buildChildrenMap(edges);
  const result: string[] = [];
  const stack = [ancestorAccountId];
  const seen = new Set<string>([ancestorAccountId]);

  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of children.get(current) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      result.push(child);
      stack.push(child);
    }
  }
  return result;
}

/**
 * Enforce the subtree rule on a service-role path: throws
 * `ForbiddenError` unless `targetAccountId` is `ancestorAccountId`
 * or a descendant of it. `client` must be the service-role client
 * (RLS is bypassed here by design — this check is the guard).
 */
export async function requireSubtreeAccess(
  client: Pick<SupabaseClient, 'from'>,
  ancestorAccountId: string,
  targetAccountId: string
): Promise<void> {
  const { data, error } = await client
    .from('account_relationships')
    .select('parent_account_id, child_account_id');

  if (error) {
    console.error('[requireSubtreeAccess] relationships fetch error:', error);
    throw new ForbiddenError('Could not verify subtree access');
  }

  if (!isDescendant(data ?? [], ancestorAccountId, targetAccountId)) {
    throw new ForbiddenError(
      'Target account is not within your subtree'
    );
  }
}
