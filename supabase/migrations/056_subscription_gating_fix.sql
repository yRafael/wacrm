-- ============================================================
-- 056_subscription_gating_fix.sql — Fix RLS + add PLATFORM bypass
--
-- Problems fixed:
--  1. platform_subscriptions RLS only allowed is_platform_operator()
--     to SELECT — regular users couldn't read their own subscription,
--     so the gating check always fell through to the trial-by-default
--     fallback (no audit trail, no blocking).
--  2. No explicit PLATFORM account bypass — the fallback logic
--     granted trial access to any account without a subscription,
--     including accounts that should be blocked.
--
-- Changes:
--  a. Replace platform_subscriptions SELECT policy: allow users to
--     read their own account's subscription + keep operator access.
--  b. Add is_internal_account to accounts table for explicit bypass.
--  c. Mark the PLATFORM root account as internal.
-- ============================================================

-- a. Fix RLS on platform_subscriptions
DROP POLICY IF EXISTS platform_subscriptions_select ON platform_subscriptions;
DROP POLICY IF EXISTS platform_subscriptions_select_own ON platform_subscriptions;
DROP POLICY IF EXISTS platform_subscriptions_select_operator ON platform_subscriptions;

-- Users can read subscriptions for their own account
CREATE POLICY platform_subscriptions_select_own ON platform_subscriptions
  FOR SELECT USING (
    account_id IN (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    )
  );

-- Platform operators can read all subscriptions (admin panel)
CREATE POLICY platform_subscriptions_select_operator ON platform_subscriptions
  FOR SELECT USING (is_platform_operator());

-- b. Add is_internal_account to accounts
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS is_internal_account BOOLEAN NOT NULL DEFAULT FALSE;

-- c. Mark the PLATFORM root account(s) as internal
-- Any account with account_type = 'PLATFORM' gets the flag
UPDATE accounts
SET is_internal_account = TRUE
WHERE account_type = 'PLATFORM';

-- d. Also fix RLS on platform_plans so regular users can read plans
-- (needed for the pricing page and subscription display)
DROP POLICY IF EXISTS platform_plans_select ON platform_plans;
DROP POLICY IF EXISTS platform_plans_select_own ON platform_plans;
DROP POLICY IF EXISTS platform_plans_select_operator ON platform_plans;

CREATE POLICY platform_plans_select_own ON platform_plans
  FOR SELECT USING (TRUE);  -- Plans are public catalog, all authenticated users can read

CREATE POLICY platform_plans_select_operator ON platform_plans
  FOR SELECT USING (is_platform_operator());
