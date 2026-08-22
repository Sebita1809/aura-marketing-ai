import MaterialIcon from './MaterialIcon';
import { getAvatarOption } from '../lib/avatarOptions';

// Renderiza la foto de perfil elegida del banco fijo (ver avatarOptions.js).
// Sin avatarKey (todavía no eligió, o clave desconocida) cae a un ícono
// genérico sobre fondo neutro -- mismo placeholder que ya se usaba en los
// headers antes de esta feature.
export default function Avatar({ avatarKey, size = 'text-[20px]', className = '' }) {
  const option = getAvatarOption(avatarKey);

  if (!option) {
    return (
      <div className={`w-full h-full flex items-center justify-center bg-surface-container-high ${className}`}>
        <MaterialIcon icon="account_circle" size={size} />
      </div>
    );
  }

  return (
    <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${option.gradient} ${className}`}>
      <MaterialIcon icon={option.icon} size={size} className="text-on-primary-container" fill />
    </div>
  );
}
