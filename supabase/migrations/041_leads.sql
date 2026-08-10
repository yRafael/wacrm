-- ============================================================
-- 041_leads.sql — Leads via deals/pipelines (Fase 3, doc Cap. 47)
--
-- The workspace reuses the wacrm Kanban (deals + pipelines) as its
-- Leads board. A deal IS a lead: it already points at a contact, so
-- history is preserved across conversion (migration 004 keeps the
-- contact_id via ON DELETE SET NULL).
--
-- This migration adds two pieces:
--   1. `ensure_leads_pipeline` — an idempotent SECURITY DEFINER seed
--      that creates a "Leads" pipeline with the spec's stages
--      (Novo → Em contato → Negociação → Sem resposta → Convertido →
--      Perdido) if the account doesn't have one yet.
--   2. `on_deal_converted` — a trigger that, whenever a deal lands on
--      a stage named "Convertido", automatically marks it 'won' and
--      notifies the account owner ("O Lead automaticamente vira
--      Cliente. Mantendo todo histórico."). Conversion is purely a
--      status + notification change — no history is destroyed.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- EXTEND notifications.type CHECK with lead_converted
-- ============================================================
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned',
    'renewal_due',
    'renewal_paid',
    'payment_received',
    'whatsapp_disconnected',
    'lead_converted'
  ));

-- ============================================================
-- ensure_leads_pipeline(p_account_id)
--
-- Idempotently creates the spec-defined "Leads" pipeline for the
-- caller's account (or p_account_id when given). Returns the existing
-- pipeline id when the account already has one named "Leads", so it is
-- safe to call on every page load.
--
-- Stage names/order match doc Cap. 11 / Cap. 47 exactly. "Convertido"
-- is the conversion stage the trigger below keys on.
--
-- Error contract (matches 018): 42501 forbidden, 22023 bad input.
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_leads_pipeline(
  p_account_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_role account_role_enum;
  v_pipeline_id UUID;
BEGIN
  -- Caller must be authenticated.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Resolve the account from the caller unless one was passed.
  SELECT COALESCE(p_account_id, account_id), account_role
  INTO v_account_id, v_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  -- Leads are an operational flow (agent+), matching deals INSERT RLS.
  IF v_role NOT IN ('owner', 'admin', 'agent') THEN
    RAISE EXCEPTION 'This action requires the agent role or higher'
      USING ERRCODE = '42501';
  END IF;

  -- Already seeded?
  SELECT id INTO v_pipeline_id
  FROM pipelines
  WHERE account_id = v_account_id
    AND lower(name) = 'leads'
  LIMIT 1;

  IF v_pipeline_id IS NOT NULL THEN
    RETURN v_pipeline_id;
  END IF;

  -- Create the pipeline + spec stages.
  INSERT INTO pipelines (user_id, account_id, name)
  VALUES (auth.uid(), v_account_id, 'Leads')
  RETURNING id INTO v_pipeline_id;

  INSERT INTO pipeline_stages (pipeline_id, name, color, position)
  VALUES
    (v_pipeline_id, 'Novo',          '#3b82f6', 0),  -- blue
    (v_pipeline_id, 'Em contato',    '#eab308', 1),  -- yellow
    (v_pipeline_id, 'Negociação',    '#f97316', 2),  -- orange
    (v_pipeline_id, 'Sem resposta',  '#6b7280', 3),  -- gray
    (v_pipeline_id, 'Convertido',    '#22c55e', 4),  -- green
    (v_pipeline_id, 'Perdido',       '#ef4444', 5);  -- red

  RETURN v_pipeline_id;
END;
$$;

ALTER FUNCTION public.ensure_leads_pipeline(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ensure_leads_pipeline(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_leads_pipeline(UUID) TO authenticated;

-- ============================================================
-- on_deal_converted — automatic lead → client conversion
--
-- BEFORE INSERT OR UPDATE OF stage_id: when a deal is placed on (or
-- moved to) a stage whose name is "Convertido", mark it 'won' and
-- notify the account owner. Moving a deal into "Convertido" is the
-- operator's action; the status + notification are the system's.
--
-- One-directional on purpose: leaving "Convertido" later does NOT
-- un-convert, so a conversion is never silently undone.
-- ============================================================
CREATE OR REPLACE FUNCTION public.on_deal_converted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage_name TEXT;
  v_owner_user_id UUID;
  v_contact_name TEXT;
BEGIN
  -- Skip unless this row's stage is actually changing.
  IF TG_OP = 'UPDATE'
     AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  -- Already won → nothing to do (idempotent, no double notification).
  IF NEW.status = 'won' THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_stage_name
  FROM pipeline_stages
  WHERE id = NEW.stage_id;

  IF v_stage_name IS NULL OR lower(v_stage_name) <> 'convertido' THEN
    RETURN NEW;
  END IF;

  -- The lead is now a client.
  NEW.status := 'won';
  NEW.updated_at := NOW();

  SELECT owner_user_id INTO v_owner_user_id
  FROM accounts
  WHERE id = NEW.account_id;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts
  WHERE id = NEW.contact_id;

  IF v_owner_user_id IS NOT NULL AND v_owner_user_id <> auth.uid() THEN
    INSERT INTO notifications (
      account_id, user_id, type, contact_id, actor_user_id, title, body
    ) VALUES (
      NEW.account_id, v_owner_user_id, 'lead_converted',
      NEW.contact_id, auth.uid(),
      'Lead converted',
      COALESCE(v_contact_name, 'A lead')
        || ' was converted to a client — ' || NEW.title
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a conversion-status failure block the board move itself.
  RAISE WARNING 'Failed to convert deal %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.on_deal_converted() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_deal_converted ON deals;
CREATE TRIGGER on_deal_converted
  BEFORE INSERT OR UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION public.on_deal_converted();
