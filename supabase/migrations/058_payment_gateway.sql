-- ============================================================
-- 058_payment_gateway.sql — Mercado Pago integration columns
--
-- Adds payment provider columns to platform_subscriptions and
-- creates payment_events table for webhook audit trail.
-- ============================================================

-- 1. Add payment provider columns to platform_subscriptions
ALTER TABLE platform_subscriptions
  ADD COLUMN IF NOT EXISTS payment_provider TEXT
    CHECK (payment_provider IN ('mercado_pago', 'stripe')),
  ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;

-- Index for webhook lookups by provider subscription ID
CREATE INDEX IF NOT EXISTS idx_platform_subscriptions_provider_id
  ON platform_subscriptions (provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

-- 2. Create payment_events table for webhook audit trail
CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id UUID NOT NULL REFERENCES platform_subscriptions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('mercado_pago', 'stripe')),
  event_type TEXT NOT NULL,
  provider_event_id TEXT,
  raw_payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for idempotency checks and lookups
CREATE INDEX IF NOT EXISTS idx_payment_events_provider
  ON payment_events (provider, provider_event_id);

CREATE INDEX IF NOT EXISTS idx_payment_events_subscription
  ON payment_events (subscription_id);

-- 3. RLS — only service role accesses payment_events (append-only audit)
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_events_service_only ON payment_events
  FOR ALL USING (false);

-- Service role bypasses RLS, so the webhook endpoint (using supabaseAdmin)
-- can insert. Regular users cannot read payment_events.
