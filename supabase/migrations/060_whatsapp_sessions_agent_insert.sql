-- ============================================================
-- 060 — Allow agents to create WhatsApp sessions
--
-- The original RLS policy (migration 037) required admin+ for
-- INSERT on whatsapp_sessions. This was too restrictive — any
-- team member should be able to create/pair their own session.
-- Admin+ is still required for DELETE and UPDATE (management).
-- ============================================================

DROP POLICY IF EXISTS whatsapp_sessions_insert ON whatsapp_sessions;
CREATE POLICY whatsapp_sessions_insert ON whatsapp_sessions
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
