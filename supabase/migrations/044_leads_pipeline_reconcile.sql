-- ============================================================
-- 044_leads_pipeline_reconcile.sql — garante os stages do contrato
--
-- O painel ⚡ Ações da conversa (quick actions) e o trigger
-- on_deal_converted operam por NOME de stage: "Novo Lead" (primeiro
-- stage, onde leads automáticos caem), "Em Teste" (🧪 Colocar em
-- teste) e "Convertido" (💰 conversão). Pipelines "Leads" criados pela
-- versão 041 do ensure_leads_pipeline não têm "Em Teste" nem "Novo
-- Lead" — e a reconciliação da 042 só rodava no momento do apply,
-- então um pipeline que já existia (ou foi criado depois) fica sem o
-- stage e o ⚡ Ações avisa "não tem a opção Em Teste".
--
-- Três peças:
--   1. `reconcile_leads_stages(p_pipeline_id)` — helper SECURITY
--      DEFINER interno (sem auth guard de propósito): garante que o
--      pipeline tenha "Novo Lead" (renomeia o "Novo" da era-041), que
--      "Em Teste" exista na posição 2 (deslocando os seguintes) e que
--      "Convertido" exista. Nunca apaga stage — só renomeia o primeiro
--      da era-041 e insere os faltantes. Idempotente.
--   2. `ensure_leads_pipeline` reescrita para chamar o reconcile em
--      TODO pipeline (novo ou já existente) antes de retornar — o
--      pipeline da conta se auto-repara a cada montagem da board.
--   3. Bloco DO que reconcilia AGORA todos os pipelines "Leads"
--      existentes — aplicar esta migração corrige o banco na hora,
--      sem depender do app.
--
-- Idempotente — safe to run multiple times.
-- ============================================================

-- ============================================================
-- reconcile_leads_stages(p_pipeline_id)
--
-- Garante os stages do contrato em qualquer pipeline "Leads":
--   a. renomeia o primeiro stage da era-041 "Novo" → "Novo Lead"
--      (só quando a conta ainda não renomeou para "Novo Lead");
--   b. insere "Em Teste" na posição 2 quando faltar, deslocando os
--      stages ≥ 2 uma posição para baixo (pipeline_stages não tem
--      UNIQUE em position — mesmo raciocínio da 042);
--   c. insere "Convertido" no fim quando faltar (o trigger
--      on_deal_converted e a ação 💰 dependem dele por nome).
--
-- Sem guard de auth de propósito: é chamado pelo DO block do apply
-- (roda como postgres, auth.uid() NULL) e de dentro de
-- ensure_leads_pipeline (que já tem o guard). Sem GRANT ao público,
-- então só funções do sistema o invocam.
-- ============================================================
CREATE OR REPLACE FUNCTION public.reconcile_leads_stages(p_pipeline_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- a. Era-041: primeiro stage "Novo" → "Novo Lead", salvo se a conta
  --    já tiver um "Novo Lead" em qualquer posição (nunca sobrescreve
  --    uma edição do usuário).
  UPDATE pipeline_stages
     SET name = 'Novo Lead'
   WHERE pipeline_id = p_pipeline_id
     AND position = 0
     AND lower(name) = 'novo'
     AND NOT EXISTS (
       SELECT 1 FROM pipeline_stages s
       WHERE s.pipeline_id = p_pipeline_id
         AND lower(s.name) = 'novo lead'
     );

  -- b. Insere "Em Teste" na posição 2 quando faltar, deslocando os
  --    stages seguintes uma posição para baixo.
  IF NOT EXISTS (
    SELECT 1 FROM pipeline_stages
    WHERE pipeline_id = p_pipeline_id
      AND lower(name) = 'em teste'
  ) THEN
    UPDATE pipeline_stages
       SET position = position + 1
     WHERE pipeline_id = p_pipeline_id
       AND position >= 2;

    INSERT INTO pipeline_stages (pipeline_id, name, color, position)
    VALUES (p_pipeline_id, 'Em Teste', '#8b5cf6', 2);
  END IF;

  -- c. Garante o stage de conversão (triggers por nome).
  IF NOT EXISTS (
    SELECT 1 FROM pipeline_stages
    WHERE pipeline_id = p_pipeline_id
      AND lower(name) = 'convertido'
  ) THEN
    INSERT INTO pipeline_stages (pipeline_id, name, color, position)
    SELECT p_pipeline_id, 'Convertido', '#22c55e',
           COALESCE(MAX(position), -1) + 1
      FROM pipeline_stages
     WHERE pipeline_id = p_pipeline_id;
  END IF;
END;
$$;

ALTER FUNCTION public.reconcile_leads_stages(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reconcile_leads_stages(UUID) FROM PUBLIC;

-- ============================================================
-- ensure_leads_pipeline — agora auto-reparável
--
-- Mesma seed da 042 (Novo Lead → Em contato → Em Teste → Negociação →
-- Convertido → Sem resposta → Perdido), mas em vez de retornar cedo
-- quando o pipeline já existe, chama reconcile_leads_stages antes de
-- retornar. Assim qualquer chamada (montagem da board, seed) conserta
-- um pipeline criado por versão antiga da função.
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

  IF v_pipeline_id IS NULL THEN
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
  END IF;

  -- Self-heal: garante os stages do contrato mesmo em pipeline criado
  -- por versão antiga da função (ex.: 041, sem "Em Teste"/"Novo Lead").
  PERFORM public.reconcile_leads_stages(v_pipeline_id);

  RETURN v_pipeline_id;
END;
$$;

ALTER FUNCTION public.ensure_leads_pipeline(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ensure_leads_pipeline(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_leads_pipeline(UUID) TO authenticated;

-- ============================================================
-- Reconciliar AGORA todos os pipelines "Leads" existentes.
-- Corrige imediatamente a conta do usuário ao aplicar a migração.
-- ============================================================
DO $$
DECLARE
  v_pipeline RECORD;
BEGIN
  FOR v_pipeline IN
    SELECT id FROM pipelines WHERE lower(name) = 'leads'
  LOOP
    PERFORM public.reconcile_leads_stages(v_pipeline.id);
  END LOOP;
END;
$$;
