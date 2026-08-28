-- ============================================================
-- 057_trial_3days_and_manual_grant.sql
--
-- 1. Adds subscription_type column to platform_subscriptions
--    ('automatic', 'manual', 'courtesy', 'promotional')
-- 2. Changes the signup trigger to create a 3-day trial instead
--    of 7 (configurable via TRIAL_DURATION_DAYS env var in app)
-- ============================================================

-- 1. Add subscription_type column
ALTER TABLE platform_subscriptions
  ADD COLUMN IF NOT EXISTS subscription_type TEXT NOT NULL DEFAULT 'automatic'
  CHECK (subscription_type IN ('automatic', 'manual', 'courtesy', 'promotional'));

-- 2. Add granted_by and granted_reason for audit trail
ALTER TABLE platform_subscriptions
  ADD COLUMN IF NOT EXISTS granted_by UUID REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS granted_reason TEXT;

-- 3. Update the signup trigger to use 3-day trial
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
  v_plan_id UUID;
  v_trial_days INTEGER := 3;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  -- Create the personal account (same as 017)
  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  -- Link the profile to the new account
  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  -- Create a trial subscription with the default 'fire_user' plan
  SELECT id INTO v_plan_id
  FROM platform_plans
  WHERE code = 'fire_user'
  LIMIT 1;

  IF v_plan_id IS NOT NULL THEN
    INSERT INTO platform_subscriptions (
      account_id,
      plan_id,
      status,
      subscription_type,
      started_at,
      expires_at
    ) VALUES (
      v_account_id,
      v_plan_id,
      'TRIAL',
      'automatic',
      NOW(),
      (NOW() + (v_trial_days || ' days')::INTERVAL)
    );
  ELSE
    RAISE WARNING 'No fire_user plan found; skipping trial subscription for account %', v_account_id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile/subscription for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates account + profile + 3-day trial subscription for new signups (017 + 048 + 057).';
