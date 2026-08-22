-- Migration: backfill de usage_events.model para eventos de imagen previos al fix
-- Contexto: los nodos n8n "HTTP - Emit usage_events image_generated/image_edited"
-- mandaban el modelo dentro de metadata.modelo en vez de la columna model de
-- primer nivel que usa admin_dashboard_metrics para el join contra
-- ai_model_prices (p.model = e.model). Filas con model NULL nunca matchean
-- ningún precio -> costo estimado $0 pese a tener eventos reales. El nodo de
-- n8n ya se corrigió para escribir la columna correcta de acá en adelante;
-- este backfill es solo para las filas ya insertadas antes del fix.
--
-- Alcance acotado a propósito: SOLO event_type IN ('image_generated',
-- 'image_edited') AND model IS NULL -- no toca post_published ni filas que
-- ya tengan model seteado (idempotente: correrla dos veces es un no-op).

UPDATE public.usage_events
SET model = COALESCE(metadata->>'modelo', 'models/gemini-3-pro-image-preview')
WHERE event_type IN ('image_generated', 'image_edited')
  AND model IS NULL;
