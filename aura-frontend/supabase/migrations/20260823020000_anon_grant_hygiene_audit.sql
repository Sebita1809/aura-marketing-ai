-- Auditoria de permisos (2026-08-23, pedido del usuario tras el hallazgo
-- critico de la migracion anterior): se listaron TODAS las funciones del
-- schema public con EXECUTE otorgado a "anon" (SELECT ... FROM
-- information_schema.routine_privileges WHERE grantee='anon') y se revisó
-- el codigo real de cada una para separar lo explotable de lo que no.
--
-- Resultado (19 funciones con anon encontradas):
--
-- YA CORREGIDAS en la migracion anterior (20260823010000):
--   product_catalog_upsert_for_user, product_catalog_snapshot_item -- estas
--   SI eran explotables (reciben p_user_id sin validar contra auth.uid()).
--
-- CORREGIDAS ACA (higiene -- NO explotables hoy porque validan auth.uid()
-- internamente y fallan cerrado para anon, pero anon no tiene ningun caso de
-- uso legitimo sobre ellas):
--   product_catalog_update, product_catalog_rollback, product_catalog_add,
--   product_catalog_remove, product_catalog_versions_list (RAISE EXCEPTION o
--   0 filas si auth.uid() es NULL); admin_dashboard_metrics (RAISE EXCEPTION
--   'forbidden' via is_active_admin()); disconnect_telegram (UPDATE ... WHERE
--   id = auth.uid() -> 0 filas afectadas si es NULL); link_telegram_with_code
--   (chequea auth.uid() IS NULL explicitamente y devuelve error JSON, ya
--   fail-safe, pero anon no tiene motivo para llamarla).
--
-- DEJADAS COMO ESTAN, evaluadas y descartadas a proposito:
--   contact_rate_limit_check -- INTENCIONAL: pensada para el formulario de
--     contacto publico, se llama ANTES de cualquier login. No tocar.
--   is_admin, is_active_admin -- boolean puro sobre auth.uid(), sin efectos
--     secundarios ni datos expuestos; anon simplemente recibe "false".
--   product_item_normalized_name, product_catalog_description_similarity,
--     product_catalog_parse_price -- funciones puras/IMMUTABLE sin acceso a
--     datos ni efectos secundarios, nada que filtrar.
--   set_updated_at, support_messages_after_insert,
--     support_messages_guard_update, sync_profile_email -- RETURNS trigger:
--     Postgres rechaza llamarlas fuera de un trigger ("trigger functions can
--     only be called as triggers") sin importar el grant, no son invocables
--     via RPC de ninguna forma util.

REVOKE EXECUTE ON FUNCTION public.product_catalog_update(text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.product_catalog_rollback(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.product_catalog_add(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.product_catalog_remove(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.product_catalog_versions_list(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_dashboard_metrics(timestamptz, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.disconnect_telegram() FROM anon;
REVOKE EXECUTE ON FUNCTION public.link_telegram_with_code(text) FROM anon;
