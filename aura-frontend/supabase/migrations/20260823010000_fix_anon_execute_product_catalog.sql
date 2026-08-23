-- SECURITY FIX (2026-08-23, urgente): product_catalog_upsert_for_user y
-- product_catalog_snapshot_item quedaron ejecutables por "anon" (cualquiera
-- en internet con la anon key, que es publica a proposito) y, en el caso de
-- product_catalog_upsert_for_user, tambien por "authenticated" -- pese a que
-- sus migraciones de origen (20260818161500, 20260823000001) SOLO pedian
-- "GRANT EXECUTE ... TO service_role" y nunca mencionaron anon/authenticated.
--
-- Causa raiz: Supabase configura por proyecto un ALTER DEFAULT PRIVILEGES que
-- otorga EXECUTE a anon/authenticated/service_role en TODA funcion nueva del
-- schema public al momento de crearse. "REVOKE ALL ... FROM PUBLIC" (que ya
-- usan ambas migraciones) NO deshace ese otorgamiento -- son grants directos
-- a esos roles, no via el pseudo-rol PUBLIC. Hay que revocarlos explicitamente
-- rol por rol, algo que faltaba en las dos funciones de este archivo.
--
-- Impacto real (verificado contra la base real antes de este fix): estas dos
-- funciones reciben p_user_id como parametro SIN validarlo contra auth.uid()
-- (a diferencia de product_catalog_update/rollback/add/remove, que si lo
-- chequean y por eso NO son explotables aunque tengan el mismo grant de mas).
-- Estaban pensadas para ser invocadas UNICAMENTE por el bot via Service Role
-- Key. Con el grant de mas, cualquiera con la anon key podia llamar
-- product_catalog_upsert_for_user('<uuid ajeno>', '{...}') y sobrescribir el
-- catalogo de cualquier usuario sin login.
--
-- Alcance de este fix: solo las 2 funciones con el problema real (parametro
-- de identidad sin validar). product_catalog_update/rollback/add/remove/
-- versions_list quedan con el mismo grant "de mas" a nivel permisos, pero no
-- son explotables porque validan auth.uid() -- pendiente de auditoria aparte
-- si se quiere higienizar el resto del schema.

REVOKE EXECUTE ON FUNCTION public.product_catalog_upsert_for_user(uuid, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.product_catalog_snapshot_item(uuid, jsonb) FROM anon;

-- Verificacion post-fix esperada: solo service_role (y el dueno, postgres)
-- deberian figurar con EXECUTE sobre estas dos funciones.
