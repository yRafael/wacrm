-- ============================================================
-- 048_auto_trial_on_signup.sql — Auto-create trial subscription
--
-- Extends the signup trigger (migration 017) so that every new user
-- signing up through /signup automatically receives:
--
--   1. A platform_subscriptions row with status = 'TRIAL'
--   2. expires_at = started_at + 7 days (doc TELADECADASSTRO.txt §4.5)
--   3. The default 'fire_user' plan (code = 'fire_user', seeded in 046)
--
-- This is the entry point of the subscription gating system (§4.4):
-- without it, new accounts would have no subscription at all and the
-- gating check would fall through to trial-by-default — which works
-- but leaves no auditable record of the trial period.
--
-- Idempotent: drops and recreates the trigger + function.
-- ============================================================

-- ============================================================
-- Replace the signup trigger to also create a trial subscription
-- ============================================================
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
  v_trial_days INTEGER := 7;
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
      started_at,
      expires_at
    ) VALUES (
      v_account_id,
      v_plan_id,
      'TRIAL',
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
  'Creates account + profile + 7-day trial subscription for new signups (017 + 048).';
