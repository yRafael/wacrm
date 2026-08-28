// ============================================================
// Platform tree — pure helpers to shape the reseller tree for the
// Fire Control read-only view.
//
// No I/O here: the page passes in the raw `accounts` rows and
// `account_relationships` edges (already fetched via the service-role
// client) and gets back a nested tree rooted at the PLATFORM account.
// Kept pure so the shape logic is unit-testable.
// ============================================================

export interface AccountRow {
  id: string;
  name: string;
  account_type: string;
  status: string;
  created_at?: string;
}

export interface TreeEdge {
  parent_account_id: string;
  child_account_id: string;
}

export interface AccountTreeNode {
  account: AccountRow;
  /** Subscription plan name (denormalised for display), if any. */
  planName: string | null;
  children: AccountTreeNode[];
}

/**
 * Nest `accounts` under their parents using `edges`, starting at
 * `rootId`. Returns null when `rootId` doesn't match any account
 * (e.g. no PLATFORM account exists yet). Children of accounts that
 * don't exist are dropped — the DB guarantees valid FKs, but a
 * partially-applied migration shouldn't crash the render.
 */
export function buildAccountTree(
  accounts: AccountRow[],
  edges: TreeEdge[],
  rootId: string
): AccountTreeNode | null {
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const childrenByParent = new Map<string, string[]>();
  for (const edge of edges) {
    const list = childrenByParent.get(edge.parent_account_id) ?? [];
    list.push(edge.child_account_id);
    childrenByParent.set(edge.parent_account_id, list);
  }

  function visit(id: string, seen: Set<string>): AccountTreeNode | null {
    if (seen.has(id)) return null; // cycle guard — the DB can't create these
    const row = byId.get(id);
    if (!row) return null;

    const nextSeen = new Set(seen).add(id);
    const children = (childrenByParent.get(id) ?? [])
      .map((childId) => visit(childId, nextSeen))
      .filter((n): n is AccountTreeNode => n !== null);

    return { account: row, planName: null, children };
  }

  if (!byId.has(rootId)) return null;
  return visit(rootId, new Set());
}

/** Count accounts across the tree by a predicate (status / type). */
export function countAccounts(
  accounts: AccountRow[],
  predicate: (a: AccountRow) => boolean
): number {
  return accounts.filter(predicate).length;
}
