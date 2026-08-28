-- ============================================================
-- 050_subscription_reminders.sql — automatic expiration reminders
--
-- Adds reminder-tracking columns to iptv_credentials and a
-- SECURITY DEFINER function that the daily cron job calls to
-- find subscriptions expiring within the configured window and
-- mark them as reminded.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- Reminder tracking columns on iptv_credentials
ALTER TABLE iptv_credentials
  ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_iptv_credentials_reminder
  ON iptv_credentials(account_id, expires_at)
  WHERE deleted_at IS NULL AND reminder_enabled = TRUE AND last_reminder_sent_at IS NULL;

-- ============================================================
-- FIND_EXPIRING_CREDENTIALS — called by the daily cron job.
--
-- Returns credentials expiring within `p_days_ahead` days that
-- have not yet been reminded for this cycle. The cron job uses
-- this list to send WhatsApp template messages and then calls
-- mark_reminder_sent() to avoid duplicates.
-- ============================================================
CREATE OR REPLACE FUNCTION public.find_expiring_credentials(
  p_account_id UUID DEFAULT NULL,
  p_days_ahead INTEGER DEFAULT 3
)
RETURNS TABLE (
  credential_id UUID,
  account_id UUID,
  contact_id UUID,
  contact_name TEXT,
  contact_phone TEXT,
  server_name TEXT,
  plan_name TEXT,
  username TEXT,
  expires_at TIMESTAMPTZ,
  days_until INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Caller must be authenticated.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    ic.id AS credential_id,
    ic.account_id,
    ic.contact_id,
    c.name AS contact_name,
    c.phone AS contact_phone,
    s.name AS server_name,
    p.name AS plan_name,
    ic.username,
    ic.expires_at,
    EXTRACT(DAY FROM (ic.expires_at - NOW()))::INTEGER AS days_until
  FROM iptv_credentials ic
  JOIN contacts c ON c.id = ic.contact_id
  LEFT JOIN servers s ON s.id = ic.server_id
  LEFT JOIN plans p ON p.id = ic.plan_id
  WHERE ic.deleted_at IS NULL
    AND ic.status = 'active'
    AND ic.reminder_enabled = TRUE
    AND ic.last_reminder_sent_at IS NULL
    AND ic.expires_at <= NOW() + (p_days_ahead || ' days')::INTERVAL
    AND ic.expires_at > NOW()
    AND (p_account_id IS NULL OR ic.account_id = p_account_id)
  ORDER BY ic.expires_at ASC;
END;
$$;

ALTER FUNCTION public.find_expiring_credentials(UUID, INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.find_expiring_credentials(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_expiring_credentials(UUID, INTEGER) TO authenticated;

-- ============================================================
-- MARK_REMINDER_SENT — called after a reminder is successfully
-- sent to prevent duplicate sends in the same cycle.
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_reminder_sent(
  p_credential_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE iptv_credentials
  SET last_reminder_sent_at = NOW(),
      updated_at = NOW()
  WHERE id = p_credential_id
    AND account_id = (
      SELECT account_id FROM profiles WHERE user_id = auth.uid()
    );
END;
$$;

ALTER FUNCTION public.mark_reminder_sent(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_reminder_sent(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_reminder_sent(UUID) TO authenticated;
