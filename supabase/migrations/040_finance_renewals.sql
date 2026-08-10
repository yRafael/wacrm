-- ============================================================
-- 040_finance_renewals.sql — payments, financial_transactions,
-- renewals + the atomic complete_renewal RPC (Fase 3)
--
-- Three tables with a clear split of responsibilities:
--   payments               — receivables ("contas a receber"): a
--     scheduled/pending renewal the customer owes. Operational and
--     mutable — it can be canceled, marked late, or re-dated.
--   financial_transactions — the cash ledger. Every entry is
--     immutable: income/expense/adjustment rows are written once
--     and never edited; corrections are new 'adjustment' rows.
--   renewals               — immutable renewal history: each row
--     records one completed renewal with old→new expiry. Never
--     edited or deleted.
--
-- The atomic payment→paid transition is `complete_renewal`, a
-- SECURITY DEFINER RPC (pattern from 018): it marks the payment
-- paid, appends a renewals row, extends iptv_credentials.expires_at,
-- books an income transaction, and notifies the account owner — all
-- in one transaction, so the credential and the ledger can never
-- drift apart.
--
-- Also extends notifications.type CHECK with the renewal types the
-- worker scheduler (Fase 4) and complete_renewal emit.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  method TEXT NOT NULL DEFAULT 'pix'
    CHECK (method IN ('pix', 'cash', 'card', 'transfer', 'boleto', 'credit')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'late', 'canceled', 'refunded', 'partial')),
  due_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_account_status
  ON payments(account_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_account_due
  ON payments(account_id, due_at);
CREATE INDEX IF NOT EXISTS idx_payments_account_contact
  ON payments(account_id, contact_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Members read; agents create and update receivables (the day-to-day
-- "customer owes a renewal" flow); admins delete mistaken rows.
DROP POLICY IF EXISTS payments_select ON payments;
DROP POLICY IF EXISTS payments_insert ON payments;
DROP POLICY IF EXISTS payments_update ON payments;
DROP POLICY IF EXISTS payments_delete ON payments;
CREATE POLICY payments_select ON payments
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY payments_insert ON payments
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY payments_update ON payments
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY payments_delete ON payments
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON payments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- FINANCIAL_TRANSACTIONS — immutable cash ledger
-- ============================================================
CREATE TABLE IF NOT EXISTS financial_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL
    CHECK (type IN ('income', 'expense', 'transfer', 'adjustment', 'refund')),
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('sale', 'renewal', 'server', 'internet', 'marketing', 'salary', 'taxes', 'other')),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  method TEXT NOT NULL DEFAULT 'pix'
    CHECK (method IN ('pix', 'cash', 'card', 'transfer', 'boleto', 'credit')),
  -- Cost center (doc Cap. 44) — free-text tag, e.g. "Residencial".
  center_cost TEXT,
  -- The related contact when the transaction is customer-facing
  -- (sale/renewal income, a refund). Null for operating expenses.
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  -- Reference to the source row (e.g. the renewals.id that booked
  -- this income) for auditing.
  reference_id UUID,
  description TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_financial_account_occurred
  ON financial_transactions(account_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_financial_account_type
  ON financial_transactions(account_id, type);
CREATE INDEX IF NOT EXISTS idx_financial_account_contact
  ON financial_transactions(account_id, contact_id);

ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;

-- Read + record only. The ledger is append-only: corrections are new
-- 'adjustment' rows, never UPDATE/DELETE of an existing entry.
DROP POLICY IF EXISTS financial_transactions_select ON financial_transactions;
DROP POLICY IF EXISTS financial_transactions_insert ON financial_transactions;
CREATE POLICY financial_transactions_select ON financial_transactions
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY financial_transactions_insert ON financial_transactions
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

-- ============================================================
-- RENEWALS — immutable renewal history
-- ============================================================
CREATE TABLE IF NOT EXISTS renewals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  iptv_credential_id UUID REFERENCES iptv_credentials(id) ON DELETE SET NULL,
  old_expires_at TIMESTAMPTZ,
  new_expires_at TIMESTAMPTZ NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  renewal_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (renewal_type IN ('manual', 'automatic', 'promotional', 'courtesy')),
  status TEXT NOT NULL DEFAULT 'renewed'
    CHECK (status IN ('scheduled', 'pending', 'paid', 'renewed', 'canceled', 'expired')),
  -- The user who completed the renewal.
  renewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_renewals_account_contact
  ON renewals(account_id, contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_renewals_account_created
  ON renewals(account_id, created_at DESC);

ALTER TABLE renewals ENABLE ROW LEVEL SECURITY;

-- Immutable history: members read; rows are written exclusively by
-- complete_renewal. No client INSERT/UPDATE/DELETE.
DROP POLICY IF EXISTS renewals_select ON renewals;
CREATE POLICY renewals_select ON renewals
  FOR SELECT USING (is_account_member(account_id));

-- ============================================================
-- EXTEND notifications.type CHECK
-- ============================================================
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned',
    'renewal_due',
    'renewal_paid',
    'payment_received',
    'whatsapp_disconnected'
  ));

-- ============================================================
-- complete_renewal(p_payment_id, p_duration_days, p_notes)
--
-- The only path that marks a renewal payment 'paid'. Atomically:
--   1. marks the payment paid (paid_at = now)
--   2. appends an immutable renewals history row (old→new expiry)
--   3. extends iptv_credentials.expires_at by the chosen duration
--      (defaults to the credential's current span; falls back to 30d)
--   4. books an 'income / renewal' ledger entry
--   5. notifies the account owner
--
-- Returns the renewals row id. Requires the contact's active IPTV
-- credential (created by the parser flow) — you can't renew a
-- subscription the workspace has no record of.
--
-- Error contract (matches 018): 42501 forbidden, 22023 bad input.
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_renewal(
  p_payment_id UUID,
  p_duration_days INTEGER DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_payment RECORD;
  v_credential RECORD;
  v_duration INTEGER;
  v_old_expires TIMESTAMPTZ;
  v_new_expires TIMESTAMPTZ;
  v_contact_name TEXT;
  v_owner_user_id UUID;
  v_renewal_id UUID;
BEGIN
  -- Caller must be authenticated.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Resolve caller's account + role.
  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  -- Agent+ completes renewals (the daily operator flow).
  IF v_caller_role NOT IN ('owner', 'admin', 'agent') THEN
    RAISE EXCEPTION 'This action requires the agent role or higher'
      USING ERRCODE = '42501';
  END IF;

  -- Lock the payment row so a concurrent renewal can't double-book it.
  SELECT * INTO v_payment
  FROM payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF v_payment.id IS NULL THEN
    RAISE EXCEPTION 'Payment not found' USING ERRCODE = '22023';
  END IF;

  IF v_payment.account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Payment does not belong to your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_payment.status IN ('paid', 'canceled', 'refunded') THEN
    RAISE EXCEPTION 'Payment is already %', v_payment.status
      USING ERRCODE = '22023';
  END IF;

  -- Renewal requires the contact's active credential. No credential →
  -- nothing to extend; the operator creates one via the parser first.
  SELECT * INTO v_credential
  FROM iptv_credentials
  WHERE account_id = v_caller_account_id
    AND contact_id = v_payment.contact_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_credential.id IS NULL THEN
    RAISE EXCEPTION 'Contact has no active IPTV credential; extract one via the parser first'
      USING ERRCODE = '22023';
  END IF;

  -- Default the span to the credential's current duration; fall back to 30.
  v_duration := COALESCE(p_duration_days, v_credential.duration_days, 30);
  IF v_duration <= 0 OR v_duration > 1095 THEN
    RAISE EXCEPTION 'Invalid renewal duration: %', v_duration
      USING ERRCODE = '22023';
  END IF;

  v_old_expires := v_credential.expires_at;
  v_new_expires := v_old_expires + (v_duration * INTERVAL '1 day');

  -- 1) Mark the payment paid.
  UPDATE payments
  SET status = 'paid', paid_at = NOW(), notes = COALESCE(p_notes, notes)
  WHERE id = p_payment_id;

  -- 2) Append the immutable renewal history row.
  INSERT INTO renewals (
    account_id, contact_id, iptv_credential_id,
    old_expires_at, new_expires_at, amount, payment_id,
    duration_days, renewal_type, status, renewed_by, notes
  ) VALUES (
    v_caller_account_id, v_payment.contact_id, v_credential.id,
    v_old_expires, v_new_expires, v_payment.amount, p_payment_id,
    v_duration, 'manual', 'renewed', auth.uid(), p_notes
  ) RETURNING id INTO v_renewal_id;

  -- 3) Extend the credential.
  UPDATE iptv_credentials
  SET expires_at = v_new_expires,
      status = CASE WHEN v_new_expires > NOW() THEN 'active' ELSE 'expired' END,
      duration_days = v_duration,
      updated_at = NOW()
  WHERE id = v_credential.id;

  -- 4) Book the income.
  INSERT INTO financial_transactions (
    account_id, type, category, amount, method, contact_id,
    reference_id, description, occurred_at
  ) VALUES (
    v_caller_account_id, 'income', 'renewal', v_payment.amount,
    v_payment.method, v_payment.contact_id, v_renewal_id,
    'Renewal paid (' || v_duration || ' days)',
    NOW()
  );

  -- 5) Notify the account owner.
  SELECT COALESCE(NULLIF(c.name, ''), c.phone), a.owner_user_id
  INTO v_contact_name, v_owner_user_id
  FROM contacts c
  JOIN accounts a ON a.id = c.account_id
  WHERE c.id = v_payment.contact_id;

  IF v_owner_user_id IS NOT NULL THEN
    INSERT INTO notifications (
      account_id, user_id, type, contact_id, title, body
    ) VALUES (
      v_caller_account_id, v_owner_user_id, 'renewal_paid',
      v_payment.contact_id,
      'Renewal paid',
      'Renewal of ' || COALESCE(v_contact_name, 'a contact')
        || ' paid — valid until ' || to_char(v_new_expires, 'DD/MM/YYYY')
    );
  END IF;

  RETURN v_renewal_id;
END;
$$;

ALTER FUNCTION public.complete_renewal(UUID, INTEGER, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_renewal(UUID, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_renewal(UUID, INTEGER, TEXT) TO authenticated;

-- ============================================================
-- REALTIME — the finance/renewals pages reflect changes live
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'payments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE payments;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'financial_transactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE financial_transactions;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'renewals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE renewals;
  END IF;
END $$;
