-- Mejoras de eficiencia (2026-08-23, code-review findings #7 y #8).
--
-- #7: el mismo loop "completar con un id nuevo cualquier item legado sin id"
-- estaba copiado, idéntico, en 3 funciones (product_catalog_remove,
-- product_catalog_update, product_catalog_rollback). Se extrae a un helper
-- compartido (product_catalog_normalize_ids) para que un futuro cambio en el
-- formato del id se haga en un solo lugar, no en 3. Sin cambios de
-- comportamiento: mismo resultado exacto, línea por línea.
--
-- #8: product_catalog_rollback solo devolvía product_data, así que el panel
-- (ProductsPage.jsx handleRollback) tenía que volver a pedir TODO el
-- historial con una segunda llamada (product_catalog_versions_list) para
-- mostrar la versión nueva que el propio rollback ya había creado -- ya
-- conocida en el momento, solo no se exponía. Ahora devuelve también esa
-- versión nueva junto con product_data, así el panel la agrega directo a la
-- lista local sin la segunda consulta ni el parpadeo de "cargando".
-- Requiere que product_catalog_snapshot_item devuelva la fila insertada en
-- vez de nada (RETURNS void -> RETURNS product_catalog_versions) -- los
-- otros 2 llamadores (upsert_for_user, update) siguen usando PERFORM, que
-- ignora cualquier valor de retorno sin importar su tipo, así que no cambian.

-- ============================================================================
-- #7: helper compartido
-- ============================================================================
CREATE OR REPLACE FUNCTION public.product_catalog_normalize_ids(p_product_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_normalized jsonb := '[]'::jsonb;
  i int;
BEGIN
  FOR i IN 0 .. jsonb_array_length(p_product_data) - 1 LOOP
    IF (p_product_data->i)->>'id' IS NULL THEN
      v_normalized := v_normalized || jsonb_build_array((p_product_data->i) || jsonb_build_object('id', gen_random_uuid()::text));
    ELSE
      v_normalized := v_normalized || jsonb_build_array(p_product_data->i);
    END IF;
  END LOOP;
  RETURN v_normalized;
END;
$$;

COMMENT ON FUNCTION public.product_catalog_normalize_ids(jsonb) IS
  'Helper compartido (2026-08-23, ex-duplicado en remove/update/rollback): completa con un id nuevo (gen_random_uuid) cualquier item legado de products.product_data que no tenga uno todavía. IMMUTABLE, sin acceso a tablas -- no necesita SECURITY DEFINER ni grants propios, se usa solo desde dentro de otras funciones.';

-- ============================================================================
-- product_catalog_remove: usa el helper en vez del loop propio.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.product_catalog_remove(product_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing jsonb;
  v_normalized jsonb;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT product_data INTO v_existing FROM public.products WHERE user_id = v_uid FOR UPDATE;
  IF v_existing IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  v_normalized := public.product_catalog_normalize_ids(v_existing);

  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) INTO v_result
    FROM jsonb_array_elements(v_normalized) elem
    WHERE elem->>'id' IS DISTINCT FROM product_id;

  UPDATE public.products SET product_data = v_result WHERE user_id = v_uid;
  RETURN v_result;
END;
$$;

-- ============================================================================
-- #8 (parte 1): product_catalog_snapshot_item ahora devuelve la fila que
-- inserta, en vez de nada -- Postgres no permite cambiar el tipo de retorno
-- con CREATE OR REPLACE, hace falta DROP primero (se re-crean sus grants
-- despues, DROP los borra).
-- ============================================================================
DROP FUNCTION IF EXISTS public.product_catalog_snapshot_item(uuid, jsonb);

CREATE FUNCTION public.product_catalog_snapshot_item(p_user_id uuid, item jsonb)
RETURNS public.product_catalog_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.product_catalog_versions;
BEGIN
  IF item IS NULL OR item->>'id' IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.product_catalog_versions (user_id, product_id, snapshot)
  VALUES (p_user_id, item->>'id', item)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.product_catalog_snapshot_item(uuid, jsonb) IS
  'product-overwrite-safety (2026-08-23) + eficiencia (2026-08-23, devuelve la fila insertada para que product_catalog_rollback no tenga que re-consultarla): guarda un snapshot de un item de catálogo ANTES de sobrescribirlo. Llamada internamente por product_catalog_upsert_for_user, product_catalog_update y product_catalog_rollback -- nunca se llama sola desde el bot ni el panel.';

REVOKE ALL ON FUNCTION public.product_catalog_snapshot_item(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.product_catalog_snapshot_item(uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_catalog_snapshot_item(uuid, jsonb) TO service_role;

-- ============================================================================
-- product_catalog_update: usa el helper en vez del loop propio. Sin más
-- cambios respecto a 20260823000001 (sigue usando PERFORM, ignora el nuevo
-- valor de retorno de snapshot_item).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.product_catalog_update(product_id text, updates jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing jsonb;
  v_normalized jsonb;
  v_current_item jsonb;
  v_result jsonb;
  v_found boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF product_id IS NULL OR product_id = '' THEN
    RAISE EXCEPTION 'product_id is required' USING ERRCODE = '22023';
  END IF;

  SELECT product_data INTO v_existing FROM public.products WHERE user_id = v_uid FOR UPDATE;
  IF v_existing IS NULL THEN
    RAISE EXCEPTION 'product not found' USING ERRCODE = 'P0002';
  END IF;

  v_normalized := public.product_catalog_normalize_ids(v_existing);

  SELECT bool_or(elem->>'id' = product_id) INTO v_found
    FROM jsonb_array_elements(v_normalized) elem;
  IF NOT COALESCE(v_found, false) THEN
    RAISE EXCEPTION 'product not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT elem INTO v_current_item FROM jsonb_array_elements(v_normalized) elem
    WHERE elem->>'id' = product_id LIMIT 1;
  PERFORM public.product_catalog_snapshot_item(v_uid, v_current_item);

  SELECT jsonb_agg(
    CASE
      WHEN elem->>'id' = product_id THEN
        jsonb_strip_nulls((elem || updates) - 'id') || jsonb_build_object('id', elem->>'id')
      ELSE elem
    END
  ) INTO v_result
  FROM jsonb_array_elements(v_normalized) elem;

  UPDATE public.products SET product_data = v_result WHERE user_id = v_uid;
  RETURN v_result;
END;
$$;

-- ============================================================================
-- #8 (parte 2): product_catalog_rollback usa el helper (#7) Y ahora devuelve
-- {product_data, new_version} en vez de solo product_data -- new_version es
-- la fila que product_catalog_snapshot_item acaba de insertar (el estado
-- ANTERIOR al rollback, ya versionado), para que el panel la agregue directo
-- a la lista de historial sin re-consultarla.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.product_catalog_rollback(p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_version public.product_catalog_versions;
  v_existing jsonb;
  v_normalized jsonb;
  v_current_item jsonb;
  v_new_version public.product_catalog_versions;
  v_found boolean;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_version FROM public.product_catalog_versions
    WHERE id = p_version_id AND user_id = v_uid;
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'version not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT product_data INTO v_existing FROM public.products WHERE user_id = v_uid FOR UPDATE;
  IF v_existing IS NULL THEN
    RAISE EXCEPTION 'product not found' USING ERRCODE = 'P0002';
  END IF;

  v_normalized := public.product_catalog_normalize_ids(v_existing);

  SELECT bool_or(elem->>'id' = v_version.product_id) INTO v_found
    FROM jsonb_array_elements(v_normalized) elem;
  IF NOT COALESCE(v_found, false) THEN
    RAISE EXCEPTION 'product not found' USING ERRCODE = 'P0002';
  END IF;

  -- Snapshot del estado ACTUAL antes de pisarlo con el rollback: el rollback
  -- nunca pierde información, siempre se puede deshacer también. Ahora
  -- capturamos la fila insertada (antes se ignoraba con PERFORM) para
  -- devolverla al panel.
  SELECT elem INTO v_current_item FROM jsonb_array_elements(v_normalized) elem
    WHERE elem->>'id' = v_version.product_id LIMIT 1;
  SELECT * INTO v_new_version FROM public.product_catalog_snapshot_item(v_uid, v_current_item);

  SELECT jsonb_agg(
    CASE
      WHEN elem->>'id' = v_version.product_id THEN
        v_version.snapshot || jsonb_build_object('id', v_version.product_id)
      ELSE elem
    END
  ) INTO v_result
  FROM jsonb_array_elements(v_normalized) elem;

  UPDATE public.products SET product_data = v_result WHERE user_id = v_uid;

  RETURN jsonb_build_object(
    'product_data', v_result,
    'new_version', to_jsonb(v_new_version)
  );
END;
$$;

COMMENT ON FUNCTION public.product_catalog_rollback(uuid) IS
  'product-overwrite-safety (2026-08-23) + eficiencia (2026-08-23, devuelve {product_data, new_version} en vez de solo product_data, ver product_catalog_normalize_ids/product_catalog_snapshot_item): restaura un producto puntual a una versión anterior. Guarda el estado actual como una nueva versión antes de pisarlo, así el rollback también se puede deshacer.';
