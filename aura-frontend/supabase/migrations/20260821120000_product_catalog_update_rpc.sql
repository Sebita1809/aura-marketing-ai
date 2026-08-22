-- Migration: RPC security definer de edición del catálogo de productos
-- Contexto: el panel de Productos pasa de cards a una tabla editable. Hasta
-- ahora solo existían product_catalog_add/remove (20260818161500) -- no había
-- forma de editar un item existente sin reabrir la ventana de lost-update
-- frente al bot (product_catalog_upsert_for_user, service_role, escribe
-- product_data en paralelo). Esta RPC replica el patrón de
-- product_catalog_remove: SELECT ... FOR UPDATE mantiene el lock de fila
-- durante toda la transacción, así que el ciclo lectura-modificación-escritura
-- es atómico frente a un escritor concurrente.

CREATE OR REPLACE FUNCTION public.product_catalog_update(product_id text, updates jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing jsonb;
  v_normalized jsonb := '[]'::jsonb;
  v_result jsonb;
  v_found boolean;
  i int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF product_id IS NULL OR product_id = '' THEN
    RAISE EXCEPTION 'product_id is required' USING ERRCODE = '22023';
  END IF;

  -- Mismo lock de fila que product_catalog_remove (D6): sin ventana de
  -- lost-update frente al bot aunque sean varias sentencias.
  SELECT product_data INTO v_existing FROM public.products WHERE user_id = v_uid FOR UPDATE;
  IF v_existing IS NULL THEN
    RAISE EXCEPTION 'product not found' USING ERRCODE = 'P0002';
  END IF;

  -- Normaliza items heredados sin id antes de poder matchear por id
  -- (idéntico a product_catalog_remove).
  FOR i IN 0 .. jsonb_array_length(v_existing) - 1 LOOP
    IF (v_existing->i)->>'id' IS NULL THEN
      v_normalized := v_normalized || jsonb_build_array((v_existing->i) || jsonb_build_object('id', gen_random_uuid()::text));
    ELSE
      v_normalized := v_normalized || jsonb_build_array(v_existing->i);
    END IF;
  END LOOP;

  SELECT bool_or(elem->>'id' = product_id) INTO v_found
    FROM jsonb_array_elements(v_normalized) elem;
  IF NOT COALESCE(v_found, false) THEN
    RAISE EXCEPTION 'product not found' USING ERRCODE = 'P0002';
  END IF;

  -- Mergea updates sobre el item existente (preserva cualquier clave que el
  -- formulario de edición no toque, incluida cualquier clave libre que haya
  -- inventado la IA al extraer el producto de un PDF/imagen). El id nunca
  -- es escribible desde acá, sin importar qué traiga updates. Una clave en
  -- updates con valor JSON null borra esa clave del item (permite vaciar un
  -- campo opcional como precio/detalle).
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

COMMENT ON FUNCTION public.product_catalog_update(text, jsonb) IS
  'Panel de Productos: edita un item existente por id. Mergea "updates" (objeto parcial) sobre el item existente bajo el mismo lock de fila que product_catalog_remove -- atómico frente al bot (product_catalog_upsert_for_user). El id nunca se sobrescribe. Una clave en updates con valor null borra esa clave del item.';

REVOKE ALL ON FUNCTION public.product_catalog_update(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.product_catalog_update(text, jsonb) TO authenticated;
