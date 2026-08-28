-- ============================================================
-- 061 — Allow all users to create WhatsApp sessions
--
-- In a CRM, every user needs to connect their own WhatsApp to
-- handle conversations. The previous policy (migration 060) only
-- allowed agent+ which still blocked viewers. Change INSERT to
-- allow any account member (viewer+).
-- ============================================================

DROP POLICY IF EXISTS whatsapp_sessions_insert ON whatsapp_sessions;
CREATE POLICY whatsapp_sessions_insert ON whatsapp_sessions
  FOR INSERT WITH CHECK (is_account_member(account_id));
