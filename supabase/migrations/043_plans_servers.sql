-- ============================================================
-- 043_plans_servers.sql — company plan + server catalog (multi-tenant)
--
-- The conversation's operational panel (⚡ Ações) and the "Plano
-- [Mensal ▼]" header selector need the plans and servers that BELONG
-- TO THE COMPANY, not hardcoded labels. "Rafael é um usuário da
-- empresa Vision" — tomorrow João → João IPTV, Maria → Maria Play,
-- each in the same Workspace seeing only their own company's catalog.
--
--   plans    — subscription spans the company sells (Mensal 30,
--              Trimestral 90, Semestral 180, Anual 365). `duration_days`
--              ties a plan to the renewal span the finance flow uses.
--   servers  — IPTV servers the company provisions on. Reverses the
--              migration-038 scope decision ("servers stay outside the
--              workspace"): the operator panel now edits server/plan
--              from inside the conversation.
--   iptv_credentials — gains nullable plan_id/server_id FKs. Nullable so
--              pre-043 credentials stay valid; `duration_days` remains
--              the field complete_renewal actually extends by.
--
-- RLS mirrors pipelines: members read, admins write (settings-tier
-- company config). Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- PLANS
-- ============================================================
CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Subscription span in days — what applyPlanToCredential writes into
  -- iptv_credentials.duration_days and complete_renewal extends by.
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  -- Suggested price for the "Registrar pagamento"/"Agendar renovação"
  -- dialogs to prefill. NULL when the company sells it for another
  -- amount (the operator still types the amount freely).
  price NUMERIC(12, 2),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plans_account_name
  ON plans(account_id, name);
CREATE INDEX IF NOT EXISTS idx_plans_account_active
  ON plans(account_id, is_active, sort_order);

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plans_select ON plans;
DROP POLICY IF EXISTS plans_insert ON plans;
DROP POLICY IF EXISTS plans_update ON plans;
DROP POLICY IF EXISTS plans_delete ON plans;
CREATE POLICY plans_select ON plans
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY plans_insert ON plans
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY plans_update ON plans
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY plans_delete ON plans
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON plans;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- SERVERS
-- ============================================================
CREATE TABLE IF NOT EXISTS servers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_servers_account_name
  ON servers(account_id, name);
CREATE INDEX IF NOT EXISTS idx_servers_account_active
  ON servers(account_id, is_active, sort_order);

ALTER TABLE servers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS servers_select ON servers;
DROP POLICY IF EXISTS servers_insert ON servers;
DROP POLICY IF EXISTS servers_update ON servers;
DROP POLICY IF EXISTS servers_delete ON servers;
CREATE POLICY servers_select ON servers
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY servers_insert ON servers
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY servers_update ON servers
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY servers_delete ON servers
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON servers;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON servers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- IPTV_CREDENTIALS — nullable plan/server FKs
-- ============================================================
ALTER TABLE iptv_credentials
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS server_id UUID REFERENCES servers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_iptv_credentials_plan
  ON iptv_credentials(account_id, plan_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_iptv_credentials_server
  ON iptv_credentials(account_id, server_id) WHERE deleted_at IS NULL;

-- ============================================================
-- ENSURE_DEFAULT_PLANS — idempotent seed of the spec-defined plans.
--
-- Same pattern as ensure_leads_pipeline (042): SECURITY DEFINER, caller
-- must be an owner/admin of the resolved account (settings-tier, same
-- tier as the plans RLS writes), SELECT-before-INSERT so re-runs are
-- no-ops. Covers BOTH fresh accounts (called from Settings on mount)
-- and existing ones without a catalog.
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_default_plans(
  p_account_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_role account_role_enum;
  v_plan_count INTEGER;
BEGIN
  -- Caller must be authenticated.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Resolve the account from the caller unless one was passed.
  SELECT COALESCE(p_account_id, account_id), account_role
  INTO v_account_id, v_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  -- Company catalog is settings-tier config, matching plans RLS writes.
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  -- Only seed an account that has NO plans yet — never clobber a
  -- catalog the company already edited.
  SELECT COUNT(*) INTO v_plan_count
  FROM plans
  WHERE account_id = v_account_id;

  IF v_plan_count > 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO plans (account_id, name, duration_days, sort_order)
  VALUES
    (v_account_id, 'Mensal',    30,  0),
    (v_account_id, 'Trimestral', 90,  1),
    (v_account_id, 'Semestral', 180,  2),
    (v_account_id, 'Anual',     365,  3);

  RETURN NULL;
END;
$$;

ALTER FUNCTION public.ensure_default_plans(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ensure_default_plans(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_default_plans(UUID) TO authenticated;

-- ============================================================
-- REALTIME — plan/server changes reflect in open conversations
-- (e.g. an admin renaming a plan while an agent has the thread open).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'plans'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE plans;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'servers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE servers;
  END IF;
END $$;
