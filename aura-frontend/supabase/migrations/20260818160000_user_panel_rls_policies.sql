-- Migration: RLS de panel de usuario (profiles update acotado, products select
-- propio + habilitar RLS, usage_events select propio)
-- Change: user-panel-features, Grupo 1 / Gate 0.A (design.md D9, D11)
--
-- Aprobado por el usuario 2026-08-18 tal cual se presentó en el reporte de
-- Gate 0.A (topic_key opsx/user-panel-features/gate0). Tres piezas
-- independientes, cada una documentada con a qué filas/columnas da acceso:
--
-- 1) profiles: hoy solo hay políticas de SELECT ("profiles_select_own",
--    "profiles_select_admin_active", migración 20260817223651). NO existe
--    ninguna política de UPDATE — con RLS enabled y sin política para ese
--    comando, el UPDATE está denegado hoy para anon/authenticated. Se agrega
--    UPDATE, pero acotado a full_name/company vía GRANT de columna (mecanismo
--    nativo de Postgres): un UPDATE que nombre cualquier otra columna
--    (role, status, telegram_chat_id, email...) falla con "permission denied
--    for column X" ANTES de que la policy de fila se evalúe siquiera.
--
-- 2) products: verificado en vivo que HOY NO TIENE RLS HABILITADO (ninguna
--    migración lo habilita). Esto significa que hoy cualquier cliente
--    autenticado (y posiblemente anon, según los GRANT por defecto de
--    Supabase) puede leer/escribir TODAS las filas de products vía PostgREST.
--    No es un gap introducido por este change: es preexistente y este gate
--    lo cierra. Se habilita RLS + se agrega SOLO select propio; las
--    mutaciones van por las RPC security definer del Grupo 2 (D6), no por
--    policy de escritura.
--
-- 3) usage_events: la tabla y ENABLE ROW LEVEL SECURITY ya existen (change
--    archivado admin-dashboard-metrics, migración 20260818140412) con CERO
--    políticas para roles cliente (deliberado: la única lectura agregada
--    para admin es vía el RPC security definer admin_dashboard_metrics). Se
--    agrega una policy de select ACOTADA a la fila propia del usuario
--    (user_id = auth.uid()); esto no contradice el diseño original, que
--    rechazaba una policy de lectura GLOBAL/masiva para admin, no el patrón
--    estándar de "cada quien lee lo suyo" que ya usan profiles/products.
--    Filas con user_id IS NULL (eventos sin usuario vinculado aún) quedan
--    invisibles para todo el mundo bajo esta policy — nadie queda sobre-expuesto.
--    Sigue sin haber política de insert/update/delete para authenticated: el
--    único escritor legítimo es el bot con service_role (bypasea RLS).

-- ============================================================================
-- 1. profiles — update propio, acotado a full_name y company
-- ============================================================================
GRANT UPDATE (full_name, company) ON public.profiles TO authenticated;

DROP POLICY IF EXISTS "profiles_update_own_limited_columns" ON public.profiles;
CREATE POLICY "profiles_update_own_limited_columns" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

COMMENT ON POLICY "profiles_update_own_limited_columns" ON public.profiles IS
  'user-panel-features Gate 0.A: permite UPDATE de la fila propia; el GRANT de columna (full_name, company) es lo que realmente acota qué se puede escribir — role/status/telegram_chat_id/email siguen sin permiso de columna para authenticated.';

-- ============================================================================
-- 2. products — habilitar RLS (hoy deshabilitado) + select propio
-- ============================================================================
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_select_own" ON public.products;
CREATE POLICY "products_select_own" ON public.products
  FOR SELECT
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.products IS
  'Una fila por usuario, catálogo completo en product_data jsonb (array). RLS habilitado desde user-panel-features Gate 0.A (2026-08-18) — antes no tenía ninguna política. select propio vía policy; insert/update/delete del cliente van SOLO por las RPC security definer product_catalog_* (Grupo 2), nunca por policy directa.';

-- ============================================================================
-- 3. usage_events — select propio (tabla y RLS ya existían, sin policies)
-- ============================================================================
DROP POLICY IF EXISTS "usage_events_select_own" ON public.usage_events;
CREATE POLICY "usage_events_select_own" ON public.usage_events
  FOR SELECT
  USING (auth.uid() = user_id);

COMMENT ON POLICY "usage_events_select_own" ON public.usage_events IS
  'user-panel-features Gate 0.A: cada usuario lee solo sus propias filas (user_id = auth.uid()). No reemplaza ni afecta el acceso agregado de admin_dashboard_metrics (SECURITY DEFINER, bypasea RLS). Filas con user_id NULL quedan sin lectura para nadie via esta policy.';
