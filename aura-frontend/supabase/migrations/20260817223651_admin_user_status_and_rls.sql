-- Migration: admin user status model (status + trace columns + generated is_active + RLS)
-- Change: admin-user-management, Group 1 (D1, D2, D5, D10 de design.md)
--
-- Verificado en vivo antes de escribir esta migración (2026-08-17, project ref
-- legffrhakunfignlaftl):
--   - `profiles` hoy tiene 7 filas, TODAS con is_active = true. No hay ninguna
--     fila con is_active = false, así que el backfill de abajo es un no-op hoy
--     mismo (se deja igual para que la migración sea correcta si se corre en
--     otro entorno, o en el futuro, con filas inactivas).
--   - RLS está ENABLED (relrowsecurity = true) y NO forzado (relforcerowsecurity
--     = false) sobre `profiles`. Políticas existentes (no versionadas, D10):
--       * "Usuarios pueden ver su propio perfil" (SELECT, auth.uid() = id)
--       * "Users can read own profile" (SELECT, auth.uid() = id) — duplicado
--         funcional de la anterior, mismo qual, distinto nombre.
--       * "Admin view all, users view own" (SELECT, (auth.jwt()->'app_metadata'
--         ->>'role') = 'admin' OR auth.uid() = id) — el admin se resuelve leyendo
--         el JWT, NO profiles.role. Es un problema real para este change: el
--         claim del JWT queda fijo hasta que el token expira/refresca, así que
--         un admin bloqueado seguiría leyendo "todos los perfiles" por RLS hasta
--         que su JWT venza, aunque ya no pueda loguearse de nuevo. Se reemplaza
--         por una función SECURITY DEFINER que lee el estado vivo de `profiles`
--         (ver más abajo), consistente con D3/D7: la fuente de verdad de "es
--         admin" es siempre profiles.role, nunca el JWT.
--     No existe NINGUNA política de INSERT/UPDATE/DELETE sobre `profiles`: con
--     RLS enabled y permissive, la ausencia de política para un comando deniega
--     ese comando para todas las filas. Es decir: hoy ya nadie puede escribir
--     `profiles` desde el cliente (anon/authenticated), aunque a nivel de GRANT
--     de tabla anon/authenticated tienen INSERT/UPDATE/DELETE otorgado (hallazgo
--     adicional, no se toca en este change: el GRANT es más amplio de lo
--     necesario pero RLS ya lo neutraliza; revocar esos GRANT queda fuera de
--     alcance de este grupo).
--   - Todas las escrituras privilegiadas (create-user, y en el grupo 2
--     admin-user-status) usan el cliente `service_role`, que **bypassa RLS**
--     por diseño de Postgres/Supabase; las políticas de abajo gobiernan
--     exclusivamente lo que el cliente del navegador puede hacer.
--
-- ROLLBACK probado para este grupo (ver reporte de apply, tasks.md 1.13):
--   BEGIN;
--     DROP POLICY IF EXISTS "profiles_select_admin_active" ON public.profiles;
--     DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
--     DROP FUNCTION IF EXISTS public.is_active_admin();
--     ALTER TABLE public.profiles DROP COLUMN is_active;
--     ALTER TABLE public.profiles ADD COLUMN is_active boolean DEFAULT true;
--     UPDATE public.profiles SET is_active = (status = 'active');
--     ALTER TABLE public.profiles
--       DROP COLUMN status,
--       DROP COLUMN status_changed_at,
--       DROP COLUMN status_changed_by,
--       DROP COLUMN status_reason;
--     CREATE POLICY "Usuarios pueden ver su propio perfil" ON public.profiles
--       FOR SELECT USING (auth.uid() = id);
--     CREATE POLICY "Users can read own profile" ON public.profiles
--       FOR SELECT USING (auth.uid() = id);
--     CREATE POLICY "Admin view all, users view own" ON public.profiles
--       FOR SELECT USING (
--         (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)
--         OR (auth.uid() = id)
--       );
--   COMMIT;
--   -- + revertir aura-frontend/supabase/functions/create-user/index.ts al
--   --   commit anterior (git revert), y desplegar esa versión anterior de la
--   --   función junto con este rollback de la migración (misma dependencia
--   --   dura del despliegue conjunto, en sentido inverso).

-- 1. Estado explícito (D1)
ALTER TABLE public.profiles
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CONSTRAINT profiles_status_check CHECK (status IN ('active', 'blocked', 'deactivated'));

-- 2. Columnas de traza mínima (D5)
ALTER TABLE public.profiles
  ADD COLUMN status_changed_at timestamptz,
  ADD COLUMN status_changed_by uuid REFERENCES public.profiles(id),
  ADD COLUMN status_reason text;

-- 3. Backfill: is_active = false -> blocked (decidido en tasks.md 0.2, resuelto
-- 2026-08-17). Ver nota arriba: 0 filas afectadas en la verificación en vivo de
-- hoy, se deja el UPDATE para que la migración sea correcta igual.
UPDATE public.profiles SET status = 'blocked' WHERE is_active = false;

-- 4. is_active pasa a ser derivada de status (D2). Postgres no permite convertir
-- una columna existente en GENERATED con ALTER COLUMN: hay que dropearla y
-- recrearla. Se hace DESPUÉS del backfill para que el valor generado ya refleje
-- el status correcto de cada fila.
ALTER TABLE public.profiles DROP COLUMN is_active;
ALTER TABLE public.profiles
  ADD COLUMN is_active boolean GENERATED ALWAYS AS (status = 'active') STORED;

-- 5. Políticas RLS (blocked-user-enforcement / D10)
-- Se reemplazan las 3 políticas de SELECT existentes (halladas en vivo, ver
-- nota arriba) por dos, ambas con profiles.role/status como única fuente de
-- verdad (nunca el JWT):
DROP POLICY IF EXISTS "Usuarios pueden ver su propio perfil" ON public.profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admin view all, users view own" ON public.profiles;

-- Función SECURITY DEFINER: evita la recursión de RLS que resultaría de que una
-- política sobre `profiles` corra una subconsulta sobre `profiles` (una consulta
-- normal ahí volvería a evaluar la misma política). Al ser SECURITY DEFINER y
-- pertenecer al rol dueño de la tabla (que no tiene FORCE ROW LEVEL SECURITY
-- encima, confirmado en vivo: relforcerowsecurity = false), la consulta interna
-- bypassa RLS igual que ya bypassan las Edge Functions con service_role.
CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_active_admin() TO authenticated;

-- Cualquier usuario autenticado lee su propia fila, sin importar su status:
-- AuthContext necesita poder leer status = 'blocked'/'deactivated' del propio
-- perfil para poder expulsar al usuario del panel (D4, capa "Panel").
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Un admin ACTIVO lee todos los perfiles. "Activo" es intencional: un admin
-- bloqueado no debe retener acceso de lectura a perfiles ajenos por RLS aunque
-- su JWT no haya expirado todavía (D4 capa "Panel" — defensa en profundidad,
-- ver nota sobre la política vieja arriba).
CREATE POLICY "profiles_select_admin_active" ON public.profiles
  FOR SELECT
  USING (public.is_active_admin());

-- Deliberado: NO se agrega ninguna política de INSERT/UPDATE/DELETE. Con RLS
-- enabled y sin política para esos comandos, quedan denegados para anon y
-- authenticated (confirmado que este es el comportamiento actual, ver nota
-- arriba). Esto es exactamente el requisito de blocked-user-enforcement: nadie
-- puede modificar su status, su role ni las columnas de traza desde el cliente.
-- Todas las escrituras de estado pasan por Edge Functions con service_role
-- (create-user, y admin-user-status en el grupo 2).

COMMENT ON COLUMN public.profiles.status IS
  'Estado del usuario: active (operativo) | blocked (suspensión reversible, conserva telegram_chat_id) | deactivated (baja definitiva, libera telegram_chat_id). Ver design.md D1 del change admin-user-management.';
COMMENT ON COLUMN public.profiles.is_active IS
  'Derivada de status (GENERATED ALWAYS AS status = ''active''). No escribible directamente. Se conserva por compatibilidad con consumidores existentes (D2).';
