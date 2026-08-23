-- SECURITY FIX (2026-08-23, encontrado en la propia auditoria de permisos
-- que motivo la migracion anterior): product_catalog_diff_preview quedo con
-- EXECUTE otorgado a "anon" Y "authenticated" -- a diferencia de las demas
-- funciones auditadas, esta SI es explotable: es SECURITY DEFINER, recibe
-- p_user_id como parametro SIN validarlo contra auth.uid(), y aunque es
-- de solo lectura (no escribe nada), devuelve nombres de producto, precios
-- anteriores/nuevos y variacion porcentual del catalogo de CUALQUIER
-- user_id que se le pase -- un fuga de datos de un usuario a otro (o a
-- cualquiera sin cuenta) si se conoce/adivina un user_id ajeno.
--
-- Esta funcion es exclusivamente para el bot (arma el mensaje de
-- confirmacion de sobrescritura ANTES de llamar a
-- product_catalog_upsert_for_user, que ya es service_role-only) -- nunca
-- deberia haber sido alcanzable por nadie mas.

REVOKE EXECUTE ON FUNCTION public.product_catalog_diff_preview(uuid, jsonb) FROM anon, authenticated;
