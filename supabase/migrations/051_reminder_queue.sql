-- ============================================================
-- 051_reminder_queue.sql — batch reminder queue with interval
--
-- Supports the "Renovações" page batch-send feature: operators
-- select N expiring clients and enqueue reminders that the worker
-- processes with a configurable delay between sends.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS reminder_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminder_queue_account_status
  ON reminder_queue(account_id, status, scheduled_for)
  WHERE status IN ('pending', 'sending');

CREATE INDEX IF NOT EXISTS idx_reminder_queue_scheduled
  ON reminder_queue(scheduled_for)
  WHERE status = 'pending';

ALTER TABLE reminder_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reminder_queue_select ON reminder_queue;
DROP POLICY IF EXISTS reminder_queue_insert ON reminder_queue;
DROP POLICY IF EXISTS reminder_queue_update ON reminder_queue;
DROP POLICY IF EXISTS reminder_queue_delete ON reminder_queue;

CREATE POLICY reminder_queue_select ON reminder_queue
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY reminder_queue_insert ON reminder_queue
  FOR INSERT WITH CHECK (is_account_member(account_id));
CREATE POLICY reminder_queue_update ON reminder_queue
  FOR UPDATE USING (is_account_member(account_id));
CREATE POLICY reminder_queue_delete ON reminder_queue
  FOR DELETE USING (is_account_member(account_id));

DROP TRIGGER IF EXISTS set_updated_at ON reminder_queue;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON reminder_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
