-- Migration: extensión aditiva de usage_events para user-panel-features
-- Change: user-panel-features, Grupo 1 / resolución de tasks.md 0.7
-- (design.md D1, reconciliado contra la tabla real creada por el change
-- archivado admin-dashboard-metrics, migración 20260818140412)
--
-- Contexto: design.md de user-panel-features fue escrito ANTES de que
-- admin-dashboard-metrics existiera y proponía una tabla usage_events propia
-- (bigserial, event_uid, columnas platform/status/source). admin-dashboard-metrics
-- llegó primero y ya creó la tabla real en producción con otra forma (uuid,
-- event_key, sin platform/status/source, CHECK sin 'post_scheduled'). Este
-- change NO crea una segunda tabla: la extiende de forma aditiva. Ver el
-- reporte de Gate 0 (engram opsx/user-panel-features/gate0) para el análisis
-- completo de la reconciliación.
--
-- Decisiones de esta migración:
--   - Se mantiene id uuid, event_key (no se agrega event_uid) y
--     user_id ... on delete set null tal como están hoy en producción — el
--     event_key determinístico <execution_id>:<node_name>:<platform|-> que
--     usa el bot (Grupo 4) encaja en la misma columna/constraint UNIQUE ya
--     existente (usage_events_event_key_key), sin necesidad de una segunda
--     columna de idempotencia.
--   - platform/status/source son columnas NUEVAS, nullable/con default,
--     100% aditivas: no tocan las filas ni la query existentes del RPC
--     admin_dashboard_metrics (que no las referencia).
--   - El contrato de post_published/post_scheduled pasa a ser "una fila por
--     plataforma" (platform column propia), en vez de la idea original de
--     admin-dashboard-metrics de "una fila, quantity = N plataformas". Es
--     seguro numéricamente: el RPC de admin usa sum(quantity), que da el
--     mismo total en ambos esquemas (N filas de quantity=1 == 1 fila de
--     quantity=N), y esa instrumentación nunca se llegó a escribir.
--   - Se amplía el CHECK de event_type para incluir 'post_scheduled' (aditivo,
--     el resto de los valores permitidos no cambia).

ALTER TABLE public.usage_events
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'telegram_bot';

ALTER TABLE public.usage_events
  DROP CONSTRAINT IF EXISTS usage_events_event_type_check;
ALTER TABLE public.usage_events
  ADD CONSTRAINT usage_events_event_type_check CHECK (
    event_type IN ('image_generated', 'image_edited', 'post_published', 'post_scheduled', 'ai_call')
  );

ALTER TABLE public.usage_events
  ADD CONSTRAINT usage_events_status_check CHECK (status IN ('success', 'failed'));

COMMENT ON COLUMN public.usage_events.platform IS
  'user-panel-features D2: instagram|facebook|threads|twitter|linkedin, null si el evento no es por-plataforma (image_generated/edited/ai_call). Una fila por plataforma publicada/programada, no un array.';
COMMENT ON COLUMN public.usage_events.status IS
  'user-panel-features D11: success|failed. Los productores actuales (Grupo 4) solo emiten en éxito; la columna queda para uso futuro sin requerir migración.';
COMMENT ON COLUMN public.usage_events.source IS
  'user-panel-features: identifica el productor (telegram_bot hoy; deja lugar a futuros productores sin migración).';
COMMENT ON CONSTRAINT usage_events_event_type_check ON public.usage_events IS
  'Ampliado 2026-08-18 (user-panel-features) para incluir post_scheduled, aditivo sobre el CHECK original de admin-dashboard-metrics.';
