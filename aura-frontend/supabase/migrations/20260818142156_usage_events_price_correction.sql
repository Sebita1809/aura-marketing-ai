-- Migration: corrección del precio placeholder de imagen (ai_model_prices)
-- Change: admin-dashboard-metrics, ajuste posterior al Grupo 1 (design.md D2)
--
-- Contexto (2026-08-18): el modelo real que usa el bot para generar/editar
-- imágenes es `models/gemini-3-pro-image-preview` — confirmado por el usuario
-- contra codigo.json (nodos "Generate an image" / "Edit an image", líneas
-- ~702, 2749, 2811). El seed inicial de la migración
-- 20260818140412_usage_events.sql YA usaba ese modelo correcto para la fila de
-- `unit = 'image'` (no había mezcla con gemini-2.5-flash ahí); lo que se
-- corrige acá es únicamente el VALOR del precio placeholder: el usuario
-- estima que gemini-3-pro-image-preview es "un poco más caro" que el
-- placeholder original ($0.04/imagen), sin dar una cifra exacta todavía
-- (OQ2 sigue sin resolver).
--
-- Por diseño (D2 del design.md: "corregir un precio es un INSERT nuevo, la
-- historia previa conserva el precio que estaba vigente"), esta corrección
-- NO hace un UPDATE sobre la fila ya aplicada por la migración anterior:
-- inserta una fila nueva con `effective_from` posterior, que pasa a ser la
-- vigente para cualquier evento a partir de ahora. Es inocuo para datos
-- históricos porque, al momento de este archivo, `usage_events` todavía no
-- tiene ninguna fila con `event_type IN ('image_generated','image_edited')`
-- (instrumentación de n8n pendiente, change hermano n8n-usage-events-logging).
--
-- gemini-2.5-flash SIGUE siendo el modelo real para el resto de las llamadas
-- de IA (moderación, clasificador de injection, análisis de documento/imagen,
-- agentes) — esas filas de ai_model_prices no cambian.

INSERT INTO public.ai_model_prices (model, unit, unit_cost_usd, is_estimate, notes)
VALUES (
  'models/gemini-3-pro-image-preview',
  'image',
  0.06000000,
  true,
  'PLACEHOLDER corregido 2026-08-18, todavía pendiente de confirmación (OQ2): el precio de lista REAL de gemini-3-pro-image-preview no está confirmado. Este valor ($0.06/imagen) es una estimación ajustada al alza respecto del seed inicial ($0.04) porque el usuario indicó que el modelo es "un poco más caro", sin cifra exacta. Reemplazar con el precio real de lista cuando se confirme (nueva fila con effective_from posterior, mismo patrón D2 — no UPDATE).'
)
ON CONFLICT (model, unit, effective_from) DO NOTHING;
