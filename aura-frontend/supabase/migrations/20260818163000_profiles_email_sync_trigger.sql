-- Migration: sincronización auth.users.email -> profiles.email
-- Change: user-panel-features, Grupo 8 / Gate 0.B (design.md Open Question 2,
-- resuelta 2026-08-18: trigger en la base, no propagación explícita del panel)
--
-- Por qué un trigger y no una llamada explícita desde el frontend: el cambio
-- de email de Supabase Auth es asíncrono y de doble confirmación (ver 0.2 en
-- el reporte de Gate 0) — auth.users.email solo cambia cuando el usuario
-- confirma el/los link(s) de mail, momento en el que el navegador que inició
-- el cambio puede llevar rato cerrado. Un trigger en la propia tabla
-- auth.users dispara exactamente cuando el cambio se confirma, sin depender
-- de que el cliente siga presente.
--
-- Seguridad: la función es SECURITY DEFINER pero NO hace nada peligroso — un
-- UPDATE de una sola columna (email) en la fila cuyo id coincide con el de
-- auth.users que disparó el trigger. Si por lo que sea no existe fila en
-- profiles con ese id, el UPDATE es un no-op (no lanza excepción), así que
-- este trigger nunca puede romper el flujo de Auth de Supabase (signup,
-- login, etc.) aunque profiles esté desincronizada.

CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_profile_email() IS
  'user-panel-features Grupo 8 (Open Question 2): propaga auth.users.email -> profiles.email cuando el cambio de email ya fue confirmado (el trigger corre sobre la fila real de auth.users, que solo cambia post-confirmación). No-op si no hay fila de profiles con ese id.';

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.sync_profile_email();
