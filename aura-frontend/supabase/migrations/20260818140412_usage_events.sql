-- Migration: usage events log + AI model prices + admin dashboard aggregation RPC
-- Change: admin-dashboard-metrics, Group 1 (design.md D1, D2, D3, D4, D5, D9, D10, D13)
--
-- Qué resuelve: hoy no existe ninguna tabla que registre imágenes generadas,
-- publicaciones o llamadas a modelos de Google AI (el workflow n8n en codigo.json
-- las produce pero no las loguea). Este archivo crea el sustrato de datos y el
-- único punto de lectura agregada que usa el dashboard de admin.
--
-- Decisiones de diseño relevantes para quien lea/mantenga esto:
--   D1 — usage_events es un log append-only genérico (event_type), no contadores
--        ni una tabla por métrica. Agregar una métrica nueva es un event_type
--        nuevo, sin migración.
--   D2 — el costo NO se guarda en el evento: se calcula a tiempo de lectura contra
--        ai_model_prices, tomando el precio vigente a la fecha del evento
--        (effective_from <= occurred_at, el más reciente). Corregir un precio es
--        un INSERT nuevo; la historia ya costeada no se reescribe.
--   D5 — RLS ENABLED en ambas tablas y CERO políticas para anon/authenticated:
--        nadie lee estas tablas directo desde la web. n8n escribe con
--        service_role (bypasea RLS, mismo patrón que telegram_link_codes). La
--        única lectura agregada es el RPC admin_dashboard_metrics, que es
--        SECURITY DEFINER y valida rol admin como primera instrucción.
--   D9 — idempotencia de escritura por event_key UNIQUE: un reintento de n8n
--        (retryOnFail) con el mismo event_key es un no-op via
--        `Prefer: resolution=ignore-duplicates`, nunca un duplicado.
--   La escritura de eventos la hace el change hermano n8n-usage-events-logging
--   sobre codigo.json (design D8) — este change NO toca codigo.json.
--
-- Nota de apply (verificado en vivo, 2026-08-18, project ref legffrhakunfignlaftl):
-- el change hermano admin-user-management (archivado) ya agregó
-- public.is_active_admin() — SECURITY DEFINER, STABLE, `role = 'admin' AND
-- status = 'active'` — para el mismo propósito de "es admin" que necesita este
-- RPC. Se reutiliza esa función en vez de duplicar el chequeo inline que
-- proponía design.md D5 (`role = 'admin'` sin mirar status): un admin
-- bloqueado/dado de baja no debería poder leer métricas globales tampoco, y
-- reusar la función ya probada evita que el criterio de "admin" diverja entre
-- RPCs. Ver el reporte de apply para la justificación completa — es una
-- desviación menor y reversible respecto del texto literal de design.md D5
-- (cambiar a la condición inline original es una sola línea si se prefiere).

-- ============================================================================
-- 1. usage_events — log append-only (D1)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.usage_events (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  event_key      text        NOT NULL,
  event_type     text        NOT NULL,
  user_id        uuid        NULL,
  telegram_chat_id text      NULL,
  provider       text        NOT NULL DEFAULT 'google',
  model          text        NULL,
  quantity       integer     NOT NULL DEFAULT 1,
  input_tokens   integer     NULL,
  output_tokens  integer     NULL,
  metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_events_pkey PRIMARY KEY (id),
  CONSTRAINT usage_events_event_key_key UNIQUE (event_key),
  CONSTRAINT usage_events_event_type_check CHECK (
    event_type IN ('image_generated', 'image_edited', 'post_published', 'ai_call')
  ),
  CONSTRAINT usage_events_quantity_check CHECK (quantity > 0),
  CONSTRAINT usage_events_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES public.profiles (id) ON DELETE SET NULL
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_usage_events_occurred_at
  ON public.usage_events (occurred_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_type_occurred
  ON public.usage_events (event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_user
  ON public.usage_events (user_id);

COMMENT ON TABLE public.usage_events IS
  'Log append-only de eventos de uso (imágenes, publicaciones, llamadas Gemini). Fuente de las métricas 2-4 del dashboard de admin. Escrito por n8n con service_role (change hermano n8n-usage-events-logging); leído solo vía el RPC admin_dashboard_metrics. Ver design.md D1/D5/D9 de admin-dashboard-metrics.';
COMMENT ON COLUMN public.usage_events.event_key IS
  'Idempotencia (D9): <execution_id>:<node_name>:<item_index>. UNIQUE + Prefer: resolution=ignore-duplicates en el INSERT evita doble conteo en reintentos de n8n.';

-- RLS habilitado, sin políticas (D5): el único acceso de lectura permitido es
-- vía el RPC SECURITY DEFINER de más abajo; n8n escribe con service_role, que
-- bypasea RLS. Idempotente: re-habilitarlo es un no-op.
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. ai_model_prices — precios de lista versionados por effective_from (D2)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ai_model_prices (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  model          text        NOT NULL,
  unit           text        NOT NULL,
  unit_cost_usd  numeric(12,8) NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  is_estimate    boolean     NOT NULL DEFAULT true,
  notes          text        NULL,
  CONSTRAINT ai_model_prices_pkey PRIMARY KEY (id),
  CONSTRAINT ai_model_prices_unit_check CHECK (
    unit IN ('image', 'input_token', 'output_token')
  ),
  CONSTRAINT ai_model_prices_model_unit_effective_key
    UNIQUE (model, unit, effective_from)
) TABLESPACE pg_default;

COMMENT ON TABLE public.ai_model_prices IS
  'Precios de lista estimados por modelo/unidad, versionados por effective_from. El RPC toma el precio vigente a la fecha del evento (D2): corregir un precio es un INSERT nuevo, nunca un UPDATE que reescriba historia.';

ALTER TABLE public.ai_model_prices ENABLE ROW LEVEL SECURITY;

-- Seed de precios — PLACEHOLDERS marcados is_estimate = true, pendientes de
-- confirmación del usuario (design.md OQ2/OQ3, no resuelto al momento del
-- apply). Valores ilustrativos, NO facturación real de Google Cloud. El
-- fallback de "tokens promedio por invocación" para llamadas Gemini sin
-- usageMetadata (design D3) lo aplica el productor (n8n) mandando null en
-- input_tokens/output_tokens; ese evento contribuye 0 a los términos de token
-- y solo cuenta como invocación en el desglose por modelo.
INSERT INTO public.ai_model_prices (model, unit, unit_cost_usd, is_estimate, notes)
VALUES
  ('models/gemini-3-pro-image-preview', 'image', 0.04000000, true,
   'PLACEHOLDER pendiente de confirmación (OQ2): precio de lista estimado por imagen generada o editada. Ajustar effective_from + nueva fila cuando se confirme.'),
  ('models/gemini-2.5-flash', 'input_token', 0.00000015, true,
   'PLACEHOLDER pendiente de confirmación (OQ2): ~$0.15 por millón de tokens de entrada. Si un evento ai_call no trae input_tokens (falta usageMetadata), no se le imputa costo por este término — se cuenta como invocación sin tokens medidos.'),
  ('models/gemini-2.5-flash', 'output_token', 0.00000060, true,
   'PLACEHOLDER pendiente de confirmación (OQ2): ~$0.60 por millón de tokens de salida. Mismo criterio de fallback que input_token.')
ON CONFLICT (model, unit, effective_from) DO NOTHING;

-- ============================================================================
-- 3. admin_dashboard_metrics — RPC de agregación (D4, D5, D10, D13)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_dashboard_metrics(p_from timestamptz, p_to timestamptz)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  -- Primera instrucción (riesgo R7): falla cerrada si el llamador no es un
  -- admin activo. is_active_admin() ya existe (change admin-user-management,
  -- migración 20260817223651) y valida profiles.role = 'admin' AND
  -- profiles.status = 'active' contra auth.uid() — ver nota de cabecera.
  IF NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH period_events AS (
    SELECT *
    FROM public.usage_events
    WHERE occurred_at >= p_from AND occurred_at < p_to
  ),
  priced_events AS (
    SELECT
      e.event_type,
      e.model,
      e.quantity,
      e.input_tokens,
      e.output_tokens,
      CASE
        WHEN e.event_type IN ('image_generated', 'image_edited')
          THEN e.quantity * COALESCE(img_price.unit_cost_usd, 0)
        WHEN e.event_type = 'ai_call'
          THEN COALESCE(e.input_tokens, 0) * COALESCE(in_price.unit_cost_usd, 0)
             + COALESCE(e.output_tokens, 0) * COALESCE(out_price.unit_cost_usd, 0)
        ELSE 0
      END AS event_cost_usd,
      CASE
        WHEN e.event_type IN ('image_generated', 'image_edited')
          THEN img_price.unit_cost_usd IS NOT NULL
        WHEN e.event_type = 'ai_call'
          THEN (in_price.unit_cost_usd IS NOT NULL OR out_price.unit_cost_usd IS NOT NULL)
        ELSE false
      END AS is_priced
    FROM period_events e
    LEFT JOIN LATERAL (
      SELECT p.unit_cost_usd FROM public.ai_model_prices p
      WHERE p.model = e.model AND p.unit = 'image' AND p.effective_from <= e.occurred_at
      ORDER BY p.effective_from DESC LIMIT 1
    ) img_price ON e.event_type IN ('image_generated', 'image_edited')
    LEFT JOIN LATERAL (
      SELECT p.unit_cost_usd FROM public.ai_model_prices p
      WHERE p.model = e.model AND p.unit = 'input_token' AND p.effective_from <= e.occurred_at
      ORDER BY p.effective_from DESC LIMIT 1
    ) in_price ON e.event_type = 'ai_call'
    LEFT JOIN LATERAL (
      SELECT p.unit_cost_usd FROM public.ai_model_prices p
      WHERE p.model = e.model AND p.unit = 'output_token' AND p.effective_from <= e.occurred_at
      ORDER BY p.effective_from DESC LIMIT 1
    ) out_price ON e.event_type = 'ai_call'
    WHERE e.event_type IN ('image_generated', 'image_edited', 'ai_call')
  ),
  by_model AS (
    SELECT
      model,
      count(*) AS events,
      COALESCE(sum(quantity) FILTER (WHERE event_type IN ('image_generated', 'image_edited')), 0) AS images,
      COALESCE(sum(input_tokens), 0) AS tokens_in,
      COALESCE(sum(output_tokens), 0) AS tokens_out,
      COALESCE(sum(event_cost_usd), 0) AS cost_usd,
      bool_or(is_priced) AS priced
    FROM priced_events
    GROUP BY model
  ),
  daily_series AS (
    SELECT
      date_trunc('day', occurred_at AT TIME ZONE 'America/Argentina/Buenos_Aires') AS day,
      COALESCE(sum(quantity) FILTER (WHERE event_type IN ('image_generated', 'image_edited')), 0) AS images,
      COALESCE(sum(quantity) FILTER (WHERE event_type = 'post_published'), 0) AS posts
    FROM period_events
    GROUP BY 1
  )
  SELECT json_build_object(
    'clients', json_build_object(
      'total', (SELECT count(*) FROM public.profiles),
      'active', (SELECT count(*) FROM public.profiles WHERE is_active IS DISTINCT FROM false)
    ),
    'cost', json_build_object(
      'usd', COALESCE((SELECT sum(event_cost_usd) FROM priced_events), 0)
    ),
    'posts', COALESCE((SELECT sum(quantity) FROM period_events WHERE event_type = 'post_published'), 0),
    'images', json_build_object(
      'new', COALESCE((SELECT sum(quantity) FROM period_events WHERE event_type = 'image_generated'), 0),
      'redone', COALESCE((SELECT sum(quantity) FROM period_events WHERE event_type = 'image_edited'), 0),
      'total', COALESCE((SELECT sum(quantity) FROM period_events WHERE event_type IN ('image_generated', 'image_edited')), 0)
    ),
    'by_model', COALESCE((
      SELECT json_agg(json_build_object(
        'model', model,
        'events', events,
        'images', images,
        'tokens_in', tokens_in,
        'tokens_out', tokens_out,
        'cost_usd', cost_usd,
        'priced', priced
      ) ORDER BY cost_usd DESC)
      FROM by_model
    ), '[]'::json),
    'daily', COALESCE((
      SELECT json_agg(json_build_object(
        'day', to_char(day, 'YYYY-MM-DD'),
        'images', images,
        'posts', posts
      ) ORDER BY day)
      FROM daily_series
    ), '[]'::json),
    'first_event_at', (SELECT min(occurred_at) FROM public.usage_events),
    'last_event_at', (SELECT max(occurred_at) FROM public.usage_events),
    'period', json_build_object('from', p_from, 'to', p_to)
  )
  INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dashboard_metrics(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_metrics(timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.admin_dashboard_metrics(timestamptz, timestamptz) IS
  'Único punto de lectura agregada para el dashboard de admin. SECURITY DEFINER + chequeo de rol como primera instrucción (falla cerrada); RLS de usage_events/ai_model_prices no tiene políticas, así que esta función es la única vía de lectura agregada. Ver design.md D4/D5/D10/D13 de admin-dashboard-metrics.';
