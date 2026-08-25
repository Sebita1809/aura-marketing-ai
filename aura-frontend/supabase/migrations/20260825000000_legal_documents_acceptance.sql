-- Migration: aceptación de documentos legales (doble aceptación: web + Telegram)
-- Feature: legal-documents-acceptance (2026-08-25). Generaliza el diseño inicial
-- de "privacy-policy-acceptance" (pensado para un solo documento) para soportar
-- N documentos legales (hoy: Política de Privacidad + Términos y Condiciones)
-- sin duplicar tablas por documento.
--
-- Decisiones de diseño:
--   D1 — `legal_documents` es config de una fila por documento (`slug` como PK,
--        restringido por CHECK a los slugs conocidos), leída tanto por el
--        frontend (versión/URL vigentes de cada uno) como por el bot de n8n
--        (vía REST, mismo patrón que ya usa para `profiles`/`products` — no
--        hace falta una Edge Function nueva). Bump manual: cuando cambie el
--        texto legal de un documento, se actualiza su fila (UPDATE) y la
--        constante de versión correspondiente en el frontend.
--   D2 — `legal_acceptances` guarda UNA fila por (user_id, document, channel):
--        re-aceptar (misma versión u otra) hace UPSERT sobre esa fila en vez
--        de duplicar historial. Alcanza para la auditoría pedida (qué
--        documento, qué versión, qué canal, cuándo) sin acumular filas
--        redundantes.
--   D3 — RLS habilitado en ambas tablas, sin políticas de escritura para
--        `authenticated` directo: `legal_acceptances` únicamente se escribe vía
--        el RPC `accept_legal_document` (SECURITY DEFINER, web) o `service_role`
--        (n8n, Telegram) — mismo patrón D2 documentado en
--        `20260814000001_telegram_link_codes_reproducible.sql`. `legal_documents`
--        es de solo lectura pública (nada sensible: versión/URL vigentes).
--   D4 — Reemplaza por completo el diseño de `policy_versions`/`policy_acceptances`
--        de la propuesta anterior (nunca llegó a aplicarse en ninguna DB, por
--        eso se reemplaza en vez de migrar datos).

CREATE TABLE IF NOT EXISTS public.legal_documents (
  slug       text        PRIMARY KEY CHECK (slug IN ('privacy_policy', 'terms_conditions')),
  version    text        NOT NULL,
  url        text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
) TABLESPACE pg_default;

ALTER TABLE public.legal_documents ENABLE ROW LEVEL SECURITY;

-- Config pública de solo lectura (versión/URL vigentes, nada sensible): el
-- frontend la lee con la key `anon` antes incluso de loguearse (footer,
-- páginas públicas de privacidad/términos) y el bot la lee con `service_role`.
GRANT SELECT ON public.legal_documents TO anon, authenticated;

-- Seed: una fila por documento con la versión vigente al momento de este
-- migration. Las URLs se actualizan a mano (UPDATE) si el dominio del
-- frontend cambia (mismo criterio manual que el resto de URLs hardcodeadas
-- del proyecto).
INSERT INTO public.legal_documents (slug, version, url) VALUES
  ('privacy_policy', '2026-08-25', 'https://aura-marketing-ai.vercel.app/privacy-policy'),
  ('terms_conditions', '2026-08-25', 'https://aura-marketing-ai.vercel.app/terms-and-conditions')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  document     text        NOT NULL REFERENCES public.legal_documents(slug),
  channel      text        NOT NULL CHECK (channel IN ('web', 'telegram')),
  version      text        NOT NULL,
  accepted_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_acceptances_pkey PRIMARY KEY (id),
  CONSTRAINT legal_acceptances_user_document_channel_unique UNIQUE (user_id, document, channel)
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user
  ON public.legal_acceptances (user_id);

ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;

-- Único acceso directo permitido a `authenticated`: leer las PROPIAS filas
-- (para que el frontend sepa qué documentos ya aceptó, sin necesitar un RPC
-- de lectura aparte). Escribir sigue siendo solo vía el RPC de abajo
-- (SECURITY DEFINER) o `service_role` (n8n) — no hay policy de INSERT/UPDATE
-- para `authenticated`.
CREATE POLICY legal_acceptances_select_own
  ON public.legal_acceptances
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- RPC que usa el frontend (usuario autenticado) para registrar su aceptación
-- de UN documento en el canal web. Mismo estilo que `link_telegram_with_code`:
-- SECURITY DEFINER + search_path fijo para bypasear RLS con seguridad, valida
-- auth.uid() adentro. El frontend la llama una vez por documento (dos veces
-- en el gate combinado de privacidad+términos).
CREATE OR REPLACE FUNCTION public.accept_legal_document(p_document text, p_channel text, p_version text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Usuario no autenticado.');
  END IF;

  IF p_channel NOT IN ('web', 'telegram') THEN
    RETURN json_build_object('success', false, 'error', 'Canal inválido.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.legal_documents WHERE slug = p_document) THEN
    RETURN json_build_object('success', false, 'error', 'Documento inválido.');
  END IF;

  INSERT INTO public.legal_acceptances (user_id, document, channel, version)
  VALUES (auth.uid(), p_document, p_channel, p_version)
  ON CONFLICT (user_id, document, channel)
  DO UPDATE SET version = EXCLUDED.version, accepted_at = now();

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_legal_document(text, text, text) TO authenticated;
