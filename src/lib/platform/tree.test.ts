import { describe, expect, it } from 'vitest';

import {
  buildAccountTree,
  countAccounts,
  type AccountRow,
} from '@/lib/platform/tree';

const ACCOUNTS: AccountRow[] = [
  { id: 'rafael', name: 'Rafael', account_type: 'PLATFORM', status: 'ACTIVE' },
  { id: 'carlos', name: 'Carlos', account_type: 'RESELLER', status: 'ACTIVE' },
  { id: 'joao', name: 'João', account_type: 'USER', status: 'ACTIVE' },
  { id: 'maria', name: 'Maria', account_type: 'USER', status: 'SUSPENDED' },
  { id: 'pedro', name: 'Pedro', account_type: 'RESELLER', status: 'ACTIVE' },
];

const EDGES = [
  { parent_account_id: 'rafael', child_account_id: 'carlos' },
  { parent_account_id: 'carlos', child_account_id: 'joao' },
  { parent_account_id: 'carlos', child_account_id: 'maria' },
  { parent_account_id: 'rafael', child_account_id: 'pedro' },
];

describe('buildAccountTree', () => {
  it('nests accounts under the PLATFORM root', () => {
    const tree = buildAccountTree(ACCOUNTS, EDGES, 'rafael');

    expect(tree).not.toBeNull();
    expect(tree!.account.name).toBe('Rafael');
    expect(tree!.children.map((c) => c.account.name).sort()).toEqual([
      'Carlos',
      'Pedro',
    ]);

    const carlos = tree!.children.find((c) => c.account.name === 'Carlos')!;
    expect(carlos.children.map((c) => c.account.name).sort()).toEqual([
      'João',
      'Maria',
    ]);
  });

  it('returns null when the root account is unknown', () => {
    expect(buildAccountTree(ACCOUNTS, EDGES, 'ghost')).toBeNull();
  });

  it('ignores edges whose children are not in the account list', () => {
    const tree = buildAccountTree(
      ACCOUNTS,
      [...EDGES, { parent_account_id: 'joao', child_account_id: 'ghost' }],
      'rafael'
    );
    expect(tree).not.toBeNull();
    expect(JSON.stringify(tree)).not.toContain('ghost');
  });
});

describe('countAccounts', () => {
  it('counts by status and type', () => {
    expect(countAccounts(ACCOUNTS, (a) => a.status === 'ACTIVE')).toBe(4);
    expect(countAccounts(ACCOUNTS, (a) => a.account_type === 'RESELLER')).toBe(
      2
    );
    expect(countAccounts(ACCOUNTS, (a) => a.status === 'BANNED')).toBe(0);
  });
});
