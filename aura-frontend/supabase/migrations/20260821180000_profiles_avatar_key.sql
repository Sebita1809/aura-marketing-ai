-- Migration: foto de perfil desde un banco de opciones (íconos + gradiente
-- de marca, sin subida de archivos ni assets externos).
--
-- avatar_key referencia una de 12 combinaciones fijas (definidas también en
-- el frontend, src/lib/avatarOptions.js -- deben mantenerse sincronizadas).
-- CHECK explícito para que no se pueda escribir una clave que el frontend no
-- sepa renderizar. NULL = sin elegir todavía, se muestra un ícono genérico.
--
-- Mismo patrón que profiles_update_own_limited_columns (Gate 0.A,
-- 20260818160000): el UPDATE de la fila propia ya estaba permitido por RLS,
-- lo que faltaba era el permiso de columna -- se amplía el GRANT existente
-- para incluir avatar_key, sin tocar la policy de fila.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_key text;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_avatar_key_check CHECK (
    avatar_key IS NULL OR avatar_key IN (
      'auto_awesome', 'rocket_launch', 'star', 'bolt',
      'favorite', 'diamond', 'spa', 'whatshot',
      'local_florist', 'anchor', 'sunny', 'pets'
    )
  );

GRANT UPDATE (full_name, company, avatar_key) ON public.profiles TO authenticated;

COMMENT ON COLUMN public.profiles.avatar_key IS
  'Foto de perfil elegida de un banco fijo de 12 opciones (ícono + gradiente de marca, ver src/lib/avatarOptions.js). NULL = todavía no eligió, se muestra un ícono genérico. Nunca se suben imágenes propias.';
