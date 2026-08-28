import { afterEach, describe, expect, it, vi } from 'vitest';

// The doc §5.6 IDOR/BOLA matrix, enforced in code. The database half
// (`is_account_in_subtree`) runs in Postgres; this file unit-tests the
// code-side half that `requireSubtreeAccess` uses on service-role paths.

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: vi.fn(),
}));

const { isDescendant, listDescendants, requireSubtreeAccess } =
  await import('./subtree');
const { ForbiddenError } = await import('./account');

// Tree under test (doc §4.2 / §5.4 example):
//
//   Rafael (raiz, PLATFORM)
//    ├── Carlos   → depth 1
//    │    ├── João    → depth 2
//    │    └── Maria   → depth 2
//    └── Pedro    → depth 1
//         └── Ana     → depth 2
const EDGES = [
  { parent_account_id: 'rafael', child_account_id: 'carlos' },
  { parent_account_id: 'carlos', child_account_id: 'joao' },
  { parent_account_id: 'carlos', child_account_id: 'maria' },
  { parent_account_id: 'rafael', child_account_id: 'pedro' },
  { parent_account_id: 'pedro', child_account_id: 'ana' },
];

afterEach(() => vi.clearAllMocks());

describe('isDescendant — IDOR/BOLA matrix (§5.6)', () => {
  it('allows Carlos reading/editing João (son)', () => {
    expect(isDescendant(EDGES, 'carlos', 'joao')).toBe(true);
  });

  it('allows Carlos reading/editing Maria (daughter)', () => {
    expect(isDescendant(EDGES, 'carlos', 'maria')).toBe(true);
  });

  it('forbids Carlos reading/editing Pedro (sibling)', () => {
    expect(isDescendant(EDGES, 'carlos', 'pedro')).toBe(false);
  });

  it('forbids Carlos reading/editing Ana (Pedro\'s daughter)', () => {
    expect(isDescendant(EDGES, 'carlos', 'ana')).toBe(false);
  });

  it('forbids Carlos reading/editing Rafael (ancestor)', () => {
    expect(isDescendant(EDGES, 'carlos', 'rafael')).toBe(false);
  });

  it('forbids Pedro reading/editing Carlos (other branch)', () => {
    expect(isDescendant(EDGES, 'pedro', 'carlos')).toBe(false);
  });

  it('allows an account to act on itself', () => {
    expect(isDescendant(EDGES, 'carlos', 'carlos')).toBe(true);
  });

  it('forbids an unknown target id', () => {
    expect(isDescendant(EDGES, 'carlos', 'invented-uuid')).toBe(false);
  });
});

describe('listDescendants', () => {
  it('returns every node strictly below the ancestor', () => {
    expect(listDescendants(EDGES, 'rafael').sort()).toEqual([
      'ana',
      'carlos',
      'joao',
      'maria',
      'pedro',
    ]);
  });

  it('returns a leaf subtree with only its own children', () => {
    expect(listDescendants(EDGES, 'carlos').sort()).toEqual(['joao', 'maria']);
  });
});

describe('requireSubtreeAccess', () => {
  function clientFrom(edges: typeof EDGES) {
    return {
      from: () => ({
        select: () => Promise.resolve({ data: edges, error: null }),
      }),
    } as never;
  }

  it('resolves when the target is in the subtree', async () => {
    await expect(
      requireSubtreeAccess(clientFrom(EDGES), 'carlos', 'joao')
    ).resolves.toBeUndefined();
  });

  it('throws ForbiddenError for a sibling branch', async () => {
    const err = await requireSubtreeAccess(clientFrom(EDGES), 'carlos', 'ana')
      .catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toBe('Target account is not within your subtree');
  });

  it('throws ForbiddenError for an ancestor', async () => {
    await expect(
      requireSubtreeAccess(clientFrom(EDGES), 'carlos', 'rafael')
    ).rejects.toThrow('Target account is not within your subtree');
  });

  it('throws ForbiddenError when the relationships fetch fails', async () => {
    const broken = {
      from: () => ({
        select: () => Promise.resolve({ data: null, error: { code: 'boom' } }),
      }),
    } as never;
    await expect(
      requireSubtreeAccess(broken, 'carlos', 'joao')
    ).rejects.toThrow('Could not verify subtree access');
  });
});
