import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  isAccountStatus,
  isAccountType,
  requirePlatformOperator,
  toErrorResponse,
} from '@/lib/auth/account';
import { hasValidStepUp } from '@/lib/auth/step-up';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { TRIAL_DURATION_DAYS } from '@/lib/subscription/constants';

interface CreateAccountBody {
  parentAccountId?: unknown;
  name?: unknown;
  email?: unknown;
  password?: unknown;
  accountType?: unknown;
  planId?: unknown;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const PAGE_SIZE = 20;

// ------------------------------------------------------------
// GET /api/platform/accounts
// List accounts with filtering and pagination.
// ------------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    await requirePlatformOperator();

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search')?.trim() ?? '';
    const statusFilter = searchParams.get('status') ?? 'all';
    const typeFilter = searchParams.get('type') ?? 'all';
    const planFilter = searchParams.get('plan') ?? 'all';
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const pageSize = Math.min(
      100,
      Number(searchParams.get('pageSize') ?? PAGE_SIZE)
    );

    const admin = supabaseAdmin();

    // --- Plan filter: pre-resolve which account_ids have the requested plan ---
    let planAccountIds: string[] | null = null;
    if (planFilter && planFilter !== 'all') {
      const { data: planSubs } = await admin
        .from('platform_subscriptions')
        .select('account_id')
        .eq('plan_id', planFilter);
      planAccountIds = (planSubs ?? []).map((s) => s.account_id);
    }

    // Build the accounts query with optional filters
    let query = admin
      .from('accounts')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    // Search filter (name or email ILIKE)
    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    // Status filter
    if (statusFilter && statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }

    // Type filter
    if (typeFilter && typeFilter !== 'all') {
      query = query.eq('account_type', typeFilter);
    }

    // Plan filter — scope to accounts that have the requested plan
    if (planAccountIds && planAccountIds.length > 0) {
      query = query.in('id', planAccountIds);
    } else if (planAccountIds && planAccountIds.length === 0 && planFilter !== 'all') {
      // Plan filter requested but no accounts match — return empty
      return NextResponse.json({
        accounts: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0,
        plans: [],
      });
    }

    // Pagination
    query = query.range((page - 1) * pageSize, page * pageSize - 1);

    const { data: accounts, count, error } = await query;

    if (error) {
      console.error('[accounts GET] query error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch accounts' },
        { status: 500 }
      );
    }

    // Batch-load related data
    const accountIds = accounts?.map((a) => a.id) ?? [];
    const [subsRes, parentsRes] = await Promise.all([
      accountIds.length > 0
        ? admin
            .from('platform_subscriptions')
            .select('account_id, status, expires_at, plan_id')
            .in('account_id', accountIds)
        : { data: [] },
      accountIds.length > 0
        ? admin
            .from('account_relationships')
            .select('child_account_id, parent_account_id')
            .in('child_account_id', accountIds)
        : { data: [] },
    ]);

    const subMap = new Map(
      (subsRes.data ?? []).map((s) => [s.account_id, s])
    );

    // Bulk-fetch plan names
    const planIds = Array.from(subMap.values()).map((s) => s.plan_id);
    const { data: plansData } =
      planIds.length > 0
        ? await admin
            .from('platform_plans')
            .select('id, name')
            .in('id', planIds)
        : { data: [] };

    const planNameById = new Map(
      (plansData ?? []).map((p) => [p.id, p.name])
    );

    // Build enriched accounts
    const enrichedAccounts = accounts?.map((a) => {
      const sub = subMap.get(a.id);
      const rel = parentsRes.data?.find((r) => r.child_account_id === a.id);
      return {
        id: a.id,
        name: a.name ?? 'Sem nome',
        email: a.email ?? '',
        account_type: a.account_type,
        status: a.status,
        plan_name: sub ? planNameById.get(sub.plan_id ?? '') ?? null : null,
        subscription_status: sub?.status ?? null,
        expires_at: sub?.expires_at ?? null,
        created_at: a.created_at,
        last_access_at: null,
        parent_id: rel?.parent_account_id ?? null,
        quota_used: a.quota_used ?? 0,
        quota_total: a.quota_total ?? 0,
      };
    }) ?? [];

    // Fetch parent names
    const parentIds = Array.from(
      new Set(enrichedAccounts.map((a) => a.parent_id).filter(Boolean))
    );
    const { data: parentAccounts } = parentIds.length
      ? await admin.from('accounts').select('id, name').in('id', parentIds as string[])
      : { data: [] };

    const parentNameById = new Map(
      (parentAccounts ?? []).map((p) => [p.id, p.name])
    );

    const finalAccounts = enrichedAccounts.map((a) => ({
      ...a,
      parent_name: a.parent_id
        ? parentNameById.get(a.parent_id) ?? null
        : null,
      tree_depth: 0,
    }));

    // Fetch all plans for filter dropdown
    const { data: allPlans } = await admin
      .from('platform_plans')
      .select('id, name')
      .order('name');

    return NextResponse.json({
      accounts: finalAccounts,
      total: count ?? 0,
      page,
      pageSize,
      totalPages: Math.ceil((count ?? 0) / pageSize),
      plans: allPlans ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// ============================================================
// POST /api/platform/accounts
//
// Fire Control — Fase 1 "manual tree building": the operator creates
// an account (USER or RESELLER) below a parent, with a real login
// (email + password). One call creates the auth user, the account
// row, the `account_relationships` edge (tree_depth = parent + 1),
// the active `platform_subscriptions`, links the new user's profile
// to the new account, and writes the audit entry.
// ============================================================

export async function POST(request: NextRequest) {
  let body: CreateAccountBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const accountType = body.accountType;
  const parentAccountId = body.parentAccountId;
  const planId = body.planId;

  if (!name || name.length > 120) {
    return NextResponse.json(
      { error: 'A name is required (max 120 chars)' },
      { status: 400 }
    );
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: 'A valid email is required' },
      { status: 400 }
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    );
  }
  if (!isAccountType(accountType) || accountType === 'PLATFORM') {
    return NextResponse.json(
      { error: 'accountType must be USER or RESELLER' },
      { status: 400 }
    );
  }
  if (typeof parentAccountId !== 'string' || !parentAccountId) {
    return NextResponse.json(
      { error: 'A parent account is required' },
      { status: 400 }
    );
  }
  if (typeof planId !== 'string' || !planId) {
    return NextResponse.json({ error: 'A plan is required' }, { status: 400 });
  }

  try {
    const ctx = await requirePlatformOperator();

    if (!(await hasValidStepUp(request))) {
      return NextResponse.json(
        { error: 'Step-up verification required' },
        { status: 403 }
      );
    }

    const limit = checkRateLimit(
      `platform-create:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    // --- Parent -----------------------------------------------------
    const { data: parent, error: parentErr } = await ctx.supabase
      .from('accounts')
      .select('id, name, account_type, status')
      .eq('id', parentAccountId)
      .maybeSingle();
    if (parentErr || !parent) {
      return NextResponse.json(
        { error: 'Parent account not found' },
        { status: 400 }
      );
    }
    if (!isAccountStatus(parent.status) || parent.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'Parent account is not active' },
        { status: 400 }
      );
    }
    if (parent.account_type === 'USER') {
      return NextResponse.json(
        { error: 'A USER account cannot have children' },
        { status: 400 }
      );
    }

    // --- Plan -------------------------------------------------------
    const { data: plan, error: planErr } = await ctx.supabase
      .from('platform_plans')
      .select('id, code, name, account_type, is_active')
      .eq('id', planId)
      .maybeSingle();
    if (planErr || !plan || !plan.is_active) {
      return NextResponse.json(
        { error: 'Plan not found or inactive' },
        { status: 400 }
      );
    }
    if (plan.account_type !== accountType) {
      return NextResponse.json(
        { error: 'Plan does not match the account type' },
        { status: 400 }
      );
    }

    // --- Auth user --------------------------------------------------
    const { data: createdUser, error: createUserErr } =
      await ctx.supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name },
      });
    if (createUserErr) {
      if (createUserErr.status === 409 || createUserErr.code === 'email_exists') {
        return NextResponse.json(
          { error: 'Email is already registered' },
          { status: 409 }
        );
      }
      console.error('[platform-create] createUser error:', createUserErr);
      return NextResponse.json(
        { error: 'Failed to create the user' },
        { status: 500 }
      );
    }
    const userId = createdUser.user.id;

    // --- Account row ------------------------------------------------
    const { data: account, error: accountErr } = await ctx.supabase
      .from('accounts')
      .insert({ name, account_type: accountType, owner_user_id: userId })
      .select('id')
      .single();
    if (accountErr || !account) {
      console.error('[platform-create] account insert error:', accountErr);
      await cleanupUser(ctx.supabase, userId);
      return NextResponse.json(
        { error: 'Failed to create the account' },
        { status: 500 }
      );
    }
    const accountId = account.id;

    // --- Tree edge --------------------------------------------------
    const { data: parentRel } = await ctx.supabase
      .from('account_relationships')
      .select('tree_depth')
      .eq('child_account_id', parentAccountId)
      .maybeSingle();
    const childDepth = (parentRel?.tree_depth ?? 0) + 1;

    const { error: relErr } = await ctx.supabase
      .from('account_relationships')
      .insert({
        parent_account_id: parentAccountId,
        child_account_id: accountId,
        tree_depth: childDepth,
      });
    if (relErr) {
      console.error('[platform-create] relationship insert error:', relErr);
      await cleanupUser(ctx.supabase, userId);
      await cleanupAccount(ctx.supabase, accountId);
      return NextResponse.json(
        { error: 'Failed to link the account in the tree' },
        { status: 500 }
      );
    }

    // --- Subscription (inherited or trial) -------------------------------
    // Child accounts inherit the parent's subscription status (doc §4.7).
    // If the parent has no subscription, the new account starts on
    // an inherited TRIAL (7 days, matching the signup trigger in 048).
    const { data: parentSub } = await ctx.supabase
      .from('platform_subscriptions')
      .select('status, expires_at, plan_id')
      .eq('account_id', parentAccountId)
      .order('created_at', { ascending: false })
      .maybeSingle();

    const trialDays = TRIAL_DURATION_DAYS;
    const inheritedStatus = parentSub?.status ?? 'TRIAL';
    const inheritedExpires =
      parentSub?.expires_at ??
      new Date(Date.now() + trialDays * 86400000).toISOString();

    const { error: subErr } = await ctx.supabase
      .from('platform_subscriptions')
      .insert({
        account_id: accountId,
        plan_id: plan.id,
        status: inheritedStatus,
        started_at: new Date().toISOString(),
        expires_at: inheritedExpires,
      });
    if (subErr) {
      console.error('[platform-create] subscription insert error:', subErr);
      await cleanupUser(ctx.supabase, userId);
      await cleanupAccount(ctx.supabase, accountId);
      return NextResponse.json(
        { error: 'Failed to create the subscription' },
        { status: 500 }
      );
    }

    // --- Move the new user's profile onto the account ----------------
    const { error: profileErr } = await ctx.supabase
      .from('profiles')
      .update({
        account_id: accountId,
        account_role: 'owner',
        full_name: name,
      })
      .eq('user_id', userId);
    if (profileErr) {
      console.error('[platform-create] profile update error:', profileErr);
      await cleanupUser(ctx.supabase, userId);
      await cleanupAccount(ctx.supabase, accountId);
      return NextResponse.json(
        { error: 'Failed to attach the user to the account' },
        { status: 500 }
      );
    }

    // --- Remove the trigger-created personal account ------------------
    const { data: stray, error: strayErr } = await ctx.supabase
      .from('accounts')
      .select('id')
      .eq('owner_user_id', userId)
      .neq('id', accountId)
      .maybeSingle();
    if (!strayErr && stray) {
      const { error: delErr } = await ctx.supabase
        .from('accounts')
        .delete()
        .eq('id', stray.id);
      if (delErr) {
        console.error(
          '[platform-create] stray account cleanup failed:',
          delErr
        );
      }
    }

    // --- Audit -------------------------------------------------------
    await ctx.supabase.from('audit_logs').insert({
      actor_user_id: ctx.userId,
      actor_account_id: ctx.accountId,
      action: 'ACCOUNT_CREATED',
      target_account_id: accountId,
      metadata: {
        name,
        account_type: accountType,
        parent_account_id: parentAccountId,
        plan_code: plan.code,
        tree_depth: childDepth,
      },
    });

    return NextResponse.json({ accountId }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

async function cleanupUser(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    console.error('[platform-create] user rollback failed:', error);
  }
}

async function cleanupAccount(
  supabase: SupabaseClient,
  accountId: string
): Promise<void> {
  const { error } = await supabase
    .from('accounts')
    .delete()
    .eq('id', accountId);
  if (error) {
    console.error('[platform-create] account rollback failed:', error);
  }
}
