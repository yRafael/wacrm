-- ============================================================
-- 052_iptv_structure_costs.sql — cost tracking for IPTV resellers
--
-- Tracks the monthly/yearly costs of servers, panels, and other
-- infrastructure that the operator uses to resell IPTV. Revenue
-- is derived from existing iptv_credentials (active subscriptions)
-- joined with plans.price. Profit = revenue - costs.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS iptv_structure_costs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('server', 'panel', 'other')),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  billing_cycle TEXT NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'yearly')),
  capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iptv_structure_costs_account
  ON iptv_structure_costs(account_id, is_active)
  WHERE is_active = TRUE;

ALTER TABLE iptv_structure_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS iptv_structure_costs_select ON iptv_structure_costs;
DROP POLICY IF EXISTS iptv_structure_costs_insert ON iptv_structure_costs;
DROP POLICY IF EXISTS iptv_structure_costs_update ON iptv_structure_costs;
DROP POLICY IF EXISTS iptv_structure_costs_delete ON iptv_structure_costs;

CREATE POLICY iptv_structure_costs_select ON iptv_structure_costs
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY iptv_structure_costs_insert ON iptv_structure_costs
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY iptv_structure_costs_update ON iptv_structure_costs
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY iptv_structure_costs_delete ON iptv_structure_costs
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON iptv_structure_costs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON iptv_structure_costs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
