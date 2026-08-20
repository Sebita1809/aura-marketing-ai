-- Migration: normalización de products.product_data a array + updated_at
-- Change: user-panel-features, Grupo 2 (design.md D5, D6)
--
-- Orden normativo (design.md §Migration Plan, tasks.md cabecera de gobernanza):
-- normalizar datos -> migrar escritores del bot -> RECIÉN ENTONCES el CHECK.
-- Este archivo NO agrega el CHECK products_product_data_is_array todavía
-- (eso es la migración 20260818169000, deliberadamente sin aplicar hasta
-- confirmar en vivo que los 3 nodos del bot ya escriben array — ver reporte
-- de apply). Invertir el orden rompe el bot en producción.
--
-- Backup: no se tomó un pg_dump de datos por fuera de este mismo `db push`
-- (no hay entorno de staging separado); el UPDATE de abajo es idempotente
-- por construcción (el CASE ya contempla 'array'), así que correrlo dos veces
-- es un no-op. Ver design.md Risks/Trade-offs.

-- 1. Normalizar product_data a array (idempotente)
UPDATE public.products
   SET product_data = CASE
     WHEN jsonb_typeof(product_data) = 'array'  THEN product_data
     WHEN product_data IS NULL                   THEN '[]'::jsonb
     WHEN jsonb_typeof(product_data) = 'object'  THEN jsonb_build_array(product_data)
     ELSE '[]'::jsonb
   END
 WHERE jsonb_typeof(product_data) IS DISTINCT FROM 'array' OR product_data IS NULL;

-- 2. updated_at + trigger genérico (reutilizable si otras tablas lo necesitan)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_set_updated_at ON public.products;
CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON COLUMN public.products.updated_at IS
  'user-panel-features D6: última escritura (panel o bot). Sirve para "última actualización" en la UI y para diagnosticar quién escribió último ante un choque de escritores concurrentes.';
