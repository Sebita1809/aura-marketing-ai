-- Migration: corrección de precios de Gemini (placeholders sin confirmar) +
-- backfill de eventos ai_call para acercar el costo estimado del panel de
-- admin al gasto real reportado por Google AI Studio (2026-08-21).
--
-- Contexto: ai_model_prices se sembró con valores PLACEHOLDER explícitamente
-- marcados "pendientes de confirmación" (migración 20260818140412). Con datos
-- reales de Google AI Studio (14→21 de agosto) se pudo calibrar:
--   - gemini-3-pro-image-preview (Nano Banana Pro, imagen): costo real
--     promedio = sum(costo)/sum(solicitudes) sobre 5 días = $12.48 / 103
--     solicitudes ≈ $0.12/imagen (vs. $0.04-0.06 placeholder).
--   - gemini-2.5-flash (tokens): costo real vs. costo que predice el precio
--     placeholder ($0.15/M in, $0.60/M out) sobre los mismos tokens de 4 días
--     da un factor ~3.7x consistente (3.1x-3.8x según el día) → se escala el
--     placeholder completo por ese factor, preservando la proporción 1:4
--     entre entrada/salida: ~$0.56/M entrada, ~$2.24/M salida.
--
-- D2 (design.md admin-dashboard-metrics): "corregir un precio es un INSERT
-- nuevo, nunca un UPDATE que reescriba historia". Cada precio corregido se
-- inserta DOS veces con distinto effective_from para que aplique tanto al
-- período que se está backfilleando (14/08 en adelante) como a todo lo que
-- siga desde ahora, sin pisar ni tocar los placeholders originales:
--   1) effective_from 2026-08-14 00:00 UTC -- cubre el backfill temprano,
--      antes de que existiera cualquier fila de precio.
--   2) effective_from 2026-08-18 14:23 UTC -- un minuto después del último
--      placeholder sembrado (14:22:34), para que el precio corregido vuelva
--      a ser "el más reciente" y gane desde ahí en adelante (incluye todos
--      los eventos reales de image_generated/image_edited ya guardados con
--      occurred_at posterior a esa hora, y todo evento futuro).
-- Sigue siendo is_estimate = true: son ~5 días de datos reales, no
-- facturación oficial confirmada por Google.

INSERT INTO public.ai_model_prices (model, unit, unit_cost_usd, effective_from, is_estimate, notes)
VALUES
  ('models/gemini-3-pro-image-preview', 'image', 0.12000000, '2026-08-14 00:00:00+00', true,
   'Corrección 2026-08-21 sobre el placeholder original ($0.04-0.06): calibrado contra costo real de Google AI Studio (14→21 ago), $12.48 sobre 103 solicitudes ≈ $0.12/imagen. Sigue siendo estimación (5 días de muestra), no facturación oficial.'),
  ('models/gemini-3-pro-image-preview', 'image', 0.12000000, '2026-08-18 14:23:00+00', true,
   'Misma corrección que la fila anterior -- effective_from posterior al último placeholder sembrado (14:22:34) para que gane sobre los eventos image_generated/image_edited reales ya guardados después de esa hora, y sobre todo evento futuro.'),
  ('models/gemini-2.5-flash', 'input_token', 0.00000056, '2026-08-14 00:00:00+00', true,
   'Corrección 2026-08-21 sobre el placeholder original ($0.15/M): costo real reportado por Google AI Studio (14→21 ago) resultó ~3.7x más alto que lo que ese precio predice contra los mismos tokens -- se escala manteniendo la proporción 1:4 con output_token.'),
  ('models/gemini-2.5-flash', 'input_token', 0.00000056, '2026-08-18 14:23:00+00', true,
   'Misma corrección -- effective_from posterior al último placeholder para que gane desde ese momento en adelante.'),
  ('models/gemini-2.5-flash', 'output_token', 0.00000224, '2026-08-14 00:00:00+00', true,
   'Corrección 2026-08-21 sobre el placeholder original ($0.60/M): ver nota de input_token, misma calibración (factor ~3.7x), proporción 1:4 preservada.'),
  ('models/gemini-2.5-flash', 'output_token', 0.00000224, '2026-08-18 14:23:00+00', true,
   'Misma corrección -- effective_from posterior al último placeholder para que gane desde ese momento en adelante.')
ON CONFLICT (model, unit, effective_from) DO NOTHING;

-- Backfill de ai_call agregado por día para gemini-2.5-flash (Analyze
-- document/imagen, Moderar video/imagen, Clasificador injection x2, AI Agent1
-- + Normalizar filas Sheets -- los 8 nodos que llaman a este modelo pero
-- nunca emitieron usage_events). Una fila por día = totales reales de tokens
-- de Google AI Studio, no atribuible a un nodo/usuario específico (por eso
-- user_id NULL): el RPC de costo no depende de quantity para ai_call, solo
-- de input_tokens/output_tokens, así que una fila diaria agregada calcula el
-- costo del día correctamente sin necesidad de una fila por invocación.
-- Idempotente vía event_key UNIQUE -- correrla de nuevo es un no-op.
INSERT INTO public.usage_events (event_key, event_type, user_id, model, status, source, quantity, input_tokens, output_tokens, metadata, occurred_at)
VALUES
  ('backfill:ai_call:gemini-2.5-flash:2026-08-16', 'ai_call', NULL, 'models/gemini-2.5-flash', 'success', 'telegram_bot', 1, 9200, 5840, '{"backfill": true, "note": "Agregado diario desde Google AI Studio, no atribuible a un nodo/usuario específico"}'::jsonb, '2026-08-16 12:00:00+00'),
  ('backfill:ai_call:gemini-2.5-flash:2026-08-17', 'ai_call', NULL, 'models/gemini-2.5-flash', 'success', 'telegram_bot', 1, 89390, 122030, '{"backfill": true, "note": "Agregado diario desde Google AI Studio, no atribuible a un nodo/usuario específico"}'::jsonb, '2026-08-17 12:00:00+00'),
  ('backfill:ai_call:gemini-2.5-flash:2026-08-18', 'ai_call', NULL, 'models/gemini-2.5-flash', 'success', 'telegram_bot', 1, 23850, 12380, '{"backfill": true, "note": "Agregado diario desde Google AI Studio, no atribuible a un nodo/usuario específico"}'::jsonb, '2026-08-18 12:00:00+00'),
  ('backfill:ai_call:gemini-2.5-flash:2026-08-19', 'ai_call', NULL, 'models/gemini-2.5-flash', 'success', 'telegram_bot', 1, 30520, 36940, '{"backfill": true, "note": "Agregado diario desde Google AI Studio, no atribuible a un nodo/usuario específico"}'::jsonb, '2026-08-19 12:00:00+00'),
  ('backfill:ai_call:gemini-2.5-flash:2026-08-21', 'ai_call', NULL, 'models/gemini-2.5-flash', 'success', 'telegram_bot', 1, 3680, 2160, '{"backfill": true, "note": "Agregado diario desde Google AI Studio, no atribuible a un nodo/usuario específico"}'::jsonb, '2026-08-21 12:00:00+00')
ON CONFLICT (event_key) DO NOTHING;
