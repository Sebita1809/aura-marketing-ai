-- Migration: RPC security definer de alta/baja/upsert del catálogo de productos
-- Change: user-panel-features, Grupo 2 (design.md D6) + Grupo 3 (0.3, decisión
-- de upsert-por-nombre confirmada por el usuario 2026-08-18, reemplaza el
-- "acumula a secas" del design.md original)
--
-- product_item_normalized_name(item): helper de matching. Decisión de
-- criterio (0.3, a definir por el agente, documentada acá): NORMALIZADO
-- case-insensitive (trim + colapso de espacios + lower), NO fuzzy. No se usa
-- pg_trgm/similarity para no sumar una dependencia de extensión ni casos
-- ambiguos de umbral — el propio usuario encuadró el panel de Productos como
-- la válvula de escape para lo que el matching automático NO resuelva
-- (duplicados por nombres ligeramente distintos, renombres), lo cual solo
-- tiene sentido si el matching automático es conservador. Prioridad de
-- claves de nombre (por la heterogeneidad real del product_data que
-- generan las 3 ramas del bot, ver Gate 0 tasks.md 0.4): producto, nombre,
-- "nombre del producto", name, titulo.
CREATE OR REPLACE FUNCTION public.product_item_normalized_name(item jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    lower(regexp_replace(trim(
      coalesce(
        item->>'producto',
        item->>'nombre',
        item->>'nombre del producto',
        item->>'name',
        item->>'titulo'
      )
    ), '\s+', ' ', 'g')),
  '')
$$;

COMMENT ON FUNCTION public.product_item_normalized_name(jsonb) IS
  'Nombre normalizado (trim + espacios colapsados + lower) de un item de product_data, probando las claves conocidas en orden. NULL si el item no trae ninguna. Usado por product_catalog_upsert_for_user para el matching por nombre (0.3) — normalizado, no fuzzy, a propósito.';

-- ============================================================================
-- product_catalog_add(item) — panel, auth.uid() resuelto adentro
-- ============================================================================
CREATE OR REPLACE FUNCTION public.product_catalog_add(item jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_item jsonb := item;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF v_item->>'id' IS NULL THEN
    v_item := v_item || jsonb_build_object('id', gen_random_uuid()::text);
  END IF;

  -- Una sola sentencia (INSERT ... ON CONFLICT DO UPDATE): atómica bajo el
  -- lock de fila de Postgres, sin ventana entre leer y escribir (D6). Crea
  -- la fila con [item] si el usuario todavía no tiene catálogo.
  INSERT INTO public.products (user_id, product_data)
    VALUES (v_uid, jsonb_build_array(v_item))
  ON CONFLICT (user_id) DO UPDATE
    SET product_data = COALESCE(public.products.product_data, '[]'::jsonb) || jsonb_build_array(v_item)
  RETURNING product_data INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- product_catalog_remove(product_id) — panel, borra por id, nunca por índice
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
  v_normalized jsonb := '[]'::jsonb;
  v_result jsonb;
  i int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE: mantiene el lock de fila durante toda la transacción de la
  -- RPC, así que aunque sean dos sentencias (select + update) no hay ventana
  -- de lost-update frente a un escritor concurrente (D6, nota de apply: el
  -- texto de design.md pedía "una sola sentencia" para el caso de add; acá
  -- remove necesita normalizar items heredados sin id antes de poder
  -- filtrarlos por id, así que la atomicidad la da el lock, no una sola
  -- sentencia SQL).
  SELECT product_data INTO v_existing FROM public.products WHERE user_id = v_uid FOR UPDATE;
  IF v_existing IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR i IN 0 .. jsonb_array_length(v_existing) - 1 LOOP
    IF (v_existing->i)->>'id' IS NULL THEN
      v_normalized := v_normalized || jsonb_build_array((v_existing->i) || jsonb_build_object('id', gen_random_uuid()::text));
    ELSE
      v_normalized := v_normalized || jsonb_build_array(v_existing->i);
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) INTO v_result
    FROM jsonb_array_elements(v_normalized) elem
    WHERE elem->>'id' IS DISTINCT FROM product_id;

  UPDATE public.products SET product_data = v_result WHERE user_id = v_uid;
  RETURN v_result;
END;
$$;

-- ============================================================================
-- product_catalog_upsert_for_user(p_user_id, item) — bot, service_role
-- (0.3: upsert por nombre, no "acumula a secas" ni "pisa el documento")
-- ============================================================================
CREATE OR REPLACE FUNCTION public.product_catalog_upsert_for_user(p_user_id uuid, item jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb := item;
  v_name text;
  v_existing jsonb;
  v_idx int := NULL;
  v_existing_name text;
  v_result jsonb;
  i int;
BEGIN
  IF v_item->>'id' IS NULL THEN
    v_item := v_item || jsonb_build_object('id', gen_random_uuid()::text);
  END IF;
  v_name := public.product_item_normalized_name(v_item);

  SELECT product_data INTO v_existing FROM public.products WHERE user_id = p_user_id FOR UPDATE;
  IF v_existing IS NULL THEN
    INSERT INTO public.products (user_id, product_data) VALUES (p_user_id, jsonb_build_array(v_item))
    ON CONFLICT (user_id) DO UPDATE
      SET product_data = COALESCE(public.products.product_data, '[]'::jsonb) || jsonb_build_array(v_item)
    RETURNING product_data INTO v_result;
    RETURN v_result;
  END IF;

  IF v_name IS NOT NULL THEN
    FOR i IN 0 .. jsonb_array_length(v_existing) - 1 LOOP
      v_existing_name := public.product_item_normalized_name(v_existing->i);
      IF v_existing_name IS NOT NULL AND v_existing_name = v_name THEN
        v_idx := i;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_idx IS NOT NULL THEN
    -- Match por nombre: actualiza el item existente in-place (típicamente
    -- cambia el precio), preservando el id ya asignado — el resto del
    -- catálogo no se toca.
    v_item := v_item || jsonb_build_object('id', COALESCE(v_existing->v_idx->>'id', v_item->>'id'));
    v_existing := jsonb_set(v_existing, ARRAY[v_idx::text], v_item);
  ELSE
    -- Sin match: se agrega como producto nuevo, append atómico.
    v_existing := v_existing || jsonb_build_array(v_item);
  END IF;

  UPDATE public.products SET product_data = v_existing WHERE user_id = p_user_id
    RETURNING product_data INTO v_result;
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.product_catalog_upsert_for_user(uuid, jsonb) IS
  'user-panel-features 0.3 (decisión del usuario 2026-08-18, reemplaza D7 original): el bot NO pisa el catálogo ni acumula a ciegas. Matchea el item nuevo contra el catálogo existente por product_item_normalized_name(); si matchea, actualiza ese item in-place (preserva id); si no, lo agrega. El bot no pregunta nada de forma interactiva. El panel de Productos (Grupo 5) es el ajuste manual para lo que este matching normalizado no resuelva (nombres ligeramente distintos, renombres, bajas).';

-- ============================================================================
-- Permisos: search_path fijo ya está en cada función (protección contra
-- escalación por search_path mutable, D6/tasks.md 2.7). EXECUTE explícito:
-- ============================================================================
REVOKE ALL ON FUNCTION public.product_catalog_add(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.product_catalog_remove(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.product_catalog_upsert_for_user(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.product_item_normalized_name(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.product_catalog_add(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_catalog_remove(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_catalog_upsert_for_user(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.product_item_normalized_name(jsonb) TO authenticated, service_role;
