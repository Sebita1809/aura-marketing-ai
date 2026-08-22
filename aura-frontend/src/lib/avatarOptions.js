// Banco fijo de fotos de perfil: ícono (Material Symbols) + gradiente de
// marca, sin subida de archivos ni assets externos. Las claves deben
// coincidir 1 a 1 con el CHECK de profiles.avatar_key (supabase/migrations/
// 20260821180000_profiles_avatar_key.sql) -- agregar/quitar una opción acá
// requiere una migración que actualice ese CHECK.

export const AVATAR_OPTIONS = [
  { key: 'auto_awesome', icon: 'auto_awesome', gradient: 'from-[#ddb7ff] to-[#0566d9]' },
  { key: 'rocket_launch', icon: 'rocket_launch', gradient: 'from-[#842bd2] to-[#adc6ff]' },
  { key: 'star', icon: 'star', gradient: 'from-[#0566d9] to-[#ddb7ff]' },
  { key: 'bolt', icon: 'bolt', gradient: 'from-[#adc6ff] to-[#842bd2]' },
  { key: 'favorite', icon: 'favorite', gradient: 'from-[#ddb7ff] to-[#842bd2]' },
  { key: 'diamond', icon: 'diamond', gradient: 'from-[#0566d9] to-[#adc6ff]' },
  { key: 'spa', icon: 'spa', gradient: 'from-[#842bd2] to-[#0566d9]' },
  { key: 'whatshot', icon: 'whatshot', gradient: 'from-[#adc6ff] to-[#ddb7ff]' },
  { key: 'local_florist', icon: 'local_florist', gradient: 'from-[#ddb7ff] to-[#adc6ff]' },
  { key: 'anchor', icon: 'anchor', gradient: 'from-[#0566d9] to-[#842bd2]' },
  { key: 'sunny', icon: 'sunny', gradient: 'from-[#adc6ff] to-[#0566d9]' },
  { key: 'pets', icon: 'pets', gradient: 'from-[#842bd2] to-[#ddb7ff]' },
];

const AVATAR_MAP = Object.fromEntries(AVATAR_OPTIONS.map((opt) => [opt.key, opt]));

export function getAvatarOption(key) {
  return (key && AVATAR_MAP[key]) || null;
}
