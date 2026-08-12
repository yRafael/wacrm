-- ============================================================
-- 045_branding.sql — identidade visual por empresa (white-label)
--
-- "Rafael é um usuário da empresa Vision" — amanhã João → João IPTV,
-- Maria → Maria Play. Cada empresa entra no mesmo Workspace e enxerga
-- a PRÓPRIA cara: logo, nome, cor da marca, banner do dashboard e
-- fundo/cores do chat. Uma empresa jamais vê ou usa os arquivos e
-- configurações de outra.
--
-- Três peças:
--   1. `account_branding` — a config visual da empresa (1:1 com
--      accounts). Colunas tipadas pra logo/banner; o resto (cores,
--      fundo do chat, balões) vive no `config` JSONB.
--   2. Bucket PRIVADO `branding` + RLS em storage.objects via helper
--      `branding_bucket_access` — o path é `account-<uuid>/...` e a
--      RLS só libera objetos do próprio `account-<uuid>` do caller.
--      Leitura = membro (viewer+), escrita = admin (settings-tier).
--   3. RLS da tabela no mesmo contrato: membros leem, admin escreve.
--
-- Sem seed: sem branding a empresa mantém a identidade Fire atual —
-- a feature é 100% opt-in por conta.
--
-- Idempotente — safe to run multiple times.
-- ============================================================

-- ============================================================
-- ACCOUNT_BRANDING
-- ============================================================
CREATE TABLE IF NOT EXISTS account_branding (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  -- Objetos do bucket 'branding' (account-scoped), path
  -- `account-<uuid>/logo-...` / `.../banner-...`.
  logo_path  TEXT,
  banner_path TEXT,
  -- Cores da marca + fundo do chat + balões. Shape (consumido pela
  -- lib src/lib/branding/types.ts):
  --   {
  --     colors: { primary, primaryForeground, primaryHover, primarySoft, ring },
  --     chat: {
  --       background: { kind: 'none'|'preset'|'image', presetId?, path?,
  --                     opacity, blur, scale, position, overlayColor, overlayOpacity },
  --       bubbles: { sentBg, sentText, receivedBg, receivedText }
  --     }
  --   }
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE account_branding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_branding_select ON account_branding;
DROP POLICY IF EXISTS account_branding_insert ON account_branding;
DROP POLICY IF EXISTS account_branding_update ON account_branding;
DROP POLICY IF EXISTS account_branding_delete ON account_branding;
-- Membros leem (a identidade da empresa vale pra todo o time).
CREATE POLICY account_branding_select ON account_branding
  FOR SELECT USING (is_account_member(account_id));
-- Settings-tier: só admin (owner/admin) personaliza a empresa.
CREATE POLICY account_branding_insert ON account_branding
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY account_branding_update ON account_branding
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY account_branding_delete ON account_branding
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON account_branding;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON account_branding
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- BUCKET PRIVADO 'branding'
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'branding',
  'branding',
  FALSE, -- privado: nunca servido por URL pública; só via proxy autenticado
  5242880, -- 5 MB — imagens de logo/banner/fundo
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- HELPER DE ACESSO AO BUCKET
--
-- Extrai o `account-<uuid>` do primeiro segmento do path (convenção
-- do upload, igual flow-media/chat-media) e delega a checagem de
-- tenancy ao `is_account_member`. SECURITY DEFINER + sem GRANT ao
-- público — só o PostgREST (authenticated) avalia as policies.
-- ============================================================
CREATE OR REPLACE FUNCTION public.branding_bucket_access(
  bucket_name TEXT,
  object_path TEXT,
  min_role account_role_enum DEFAULT 'viewer'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  IF bucket_name IS DISTINCT FROM 'branding' THEN
    RETURN false;
  END IF;

  -- O primeiro segmento do path é `account-<uuid>`. UUID inválido ou
  -- ausente → false (jamais cai no default de permitir).
  v_account_id := NULLIF(
    substring(
      split_part(object_path, '/', 1)
      FROM '^account-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'
    ),
    ''
  )::uuid;

  IF v_account_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN public.is_account_member(v_account_id, min_role);
END;
$$;

ALTER FUNCTION public.branding_bucket_access(TEXT, TEXT, account_role_enum)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.branding_bucket_access(TEXT, TEXT, account_role_enum)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.branding_bucket_access(TEXT, TEXT, account_role_enum)
  TO authenticated, service_role;

-- ============================================================
-- POLICIES DO STORAGE
-- ============================================================
DROP POLICY IF EXISTS "Branding assets are company-readable" ON storage.objects;
CREATE POLICY "Branding assets are company-readable"
  ON storage.objects FOR SELECT
  USING (public.branding_bucket_access(bucket_id, name, 'viewer'));

DROP POLICY IF EXISTS "Admins upload company branding" ON storage.objects;
CREATE POLICY "Admins upload company branding"
  ON storage.objects FOR INSERT
  WITH CHECK (public.branding_bucket_access(bucket_id, name, 'admin'));

DROP POLICY IF EXISTS "Admins update company branding" ON storage.objects;
CREATE POLICY "Admins update company branding"
  ON storage.objects FOR UPDATE
  USING (public.branding_bucket_access(bucket_id, name, 'admin'));

DROP POLICY IF EXISTS "Admins delete company branding" ON storage.objects;
CREATE POLICY "Admins delete company branding"
  ON storage.objects FOR DELETE
  USING (public.branding_bucket_access(bucket_id, name, 'admin'));

-- ============================================================
-- REALTIME — mudanças de branding refletem em abas já abertas
-- (um admin salvando cor enquanto o time tem o app aberto).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'account_branding'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE account_branding;
  END IF;
END $$;