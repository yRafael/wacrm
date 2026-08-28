-- ============================================================
-- 059_mp_credentials.sql — Per-account Mercado Pago credentials
--
-- Allows each account (reseller) to store their own Mercado Pago
-- access token and webhook secret for independent billing.
-- Tokens are encrypted at rest using AES-256-GCM.
-- ============================================================

CREATE TABLE IF NOT EXISTS account_mercado_pago_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  access_token_encrypted TEXT NOT NULL,
  webhook_secret_encrypted TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id)
);

COMMENT ON TABLE account_mercado_pago_credentials IS
  'Per-account Mercado Pago credentials for independent billing. Tokens encrypted with AES-256-GCM.';

-- Index for quick lookup during webhook processing
CREATE INDEX IF NOT EXISTS idx_mp_credentials_account
  ON account_mercado_pago_credentials (account_id)
  WHERE is_active = true;

-- RLS — service role only (webhooks and checkout use supabaseAdmin)
ALTER TABLE account_mercado_pago_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mp_credentials_service_only ON account_mercado_pago_credentials;
CREATE POLICY mp_credentials_service_only ON account_mercado_pago_credentials
  FOR ALL USING (false);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_mp_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mp_credentials_updated_at ON account_mercado_pago_credentials;
CREATE TRIGGER mp_credentials_updated_at
  BEFORE UPDATE ON account_mercado_pago_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_mp_credentials_updated_at();
