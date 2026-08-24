-- BUGFIX (2026-08-24, encontrado en la campana de testeos, probando
-- confirmacion-sobrescritura contra el catalogo REAL del usuario):
-- product_catalog_parse_price interpretaba un punto UNICO como separador
-- DECIMAL por defecto (regla "el separador mas a la derecha es el decimal"),
-- lo cual es correcto cuando hay dos separadores distintos pero es
-- SISTEMATICAMENTE incorrecto para el caso mas comun de este catalogo: un
-- precio en formato es-AR como "$8.500" (ocho mil quinientos, punto de
-- miles) se parseaba como 8.5 -- reduciendo el precio ~1000x y disparando un
-- "cambio radical" falso (delta de +105782%) en CUALQUIER actualizacion de
-- precio contra un producto existente. Como los precios reales de este
-- catalogo son SIEMPRE enteros con formato "$X.XXX" (nunca centavos), este
-- bug afectaba practicamente cada producto real.
--
-- Fix: si el unico separador presente es un punto Y tiene EXACTAMENTE 3
-- digitos despues (convencion es-AR de agrupar miles de a 3), se trata como
-- separador de miles y se descarta -- NO como decimal. Cualquier otra
-- cantidad de digitos despues del ultimo punto (1, 2, o 4+) sigue
-- tratandose como parte decimal, igual que antes. El caso de dos separadores
-- distintos (ej "1.234,56") no cambia -- ya era correcto.

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
  v_digits_after_last_dot int;
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

  -- BUGFIX (2026-08-24): unico separador presente es un punto -- convencion
  -- es-AR, 3 digitos despues del ultimo punto = separador de miles (se
  -- descarta), no decimal.
  IF v_comma_rpos = 0 AND v_dot_rpos > 0 THEN
    v_digits_after_last_dot := length(v_clean) - v_dot_rpos;
    IF v_digits_after_last_dot = 3 THEN
      RETURN regexp_replace(v_clean, '\.', '', 'g')::numeric;
    END IF;
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
  'product-overwrite-safety (2026-08-23) + bugfix (2026-08-24, punto unico con 3 digitos = separador de miles es-AR, no decimal): parsea un precio en texto libre a numeric tolerando formato es-AR. Nunca lanza excepcion, devuelve NULL si no es parseable.';
