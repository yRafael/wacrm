-- ============================================================
-- 042_leads_em_teste.sql — "Em Teste" stage + "Novo Lead" rename
--
-- Follow-up to 041. The Leads pipeline gains an "Em Teste" stage
-- (the lead is trialling the service) and its first stage is renamed
-- to "Novo Lead" so automatic leads land somewhere with the right
-- vocabulary. Two parts:
--
--   1. New `ensure_leads_pipeline` seed: Novo Lead → Em contato →
--      Em Teste → Negociação → Convertido → Sem resposta → Perdido.
--   2. Reconciliation of EXISTING "Leads" pipelines seeded by 041:
--      a. rename the position-0 "Novo" stage to "Novo Lead" (only when
--         no "Novo Lead" stage exists yet — never clobber a user edit);
--      b. insert "Em Teste" at position 2, shifting later stages down.
--
-- Idempotent — safe to run multiple times. "Convertido" stays the
-- conversion stage the 041 trigger keys on (matched by name, so its
-- position moving doesn't matter).
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
    (v_pipeline_id, 'Novo Lead',    '#3b82f6', 0),  -- blue
    (v_pipeline_id, 'Em contato',   '#eab308', 1),  -- yellow
    (v_pipeline_id, 'Em Teste',     '#8b5cf6', 2),  -- purple
    (v_pipeline_id, 'Negociação',   '#f97316', 3),  -- orange
    (v_pipeline_id, 'Convertido',   '#22c55e', 4),  -- green
    (v_pipeline_id, 'Sem resposta', '#6b7280', 5),  -- gray
    (v_pipeline_id, 'Perdido',      '#ef4444', 6);  -- red

  RETURN v_pipeline_id;
END;
$$;

ALTER FUNCTION public.ensure_leads_pipeline(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ensure_leads_pipeline(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_leads_pipeline(UUID) TO authenticated;

-- ============================================================
-- Reconcile pipelines seeded by 041 (created before "Em Teste").
-- pipeline_stages has no unique constraint on position, so the
-- shift + insert below is safe.
-- ============================================================
DO $$
DECLARE
  v_pipeline RECORD;
BEGIN
  FOR v_pipeline IN
    SELECT id FROM pipelines WHERE lower(name) = 'leads'
  LOOP
    -- a. Rename the 041-era "Novo" first stage, unless the account
    --    already renamed it to "Novo Lead" itself.
    UPDATE pipeline_stages
       SET name = 'Novo Lead'
     WHERE pipeline_id = v_pipeline.id
       AND position = 0
       AND lower(name) = 'novo'
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_stages s
         WHERE s.pipeline_id = v_pipeline.id
           AND lower(s.name) = 'novo lead'
       );

    -- b. Insert "Em Teste" at position 2 when missing, shifting the
    --    stages after it (Negociação onwards) down by one.
    IF NOT EXISTS (
      SELECT 1 FROM pipeline_stages
      WHERE pipeline_id = v_pipeline.id
        AND lower(name) = 'em teste'
    ) THEN
      UPDATE pipeline_stages
         SET position = position + 1
       WHERE pipeline_id = v_pipeline.id
         AND position >= 2;

      INSERT INTO pipeline_stages (pipeline_id, name, color, position)
      VALUES (v_pipeline.id, 'Em Teste', '#8b5cf6', 2);
    END IF;
  END LOOP;
END;
$$;
