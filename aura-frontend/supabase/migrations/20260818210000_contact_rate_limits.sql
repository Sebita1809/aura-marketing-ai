-- Migration: Rate limiting por IP para el formulario de contacto público
-- (landing-contact-email, escalada documentada en design.md líneas 103/125:
-- "Si aparece abuso real, la escalada es una tabla en Postgres o Turnstile
-- de Cloudflare"). Reemplaza el `Map` en memoria del isolate de
-- send-contact-email/index.ts, que en producción resultó NO acumular estado
-- entre invocaciones (Supabase no garantiza reuso de isolate entre requests
-- consecutivos en este proyecto/tier -- verificado en vivo: 9 requests
-- seguidos desde la misma IP, 0 bloqueados por 429).
--
-- Diseño: tabla append-only (una fila = un envío permitido) + función
-- SECURITY DEFINER que hace el check-and-increment en una sola llamada RPC
-- desde la Edge Function (vía service_role, que igual bypassea RLS -- RLS
-- se deja habilitada sin políticas de cliente por consistencia con el resto
-- del proyecto, no porque haga falta para este flujo). Mismo criterio que
-- la versión en memoria: máximo 3 envíos por IP cada 10 minutos, ventana
-- deslizante por `count(*) where created_at > now() - interval`.
--
-- No se eligió una tabla de contador con upsert porque el reset de ventana
-- fija (en vez de deslizante) permitiría ráfagas de hasta 2x el límite justo
-- en el borde de la ventana; el append-only + count() da ventana deslizante
-- real a costo despreciable para el volumen esperado de un formulario de
-- contacto. Un pg_advisory_xact_lock por IP dentro de la función cierra la
-- carrera check-then-insert entre requests concurrentes de la misma IP.

-- === Tabla ===================================================================

CREATE TABLE public.contact_rate_limits (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip         text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.contact_rate_limits IS
  'Append-only: una fila por envío PERMITIDO del formulario de contacto de la landing. Los envíos bloqueados por rate limit no insertan fila (mismo criterio que el Map en memoria que reemplaza). Consumida únicamente por la Edge Function send-contact-email vía la función contact_rate_limit_check().';

-- Índice compuesto: toda lectura/escritura de esta tabla filtra por ip y
-- ordena/filtra por created_at (el count de la ventana deslizante y el
-- housekeeping de filas vencidas).
CREATE INDEX idx_contact_rate_limits_ip_created_at
  ON public.contact_rate_limits (ip, created_at DESC);

-- === RLS ======================================================================

-- RLS habilitada sin políticas de cliente (mismo criterio que el resto del
-- proyecto): default-deny total para 'anon'/'authenticated'. El único
-- consumidor es la Edge Function con la service_role key, que bypassea RLS
-- por diseño de Supabase -- esta tabla nunca es alcanzable desde el cliente.
ALTER TABLE public.contact_rate_limits ENABLE ROW LEVEL SECURITY;

-- === Función: check-and-increment atómico ===================================

-- Cuenta los envíos permitidos de `p_ip` dentro de `p_window` (ventana
-- deslizante). Si ya alcanzó `p_max_requests`, devuelve false SIN insertar
-- fila (el intento rechazado no "gasta" cupo, igual que la versión en
-- memoria). Si hay cupo, inserta la fila que representa este envío, hace
-- housekeeping de las filas vencidas de esa misma IP (la tabla no crece sin
-- límite para una IP que reintenta mucho después de su ventana) y devuelve
-- true.
--
-- pg_advisory_xact_lock(hashtext(p_ip)) serializa llamadas concurrentes para
-- la misma IP dentro de sus respectivas transacciones -- sin esto, dos
-- requests simultáneos podrían leer el mismo count() y ambos insertar,
-- dejando pasar uno de más justo en el borde del límite.
CREATE OR REPLACE FUNCTION public.contact_rate_limit_check(
  p_ip text,
  p_max_requests integer DEFAULT 3,
  p_window interval DEFAULT interval '10 minutes'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_ip));

  SELECT count(*) INTO v_count
  FROM public.contact_rate_limits
  WHERE ip = p_ip AND created_at > now() - p_window;

  IF v_count >= p_max_requests THEN
    RETURN false;
  END IF;

  INSERT INTO public.contact_rate_limits (ip) VALUES (p_ip);

  DELETE FROM public.contact_rate_limits
  WHERE ip = p_ip AND created_at <= now() - p_window;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.contact_rate_limit_check IS
  'Check-and-increment atómico del rate limit del formulario de contacto (landing-contact-email). Uso: select public.contact_rate_limit_check($1) desde send-contact-email/index.ts vía service_role. Devuelve true = envío permitido (ya registrado), false = bloqueado (no registrado).';

-- SECURITY DEFINER ya bypassea RLS para la propia función, pero el GRANT de
-- EXECUTE es lo que efectivamente controla quién puede invocarla. Solo
-- service_role (la Edge Function) la necesita; ni anon ni authenticated
-- tienen motivo para llamarla directo.
REVOKE ALL ON FUNCTION public.contact_rate_limit_check(text, integer, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contact_rate_limit_check(text, integer, interval) TO service_role;
