-- ============================================================
-- 037_whatsapp_sessions.sql — Baileys (WhatsApp Web) transport
--
-- Replaces the Meta Cloud API as the WhatsApp transport. The CRM
-- connects via a dedicated worker process that holds one Baileys
-- socket per `whatsapp_sessions` row. The worker runs OUTSIDE
-- Next.js (long-lived socket, survives dev restarts) and talks to
-- Postgres through the service-role client — but every query is
-- filtered by `account_id`, so tenancy holds regardless of which
-- client is used (the same rule send-message.ts documents).
--
-- Two tables:
--   whatsapp_sessions — one row per connected WhatsApp number per
--     account. The worker writes QR data / status here; the browser
--     reads them over Supabase Realtime (the row is added to the
--     realtime publication at the bottom).
--   whatsapp_outbox  — outbound message queue. The app's send path
--     validates the request, inserts a `pending` row, and returns;
--     the worker polls (~1s), sends over the socket, then writes the
--     result back. This keeps a Next.js request from ever holding a
--     socket and lets sends survive an app restart mid-flight.
--
-- Session states mirror the doc (Cap. 41): DISCONNECTED / CONNECTING
-- / QR_CODE / CONNECTED / RECONNECTING / ERROR / BLOCKED. "offline"
-- is not stored — it is derived from staleness like presence.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- WHATSAPP_SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'WhatsApp',
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'DISCONNECTED'
    CHECK (status IN (
      'DISCONNECTED', 'CONNECTING', 'QR_CODE', 'CONNECTED',
      'RECONNECTING', 'ERROR', 'BLOCKED'
    )),
  -- Transport discriminator. Always 'baileys' for now; kept as a
  -- column so a future Meta provider could coexist without a rewrite.
  provider TEXT NOT NULL DEFAULT 'baileys',
  -- Stable id for the on-disk Baileys auth state directory:
  --   wa-sessions/<account_id>/<session_identifier>/
  session_identifier TEXT,
  -- Data URL of the pending QR code the browser renders. Cleared on
  -- CONNECTED.
  qr_data TEXT,
  qr_expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  last_activity TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_account ON whatsapp_sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_status ON whatsapp_sessions(status);

ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;

-- settings-class: everyone in the account may read (the sessions UI
-- is shared), admin+ may manage.
DROP POLICY IF EXISTS whatsapp_sessions_select ON whatsapp_sessions;
DROP POLICY IF EXISTS whatsapp_sessions_insert ON whatsapp_sessions;
DROP POLICY IF EXISTS whatsapp_sessions_update ON whatsapp_sessions;
DROP POLICY IF EXISTS whatsapp_sessions_delete ON whatsapp_sessions;
CREATE POLICY whatsapp_sessions_select ON whatsapp_sessions
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY whatsapp_sessions_insert ON whatsapp_sessions
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY whatsapp_sessions_update ON whatsapp_sessions
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY whatsapp_sessions_delete ON whatsapp_sessions
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON whatsapp_sessions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- WHATSAPP_OUTBOX
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_outbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The session that should carry the send. Null until resolved: the
  -- worker routes by account, picking the account's CONNECTED session
  -- (usually there is exactly one).
  session_id UUID REFERENCES whatsapp_sessions(id) ON DELETE SET NULL,
  -- Present when the send originated in a conversation; lets the
  -- worker persist the sent message row without re-resolving.
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  to_phone TEXT NOT NULL,
  message_type TEXT NOT NULL
    CHECK (message_type IN ('text', 'image', 'video', 'audio', 'document', 'reaction')),
  -- Message-type-specific params:
  --   text/reaction: { text, replyToMessageId? }
  --   media types:   { mediaUrl, caption?, filename? }
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  -- Meta-style message id returned by the socket send (used to map
  -- reply-quotes + dedupe on retry).
  wamid TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_outbox_account_pending
  ON whatsapp_outbox(account_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_outbox_conversation
  ON whatsapp_outbox(conversation_id);

ALTER TABLE whatsapp_outbox ENABLE ROW LEVEL SECURITY;

-- The send path uses the RLS-scoped user client, so members must be
-- able to insert their account's rows. The worker consumes rows with
-- the service role (bypasses RLS); the client update policy covers
-- UI-triggered cancellations/retries.
DROP POLICY IF EXISTS whatsapp_outbox_select ON whatsapp_outbox;
DROP POLICY IF EXISTS whatsapp_outbox_insert ON whatsapp_outbox;
DROP POLICY IF EXISTS whatsapp_outbox_update ON whatsapp_outbox;
CREATE POLICY whatsapp_outbox_select ON whatsapp_outbox
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY whatsapp_outbox_insert ON whatsapp_outbox
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY whatsapp_outbox_update ON whatsapp_outbox
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON whatsapp_outbox;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_outbox
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- REALTIME — the sessions UI updates live as the worker changes
-- status / QR. Outbox stays out of the publication (worker polls).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'whatsapp_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_sessions;
  END IF;
END $$;
