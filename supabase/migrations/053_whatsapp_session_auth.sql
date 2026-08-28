-- ============================================================
-- 053_whatsapp_session_auth.sql — Persist Baileys auth state in DB
--
-- Replaces on-disk auth state (useMultiFileAuthState) with a
-- database-backed adapter. Each whatsapp_sessions row gets one
-- corresponding whatsapp_session_auth row that stores:
--   - creds: the full AuthenticationCreds JSON (single row per session)
--   - keys:  signal/pre-key/session/etc. records (many rows per session)
--
-- Two tables:
--   whatsapp_session_creds — one row per session, stores the serialized
--     AuthenticationCreds object (creds.json equivalent).
--   whatsapp_session_keys — many rows per session, stores individual
--     signal keys by (type, id). Null values on set() mean DELETE.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- WHATSAPP_SESSION_CREDS — one row per session
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_session_creds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES whatsapp_sessions(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The full serialized AuthenticationCreds JSON (BufferJSON format).
  creds JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_session_creds_session
  ON whatsapp_session_creds(session_id);
CREATE INDEX IF NOT EXISTS idx_wa_session_creds_account
  ON whatsapp_session_creds(account_id);

ALTER TABLE whatsapp_session_creds ENABLE ROW LEVEL SECURITY;

-- Only the service role (worker) reads/writes auth state.
-- No RLS policies needed — the worker bypasses RLS via supabaseAdmin.
-- But we still enable RLS so a misconfigured client can't accidentally
-- read creds. Admin-only policies as a safety net.
DROP POLICY IF EXISTS wa_session_creds_admin ON whatsapp_session_creds;
CREATE POLICY wa_session_creds_admin ON whatsapp_session_creds
  FOR ALL USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON whatsapp_session_creds;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_session_creds
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- WHATSAPP_SESSION_KEYS — many rows per session
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_session_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES whatsapp_sessions(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Signal key category: 'pre-key', 'session', 'sender-key',
  -- 'app-state-sync-key', 'app-state-sync-version', 'lid-mapping',
  -- 'device-list', 'tctoken', 'identity-key', 'sender-key-memory'.
  key_type TEXT NOT NULL,
  -- The key's identifier within its category (e.g. pre-key ID, JID).
  key_id TEXT NOT NULL,
  -- The serialized key data (BufferJSON format). Null = deleted.
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, key_type, key_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_session_keys_session
  ON whatsapp_session_keys(session_id);
CREATE INDEX IF NOT EXISTS idx_wa_session_keys_type
  ON whatsapp_session_keys(session_id, key_type);
CREATE INDEX IF NOT EXISTS idx_wa_session_keys_account
  ON whatsapp_session_keys(account_id);

ALTER TABLE whatsapp_session_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_session_keys_admin ON whatsapp_session_keys;
CREATE POLICY wa_session_keys_admin ON whatsapp_session_keys
  FOR ALL USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON whatsapp_session_keys;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_session_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
