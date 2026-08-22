-- Migration: backfill de image_generated/image_edited perdidos por el bug de
-- rama muerta (HTTP - Emit usage_events image_generated/edited competía en
-- paralelo con la rama que lleva al nodo Wait, y se perdía la carrera la
-- mayoría de las veces -- mismo patrón que el ya corregido para
-- post_published, corregido en n8n reordenando las conexiones).
--
-- Comparación real (Google AI Studio, Nano Banana Pro) vs. guardado
-- (usage_events), 2026-08-21:
--   15/08: real 1, guardado 0   -> faltan 1
--   16/08: real 10, guardado 0  -> faltan 10
--   17/08: real 48, guardado 0  -> faltan 48
--   18/08: real 21 ┐
--   19/08: real 23 ┘ juntos 44, guardado (18+19) 5+25=30 -> faltan 14
-- 18 y 19 se agrupan porque por separado el 19/08 tiene MÁS guardado (25)
-- que solicitudes reales reportadas (23) -- imposible; es desfasaje de huso
-- horario entre cómo Supabase cuenta el día (UTC) y cómo lo cuenta el
-- dashboard de Google, no un error real. Agrupando la ventana de 2 días se
-- evita inventar una atribución día-a-día que la propia fuente no soporta.
-- El día 20/08 (6 eventos ya guardados) se deja intacto: no hay solicitudes
-- reales reportadas para ese día contra qué compararlo.
--
-- Cada "falta agregar" se reparte generada/editada con la misma proporción
-- que ya tiene lo guardado (24 generadas : 12 editadas = 2:1) -- no hay forma
-- de saber la proporción real del faltante, es la mejor aproximación
-- disponible. quantity > 1 por fila (no una fila por imagen): el RPC de
-- costo multiplica quantity * precio, así que es equivalente y son menos
-- filas. user_id NULL (no atribuible a un usuario específico) y metadata
-- deja explícito que es una corrección retroactiva, no un evento real del
-- bot -- para que quede documentado ante cualquier auditoría futura.

-- model se setea explícito en cada fila: el RPC admin_dashboard_metrics
-- matchea el precio de imagen por (p.model = e.model AND p.unit = 'image'),
-- el mismo campo que faltaba en los nodos de n8n (fix anterior, migración de
-- corrección de precios) -- sin esto estas filas backfillearían el conteo
-- pero costarían $0 igual, por la misma razón de fondo.
INSERT INTO public.usage_events (event_key, event_type, user_id, model, quantity, status, source, metadata, occurred_at)
VALUES
  ('backfill:image_generated:2026-08-15', 'image_generated', NULL, 'models/gemini-3-pro-image-preview', 1, 'success', 'telegram_bot',
   '{"backfill": true, "note": "Corrección retroactiva: eventos reales perdidos por el bug de rama muerta del nodo de emit, antes del fix. No es un evento real individual del bot."}'::jsonb, '2026-08-15 12:00:00+00'),

  ('backfill:image_generated:2026-08-16', 'image_generated', NULL, 'models/gemini-3-pro-image-preview', 7, 'success', 'telegram_bot',
   '{"backfill": true, "note": "Corrección retroactiva: eventos reales perdidos por el bug de rama muerta del nodo de emit, antes del fix. No es un evento real individual del bot."}'::jsonb, '2026-08-16 12:00:00+00'),
  ('backfill:image_edited:2026-08-16', 'image_edited', NULL, 'models/gemini-3-pro-image-preview', 3, 'success', 'telegram_bot',
   '{"backfill": true, "note": "Corrección retroactiva: eventos reales perdidos por el bug de rama muerta del nodo de emit, antes del fix. No es un evento real individual del bot."}'::jsonb, '2026-08-16 12:00:00+00'),

  ('backfill:image_generated:2026-08-17', 'image_generated', NULL, 'models/gemini-3-pro-image-preview', 32, 'success', 'telegram_bot',
   '{"backfill": true, "note": "Corrección retroactiva: eventos reales perdidos por el bug de rama muerta del nodo de emit, antes del fix. No es un evento real individual del bot."}'::jsonb, '2026-08-17 12:00:00+00'),
  ('backfill:image_edited:2026-08-17', 'image_edited', NULL, 'models/gemini-3-pro-image-preview', 16, 'success', 'telegram_bot',
   '{"backfill": true, "note": "Corrección retroactiva: eventos reales perdidos por el bug de rama muerta del nodo de emit, antes del fix. No es un evento real individual del bot."}'::jsonb, '2026-08-17 12:00:00+00'),

  ('backfill:image_generated:2026-08-18-19-net', 'image_generated', NULL, 'models/gemini-3-pro-image-preview', 9, 'success', 'telegram_bot',
   '{"backfill": true, "note": "Corrección retroactiva agregada para la ventana 18-19/08 combinada (ver comentario de cabecera sobre desfasaje de huso horario). No es un evento real individual del bot."}'::jsonb, '2026-08-18 12:00:00+00'),
  ('backfill:image_edited:2026-08-18-19-net', 'image_edited', NULL, 'models/gemini-3-pro-image-preview', 5, 'success', 'telegram_bot',
   '{"backfill": true, "note": "Corrección retroactiva agregada para la ventana 18-19/08 combinada (ver comentario de cabecera sobre desfasaje de huso horario). No es un evento real individual del bot."}'::jsonb, '2026-08-18 12:00:00+00')
ON CONFLICT (event_key) DO NOTHING;
