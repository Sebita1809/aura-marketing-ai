-- BUGFIX (2026-08-23, encontrado en el primer test real de la campana de
-- testeos del TFC, no en revision de codigo): product_catalog_diff_preview
-- fallaba con "malformed array literal" cada vez que un producto entraba en
-- la rama de "descripcion muy distinta a la anterior" (o la de cambio de
-- precio radical), reproducido y aislado antes de este fix:
--
--   DECLARE v_motivos text[] := ARRAY[]::text[];
--   BEGIN v_motivos := v_motivos || 'texto cualquiera'; END; -- 22P02
--
-- Causa: el operador || entre un text[] y un string literal sin tipar es
-- AMBIGUO para Postgres (existen los operadores anyarray||anyarray Y
-- anyarray||anyelement) -- en este contexto (dentro de un bloque IF, valor
-- ya en una variable text[]) Postgres resuelve hacia la interpretacion
-- array||array e intenta parsear el string como litera de array (formato
-- '{...}'), lo cual falla con cualquier texto normal. array_append() no
-- tiene esta ambiguedad: siempre trata el segundo argumento como UN elemento
-- a agregar, nunca como otro array a parsear.
--
-- Impacto real: como HTTP - Calcular diff sobrescritura (n8n) no tiene
-- onError/continueOnFail configurado, esta funcion fallando rompia el paso
-- de calculo del diff para CUALQUIER producto que calificara como "radical"
-- por descripcion o precio -- exactamente el caso mas importante de la
-- feature de confirmacion de sobrescritura.

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

      v_old_price := public.product_catalog_parse_price(COALESCE(v_existing->v_idx->>'precio', v_existing->v_idx->>'price'));
      v_new_price := public.product_catalog_parse_price(COALESCE(v_item->>'precio', v_item->>'price'));
      IF v_old_price IS NOT NULL AND v_old_price <> 0 AND v_new_price IS NOT NULL THEN
        v_delta_pct := round(abs(v_new_price - v_old_price) / v_old_price * 100, 1);
        IF v_delta_pct > 40 THEN
          v_es_radical := true;
          -- BUGFIX (2026-08-23): array_append en vez de || -- ver comentario
          -- de cabecera de esta migracion.
          v_motivos := array_append(v_motivos, v_delta_pct::text || '% de cambio de precio');
        END IF;
      END IF;

      v_similitud := public.product_catalog_description_similarity(
        COALESCE(v_existing->v_idx->>'descripcion', v_existing->v_idx->>'descripción', v_existing->v_idx->>'detalle'),
        COALESCE(v_item->>'descripcion', v_item->>'descripción', v_item->>'detalle')
      );
      IF v_similitud IS NOT NULL AND v_similitud < 0.15 THEN
        v_es_radical := true;
        -- BUGFIX (2026-08-23): idem arriba.
        v_motivos := array_append(v_motivos, 'descripción muy distinta a la anterior');
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
  'product-overwrite-safety (2026-08-23) + bugfix (2026-08-23, array_append en vez de || para evitar "malformed array literal"): dado un array de items a upsertear, calcula el impacto (nuevos/actualizados/radicales) SIN escribir nada -- usado por el bot para armar el mensaje de confirmación de sobrescritura antes de llamar a product_catalog_upsert_for_user. "Radical": precio cambia >40%, o descripción con similitud Jaccard <0.15 contra la anterior.';
