-- ============================================================
-- 047_subscription_gating.sql — Add TRIAL/SUSPENDED to subscription status
--
-- Adds the missing statuses for the subscription gating system
-- (doc TELADECADASSTRO.txt §4).
--
-- Existing rows are unaffected (no default change needed).
-- ============================================================

ALTER TABLE platform_subscriptions
  DROP CONSTRAINT IF EXISTS platform_subscriptions_status_check,
  ADD CONSTRAINT platform_subscriptions_status_check
  CHECK (
    status IN (
      'TRIAL',        -- New account in trial period (3 days, see 057)
      'ACTIVE',       -- Paid subscription active
      'PAST_DUE',     -- Payment overdue, grace period active
      'SUSPENDED',    -- Grace period expired, access blocked
      'CANCELED',     -- User-initiated cancellation
      'EXPIRED'       -- Trial ended or subscription lapsed
    )
  );

COMMENT ON COLUMN platform_subscriptions.status IS
  'TRIAL (new, 3-day trial) | ACTIVE (paid, in grace) | PAST_DUE (overdue, within grace) | SUSPENDED (blocked) | CANCELED (user cancelled) | EXPIRED (lapsed)';
