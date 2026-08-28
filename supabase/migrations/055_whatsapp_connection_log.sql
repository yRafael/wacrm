-- ============================================================
-- 055_whatsapp_connection_log.sql — structured disconnect logging
--
-- Persists every connection/disconnection event so the health
-- page can show history and the team can diagnose patterns
-- without tailing live stdout.
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_connection_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES whatsapp_sessions(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Event type: 'connected', 'disconnected', 'error', 'reconnect_attempt'
  event TEXT NOT NULL CHECK (event IN (
    'connected', 'disconnected', 'error', 'reconnect_attempt'
  )),
  -- Baileys DisconnectReason key (e.g. 'connection_lost', 'logged_out').
  -- Null for 'connected' events.
  reason TEXT,
  -- Raw error message from Baileys (if any).
  raw_error TEXT,
  -- How many disconnects in the last 24h at the time of this event.
  disconnect_count_24h INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_connection_log_session
  ON whatsapp_connection_log(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_connection_log_account
  ON whatsapp_connection_log(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_connection_log_event
  ON whatsapp_connection_log(event, created_at DESC);

ALTER TABLE whatsapp_connection_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_connection_log_admin ON whatsapp_connection_log;
CREATE POLICY wa_connection_log_admin ON whatsapp_connection_log
  FOR ALL USING (is_account_member(account_id, 'admin'));

-- Auto-expire logs older than 30 days (keep storage bounded).
CREATE OR REPLACE FUNCTION expire_old_connection_logs()
RETURNS void AS $$
  DELETE FROM whatsapp_connection_log
  WHERE created_at < NOW() - INTERVAL '30 days';
$$ LANGUAGE sql;

-- No RLS insert policy needed — the worker uses service role (bypasses RLS).
