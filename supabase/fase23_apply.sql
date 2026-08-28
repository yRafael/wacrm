-- ============================================================
-- Fase 3 apply — combina 038 (credenciais) + 040 (finance/renewals) + 041 (leads)
-- Ordem importa: 040 depende das tabelas da 038. Idempotente.
-- Cole TUDO no SQL editor do Supabase (Dashboard → SQL Editor → New query).
-- ============================================================

-- ============================================================
-- 038_iptv_credentials.sql — credential extraction + save (Fase 2)
--
-- Scope (user decision): the workspace is NOT an IPTV panel. It only
-- (1) turns the panel's paid-customer message into structured fields,
-- (2) builds the customized message the operator sends, and (3) saves
-- the customer's access credentials for renewal tracking. Products,
-- servers and panel accounts stay in the user's own IPTV panel.
--
-- Two tables:
--   iptv_credentials — one active credential row per contact. The
--     password is stored ENCRYPTED (AES-256-GCM via
--     src/lib/whatsapp/encryption.ts) and is never included in the
--     customer-facing message.
--   parser_logs     — audit trail of each extraction: what text was
--     pasted, what the parser produced, confidence, and status. The
--     secret fields are excluded from `parsed_fields` (username and
--     expiry are enough to debug the parse; the password is never
--     duplicated into a log row).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- IPTV_CREDENTIALS
-- ============================================================
CREATE TABLE IF NOT EXISTS iptv_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  -- AES-256-GCM ciphertext from `encrypt()`. Plaintext lives nowhere at
  -- rest; the client message never carries it.
  password TEXT,
  -- Panel family the parser guessed — metadata only, never used for
  -- matching. Nullable because a manually-entered credential may have
  -- no panel message behind it.
  panel_type TEXT CHECK (panel_type IN ('sigma', 'xtream', 'xui', 'horus', 'generic')),
  expires_at TIMESTAMPTZ NOT NULL,
  -- Days added on renewal (30/90/180/365). Null until a renewal sets it;
  -- the renewal flow defaults to the current span.
  duration_days INTEGER,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- One live credential per contact. Revocations/expiry mutate the row in
-- place; renewal history lives in `renewals` (migration 039), so no
-- credential rows are ever destroyed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_iptv_credentials_active_contact
  ON iptv_credentials(account_id, contact_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_iptv_credentials_expires
  ON iptv_credentials(account_id, expires_at) WHERE deleted_at IS NULL;

ALTER TABLE iptv_credentials ENABLE ROW LEVEL SECURITY;

-- Member-facing data: everyone in the account can read; agents (the
-- operators saving credentials) write; admins delete (soft, via
-- deleted_at or revoked status).
DROP POLICY IF EXISTS iptv_credentials_select ON iptv_credentials;
DROP POLICY IF EXISTS iptv_credentials_insert ON iptv_credentials;
DROP POLICY IF EXISTS iptv_credentials_update ON iptv_credentials;
DROP POLICY IF EXISTS iptv_credentials_delete ON iptv_credentials;
CREATE POLICY iptv_credentials_select ON iptv_credentials
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY iptv_credentials_insert ON iptv_credentials
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY iptv_credentials_update ON iptv_credentials
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY iptv_credentials_delete ON iptv_credentials
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON iptv_credentials;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON iptv_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- PARSER_LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS parser_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Null when the operator used the standalone parser page without
  -- linking a contact yet.
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  input_text TEXT NOT NULL,
  -- Non-secret extracted fields for debugging the parse
  -- (e.g. { "username": "95184381", "expiresAt": "...", "panelType": "xtream" }).
  -- The password is intentionally NOT stored here.
  parsed_fields JSONB,
  confidence INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'partial'
    CHECK (status IN ('success', 'partial', 'error')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parser_logs_account_created
  ON parser_logs(account_id, created_at DESC);

ALTER TABLE parser_logs ENABLE ROW LEVEL SECURITY;

-- Audit log: append-only. Members read, agents record; no update/delete
-- (admin cleanup of log rows is out of scope for now).
DROP POLICY IF EXISTS parser_logs_select ON parser_logs;
DROP POLICY IF EXISTS parser_logs_insert ON parser_logs;
CREATE POLICY parser_logs_select ON parser_logs
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY parser_logs_insert ON parser_logs
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

-- ============================================================
-- REALTIME — the parser page reflects credential updates live
-- (e.g. a renewal in the worker extending expires_at).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'iptv_credentials'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE iptv_credentials;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'parser_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE parser_logs;
  END IF;
END $$;

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
UPDATE notifications SET type = 'conversation_assigned'
WHERE type NOT IN (
  'conversation_assigned',
  'renewal_due',
  'renewal_paid',
  'payment_received',
  'whatsapp_disconnected',
  'lead_converted'
);
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned',
    'renewal_due',
    'renewal_paid',
    'payment_received',
    'whatsapp_disconnected',
    'lead_converted'
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

-- ============================================================
-- 041_leads.sql — Leads via deals/pipelines (Fase 3, doc Cap. 47)
--
-- The workspace reuses the Fire Workspace Kanban (deals + pipelines) as its
-- Leads board. A deal IS a lead: it already points at a contact, so
-- history is preserved across conversion (migration 004 keeps the
-- contact_id via ON DELETE SET NULL).
--
-- This migration adds two pieces:
--   1. `ensure_leads_pipeline` — an idempotent SECURITY DEFINER seed
--      that creates a "Leads" pipeline with the spec's stages
--      (Novo → Em contato → Negociação → Sem resposta → Convertido →
--      Perdido) if the account doesn't have one yet.
--   2. `on_deal_converted` — a trigger that, whenever a deal lands on
--      a stage named "Convertido", automatically marks it 'won' and
--      notifies the account owner ("O Lead automaticamente vira
--      Cliente. Mantendo todo histórico."). Conversion is purely a
--      status + notification change — no history is destroyed.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- EXTEND notifications.type CHECK with lead_converted
-- ============================================================
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
UPDATE notifications SET type = 'conversation_assigned'
WHERE type NOT IN (
  'conversation_assigned',
  'renewal_due',
  'renewal_paid',
  'payment_received',
  'whatsapp_disconnected',
  'lead_converted'
);
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned',
    'renewal_due',
    'renewal_paid',
    'payment_received',
    'whatsapp_disconnected',
    'lead_converted'
  ));

-- ============================================================
-- ensure_leads_pipeline(p_account_id)
--
-- Idempotently creates the spec-defined "Leads" pipeline for the
-- caller's account (or p_account_id when given). Returns the existing
-- pipeline id when the account already has one named "Leads", so it is
-- safe to call on every page load.
--
-- Stage names/order match doc Cap. 11 / Cap. 47 exactly. "Convertido"
-- is the conversion stage the trigger below keys on.
--
-- Error contract (matches 018): 42501 forbidden, 22023 bad input.
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_leads_pipeline(
  p_account_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_role account_role_enum;
  v_pipeline_id UUID;
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

  -- Leads are an operational flow (agent+), matching deals INSERT RLS.
  IF v_role NOT IN ('owner', 'admin', 'agent') THEN
    RAISE EXCEPTION 'This action requires the agent role or higher'
      USING ERRCODE = '42501';
  END IF;

  -- Already seeded?
  SELECT id INTO v_pipeline_id
  FROM pipelines
  WHERE account_id = v_account_id
    AND lower(name) = 'leads'
  LIMIT 1;

  IF v_pipeline_id IS NOT NULL THEN
    RETURN v_pipeline_id;
  END IF;

  -- Create the pipeline + spec stages.
  INSERT INTO pipelines (user_id, account_id, name)
  VALUES (auth.uid(), v_account_id, 'Leads')
  RETURNING id INTO v_pipeline_id;

  INSERT INTO pipeline_stages (pipeline_id, name, color, position)
  VALUES
    (v_pipeline_id, 'Novo',          '#3b82f6', 0),  -- blue
    (v_pipeline_id, 'Em contato',    '#eab308', 1),  -- yellow
    (v_pipeline_id, 'Negociação',    '#f97316', 2),  -- orange
    (v_pipeline_id, 'Sem resposta',  '#6b7280', 3),  -- gray
    (v_pipeline_id, 'Convertido',    '#22c55e', 4),  -- green
    (v_pipeline_id, 'Perdido',       '#ef4444', 5);  -- red

  RETURN v_pipeline_id;
END;
$$;

ALTER FUNCTION public.ensure_leads_pipeline(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ensure_leads_pipeline(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_leads_pipeline(UUID) TO authenticated;

-- ============================================================
-- on_deal_converted — automatic lead → client conversion
--
-- BEFORE INSERT OR UPDATE OF stage_id: when a deal is placed on (or
-- moved to) a stage whose name is "Convertido", mark it 'won' and
-- notify the account owner. Moving a deal into "Convertido" is the
-- operator's action; the status + notification are the system's.
--
-- One-directional on purpose: leaving "Convertido" later does NOT
-- un-convert, so a conversion is never silently undone.
-- ============================================================
CREATE OR REPLACE FUNCTION public.on_deal_converted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage_name TEXT;
  v_owner_user_id UUID;
  v_contact_name TEXT;
BEGIN
  -- Skip unless this row's stage is actually changing.
  IF TG_OP = 'UPDATE'
     AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  -- Already won → nothing to do (idempotent, no double notification).
  IF NEW.status = 'won' THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_stage_name
  FROM pipeline_stages
  WHERE id = NEW.stage_id;

  IF v_stage_name IS NULL OR lower(v_stage_name) <> 'convertido' THEN
    RETURN NEW;
  END IF;

  -- The lead is now a client.
  NEW.status := 'won';
  NEW.updated_at := NOW();

  SELECT owner_user_id INTO v_owner_user_id
  FROM accounts
  WHERE id = NEW.account_id;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts
  WHERE id = NEW.contact_id;

  IF v_owner_user_id IS NOT NULL AND v_owner_user_id <> auth.uid() THEN
    INSERT INTO notifications (
      account_id, user_id, type, contact_id, actor_user_id, title, body
    ) VALUES (
      NEW.account_id, v_owner_user_id, 'lead_converted',
      NEW.contact_id, auth.uid(),
      'Lead converted',
      COALESCE(v_contact_name, 'A lead')
        || ' was converted to a client — ' || NEW.title
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a conversion-status failure block the board move itself.
  RAISE WARNING 'Failed to convert deal %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.on_deal_converted() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_deal_converted ON deals;
CREATE TRIGGER on_deal_converted
  BEFORE INSERT OR UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION public.on_deal_converted();
