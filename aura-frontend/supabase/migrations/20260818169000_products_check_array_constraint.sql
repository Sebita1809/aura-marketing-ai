-- Migration: CHECK products_product_data_is_array
-- Change: user-panel-features, Grupo 3, tasks.md 3.6 (design.md D5)
--
-- *** NO APLICADA TODAVÍA — deliberado. ***
-- Orden normativo (design.md §Migration Plan): normalizar datos -> migrar
-- TODOS los escritores del bot -> recién entonces este CHECK. Los 3 nodos
-- del bot (HTTP - Upsert producto pdf/imagen/informacion, codigo.json) ya
-- fueron migrados a la RPC product_catalog_upsert_for_user en esta sesión
-- (Grupo 3) y verificados por script (tests/user-panel-features/verify-codigo-graph.js),
-- pero NO se corrió una prueba end-to-end real contra el bot vivo (subir un
-- PDF/imagen/texto real por Telegram) — no hay forma de disparar eso desde
-- este entorno de agente. Aplicar este CHECK antes de esa prueba manual (o
-- de una corrida verificada de otra forma) arriesga romper el bot en
-- producción si algún nodo quedó mal armado, tal como advierte design.md.
--
-- Acción requerida antes de correr este archivo (tasks.md 3.5/3.7):
--   1. Probar en vivo las 3 ramas del bot (PDF, imagen, texto) y confirmar
--      que el catálogo del usuario de prueba queda como array válido.
--   2. Recién entonces aplicar esta migración con `supabase db push`.

ALTER TABLE public.products
  ADD CONSTRAINT products_product_data_is_array
  CHECK (jsonb_typeof(product_data) = 'array');
