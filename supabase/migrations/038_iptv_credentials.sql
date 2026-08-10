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
