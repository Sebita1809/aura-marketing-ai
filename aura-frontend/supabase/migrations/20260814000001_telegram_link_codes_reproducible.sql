-- Migration: Telegram link codes (one-time) — reproducible
-- Materializa el camino real de vinculación de Telegram que hasta ahora vivía solo
-- en la DB live (creado a mano): la tabla public.telegram_link_codes y el RPC
-- public.link_telegram_with_code que consume el frontend (ConnectionsPage.jsx).
--
-- Decisiones de diseño (design.md del change link-code-reproducible):
--   D1 — `code` es `text` con CHECK (char_length = 6), NO `bpchar` como en live.
--        Las comparaciones del RPC (code = p_code) y los filtros PostgREST
--        (code=eq.<código>) son el caso estándar de `text` sin semántica de padding.
--        Drift conocido y documentado (no bloqueante): en la DB live la columna
--        sigue siendo `bpchar`; para códigos de exactamente 6 dígitos ambos tipos
--        se comportan idéntico. Limpieza futura opcional: ALTER ... TYPE text.
--   D2 — RLS ENABLED sin políticas y sin FORCE. Únicos consumidores de la tabla:
--        (a) n8n con `service_role` y (b) el RPC `SECURITY DEFINER`; ambos bypasean
--        RLS. El frontend nunca lee la tabla directo (solo llama al RPC), por lo
--        que cero políticas = anon/authenticated jamás leen códigos en bruto.
--   D9 — Se asume `profiles.telegram_chat_id` de tipo `text` (el frontend guarda el
--        chat_id como string). Si en live la columna fuera numérica, agregar el
--        cast `found_chat::bigint` en el UPDATE del RPC (1 línea, pending-manual).
--   Fuera de scope: `telegram_link_tokens` (migración 20260630000002) es legacy no
--        usado por ningún código; se deja intacta. Limpieza futura documentada.

-- Tabla idempotente: no-op en la DB live (no altera el esquema existente, incl.
-- el `bpchar` de `code`, D1); crea el esquema completo en DBs nuevas.
CREATE TABLE IF NOT EXISTS public.telegram_link_codes (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  chat_id    text        NOT NULL,
  code       text        NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telegram_link_codes_pkey PRIMARY KEY (id),
  CONSTRAINT telegram_link_codes_code_length_check CHECK (char_length(code) = 6)
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_expires
  ON public.telegram_link_codes (expires_at);

-- RLS habilitado sin políticas (D2): único acceso permitido es via service_role
-- (n8n) y el RPC SECURITY DEFINER. Idempotente: re-habilitarlo es un no-op.
ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;

-- RPC que ejecuta el vínculo desde la web. Contrato con ConnectionsPage.jsx:
--   { success: boolean, chat_id: text|null, error: text|null }
-- SECURITY DEFINER + search_path fijo para bypasear RLS con seguridad y evitar
-- hijacking del search_path. El dueño de la función es el rol de migración.
CREATE OR REPLACE FUNCTION public.link_telegram_with_code(p_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  found_id   uuid;
  found_chat text;
  updated    int;
BEGIN
  -- El RPC es solo para usuarios web autenticados; bajo service_role auth.uid()
  -- es NULL y no existe forma segura de asociar el código a un perfil.
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Usuario no autenticado.');
  END IF;

  -- Código vigente y no usado (expiración por expires_at > now()).
  SELECT id, chat_id
    INTO found_id, found_chat
    FROM public.telegram_link_codes
   WHERE code = p_code
     AND used_at IS NULL
     AND expires_at > now()
   LIMIT 1;

  IF found_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Código inválido o expirado.');
  END IF;

  -- Vincula el chat_id al perfil del usuario llamador. Si el perfil no existe
  -- (row_count 0) se devuelve error sin marcar el código como usado.
  UPDATE public.profiles
     SET telegram_chat_id = found_chat
   WHERE id = auth.uid();
  GET DIAGNOSTICS updated = ROW_COUNT;

  IF updated = 0 THEN
    RETURN json_build_object('success', false, 'error', 'No se encontró el perfil del usuario.');
  END IF;

  -- Marca el código como usado (one-time).
  UPDATE public.telegram_link_codes
     SET used_at = now()
   WHERE id = found_id;

  RETURN json_build_object('success', true, 'chat_id', found_chat);
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_telegram_with_code(text) TO authenticated;
