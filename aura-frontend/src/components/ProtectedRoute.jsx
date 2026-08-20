import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import MaterialIcon from './MaterialIcon';

export default function ProtectedRoute({ children, requiredRole }) {
  const { user, profile, loading, profileLoading, logout } = useAuth();

  // El perfil ya cargó (no está en null/profileLoading) y su estado no es 'active':
  // nunca se decide esto antes de que el perfil haya terminado de cargar, para no
  // expulsar a un usuario activo legítimo durante el flash de carga (misma
  // disciplina que ya usa profileLoading para la decisión de rol más abajo).
  const isInactive = !profileLoading && !!profile && profile.status !== 'active';

  // Si el estado no es activo, cerramos la sesión local (defensa en profundidad:
  // el ban de Auth ya invalida el login y la sesión a nivel servidor, pero el JWT
  // ya emitido puede seguir siendo aceptado por PostgREST hasta su expiración,
  // así que hay que limpiar la sesión local del cliente explícitamente).
  useEffect(() => {
    if (isInactive && user) {
      logout().catch(() => {});
    }
  }, [isInactive, user, logout]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <MaterialIcon icon="autorenew" className="text-primary text-4xl animate-spin" />
          <p className="text-on-surface-variant font-body-md">Verificando sesión...</p>
        </div>
      </div>
    );
  }

  if (isInactive) {
    // Mientras el signOut local todavía no terminó (user sigue presente), no
    // exponemos la ruta protegida: se muestra el mismo tipo de loader ya
    // existente en vez de dejar pasar contenido hasta que el estado esté limpio.
    if (user) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <MaterialIcon icon="autorenew" className="text-primary text-4xl animate-spin" />
            <p className="text-on-surface-variant font-body-md">Cerrando sesión...</p>
          </div>
        </div>
      );
    }
    return (
      <Navigate
        to="/login"
        state={{ message: 'Tu cuenta no está activa. Contactá a un administrador.' }}
        replace
      />
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Si hay requiredRole pero el profile todavía se está cargando → esperar
  if (requiredRole && profileLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <MaterialIcon icon="autorenew" className="text-primary text-4xl animate-spin" />
          <p className="text-on-surface-variant font-body-md">Cargando perfil...</p>
        </div>
      </div>
    );
  }

  // Si requiere un rol específico y el usuario no lo tiene, redirigir
  if (requiredRole && profile?.role !== requiredRole) {
    // Si es usuario común y pide ruta de admin, mandarlo a conexiones
    return <Navigate to="/app/connections" replace />;
  }

  return children;
}
