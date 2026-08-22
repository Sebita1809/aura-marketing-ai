import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import MaterialIcon from './MaterialIcon';
import SupportModal from './SupportModal';
import NotificationsBell from './NotificationsBell';
import { useAuth } from '../context/AuthContext';

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, profile } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  // tasks.md 3.2/4.8: el botón "Soporte" vive acá (fuera del bloque admin),
  // así que el modal se monta acá también -- Sidebar ya se renderiza en
  // todas las páginas de usuario, así que no hace falta montarlo por
  // separado en cada una.
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportInitialTicketId, setSupportInitialTicketId] = useState(null);

  useEffect(() => {
    const handler = () => setMobileOpen(true);
    document.addEventListener('open-sidebar', handler);
    return () => document.removeEventListener('open-sidebar', handler);
  }, []);

  // NotificationsBell (tasks.md 6.4) no tiene acceso directo al estado del
  // modal -- vive en el header de otras páginas -- así que reusa el mismo
  // patrón de evento del DOM que 'open-sidebar' para pedirle a Sidebar que
  // abra el modal directo en un ticket puntual.
  useEffect(() => {
    const handler = (e) => {
      setSupportInitialTicketId(e.detail?.ticketId ?? null);
      setSupportOpen(true);
    };
    document.addEventListener('open-support', handler);
    return () => document.removeEventListener('open-support', handler);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const isActive = (path) => location.pathname === path;
  const isAdmin = profile?.role === 'admin';

  const navItems = isAdmin
    ? [
        { path: '/admin', icon: 'dashboard', label: 'Dashboard' },
        { path: '/admin/users', icon: 'group', label: 'Gestión de Usuarios' },
        { path: '/admin/support', icon: 'forum', label: 'Comunicados y Reportes' },
      ]
    : [
        { path: '/app/connections', icon: 'hub', label: 'Conexiones' },
        { path: '/app/products', icon: 'inventory_2', label: 'Productos' },
        { path: '/app/metrics', icon: 'bar_chart', label: 'Métricas' },
        { path: '/app/profile', icon: 'person', label: 'Perfil' },
      ];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const sidebarContent = (
    <>
      <div className="glass-card rounded-2xl p-4 mb-6 flex items-center justify-between gap-3 border-l-4 border-l-primary shadow-[0_0_20px_2px_rgba(221,183,255,0.12)]">
        <div className="flex items-center gap-3 min-w-0">
          <img src="/logoAura.png" alt="Aura" className="w-12 h-12 object-contain" />
          <div className="min-w-0">
            <h1 className="font-headline-lg text-headline-lg font-bold text-primary tracking-tight">Aura</h1>
            <p className="text-[10px] uppercase tracking-widest text-primary/60 font-bold">
              {isAdmin ? 'Modo Administrador' : 'Marketing AI'}
            </p>
          </div>
        </div>
        {/* Campanita de soporte: única instancia para toda la app (fix
            2026-08-18) -- vivía copiada solo en ProfilePage/MetricsPage, así
            que el admin no la veía en ninguna página propia y el usuario no
            la veía en Conexiones/Productos. Sidebar ya se renderiza para
            los dos roles en todas las rutas, así que acá cubre todo. */}
        <NotificationsBell />
      </div>
      <nav className="flex-1 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`flex items-center gap-3 px-3 py-3 transition-all rounded-lg ${isActive(item.path)
              ? 'text-primary font-bold bg-primary/10'
              : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
            }`}
          >
            <MaterialIcon icon={item.icon} />
            <span className="font-medium">{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="mt-auto border-t border-white/5 pt-4 space-y-1 pb-4">
        {/* tasks.md 3.1/D7: "Soporte" es exclusivo del rol usuario -- no se
            renderiza en absoluto para isAdmin (el admin tiene su propio
            punto de entrada, "Comunicados y Reportes", arriba en navItems). */}
        {!isAdmin && (
          <button
            type="button"
            onClick={() => {
              setSupportInitialTicketId(null);
              setSupportOpen(true);
              setMobileOpen(false);
            }}
            className="w-full flex items-center gap-3 px-3 py-3 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-all rounded-lg"
          >
            <MaterialIcon icon="support_agent" />
            <span className="font-medium">Soporte</span>
          </button>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-3 text-error/80 hover:bg-error-container/20 hover:text-error transition-all rounded-lg"
        >
          <MaterialIcon icon="logout" />
          <span className="font-medium">Cerrar Sesión</span>
        </button>
      </div>
    </>
  );

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col fixed left-0 top-0 h-screen w-64 bg-surface-container-low border-r border-white/5 py-base px-4 gap-4 z-50 overflow-y-auto">
        {sidebarContent}
      </aside>

      {/* Mobile drawer -- overflow-y-auto: si el contenido no entra en la
          altura de pantallas bajas (celular en horizontal, notebooks
          chicas), scrollea adentro del propio drawer en vez de depender de
          que se scrollee la página para llegar a Soporte/Cerrar sesión. */}
      <aside
        className={`md:hidden fixed left-0 top-0 h-screen w-64 bg-surface-container-low border-r border-white/5 py-base px-4 gap-4 z-50 flex flex-col overflow-y-auto transition-transform duration-300 ease-in-out ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center text-on-surface-variant hover:text-on-surface rounded-lg hover:bg-white/5 transition-colors"
          aria-label="Cerrar menú"
        >
          <MaterialIcon icon="close" />
        </button>
        {sidebarContent}
      </aside>

      {!isAdmin && (
        <SupportModal
          isOpen={supportOpen}
          onClose={() => setSupportOpen(false)}
          initialTicketId={supportInitialTicketId}
        />
      )}
    </>
  );
}
