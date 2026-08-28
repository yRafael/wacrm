import { afterEach, describe, expect, it, vi } from 'vitest';

// getCurrentAccount resolves the caller's account context. The
// regression this file guards (issue #294): account loading must NOT
// depend on a PostgREST embedded FK join (`accounts!inner`), because a
// stale schema cache makes that embed fail hard and blanks the whole
// context. It must instead read the profile and then the account with
// two plain point queries. Since migration 046 the account read also
// carries `status` and `account_type`, and a non-ACTIVE account is
// blocked here (the §5.7 status gate).

// ------------------------------------------------------------
// Chainable Supabase query-builder mock. Each `.from(table)` hands back
// a thenable builder pre-loaded with the result queued for that table,
// so we can assert which tables were queried and with what filters.
// ------------------------------------------------------------
interface BuilderCall {
  table: string;
  columns?: string;
  eqArgs: [string, unknown][];
}

function makeClient(opts: {
  user: { id: string } | null;
  userErr?: unknown;
  byTable: Record<string, { data: unknown; error: unknown }>;
}) {
  const calls: BuilderCall[] = [];

  const from = (table: string) => {
    const call: BuilderCall = { table, eqArgs: [] };
    calls.push(call);
    const builder = {
      select(columns: string) {
        call.columns = columns;
        return builder;
      },
      eq(col: string, val: unknown) {
        call.eqArgs.push([col, val]);
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(
          opts.byTable[table] ?? { data: null, error: null }
        );
      },
    };
    return builder;
  };

  return {
    calls,
    client: {
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: opts.user },
            error: opts.userErr ?? null,
          }),
      },
      from,
    },
  };
}

const createClient = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClient(),
}));

const supabaseAdmin = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => supabaseAdmin(),
}));

const checkSubscription = vi.fn().mockResolvedValue({
  hasAccess: true,
  status: 'ACTIVE',
  expiresAt: null,
  planName: null,
  blockReason: null,
  isTrial: false,
});
vi.mock('@/lib/subscription/gating', () => ({
  checkSubscription: (...args: unknown[]) => checkSubscription(...args),
}));

const { getCurrentAccount, requirePlatformOperator, UnauthorizedError, ForbiddenError } =
  await import('./account');

afterEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps implementations; reset the admin-client stub so
  // a previous requirePlatformOperator test can't leak its return value.
  supabaseAdmin.mockReset();
  // Restore default subscription check (active, no blocking).
  checkSubscription.mockResolvedValue({
    hasAccess: true,
    status: 'ACTIVE',
    expiresAt: null,
    planName: null,
    blockReason: null,
    isTrial: false,
  });
});

describe('getCurrentAccount', () => {
  it('resolves context via a plain accounts lookup, not an embedded join', async () => {
    const { client, calls } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: {
            account_id: 'acct-1',
            account_role: 'owner',
            is_platform_operator: false,
          },
          error: null,
        },
        accounts: {
          data: {
            id: 'acct-1',
            name: 'Acme',
            status: 'ACTIVE',
            account_type: 'USER',
          },
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();

    expect(ctx).toMatchObject({
      userId: 'user-1',
      accountId: 'acct-1',
      role: 'owner',
      account: {
        id: 'acct-1',
        name: 'Acme',
        status: 'ACTIVE',
        account_type: 'USER',
      },
    });

    // Two queries: profiles by user_id, then accounts by id. Neither
    // selects an embedded relationship — the regression guard.
    expect(calls.map((c) => c.table)).toEqual(['profiles', 'accounts']);
    expect(calls[0].columns).not.toMatch(/accounts!/);
    expect(calls[0].eqArgs).toEqual([['user_id', 'user-1']]);
    expect(calls[1].columns).not.toMatch(/accounts!/);
    expect(calls[1].eqArgs).toEqual([['id', 'acct-1']]);
  });

  it('throws UnauthorizedError when there is no session', async () => {
    const { client } = makeClient({ user: null, byTable: {} });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("maps a profiles query error to 'Could not load account context'", async () => {
    const { client } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: { data: null, error: { code: 'PGRST200' } },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      'Could not load account context'
    );
  });

  it("maps an accounts query error to 'Could not load account context'", async () => {
    // The exact #294 shape if the embed were still in play, but now on
    // the decoupled accounts lookup: profile resolves, account read errors.
    const { client } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: {
            account_id: 'acct-1',
            account_role: 'admin',
            is_platform_operator: false,
          },
          error: null,
        },
        accounts: { data: null, error: { code: 'PGRST200' } },
      },
    });
    createClient.mockReturnValue(client);
    const err = await getCurrentAccount().catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toBe('Could not load account context');
  });

  it('rejects a profile not linked to an account', async () => {
    const { client } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: { account_id: null, account_role: null },
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      'Profile is not linked to an account'
    );
  });

  it('rejects an account_id that resolves to no readable account', async () => {
    const { client } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: {
            account_id: 'acct-1',
            account_role: 'viewer',
            is_platform_operator: false,
          },
          error: null,
        },
        accounts: { data: null, error: null },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      'Profile is not linked to an account'
    );
  });

  it('blocks a SUSPENDED account (status gate §5.7)', async () => {
    const { client } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: {
            account_id: 'acct-1',
            account_role: 'owner',
            is_platform_operator: false,
          },
          error: null,
        },
        accounts: {
          data: {
            id: 'acct-1',
            name: 'Acme',
            status: 'SUSPENDED',
            account_type: 'USER',
          },
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);
    const err = await getCurrentAccount().catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toBe('This account is suspended or banned');
  });

  it('blocks a BANNED account (status gate §5.7)', async () => {
    const { client } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: {
            account_id: 'acct-1',
            account_role: 'viewer',
            is_platform_operator: false,
          },
          error: null,
        },
        accounts: {
          data: {
            id: 'acct-1',
            name: 'Acme',
            status: 'BANNED',
            account_type: 'USER',
          },
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      'This account is suspended or banned'
    );
  });
});

describe('requirePlatformOperator', () => {
  function operatorClient() {
    return makeClient({
      user: { id: 'user-op' },
      byTable: {
        profiles: {
          data: {
            account_id: 'acct-root',
            account_role: 'owner',
            is_platform_operator: true,
          },
          error: null,
        },
        accounts: {
          data: {
            id: 'acct-root',
            name: 'Fire Play',
            status: 'ACTIVE',
            account_type: 'PLATFORM',
          },
          error: null,
        },
      },
    });
  }

  it('resolves a platform operator with the service-role client', async () => {
    const { client } = operatorClient();
    createClient.mockReturnValue(client);
    supabaseAdmin.mockReturnValue({ __isMockAdminClient: true });

    const ctx = await requirePlatformOperator();

    expect(ctx).toMatchObject({
      userId: 'user-op',
      accountId: 'acct-root',
      account: { account_type: 'PLATFORM', status: 'ACTIVE' },
    });
    // Fire Control reads the whole tree → service-role client.
    expect(ctx.supabase).toEqual({ __isMockAdminClient: true });
  });

  it('forbids a non-operator even when authenticated', async () => {
    const { client } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: {
            account_id: 'acct-1',
            account_role: 'owner',
            is_platform_operator: false,
          },
          error: null,
        },
        accounts: {
          data: {
            id: 'acct-1',
            name: 'Acme',
            status: 'ACTIVE',
            account_type: 'USER',
          },
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);

    const err = await requirePlatformOperator().catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toBe('This action requires a platform operator');
  });

  it('forbids a suspended operator account via the status gate', async () => {
    const { client } = makeClient({
      user: { id: 'user-op' },
      byTable: {
        profiles: {
          data: {
            account_id: 'acct-root',
            account_role: 'owner',
            is_platform_operator: true,
          },
          error: null,
        },
        accounts: {
          data: {
            id: 'acct-root',
            name: 'Fire Play',
            status: 'SUSPENDED',
            account_type: 'PLATFORM',
          },
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);
    await expect(requirePlatformOperator()).rejects.toThrow(
      'This account is suspended or banned'
    );
  });
});
