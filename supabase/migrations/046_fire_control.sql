-- ============================================================
-- 046_fire_control.sql — Fire Control foundation (Fase 1)
--
-- The data model behind the Fire Control panel (admin of the
-- PLATFORM, not an admin of WhatsApp). This migration is purely
-- structural + read-only: the operator sees the reseller tree and
-- control metadata; no administrative actions exist yet (they land
-- in Fase 2).
--
-- What this migration does:
--   1. Extends `accounts` additively with `account_type` (USER /
--      RESELLER / PLATFORM) and `status` (ACTIVE / SUSPENDED /
--      BANNED). Defaults keep every existing row a `USER`/`ACTIVE`.
--   2. Adds `profiles.is_platform_operator` — the login gate for
--      who can open the Fire Control (flagged row in the DB, never
--      an env var).
--   3. Creates `platform_plans` (the platform's own product catalog
--      — deliberately NOT the `plans` table from 043, which is the
--      company's IPTV plan) and `platform_subscriptions` (what each
--      account contracted).
--   4. Creates `account_relationships` (the reseller tree) and
--      `audit_logs` (append-only administrative ledger).
--   5. Adds the `is_platform_operator()` and `is_account_in_subtree()`
--      SECURITY DEFINER helpers + RLS. The subtree helper is the
--      anti-IDOR/BOLA gate: a reseller can only touch descendants.
--   6. Backfill + seed: promotes the operator's account to PLATFORM
--      and inserts the two starter plans idempotently.
--
-- Naming rule (doc §2.1/§11): no "admin"/"superuser" terms —
-- the panel is internally `platform`, tables use `platform_*`.
--
-- Idempotent — safe to run multiple times. New columns use
-- IF NOT EXISTS; policies / triggers are dropped before recreate.
-- ============================================================

-- ============================================================
-- ACCOUNTS — additive extension
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'USER'
    CHECK (account_type IN ('USER', 'RESELLER', 'PLATFORM')),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'BANNED'));

CREATE INDEX IF NOT EXISTS idx_accounts_type
  ON accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_accounts_status
  ON accounts(status);

-- There is exactly ONE PLATFORM account (the platform owner / root
-- of the reseller tree). Partial unique index enforces it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_single_platform
  ON accounts(account_type) WHERE account_type = 'PLATFORM';

-- ============================================================
-- PROFILES — operator flag
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_platform_operator BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_profiles_platform_operator
  ON profiles(is_platform_operator) WHERE is_platform_operator = TRUE;

-- ============================================================
-- IS_PLATFORM_OPERATOR helper
--
-- True iff `auth.uid()` is flagged as a platform operator. SECURITY
-- DEFINER so policy bodies can read `profiles` without recursive RLS
-- (same pattern as `is_account_member`, migration 017). This is the
-- backend authorization gate for the Fire Control — the frontend and
-- the URL are never trusted for it.
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_platform_operator()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.is_platform_operator = TRUE
  );
$$;

ALTER FUNCTION public.is_platform_operator() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_platform_operator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_operator() TO authenticated, service_role;

-- ============================================================
-- PLATFORM_PLANS — the platform's product catalog
--
-- Name reserved by the doc (§5.2 / §11): do NOT confuse with
-- `plans` (043), which are the IPTV plans of each company.
-- `price_monthly` is a SUGGESTION — real billing is Fase 4 and
-- the frontend never decides price/payment.
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,            -- 'fire_user', 'fire_reseller', ...
  name TEXT NOT NULL,                   -- 'Fire User', 'Fire Reseller', ...
  account_type TEXT NOT NULL CHECK (account_type IN ('USER', 'RESELLER')),
  price_monthly NUMERIC(12,2) NOT NULL, -- preço sugerido; cobrança é Fase 4
  -- Limites do plano (doc §6.3):
  quota_accounts INTEGER,               -- NULL = ilimitado
  quota_direct_resellers INTEGER,       -- filhos revendedores diretos
  max_depth INTEGER NOT NULL DEFAULT 0, -- níveis abaixo do contratante
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_plans_account_type
  ON platform_plans(account_type, is_active, sort_order);

ALTER TABLE platform_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_plans_select ON platform_plans;
CREATE POLICY platform_plans_select ON platform_plans
  FOR SELECT USING (is_platform_operator());
-- No INSERT/UPDATE/DELETE policies in Fase 1: the catalog is seeded
-- by this migration and managed by the operator via service_role.

DROP TRIGGER IF EXISTS set_updated_at ON platform_plans;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON platform_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- PLATFORM_SUBSCRIPTIONS — what each account contracted
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES platform_plans(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_subscriptions_account
  ON platform_subscriptions(account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_subscriptions_plan
  ON platform_subscriptions(plan_id);

ALTER TABLE platform_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_subscriptions_select ON platform_subscriptions;
CREATE POLICY platform_subscriptions_select ON platform_subscriptions
  FOR SELECT USING (is_platform_operator());
-- Write paths land with the Fase 2 actions (operator + service_role).

DROP TRIGGER IF EXISTS set_updated_at ON platform_subscriptions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON platform_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ACCOUNT_RELATIONSHIPS — the reseller tree (parent/child)
-- ============================================================
CREATE TABLE IF NOT EXISTS account_relationships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  child_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tree_depth INTEGER NOT NULL,          -- profundidade absoluta do topo
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (parent_account_id, child_account_id),
  UNIQUE (child_account_id)             -- 1 pai por conta
);

CREATE INDEX IF NOT EXISTS idx_account_relationships_parent
  ON account_relationships(parent_account_id, tree_depth);

ALTER TABLE account_relationships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_relationships_select ON account_relationships;
CREATE POLICY account_relationships_select ON account_relationships
  FOR SELECT USING (is_platform_operator());
-- Edges are created manually by the operator in Fase 1; the atomic
-- create_reseller_child RPC (Fase 2/3) owns writes later.

-- ============================================================
-- AUDIT_LOGS — append-only administrative ledger
--
-- SELECT for operators + INSERT by the server (service_role). NO
-- UPDATE, NO DELETE policies — even for the operator (doc §5.5,
-- same contract as financial_transactions, migration 040).
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  action TEXT NOT NULL,                -- 'ACCOUNT_SUSPENDED', 'PLAN_CHANGED', ...
  target_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_target
  ON audit_logs(target_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
  ON audit_logs(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON audit_logs(created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_select ON audit_logs;
CREATE POLICY audit_logs_select ON audit_logs
  FOR SELECT USING (is_platform_operator());

-- ============================================================
-- IS_ACCOUNT_IN_SUBTREE helper (anti-IDOR/BOLA)
--
-- True iff `target_account_id` is `ancestor_account_id` itself or a
-- descendant of it in the reseller tree. SECURITY DEFINER so policy
-- bodies / RPCs can walk `account_relationships` without recursive
-- RLS — the same "banco barra sozinho" pattern as `is_account_member`
-- (017). Used by the RLS policies of reseller-facing tables and by
-- the `requireSubtreeAccess` server helper (doc §5.6).
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_account_in_subtree(
  ancestor_account_id UUID,
  target_account_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE subtree AS (
    SELECT r.child_account_id AS account_id
    FROM account_relationships r
    WHERE r.parent_account_id = ancestor_account_id
    UNION ALL
    SELECT r.child_account_id
    FROM account_relationships r
    JOIN subtree s ON r.parent_account_id = s.account_id
  )
  SELECT target_account_id = ancestor_account_id
      OR EXISTS (SELECT 1 FROM subtree WHERE account_id = target_account_id);
$$;

ALTER FUNCTION public.is_account_in_subtree(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_account_in_subtree(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_account_in_subtree(UUID, UUID) TO authenticated, service_role;

-- ============================================================
-- BACKFILL + SEED
-- ============================================================
-- Promote the operator's own account to PLATFORM so the tree has a
-- root. Idempotent: only rows not yet PLATFORM are touched, and the
-- partial unique index guarantees a single root.
UPDATE accounts a
SET account_type = 'PLATFORM'
FROM profiles p
WHERE p.account_id = a.id
  AND p.is_platform_operator = TRUE
  AND a.account_type <> 'PLATFORM';

-- Starter plans (doc §9.3 point of departure — fictitious values,
-- billing is Fase 4). ON CONFLICT (code) makes this a re-runnable
-- no-op after the first apply.
INSERT INTO platform_plans (
  code, name, account_type, price_monthly,
  quota_accounts, quota_direct_resellers, max_depth, sort_order
) VALUES
  ('fire_user', 'Fire User', 'USER', 99.00, 1, 0, 0, 0),
  ('fire_reseller', 'Fire Reseller', 'RESELLER', 199.00, 100, 5, 1, 1)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- REALTIME — the Fire Control tree reflects changes live
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'account_relationships'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE account_relationships;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'platform_subscriptions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE platform_subscriptions;
  END IF;
END $$;
