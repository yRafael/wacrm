-- ============================================================
-- 039_whatsapp_sessions_refresh.sql — force a fresh socket on refresh
--
-- The worker runs in its own process, so the Next.js refresh route
-- cannot touch the worker's in-memory socket registry directly. This
-- column is the handshake: the API route stamps it with NOW() when the
-- operator clicks "Atualizar QR / Reconnect", and the worker's sweep
-- compares it to the age of the live socket — when the request is newer,
-- the worker drops the (possibly stuck) socket and reconnects, which
-- emits a fresh QR for pairing.
--
-- Idempotent — safe to run multiple times.
-- ============================================================
ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS refresh_requested_at TIMESTAMPTZ;
