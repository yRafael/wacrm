-- ============================================================
-- 054_whatsapp_sessions_monitoring.sql — proactive disconnect tracking
--
-- Adds columns to whatsapp_sessions to track disconnect frequency
-- so the UI can surface "flapping" warnings and the worker can
-- log metrics for operational visibility.
-- ============================================================

ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS disconnect_count_24h INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_disconnect_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_disconnect
  ON whatsapp_sessions(account_id, last_disconnect_at);
