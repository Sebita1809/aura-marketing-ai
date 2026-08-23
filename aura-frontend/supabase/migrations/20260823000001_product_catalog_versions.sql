-- Migration: historial de versiones por producto + rollback + preview de diff
-- Change: product-overwrite-safety (2026-08-23), pedido del usuario:
--   1) el bot debe poder mostrar, ANTES de sobrescribir, cuántos productos van a
--      cambiar y cuáles tienen un cambio "radical" (product_catalog_diff_preview).
--   2) cada vez que un producto existente se sobrescribe (upsert del bot O
--      edición manual desde el panel) se guarda una versión anterior, para poder
--      volver atrás un producto puntual desde el panel (product_catalog_versions
--      + product_catalog_rollback).
-- Sigue las mismas convenciones que 20260818161500_products_catalog_rpcs.sql:
-- SECURITY DEFINER, search_path fijo, REVOKE ALL + GRANT explícito por rol,
-- matching por product_item_normalized_name() (normalizado, no fuzzy, sin
-- pg_trgm/similarity para no sumar una dependencia de extensión).

-- ============================================================================
-- Tabla: product_catalog_versions — un snapshot por cada vez que un item
-- existente se sobrescribe (nunca se borran versiones automáticamente).
-- ============================================================================
CREATE TABLE public.product_catalog_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX product_catalog_versions_user_product_idx
  ON public.product_catalog_versions (user_id, product_id, created_at DESC);

ALTER TABLE public.product_catalog_versions ENABLE ROW LEVEL SECURITY;

-- Solo lectura de las propias versiones desde el panel (authenticated). No hay
-- policy de INSERT/UPDATE/DELETE para authenticated ni anon a propósito: la
-- única forma de escribir acá es a través de product_catalog_snapshot_item()
-- (SECURITY DEFINER, invocada internamente por upsert/update/rollback), nunca
-- un INSERT directo a la tabla.
CREATE POLICY "select own product versions" ON public.product_catalog_versions
  FOR SELECT USING (auth.uid() = user_id);

COMMENT ON TABLE public.product_catalog_versions IS
  'product-overwrite-safety (2026-08-23): historial de versiones anteriores de cada item de products.product_data, para poder hacer rollback de un producto puntual desde el panel. Nunca se borra automáticamente.';

-- ============================================================================
-- product_catalog_snapshot_item(p_user_id, item) — helper interno, no expuesto
-- directamente a authenticated/anon. Guarda "item" tal como estaba ANTES de
-- ser sobrescrito. No-op si el item no tiene id (nada que versionar todavía).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.product_catalog_snapshot_item(p_user_id uuid, item jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF item IS NULL OR item->>'id' IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.product_catalog_versions (user_id, product_id, snapshot)
  VALUES (p_user_id, item->>'id', item);
END;
$$;

COMMENT ON FUNCTION public.product_catalog_snapshot_item(uuid, jsonb) IS
  'product-overwrite-safety (2026-08-23): guarda un snapshot de un item de catálogo ANTES de sobrescribirlo. Llamada internamente por product_catalog_upsert_for_user, product_catalog_update y product_catalog_rollback -- nunca se llama sola desde el bot ni el panel.';

-- SECURITY FIX (2026-08-23, hallazgo de code review): esta funcion es un
-- helper interno que recibe p_user_id como parametro SIN validarlo contra
-- auth.uid(). NO debe ser ejecutable directamente por "authenticated": un
-- usuario logueado podria llamarla via PostgREST con el user_id de otra
-- persona y un item inventado, plantando una version falsa en el historial
-- ajeno para despues hacerla "restaurar" via product_catalog_rollback. Las
-- funciones que SI la invocan internamente (product_catalog_upsert_for_user,
-- product_catalog_update, product_catalog_rollback) son SECURITY DEFINER: la
-- llamada interna corre con los privilegios del dueño de la funcion, no los
-- del rol que las invoca, asi que revocarle el grant a "authenticated" no
-- rompe ninguna de ellas. Solo service_role (el propio bot, ya de por si
-- confiable y dueno del p_user_id que pasa) puede ejecutarla directo.
REVOKE ALL ON FUNCTION public.product_catalog_snapshot_item(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.product_catalog_snapshot_item(uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.product_catalog_snapshot_item(uuid, jsonb) TO service_role;

-- ============================================================================
-- product_catalog_upsert_for_user: redefinición — agrega el snapshot ANTES de
-- pisar un item existente (match por nombre). Sin cambios de comportamiento
-- para el caso "sin match" (producto nuevo): no hay nada que versionar ahí.
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
    -- product-overwrite-safety (2026-08-23): snapshot del item TAL COMO ESTABA
    -- antes de pisarlo, para poder hacer rollback desde el panel.
    PERFORM public.product_catalog_snapshot_item(p_user_id, v_existing->v_idx);

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
  'user-panel-features 0.3 + product-overwrite-safety (2026-08-23, agrega snapshot antes de pisar un match): el bot NO pisa el catálogo ni acumula a ciegas. Matchea el item nuevo contra el catálogo existente por product_item_normalized_name(); si matchea, guarda un snapshot del item anterior y actualiza in-place (preserva id); si no, lo agrega.';

-- ============================================================================
-- product_catalog_update: redefinición — agrega el snapshot ANTES de mergear
-- "updates" sobre el item existente (edición manual desde el panel).
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
  v_normalized jsonb := '[]'::jsonb;
  v_current_item jsonb;
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

  SELECT product_data INTO v_existing FROM public.products WHERE user_id = v_uid FOR UPDATE;
  IF v_existing IS NULL THEN
    RAISE EXCEPTION 'product not found' USING ERRCODE = 'P0002';
  END IF;

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

  -- product-overwrite-safety (2026-08-23): snapshot del item ANTES del merge.
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

COMMENT ON FUNCTION public.product_catalog_update(text, jsonb) IS
  'Panel de Productos + product-overwrite-safety (2026-08-23, agrega snapshot antes del merge): edita un item existente por id, guardando primero un snapshot para poder deshacer desde el panel. El id nunca se sobrescribe.';

-- ============================================================================
-- product_catalog_versions_list(p_product_id) — panel, lista el historial de
-- un producto puntual del usuario autenticado, más reciente primero.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.product_catalog_versions_list(p_product_id text)
RETURNS SETOF public.product_catalog_versions
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.product_catalog_versions
  WHERE user_id = auth.uid() AND product_id = p_product_id
  ORDER BY created_at DESC
  LIMIT 20;
$$;

COMMENT ON FUNCTION public.product_catalog_versions_list(text) IS
  'product-overwrite-safety (2026-08-23): historial (hasta 20 versiones) de un producto puntual del usuario autenticado, para el selector de rollback del panel.';

REVOKE ALL ON FUNCTION public.product_catalog_versions_list(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.product_catalog_versions_list(text) TO authenticated;

-- ============================================================================
-- product_catalog_rollback(p_version_id) — panel, restaura un producto a una
-- versión anterior. El estado actual también se versiona antes de pisarlo
-- (el rollback es en sí mismo reversible).
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
  v_normalized jsonb := '[]'::jsonb;
  v_current_item jsonb;
  v_found boolean;
  v_result jsonb;
  i int;
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

  FOR i IN 0 .. jsonb_array_length(v_existing) - 1 LOOP
    IF (v_existing->i)->>'id' IS NULL THEN
      v_normalized := v_normalized || jsonb_build_array((v_existing->i) || jsonb_build_object('id', gen_random_uuid()::text));
    ELSE
      v_normalized := v_normalized || jsonb_build_array(v_existing->i);
    END IF;
  END LOOP;

  SELECT bool_or(elem->>'id' = v_version.product_id) INTO v_found
    FROM jsonb_array_elements(v_normalized) elem;
  IF NOT COALESCE(v_found, false) THEN
    RAISE EXCEPTION 'product not found' USING ERRCODE = 'P0002';
  END IF;

  -- Snapshot del estado ACTUAL antes de pisarlo con el rollback: el rollback
  -- nunca pierde información, siempre se puede deshacer también.
  SELECT elem INTO v_current_item FROM jsonb_array_elements(v_normalized) elem
    WHERE elem->>'id' = v_version.product_id LIMIT 1;
  PERFORM public.product_catalog_snapshot_item(v_uid, v_current_item);

  SELECT jsonb_agg(
    CASE
      WHEN elem->>'id' = v_version.product_id THEN
        v_version.snapshot || jsonb_build_object('id', v_version.product_id)
      ELSE elem
    END
  ) INTO v_result
  FROM jsonb_array_elements(v_normalized) elem;

  UPDATE public.products SET product_data = v_result WHERE user_id = v_uid;
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.product_catalog_rollback(uuid) IS
  'product-overwrite-safety (2026-08-23): restaura un producto puntual a una versión anterior (product_catalog_versions). Guarda el estado actual como una nueva versión antes de pisarlo, así el rollback también se puede deshacer.';

REVOKE ALL ON FUNCTION public.product_catalog_rollback(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.product_catalog_rollback(uuid) TO authenticated;

-- ============================================================================
-- product_catalog_description_similarity(a, b) — similitud Jaccard sobre
-- tokens (lower + split por espacios). Sin pg_trgm/similarity a propósito
-- (mismo criterio que product_item_normalized_name): no suma una dependencia
-- de extensión, y el umbral usado en product_catalog_diff_preview es
-- deliberadamente conservador (0.15) para no marcar como "radical" cualquier
-- reformulación menor de una descripción.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.product_catalog_description_similarity(a text, b text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN a IS NULL OR b IS NULL OR length(trim(a)) < 5 OR length(trim(b)) < 5 THEN NULL
    ELSE (
      SELECT CASE
        WHEN (array_length(tokens_a, 1) + array_length(tokens_b, 1) - inter) <= 0 THEN 1
        ELSE inter::numeric / (array_length(tokens_a, 1) + array_length(tokens_b, 1) - inter)
      END
      FROM (
        SELECT
          regexp_split_to_array(lower(trim(a)), '\s+') AS tokens_a,
          regexp_split_to_array(lower(trim(b)), '\s+') AS tokens_b
      ) t,
      LATERAL (
        SELECT count(*) AS inter FROM unnest(tokens_a) x WHERE x = ANY(tokens_b)
      ) c
    )
  END
$$;

COMMENT ON FUNCTION public.product_catalog_description_similarity(text, text) IS
  'product-overwrite-safety (2026-08-23): similitud Jaccard (0..1) entre dos descripciones por tokens compartidos. NULL si alguna es null o demasiado corta (<5 chars) para que la comparación tenga sentido. Sin pg_trgm a propósito.';

-- ============================================================================
-- product_catalog_parse_price(raw) — parsea un precio en texto libre a numeric,
-- tolerando tanto formato "1234.56" como el formato es-AR "1.234,56" (punto de
-- miles, coma decimal). BUGFIX (2026-08-23, hallazgo de code review): la
-- version original de product_catalog_diff_preview casteaba directo a
-- ::numeric tras solo filtrar caracteres no numericos, lo que rompe con
-- cualquier coma decimal (sintaxis numeric invalida en Postgres) -- rompiendo
-- la funcion entera (y con ella la confirmacion de sobrescritura) apenas un
-- producto tuviera un precio con formato "1.234,56". Regla: el separador
-- (. o ,) que aparece MAS A LA DERECHA en el texto es el decimal; cualquier
-- otra ocurrencia de . o , antes de ese punto se descarta (separador de
-- miles). Nunca lanza excepcion -- si el texto no es parseable como precio,
-- devuelve NULL (product_catalog_diff_preview ya trata un precio NULL como
-- "no hay suficiente informacion para comparar", no como error).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.product_catalog_parse_price(raw text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean text;
  v_dot_rpos int;
  v_comma_rpos int;
  v_decimal_pos int;
  v_intpart text;
  v_decpart text;
BEGIN
  IF raw IS NULL THEN
    RETURN NULL;
  END IF;

  v_clean := regexp_replace(raw, '[^0-9.,]', '', 'g');
  IF v_clean = '' THEN
    RETURN NULL;
  END IF;

  v_dot_rpos := CASE WHEN strpos(reverse(v_clean), '.') = 0 THEN 0
                      ELSE length(v_clean) - strpos(reverse(v_clean), '.') + 1 END;
  v_comma_rpos := CASE WHEN strpos(reverse(v_clean), ',') = 0 THEN 0
                        ELSE length(v_clean) - strpos(reverse(v_clean), ',') + 1 END;

  IF v_dot_rpos = 0 AND v_comma_rpos = 0 THEN
    RETURN v_clean::numeric;
  END IF;

  v_decimal_pos := GREATEST(v_dot_rpos, v_comma_rpos);
  v_intpart := regexp_replace(substr(v_clean, 1, v_decimal_pos - 1), '[.,]', '', 'g');
  v_decpart := regexp_replace(substr(v_clean, v_decimal_pos + 1), '[.,]', '', 'g');
  IF v_intpart = '' THEN
    v_intpart := '0';
  END IF;

  RETURN (v_intpart || '.' || v_decpart)::numeric;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.product_catalog_parse_price(text) IS
  'product-overwrite-safety bugfix (2026-08-23): parsea un precio en texto libre a numeric tolerando formato es-AR (punto de miles, coma decimal) ademas del formato plano. Nunca lanza excepcion, devuelve NULL si no es parseable.';

-- ============================================================================
-- product_catalog_diff_preview(p_user_id, items) — bot, service_role. Dado un
-- array de items a upsertear, devuelve el impacto SIN escribir nada: cuántos
-- son nuevos, cuántos van a pisar un producto existente, y cuáles de esos
-- pisados cuentan como "cambio radical" (precio cambia >40%, o descripción
-- muy distinta a la anterior). Usado por el bot para armar el mensaje de
-- confirmación antes de llamar a product_catalog_upsert_for_user.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.product_catalog_diff_preview(p_user_id uuid, items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing jsonb;
  v_item jsonb;
  v_name text;
  v_existing_name text;
  v_idx int;
  v_old_price numeric;
  v_new_price numeric;
  v_delta_pct numeric;
  v_similitud numeric;
  v_es_radical boolean;
  v_motivos text[];
  v_resultado jsonb := '[]'::jsonb;
  v_nuevos int := 0;
  v_actualizados int := 0;
  v_radicales int := 0;
  i int;
BEGIN
  SELECT product_data INTO v_existing FROM public.products WHERE user_id = p_user_id;
  v_existing := COALESCE(v_existing, '[]'::jsonb);

  FOR i IN 0 .. jsonb_array_length(items) - 1 LOOP
    v_item := items->i;
    v_name := public.product_item_normalized_name(v_item);
    v_idx := NULL;

    IF v_name IS NOT NULL THEN
      FOR j IN 0 .. jsonb_array_length(v_existing) - 1 LOOP
        v_existing_name := public.product_item_normalized_name(v_existing->j);
        IF v_existing_name IS NOT NULL AND v_existing_name = v_name THEN
          v_idx := j;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    IF v_idx IS NULL THEN
      v_nuevos := v_nuevos + 1;
      v_resultado := v_resultado || jsonb_build_array(jsonb_build_object(
        'tipo', 'nuevo',
        'nombre', COALESCE(v_item->>'nombre del producto', v_item->>'producto', v_item->>'nombre', v_item->>'name', v_item->>'titulo')
      ));
    ELSE
      v_actualizados := v_actualizados + 1;
      v_motivos := ARRAY[]::text[];
      v_es_radical := false;
      v_delta_pct := NULL;

      -- NOTA (bug encontrado en testing local, 2026-08-23): acá había que usar
      -- v_idx, NO la variable de loop `j` -- un FOR de rango entero en plpgsql
      -- SIEMPRE crea su propia variable con scope al loop, aunque ya exista una
      -- variable declarada con ese nombre; la `j` declarada arriba queda
      -- intacta (NULL) fuera del loop, así que v_existing->j->>'precio' daba
      -- NULL siempre. v_idx sí se asigna explícitamente dentro del loop y
      -- persiste después, por eso el resto de las RPCs de este archivo (que ya
      -- usan v_idx tras su propio loop) no tenían este problema.
      v_old_price := public.product_catalog_parse_price(COALESCE(v_existing->v_idx->>'precio', v_existing->v_idx->>'price'));
      v_new_price := public.product_catalog_parse_price(COALESCE(v_item->>'precio', v_item->>'price'));
      IF v_old_price IS NOT NULL AND v_old_price <> 0 AND v_new_price IS NOT NULL THEN
        v_delta_pct := round(abs(v_new_price - v_old_price) / v_old_price * 100, 1);
        IF v_delta_pct > 40 THEN
          v_es_radical := true;
          v_motivos := v_motivos || (v_delta_pct::text || '% de cambio de precio');
        END IF;
      END IF;

      v_similitud := public.product_catalog_description_similarity(
        COALESCE(v_existing->v_idx->>'descripcion', v_existing->v_idx->>'descripción', v_existing->v_idx->>'detalle'),
        COALESCE(v_item->>'descripcion', v_item->>'descripción', v_item->>'detalle')
      );
      IF v_similitud IS NOT NULL AND v_similitud < 0.15 THEN
        v_es_radical := true;
        v_motivos := v_motivos || 'descripción muy distinta a la anterior';
      END IF;

      IF v_es_radical THEN
        v_radicales := v_radicales + 1;
      END IF;

      v_resultado := v_resultado || jsonb_build_array(jsonb_build_object(
        'tipo', 'actualizado',
        'nombre', v_name,
        'precio_anterior', v_existing->v_idx->>'precio',
        'precio_nuevo', v_item->>'precio',
        'delta_precio_pct', v_delta_pct,
        'es_radical', v_es_radical,
        'motivos', to_jsonb(v_motivos)
      ));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'items', v_resultado,
    'resumen', jsonb_build_object(
      'nuevos', v_nuevos,
      'actualizados', v_actualizados,
      'radicales', v_radicales,
      'total', jsonb_array_length(items)
    )
  );
END;
$$;

COMMENT ON FUNCTION public.product_catalog_diff_preview(uuid, jsonb) IS
  'product-overwrite-safety (2026-08-23): dado un array de items a upsertear, calcula el impacto (nuevos/actualizados/radicales) SIN escribir nada -- usado por el bot para armar el mensaje de confirmación de sobrescritura antes de llamar a product_catalog_upsert_for_user. "Radical": precio cambia >40%, o descripción con similitud Jaccard <0.15 contra la anterior.';

REVOKE ALL ON FUNCTION public.product_catalog_diff_preview(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.product_catalog_diff_preview(uuid, jsonb) TO service_role;
