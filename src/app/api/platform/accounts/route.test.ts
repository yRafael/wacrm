import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ForbiddenError } from '@/lib/auth/account';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

// ---------------------------------------------------------------------------
// POST /api/platform/accounts — Fire Control tree building.
// The route must: gate on operator + step-up grant, validate parent/plan
// against the requested type, create the auth user, account, edge (depth =
// parent + 1), subscription, move the user's profile onto the account,
// delete the trigger-created personal account, and write the audit entry.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown> | null;

// Per (table, op) scripted responses; shift() consumes them in order.
const queue: Record<string, Row[]> = {};
const inserts: Record<string, Array<Record<string, unknown>>> = {};
const updates: Record<string, Array<Record<string, unknown>>> = {};

let operatorThrows: Error | null = null;
let stepUpValid = true;
let createUserError: { status?: number; code?: string; message: string } | null = null;

function shift(op: string, table: string): { data: Row; error: null } {
  const key = `${op}:${table}`;
  const next = (queue[key] ?? []).shift();
  return { data: next ?? null, error: null };
}

function makeSupabaseMock() {
  function builder(table: string) {
    let op: 'select' | 'insert' | 'update' | 'delete' | null = null;
    const b: Record<string, unknown> = {};
    const chain = () => b;

    b.select = chain;
    b.eq = chain;
    b.neq = chain;
    b.order = chain;
    b.range = chain;

    b.insert = vi.fn((payload: Record<string, unknown>) => {
      op = 'insert';
      (inserts[table] ??= []).push(payload);
      return b;
    });
    b.update = vi.fn((payload: Record<string, unknown>) => {
      op = 'update';
      (updates[table] ??= []).push(payload);
      return b;
    });
    b.delete = chain;

    const terminal = () => shift(op ?? 'select', table);
    b.maybeSingle = vi.fn(terminal);
    b.single = vi.fn(terminal);
    b.then = (resolve: (v: { data: Row; error: null }) => unknown) =>
      resolve(shift(op ?? 'select', table));

    return b;
  }

  return {
    from: vi.fn(builder),
    auth: {
      admin: {
        createUser: vi.fn(async () => {
          if (createUserError) return { data: null, error: createUserError };
          return { data: { user: { id: 'new-user-1' } }, error: null };
        }),
        deleteUser: vi.fn(async () => ({ data: null, error: null })),
      },
    },
  };
}

const operatorCtx = {
  supabase: makeSupabaseMock(),
  userId: 'op-user',
  accountId: 'op-account',
};

// Mock the operator gate and the step-up grant; keep the pure guards real.
vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return {
    ...actual,
    requirePlatformOperator: vi.fn(async () => {
      if (operatorThrows) throw operatorThrows;
      return operatorCtx;
    }),
  };
});
vi.mock('@/lib/auth/step-up', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/step-up')>();
  return {
    ...actual,
    hasValidStepUp: vi.fn(async () => stepUpValid),
  };
});

const { POST } = await import('./route');

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest('http://app.test/api/platform/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

const VALID = {
  parentAccountId: 'parent-1',
  name: 'Carlos Silva',
  email: 'carlos@example.com',
  password: 'segredo123',
  accountType: 'RESELLER',
  planId: 'plan-1',
};

beforeEach(() => {
  operatorThrows = null;
  stepUpValid = true;
  createUserError = null;
  __resetRateLimitForTests();
  for (const k of Object.keys(queue)) delete queue[k];
  for (const k of Object.keys(inserts)) delete inserts[k];
  for (const k of Object.keys(updates)) delete updates[k];

  // Reset the builder chain each test so queue/insert recording is fresh.
  operatorCtx.supabase = makeSupabaseMock();
});

afterEach(() => vi.clearAllMocks());

describe('POST /api/platform/accounts — guards', () => {
  it('rejects a non-operator with 403', async () => {
    operatorThrows = new ForbiddenError('This action requires a platform operator');
    const res = await post(VALID);
    expect(res.status).toBe(403);
  });

  it('rejects a caller without a step-up grant with 403', async () => {
    stepUpValid = false;
    const res = await post(VALID);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'Step-up verification required' });
  });

  it.each([
    ['missing name', { ...VALID, name: '   ' }],
    ['bad email', { ...VALID, email: 'not-an-email' }],
    ['short password', { ...VALID, password: '1234567' }],
    ['bad type', { ...VALID, accountType: 'PLATFORM' }],
    ['missing parent', { ...VALID, parentAccountId: '' }],
    ['missing plan', { ...VALID, planId: '' }],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/platform/accounts — validations', () => {
  it('rejects an unknown parent', async () => {
    // accounts select queue returns null for the parent lookup.
    queue['select:accounts'] = [null];
    const res = await post(VALID);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Parent account not found' });
  });

  it('rejects a USER parent (no children)', async () => {
    queue['select:accounts'] = [{ id: 'parent-1', account_type: 'USER', status: 'ACTIVE' }];
    const res = await post(VALID);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'A USER account cannot have children',
    });
  });

  it('rejects an inactive parent', async () => {
    queue['select:accounts'] = [{ id: 'parent-1', account_type: 'RESELLER', status: 'BANNED' }];
    const res = await post(VALID);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Parent account is not active' });
  });

  it('rejects a plan that does not match the requested type', async () => {
    queue['select:accounts'] = [{ id: 'parent-1', account_type: 'RESELLER', status: 'ACTIVE' }];
    queue['select:platform_plans'] = [
      { id: 'plan-1', code: 'fire_user', account_type: 'USER', is_active: true },
    ];
    const res = await post(VALID);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'Plan does not match the account type',
    });
  });

  it('rejects an inactive plan', async () => {
    queue['select:accounts'] = [{ id: 'parent-1', account_type: 'RESELLER', status: 'ACTIVE' }];
    queue['select:platform_plans'] = [
      { id: 'plan-1', code: 'fire_reseller', account_type: 'RESELLER', is_active: false },
    ];
    const res = await post(VALID);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Plan not found or inactive' });
  });
});

describe('POST /api/platform/accounts — creation', () => {
  it('returns 409 when the email is already registered', async () => {
    queue['select:accounts'] = [{ id: 'parent-1', account_type: 'RESELLER', status: 'ACTIVE' }];
    queue['select:platform_plans'] = [
      { id: 'plan-1', code: 'fire_reseller', account_type: 'RESELLER', is_active: true },
    ];
    createUserError = { status: 409, code: 'email_exists', message: 'already registered' };

    const res = await post(VALID);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'Email is already registered' });
  });

  it('creates account, edge (parent depth + 1), subscription and audit', async () => {
    const supabase = operatorCtx.supabase;
    queue['select:accounts'] = [
      { id: 'parent-1', account_type: 'RESELLER', status: 'ACTIVE' },
      null, // stray lookup: no trigger-created account
    ];
    queue['select:platform_plans'] = [
      { id: 'plan-1', code: 'fire_reseller', account_type: 'RESELLER', is_active: true },
    ];
    queue['insert:accounts'] = [{ id: 'new-account-1' }];
    queue['select:account_relationships'] = [{ tree_depth: 2 }]; // parent depth
    queue['insert:account_relationships'] = [{}];
    // Parent's subscription (TRIAL, no expiry → inherits trial)
    queue['select:platform_subscriptions'] = [null]; // no parent subscription
    queue['insert:platform_subscriptions'] = [{}];
    queue['update:profiles'] = [{}];
    queue['delete:accounts'] = [{}];
    queue['insert:audit_logs'] = [{}];

    const res = await post(VALID);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ accountId: 'new-account-1' });

    // Auth user with confirmed email + metadata.
    expect(supabase.auth.admin.createUser).toHaveBeenCalledWith({
      email: 'carlos@example.com',
      password: 'segredo123',
      email_confirm: true,
      user_metadata: { full_name: 'Carlos Silva' },
    });

    // Account row with the requested type + owner.
    expect(inserts['accounts'][0]).toMatchObject({
      name: 'Carlos Silva',
      account_type: 'RESELLER',
      owner_user_id: 'new-user-1',
    });

    // Edge inherits parent depth + 1 (2 → 3).
    expect(inserts['account_relationships'][0]).toEqual({
      parent_account_id: 'parent-1',
      child_account_id: 'new-account-1',
      tree_depth: 3,
    });

    expect(inserts['platform_subscriptions'][0]).toMatchObject({
      account_id: 'new-account-1',
      plan_id: 'plan-1',
      status: 'TRIAL', // inherited: parent has no sub → starts on trial
      started_at: expect.any(String),
      expires_at: expect.any(String),
    });

    // Profile moved onto the new account.
    expect(updates['profiles'][0]).toMatchObject({
      account_id: 'new-account-1',
      account_role: 'owner',
      full_name: 'Carlos Silva',
    });

    // Audit entry with actor + target + metadata.
    expect(inserts['audit_logs'][0]).toMatchObject({
      actor_user_id: 'op-user',
      actor_account_id: 'op-account',
      action: 'ACCOUNT_CREATED',
      target_account_id: 'new-account-1',
      metadata: expect.objectContaining({
        account_type: 'RESELLER',
        parent_account_id: 'parent-1',
        plan_code: 'fire_reseller',
        tree_depth: 3,
      }),
    });
  });

  it('deletes the trigger-created personal account when one exists', async () => {
    const supabase = operatorCtx.supabase;
    queue['select:accounts'] = [
      { id: 'parent-1', account_type: 'RESELLER', status: 'ACTIVE' },
      { id: 'stray-account' }, // handle_new_user personal account
    ];
    queue['select:platform_plans'] = [
      { id: 'plan-1', code: 'fire_reseller', account_type: 'RESELLER', is_active: true },
    ];
    queue['insert:accounts'] = [{ id: 'new-account-1' }];
    queue['select:account_relationships'] = [null]; // parent is root
    queue['insert:account_relationships'] = [{}];
    queue['select:platform_subscriptions'] = [null]; // no parent sub → trial
    queue['insert:platform_subscriptions'] = [{}];
    queue['update:profiles'] = [{}];
    queue['delete:accounts'] = [{}];
    queue['insert:audit_logs'] = [{}];

    const res = await post(VALID);
    expect(res.status).toBe(201);

    const deleteCall = supabase.from.mock.calls.find(([t]) => t === 'accounts');
    expect(deleteCall).toBeTruthy();
    expect(inserts['account_relationships'][0]).toEqual({
      parent_account_id: 'parent-1',
      child_account_id: 'new-account-1',
      tree_depth: 1, // root parent → depth 1
    });
  });

  it('rolls back the user when the account insert fails', async () => {
    const supabase = operatorCtx.supabase;
    queue['select:accounts'] = [{ id: 'parent-1', account_type: 'RESELLER', status: 'ACTIVE' }];
    queue['select:platform_plans'] = [
      { id: 'plan-1', code: 'fire_reseller', account_type: 'RESELLER', is_active: true },
    ];
    // account insert returns no row → route treats as failure.
    queue['insert:accounts'] = [null];

    const res = await post(VALID);
    expect(res.status).toBe(500);
    expect(supabase.auth.admin.deleteUser).toHaveBeenCalledWith('new-user-1');
  });
});