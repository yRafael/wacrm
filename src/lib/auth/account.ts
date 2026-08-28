// ============================================================
// Server-side account context — for API routes and server
// components. Reads the caller's profile + account in one round
// trip and verifies role on demand.
//
// IMPORTANT: this module is server-only. It imports the Supabase
// SSR client (`@/lib/supabase/server`), which reads `next/headers`
// cookies. Importing it from a client component will fail at
// build time with the standard Next.js "You're importing a
// component that needs `next/headers`" error — that's the
// boundary check; we don't need the `server-only` package.
//
// Calling convention
// ------------------
// API routes don't need to redo `supabase.auth.getUser()` — they
// receive a fully-loaded context from `requireRole`:
//
//   try {
//     const ctx = await requireRole("admin");
//     // ctx.supabase — the SSR client (RLS scoped to this user)
//     // ctx.userId  — auth.uid()
//     // ctx.accountId / ctx.role / ctx.account
//   } catch (err) {
//     return errorResponse(err); // see toErrorResponse() below
//   }
// ============================================================

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { hasMinRole, isAccountRole, type AccountRole } from './roles';
import {
  checkSubscription,
  type SubscriptionCheck,
} from '@/lib/subscription/gating';
import { logServerSecurityEvent } from '@/lib/security/log-event-server';

// ------------------------------------------------------------
// Platform account types & statuses
//
// Mirrors migration 046: `accounts.account_type`
// (USER / RESELLER / PLATFORM) and `accounts.status`
// (ACTIVE / SUSPENDED / BANNED). `account_type` classifies the
// account in the reseller tree and is orthogonal to the internal
// `account_role` (owner/admin/agent/viewer). `status` gates who can
// actually use the system (§5.7).
// ------------------------------------------------------------

export const ACCOUNT_TYPES = ['USER', 'RESELLER', 'PLATFORM'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_STATUSES = ['ACTIVE', 'SUSPENDED', 'BANNED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export function isAccountType(value: unknown): value is AccountType {
  return (
    typeof value === 'string' &&
    (ACCOUNT_TYPES as readonly string[]).includes(value)
  );
}

export function isAccountStatus(value: unknown): value is AccountStatus {
  return (
    typeof value === 'string' &&
    (ACCOUNT_STATUSES as readonly string[]).includes(value)
  );
}

// ------------------------------------------------------------
// Errors
//
// Custom classes so API routes can map a single `catch` to the
// right HTTP status without sprinkling 401/403 strings everywhere.
// ------------------------------------------------------------

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Convert one of the typed errors above (or anything else) into a
 * `NextResponse`. Routes can do:
 *
 *   } catch (err) {
 *     return toErrorResponse(err);
 *   }
 *
 * Unknown errors collapse to 500 with the generic message — we
 * never leak `err.message` for non-classified errors to keep
 * server internals out of the wire.
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error('[toErrorResponse] uncategorized error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

// ------------------------------------------------------------
// Account context
// ------------------------------------------------------------

export interface AccountContext {
  /** Supabase SSR client, RLS scoped to the calling user. */
  supabase: SupabaseClient;
  /** `auth.uid()` for the caller. Always defined when this resolves. */
  userId: string;
  /** Caller's account_id from their profile row. */
  accountId: string;
  /** Caller's role within their account. */
  role: AccountRole;
  /** Lightweight account meta — id + name + platform classification. */
  account: {
    id: string;
    name: string;
    status: AccountStatus;
    account_type: AccountType;
  };
  /** Subscription check result — callers can use this to gate features. */
  subscription: SubscriptionCheck;
}

/**
 * Resolve the caller's user + account + role in one round trip.
 *
 * Throws `UnauthorizedError` if there's no Supabase session.
 * Throws `ForbiddenError` if the profile is missing account
 * fields (shouldn't happen post-017 migration; defensive guard
 * against profile rows that pre-date the backfill or were
 * inserted by hand).
 * Throws `ForbiddenError` if the account is not ACTIVE — status
 * blocking at the dashboard entry point (§5.7).
 *
 * Use `requireRole(min)` instead when the route also needs a
 * minimum-role check — it's a thin wrapper over this.
 */
export async function getCurrentAccount(): Promise<AccountContext> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new UnauthorizedError();
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('[getCurrentAccount] profile fetch error:', error);
    throw new ForbiddenError('Could not load account context');
  }
  if (!data || !data.account_id || !data.account_role) {
    // Pre-migration profile, or a manual insert that skipped the
    // signup trigger. The user is authenticated but the app has
    // no way to scope their queries — treat as forbidden.
    throw new ForbiddenError('Profile is not linked to an account');
  }
  if (!isAccountRole(data.account_role)) {
    // The DB enum should make this impossible, but a future
    // migration that broadens the enum without updating TS would
    // hit this — surface it rather than silently widening.
    throw new ForbiddenError(`Unknown account role: ${data.account_role}`);
  }

  // Load the account with a plain point lookup by id rather than an
  // embedded FK join (`account:accounts!inner(...)`). The embed forces
  // PostgREST to resolve the profiles.account_id → accounts.id
  // relationship from its schema cache; when that cache is stale — a
  // common Supabase state right after a migration adds the FK, or when
  // migrations are applied out of band — the embed fails hard with
  // PGRST200 ("could not find a relationship … in the schema cache")
  // and takes down the entire account context (issue #294). A lookup by
  // id needs no relationship inference and is gated by the same accounts
  // RLS, so it stays robust against cache staleness and older schemas.
  const { data: account, error: accountErr } = await supabase
    .from('accounts')
    .select('id, name, status, account_type')
    .eq('id', data.account_id)
    .maybeSingle();

  if (accountErr) {
    console.error('[getCurrentAccount] account fetch error:', accountErr);
    throw new ForbiddenError('Could not load account context');
  }
  if (!account) {
    // account_id points at no readable account row — orphaned profile
    // or an RLS gap. Same "can't scope this user" outcome as above.
    throw new ForbiddenError('Profile is not linked to an account');
  }

  // Status blocking (§5.7) — a SUSPENDED/BANNED account can't operate
  // the system, no matter how valid its session is. This is the
  // dashboard entry point; requireApiKey covers the public API and
  // requirePlatformOperator the Fire Control.
  if (!isAccountStatus(account.status) || account.status !== 'ACTIVE') {
    logServerSecurityEvent({
      action: 'SECURITY_SUSPICIOUS_REQUEST',
      actorUserId: user.id,
      actorAccountId: data.account_id,
      metadata: {
        reason: 'account_not_active',
        accountStatus: account.status,
      },
    });
    throw new ForbiddenError('This account is suspended or banned');
  }

  // Subscription gating (§4) — blocked subscription statuses
  // (SUSPENDED, CANCELED, EXPIRED) prevent workspace access. This is
  // checked here at the dashboard entry point so every downstream route
  // can trust that the caller has an active subscription.
  const subscription = await checkSubscription(supabaseAdmin(), data.account_id);
  if (!subscription.hasAccess) {
    logServerSecurityEvent({
      action: 'SECURITY_SUBSCRIPTION_BYPASS_ATTEMPT',
      actorUserId: user.id,
      actorAccountId: data.account_id,
      metadata: {
        subscriptionStatus: subscription.status,
        blockReason: subscription.blockReason,
      },
    });
    throw new ForbiddenError(
      subscription.blockReason ?? 'Subscription required'
    );
  }

  return {
    supabase,
    userId: user.id,
    accountId: data.account_id,
    role: data.account_role,
    account: {
      id: account.id,
      name: account.name,
      status: account.status,
      account_type: account.account_type,
    },
    subscription,
  };
}

/**
 * Resolve the caller's account context and enforce a minimum role.
 *
 * Throws `UnauthorizedError` / `ForbiddenError` as documented on
 * `getCurrentAccount`, plus `ForbiddenError("Insufficient role")`
 * when the caller is below `min`.
 */
export async function requireRole(min: AccountRole): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (!hasMinRole(ctx.role, min)) {
    throw new ForbiddenError(
      `This action requires the '${min}' role or higher`
    );
  }
  return ctx;
}

// ------------------------------------------------------------
// Platform operator (Fire Control)
// ------------------------------------------------------------

/**
 * Context resolved for a *platform operator* — the sole person who
 * opens the Fire Control. Unlike `AccountContext`, `supabase` here is
 * the service-role client: the operator legitimately sees the WHOLE
 * reseller tree, so RLS (which scopes to one account) is bypassed and
 * every read must be explicitly scoped by the route. The operator flag
 * lives in the database (`profiles.is_platform_operator`), never in an
 * env var — flipping a flag in the DB is the entire switch.
 */
export interface PlatformOperatorContext {
  /** Service-role client — whole-tree reads; scope queries explicitly. */
  supabase: SupabaseClient;
  /** `auth.uid()` of the operator. */
  userId: string;
  /** The operator's own account — the PLATFORM root. */
  accountId: string;
  account: {
    id: string;
    name: string;
    status: AccountStatus;
    account_type: AccountType;
  };
}

/**
 * Resolve the caller as a platform operator. Runs the full
 * `getCurrentAccount()` path (auth + account + status blocking) and
 * then verifies `profiles.is_platform_operator`. Throws
 * `UnauthorizedError` / `ForbiddenError` exactly like the other
 * guards, so routes can `catch (err) { return toErrorResponse(err) }`.
 *
 * The authorization decision lives here, in the backend — never in
 * the frontend or in a URL check (doc §2.4).
 */
export async function requirePlatformOperator(): Promise<PlatformOperatorContext> {
  // Authenticates + loads account + blocks non-ACTIVE accounts.
  const ctx = await getCurrentAccount();

  const { data, error } = await ctx.supabase
    .from('profiles')
    .select('is_platform_operator')
    .eq('user_id', ctx.userId)
    .maybeSingle();

  if (error) {
    console.error(
      '[requirePlatformOperator] profile fetch error:',
      error
    );
    throw new ForbiddenError('Could not verify platform operator');
  }
  if (!data?.is_platform_operator) {
    throw new ForbiddenError('This action requires a platform operator');
  }

  return {
    supabase: supabaseAdmin(),
    userId: ctx.userId,
    accountId: ctx.accountId,
    account: ctx.account,
  };
}
