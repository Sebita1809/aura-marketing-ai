import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import Sidebar from '../components/Sidebar';
import GlassCard from '../components/GlassCard';
import MaterialIcon from '../components/MaterialIcon';
import GradientButton from '../components/GradientButton';
import Avatar from '../components/Avatar';
import RegisterUser from './RegisterUser';

// design.md D10: tamaño de página fijo y explícito.
const PAGE_SIZE = 25;

// Tres estados explícitos (design.md D1). Colores tomados de la paleta que
// ya usa el resto del proyecto: emerald para "operativo" (mismo patrón que
// el StatusBadge anterior), amber-400 para "suspensión temporal" (mismo tono
// que ConnectionsPage usa para "Por expirar"), y el `error` custom del tema
// para "baja definitiva" (mismo tono que los mensajes de error del formulario
// de alta).
const STATUS_META = {
  active: {
    label: 'Activo',
    dot: 'bg-emerald-400',
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
  },
  blocked: {
    label: 'Bloqueado',
    dot: 'bg-amber-400',
    text: 'text-amber-400',
    bg: 'bg-amber-400/10',
    border: 'border-amber-400/20',
  },
  deactivated: {
    label: 'Dado de baja',
    dot: 'bg-error',
    text: 'text-error',
    bg: 'bg-error/10',
    border: 'border-error/20',
  },
};

const ROLE_LABELS = { admin: 'Admin', user: 'User' };

// design.md D8: transiciones válidas por estado + acceso al detalle
// (tasks.md 4.1). `detail` no es una transición, va siempre al final.
// `isSelf` filtra las prohibidas por D9 (auto-bloqueo / auto-baja,
// tasks.md 4.2) en la propia fila del admin logueado -- ver nota en
// getMenuItems sobre por qué NO se filtra acá el caso "único admin activo".
function getMenuItems(status, isSelf) {
  const items = [];
  if (status === 'active') {
    if (!isSelf) items.push({ action: 'block', label: 'Bloquear', icon: 'block' });
    if (!isSelf) items.push({ action: 'deactivate', label: 'Dar de baja', icon: 'person_off', danger: true });
  } else if (status === 'blocked') {
    items.push({ action: 'unblock', label: 'Desbloquear', icon: 'lock_open' });
    if (!isSelf) items.push({ action: 'deactivate', label: 'Dar de baja', icon: 'person_off', danger: true });
  } else if (status === 'deactivated') {
    items.push({ action: 'reactivate', label: 'Reactivar', icon: 'restart_alt' });
  }
  items.push({ action: 'detail', label: 'Ver detalle', icon: 'visibility' });
  return items;
}

const ACTION_META = {
  block: { title: 'Bloquear usuario', verb: 'Bloquear', danger: false },
  unblock: { title: 'Desbloquear usuario', verb: 'Desbloquear', danger: false },
  reactivate: { title: 'Reactivar usuario', verb: 'Reactivar', danger: false },
  deactivate: { title: 'Dar de baja', verb: 'Dar de baja', danger: true },
};

const MENU_WIDTH = 208; // px, debe matchear el w-52 (13rem) del menú renderizado

// Diálogo de confirmación de una transición de estado (tasks.md 4.3/4.4,
// design.md D11). `deactivate` usa la confirmación reforzada: el admin debe
// re-tipear el email exacto del usuario objetivo antes de habilitar el botón.
function ActionConfirmDialog({ pendingAction, onCancel, onConfirm }) {
  const { action, profile } = pendingAction;
  const [reason, setReason] = useState('');
  const [emailConfirm, setEmailConfirm] = useState('');

  const meta = ACTION_META[action];
  const isDeactivate = action === 'deactivate';

  // Comparación case-insensitive, documentada (tasks.md 4.4 pide elegir y
  // documentar): `profiles.email` se guarda tal cual lo tipeó el admin en el
  // alta (create-user/index.ts no normaliza casing), pero Supabase Auth trata
  // el email como case-insensitive para login y lookup -- es el identificador
  // semántico de la cuenta en todo el resto del sistema, no un secreto
  // sensible a mayúsculas. Exigir case exacto agregaría fricción (el admin
  // retipea de memoria o copiando de otra pantalla) sin ganar seguridad real:
  // quien puede abrir este diálogo ya es un admin autorizado por el servidor.
  const trimmedTarget = (profile.email || '').trim().toLowerCase();
  const emailMatches = !isDeactivate || (trimmedTarget !== '' && emailConfirm.trim().toLowerCase() === trimmedTarget);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4" role="dialog" aria-modal="true" aria-labelledby="action-confirm-title">
      <div
        className="w-full max-w-md rounded-xl overflow-hidden shadow-2xl"
        style={{
          background: 'rgba(26, 26, 26, 0.85)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 0 15px rgba(221, 183, 255, 0.2)',
        }}
      >
        <div className="p-6 space-y-4">
          <h2 id="action-confirm-title" className="font-headline-lg text-headline-lg text-on-surface">{meta.title}</h2>

          <div className="p-3 rounded-lg bg-white/5 text-sm">
            <p className="text-on-surface font-medium">{profile.full_name || 'Sin nombre'}</p>
            <p className="text-on-surface-variant">{profile.email || '—'}</p>
          </div>

          {isDeactivate && (
            <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm flex gap-2">
              <MaterialIcon icon="warning" className="text-[18px] shrink-0" />
              <span>Esta acción libera el vínculo de Telegram del usuario. Si más adelante lo reactivás, va a tener que volver a vincularlo desde cero.</span>
            </div>
          )}

          {isDeactivate && (
            <div>
              <label className="block font-label-sm text-label-sm text-on-surface-variant mb-1.5" htmlFor="action-confirm-email">
                Escribí el email exacto del usuario para confirmar
              </label>
              <input
                id="action-confirm-email"
                type="text"
                value={emailConfirm}
                onChange={(e) => setEmailConfirm(e.target.value)}
                placeholder={profile.email || ''}
                autoComplete="off"
                className="w-full bg-surface-container-lowest border-outline-variant rounded-lg px-4 py-2.5 text-on-surface focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-surface-variant/40 outline-none"
              />
            </div>
          )}

          <div>
            <label className="block font-label-sm text-label-sm text-on-surface-variant mb-1.5" htmlFor="action-confirm-reason">
              Motivo (opcional)
            </label>
            <textarea
              id="action-confirm-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="w-full bg-surface-container-lowest border-outline-variant rounded-lg px-4 py-2.5 text-on-surface focus:ring-1 focus:ring-primary focus:border-primary outline-none resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="px-5 py-2.5 text-on-surface-variant font-bold hover:text-on-surface transition-colors active:scale-95"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!emailMatches}
              onClick={() => onConfirm(reason.trim())}
              className={`px-5 py-2.5 rounded-lg font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
                meta.danger
                  ? 'bg-error text-on-error hover:brightness-110'
                  : 'bg-gradient-to-r from-[#ddb7ff] to-[#0566d9] text-[#400071] hover:brightness-110'
              }`}
            >
              {meta.verb}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status];
  if (!meta) {
    // Defensivo: si algún día aparece un valor fuera del CHECK de la migración,
    // no rompe el render, se ve como dato ausente en vez de reventar la fila.
    return <span className="text-outline text-xs">—</span>;
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full ${meta.bg} ${meta.text} text-xs font-bold border ${meta.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`}></span>
      {meta.label}
    </span>
  );
}

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('es-AR', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}

function formatDateTime(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('es-AR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

// PostgREST embedded-filter grammar (usado por `.or()`): los valores de un
// filtro dentro de or=(...) se separan por comas y agrupan con paréntesis,
// así que un término de búsqueda con "," o ")" rompería el filtro si se
// interpola crudo. Se envuelve en comillas dobles (valor citado, sintaxis
// documentada de PostgREST) y se escapan backslash/comillas dentro del
// término.
function ilikePattern(term) {
  const escaped = term.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"%${escaped}%"`;
}

export default function UsersPage() {
  const { user, profile } = useAuth();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(''); // '' = todos menos deactivated
  const [roleFilter, setRoleFilter] = useState(''); // '' = todos
  const [page, setPage] = useState(0);

  const [profiles, setProfiles] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [resolvedChangedBy, setResolvedChangedBy] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // tasks.md grupo 4: menú de acciones (⋮), diálogo de confirmación pendiente,
  // filas con una acción en vuelo, y el último error de acción para mostrarlo.
  const [openMenu, setOpenMenu] = useState(null); // { profileId, top, left } | null
  const [pendingAction, setPendingAction] = useState(null); // { action, profile } | null
  const [loadingIds, setLoadingIds] = useState(() => new Set());
  const [expandedRows, setExpandedRows] = useState(() => new Set());

  const toggleRow = (id) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const [actionError, setActionError] = useState(null); // { message } | null

  // Debounce de búsqueda: 300ms sin tipear antes de disparar la consulta al
  // servidor (design.md D10: búsqueda server-side, no filtrado en cliente).
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(0);
  }, [statusFilter, roleFilter]);

  const fetchProfiles = useCallback(async () => {
    if (!user?.id) return;

    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('profiles')
        .select(
          'id, full_name, company, email, role, status, telegram_chat_id, telegram_id, created_at, avatar_key',
          { count: 'exact' }
        );

      if (search) {
        const pattern = ilikePattern(search);
        query = query.or(`company.ilike.${pattern},email.ilike.${pattern},full_name.ilike.${pattern}`);
      }

      // spec admin-user-directory: los `deactivated` no aparecen por defecto,
      // solo cuando se activa explícitamente ese filtro.
      if (statusFilter) {
        query = query.eq('status', statusFilter);
      } else {
        query = query.neq('status', 'deactivated');
      }

      if (roleFilter) {
        query = query.eq('role', roleFilter);
      }

      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      query = query.order('created_at', { ascending: false }).range(from, to);

      const { data, error: fetchError, count } = await query;
      if (fetchError) throw fetchError;

      setProfiles(data || []);
      setTotalCount(count ?? 0);
    } catch (err) {
      console.error('Error al cargar perfiles:', err.message);
      setError('No se pudieron cargar los usuarios. Verificá la conexión a la base de datos.');
      // Importante: NO se limpia `profiles` a [] acá para que el estado de
      // error nunca se confunda con "no hay resultados" (spec: "un fallo de
      // consulta no debe renderizarse como listado vacío"). El render usa
      // `error` para decidir qué mostrar, no la longitud del array.
    } finally {
      setLoading(false);
    }
  }, [user?.id, search, statusFilter, roleFilter, page]);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  const openDetail = async (profile) => {
    setSelectedUser(profile);
    setResolvedChangedBy(null);

    // El detalle necesita las columnas de traza que la tabla no trae
    // (status_changed_at/by/reason) más telegram_id declarado en el alta.
    setDetailLoading(true);
    try {
      const { data, error: detailError } = await supabase
        .from('profiles')
        .select('id, full_name, company, email, role, status, telegram_chat_id, telegram_id, created_at, status_changed_at, status_changed_by, status_reason, avatar_key')
        .eq('id', profile.id)
        .single();

      if (detailError) throw detailError;
      setSelectedUser(data);

      if (data?.status_changed_by) {
        const { data: adminData } = await supabase
          .from('profiles')
          .select('full_name, email')
          .eq('id', data.status_changed_by)
          .single();
        setResolvedChangedBy(adminData || null);
      }
    } catch (err) {
      console.error('Error al cargar el detalle del usuario:', err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedUser(null);
    setResolvedChangedBy(null);
  };

  const handleUserCreated = () => {
    setPage(0);
    fetchProfiles();
  };

  // Vuelve a leer una sola fila desde el servidor (tasks.md 4.6): nada de
  // parchear el estado local a lo optimista. Si el detalle de ese mismo
  // usuario está abierto, también se refresca (incluida la traza).
  const refreshRow = async (id) => {
    const { data, error: refreshError } = await supabase
      .from('profiles')
      .select('id, full_name, company, email, role, status, telegram_chat_id, telegram_id, created_at, avatar_key')
      .eq('id', id)
      .single();

    if (!refreshError && data) {
      setProfiles((prev) => prev.map((p) => (p.id === id ? data : p)));
    }

    // Efecto por fuera del updater de setState a propósito (StrictMode puede
    // invocar updaters dos veces; openDetail no debe dispararse dos veces).
    if (selectedUser?.id === id) {
      openDetail(data || selectedUser);
    }
  };

  const toggleMenu = (profile, event) => {
    if (openMenu?.profileId === profile.id) {
      setOpenMenu(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setOpenMenu({
      profileId: profile.id,
      top: rect.bottom + 6,
      left: Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
    });
  };

  const handleMenuSelect = (profile, action) => {
    setOpenMenu(null);
    if (action === 'detail') {
      openDetail(profile);
      return;
    }
    setActionError(null);
    setPendingAction({ action, profile });
  };

  // Conecta con admin-user-status (tasks.md 4.5). La fila queda deshabilitada
  // (loadingIds) mientras la solicitud está en vuelo; al terminar -- éxito o
  // error -- se relee la fila desde el servidor (refreshRow), nunca se asume
  // el resultado.
  const performAction = async (reason) => {
    if (!pendingAction) return;
    const { action, profile } = pendingAction;
    setPendingAction(null);
    setActionError(null);
    setLoadingIds((prev) => new Set(prev).add(profile.id));

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('admin-user-status', {
        body: { user_id: profile.id, action, reason: reason || undefined },
      });

      if (invokeError) throw invokeError;
      if (!data?.success) {
        setActionError({ message: data?.error || 'No se pudo completar la acción.' });
      }
    } catch (err) {
      console.error('Error al ejecutar la acción sobre el usuario:', err.message);
      setActionError({ message: err.message || 'No se pudo completar la acción. Intentá de nuevo.' });
    } finally {
      await refreshRow(profile.id);
      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(profile.id);
        return next;
      });
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const rangeStart = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(totalCount, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="min-h-screen bg-background text-on-background font-body-md">
      <Sidebar />

      <main
        className="md:ml-64 min-h-screen overflow-y-auto relative"
        onScroll={() => setOpenMenu((current) => (current ? null : current))}
      >
        <header className="h-16 flex items-center justify-between px-margin-mobile md:px-margin-desktop bg-surface-container-lowest/80 backdrop-blur-xl border-b border-white/10 sticky top-0 z-30">
          <div className="md:hidden flex items-center gap-2">
            <button
              onClick={() => document.dispatchEvent(new CustomEvent('open-sidebar'))}
              className="p-1 -ml-1 rounded-lg text-primary hover:bg-white/5 active:scale-95 transition-all"
              aria-label="Abrir menú"
            >
              <MaterialIcon icon="menu" />
            </button>
            <span className="font-headline-lg-mobile text-headline-lg-mobile font-bold text-primary">Aura</span>
          </div>
          <div className="hidden md:block">
            <h2 className="font-headline-lg text-headline-lg font-bold text-primary">Gestión de Usuarios</h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full overflow-hidden border border-white/10">
              <Avatar avatarKey={profile?.avatar_key} size="text-[16px]" />
            </div>
          </div>
        </header>

        <div className="p-margin-desktop max-w-container-max mx-auto space-y-4">
          {/* Barra de búsqueda + filtros + alta */}
          <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
            <div className="relative group flex-1 min-w-[220px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-outline text-[20px] pointer-events-none">search</span>
              <input
                type="text"
                placeholder="Buscar por empresa, email o nombre..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="bg-surface-container-low border-none rounded-full pl-10 pr-4 py-2 text-sm focus:ring-2 focus:ring-primary/40 w-full transition-all outline-none text-on-surface placeholder:text-outline/40"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-surface-container-low border-none rounded-full px-4 py-2 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="">Todos los estados</option>
              <option value="active">Activos</option>
              <option value="blocked">Bloqueados</option>
              <option value="deactivated">Dados de baja</option>
            </select>

            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="bg-surface-container-low border-none rounded-full px-4 py-2 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="">Todos los roles</option>
              <option value="admin">Admin</option>
              <option value="user">User</option>
            </select>

            <GradientButton onClick={() => setShowCreateModal(true)} className="px-5 py-2.5 whitespace-nowrap">
              <MaterialIcon icon="add" size="text-[20px]" />
              Nuevo usuario
            </GradientButton>
          </div>

          {!statusFilter && (
            <p className="text-xs text-on-surface-variant/60 -mt-2">
              Los usuarios dados de baja no se muestran por defecto. Seleccioná "Dados de baja" en el filtro de estado para verlos.
            </p>
          )}

          {actionError && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-error/10 border border-error/20 text-error text-sm">
              <MaterialIcon icon="error" className="text-[18px] shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold">No se pudo completar la acción</p>
                <p>{actionError.message}</p>
              </div>
              <button
                onClick={() => setActionError(null)}
                aria-label="Cerrar aviso de error"
                className="text-error hover:opacity-70 transition-opacity shrink-0"
              >
                <MaterialIcon icon="close" className="text-[18px]" />
              </button>
            </div>
          )}

          <GlassCard hover={false} className="overflow-hidden">
            {loading ? (
              <div className="p-12 text-center">
                <MaterialIcon icon="autorenew" className="text-primary text-4xl animate-spin mx-auto mb-4" />
                <p className="text-on-surface-variant">Cargando usuarios...</p>
              </div>
            ) : error ? (
              <div className="p-12 text-center">
                <div className="flex items-center justify-center gap-2 text-error mb-4">
                  <MaterialIcon icon="error" />
                  <span className="font-bold">Error</span>
                </div>
                <p className="text-on-surface-variant mb-4">{error}</p>
                <button
                  onClick={() => fetchProfiles()}
                  className="text-primary font-bold hover:underline"
                >
                  Intentar de nuevo
                </button>
              </div>
            ) : profiles.length === 0 ? (
              <div className="p-12 text-center">
                <MaterialIcon icon="people" className="text-outline text-5xl mx-auto mb-4" />
                <p className="text-on-surface-variant">
                  {search || statusFilter || roleFilter
                    ? 'No hay usuarios que coincidan con la búsqueda o los filtros aplicados.'
                    : 'No se encontraron usuarios'}
                </p>
              </div>
            ) : (
              <>
                {/* Mobile (< md): acordeón -- solo avatar + nombre visibles,
                    toca para desplegar el resto (mismo patrón que la tabla
                    de Productos). */}
                <div className="md:hidden divide-y divide-white/5">
                  {profiles.map((profile) => {
                    const isOpen = expandedRows.has(profile.id);
                    const isLoading = loadingIds.has(profile.id);
                    return (
                      <div key={profile.id} className={isLoading ? 'opacity-50 pointer-events-none' : ''}>
                        <button
                          type="button"
                          onClick={() => toggleRow(profile.id)}
                          aria-expanded={isOpen}
                          className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/[0.03] transition-colors"
                        >
                          <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0">
                            <Avatar avatarKey={profile.avatar_key} size="text-[16px]" />
                          </div>
                          <span className="font-medium text-on-surface flex-1 truncate">{profile.full_name || '—'}</span>
                          <MaterialIcon
                            icon="expand_more"
                            className={`text-on-surface-variant shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                          />
                        </button>
                        {isOpen && (
                          <div className="px-4 pb-4 space-y-3">
                            <div>
                              <p className="font-label-sm text-on-surface-variant uppercase tracking-wider text-[10px] mb-0.5">ID</p>
                              <p className="font-label-sm text-label-sm text-outline">{profile.id ? profile.id.substring(0, 8).toUpperCase() : '—'}</p>
                            </div>
                            <div>
                              <p className="font-label-sm text-on-surface-variant uppercase tracking-wider text-[10px] mb-0.5">Empresa</p>
                              <p className="text-on-surface-variant">{profile.company || '—'}</p>
                            </div>
                            <div>
                              <p className="font-label-sm text-on-surface-variant uppercase tracking-wider text-[10px] mb-0.5">Correo Electrónico</p>
                              <p className="text-on-surface-variant break-all">{profile.email || '—'}</p>
                            </div>
                            <div>
                              <p className="font-label-sm text-on-surface-variant uppercase tracking-wider text-[10px] mb-0.5">Rol</p>
                              <p className="text-on-surface-variant">{ROLE_LABELS[profile.role] || profile.role || '—'}</p>
                            </div>
                            <div>
                              <p className="font-label-sm text-on-surface-variant uppercase tracking-wider text-[10px] mb-0.5">Telegram</p>
                              <p className="font-mono text-sm text-primary">
                                {profile.telegram_chat_id || <span className="font-body-md text-on-surface-variant/60 italic">no vinculado</span>}
                              </p>
                            </div>
                            <div>
                              <p className="font-label-sm text-on-surface-variant uppercase tracking-wider text-[10px] mb-0.5">Estado</p>
                              <StatusBadge status={profile.status} />
                            </div>
                            <div>
                              <p className="font-label-sm text-on-surface-variant uppercase tracking-wider text-[10px] mb-0.5">Alta</p>
                              <p className="text-on-surface-variant text-sm">{formatDate(profile.created_at)}</p>
                            </div>
                            <button
                              onClick={(e) => toggleMenu(profile, e)}
                              disabled={isLoading}
                              className="w-full py-2.5 rounded-lg bg-surface-container-highest border border-white/10 text-on-surface-variant font-bold text-sm flex items-center justify-center gap-2 hover:bg-primary/10 hover:text-primary transition-all disabled:opacity-30"
                              aria-haspopup="true"
                              aria-expanded={openMenu?.profileId === profile.id}
                            >
                              {isLoading ? (
                                <MaterialIcon icon="autorenew" className="animate-spin" size="text-sm" />
                              ) : (
                                <MaterialIcon icon="more_vert" size="text-sm" />
                              )}
                              Acciones
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        <th className="px-6 py-4 font-bold text-sm text-outline uppercase tracking-wider">ID</th>
                        <th className="px-6 py-4 font-bold text-sm text-outline uppercase tracking-wider">Nombre</th>
                        <th className="px-6 py-4 font-bold text-sm text-outline uppercase tracking-wider">Empresa</th>
                        <th className="px-6 py-4 font-bold text-sm text-outline uppercase tracking-wider">Correo Electrónico</th>
                        <th className="px-6 py-4 font-bold text-sm text-outline uppercase tracking-wider">Rol</th>
                        <th className="px-6 py-4 font-bold text-sm text-outline uppercase tracking-wider">Telegram</th>
                        <th className="px-6 py-4 font-bold text-sm text-outline uppercase tracking-wider">Estado</th>
                        <th className="px-6 py-4 font-bold text-sm text-outline uppercase tracking-wider">Alta</th>
                        <th className="px-6 py-4 font-bold text-sm text-outline uppercase tracking-wider">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {profiles.map((profile) => (
                        <tr
                          key={profile.id}
                          className={`hover:bg-white/[0.03] transition-colors group ${
                            loadingIds.has(profile.id) ? 'opacity-50 pointer-events-none' : ''
                          }`}
                        >
                          <td className="px-6 py-4 font-label-sm text-label-sm text-outline">
                            {profile.id ? profile.id.substring(0, 8).toUpperCase() : '—'}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0">
                                <Avatar avatarKey={profile.avatar_key} size="text-[16px]" />
                              </div>
                              <span className="font-medium text-on-surface">{profile.full_name || '—'}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-on-surface-variant">{profile.company || '—'}</td>
                          <td className="px-6 py-4 text-on-surface-variant">{profile.email || '—'}</td>
                          <td className="px-6 py-4 text-on-surface-variant">{ROLE_LABELS[profile.role] || profile.role || '—'}</td>
                          <td className="px-6 py-4 font-mono text-sm text-primary">
                            {profile.telegram_chat_id || <span className="font-body-md text-on-surface-variant/60 italic">no vinculado</span>}
                          </td>
                          <td className="px-6 py-4">
                            <StatusBadge status={profile.status} />
                          </td>
                          <td className="px-6 py-4 text-on-surface-variant text-sm">{formatDate(profile.created_at)}</td>
                          <td className="px-6 py-4">
                            {loadingIds.has(profile.id) ? (
                              <MaterialIcon icon="autorenew" className="text-primary animate-spin text-[20px]" />
                            ) : (
                              <button
                                onClick={(e) => toggleMenu(profile, e)}
                                className="text-outline hover:text-primary transition-colors"
                                aria-haspopup="true"
                                aria-expanded={openMenu?.profileId === profile.id}
                                aria-label={`Acciones para ${profile.email || profile.id}`}
                              >
                                <MaterialIcon icon="more_vert" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
                  <p className="text-sm text-on-surface-variant">
                    Mostrando {rangeStart}–{rangeEnd} de {totalCount}
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="px-3 py-1.5 rounded-lg text-sm text-on-surface-variant hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Anterior
                    </button>
                    <span className="text-sm text-outline">
                      Página {page + 1} de {totalPages}
                    </span>
                    <button
                      onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
                      disabled={page + 1 >= totalPages}
                      className="px-3 py-1.5 rounded-lg text-sm text-on-surface-variant hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              </>
            )}
          </GlassCard>
        </div>
      </main>

      {showCreateModal && (
        <RegisterUser
          onClose={() => setShowCreateModal(false)}
          onCreated={handleUserCreated}
        />
      )}

      {selectedUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="user-detail-title"
        >
          <div
            className="w-full max-w-lg rounded-xl overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto"
            style={{
              background: 'rgba(26, 26, 26, 0.7)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '0 0 15px rgba(221, 183, 255, 0.2)',
            }}
          >
            <div className="p-8 pb-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-[1px] bg-outline-variant"></div>
                  <span className="font-label-sm text-label-sm text-primary uppercase tracking-widest">Detalle de usuario</span>
                </div>
                <button
                  onClick={closeDetail}
                  className="text-on-surface-variant hover:text-on-surface transition-colors"
                  aria-label="Cerrar"
                >
                  <MaterialIcon icon="close" />
                </button>
              </div>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 border border-white/10">
                  <Avatar avatarKey={selectedUser.avatar_key} size="text-[22px]" />
                </div>
                <h1 id="user-detail-title" className="font-headline-lg text-headline-lg text-on-surface">
                  {selectedUser.full_name || selectedUser.email || 'Usuario'}
                </h1>
              </div>
              <StatusBadge status={selectedUser.status} />
            </div>

            <div className="px-8 pb-8 space-y-5">
              {detailLoading ? (
                <div className="text-center py-6">
                  <MaterialIcon icon="autorenew" className="text-primary text-2xl animate-spin mx-auto" />
                </div>
              ) : (
                <>
                  <dl className="grid grid-cols-1 gap-3 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-on-surface-variant">Identificador completo</dt>
                      <dd className="text-on-surface font-mono text-xs break-all text-right">{selectedUser.id}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-on-surface-variant">Empresa</dt>
                      <dd className="text-on-surface text-right">{selectedUser.company || '—'}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-on-surface-variant">Correo</dt>
                      <dd className="text-on-surface text-right">{selectedUser.email || '—'}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-on-surface-variant">Rol</dt>
                      <dd className="text-on-surface text-right">{ROLE_LABELS[selectedUser.role] || selectedUser.role || '—'}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-on-surface-variant">Fecha de alta</dt>
                      <dd className="text-on-surface text-right">{formatDate(selectedUser.created_at)}</dd>
                    </div>
                  </dl>

                  <div className="border-t border-white/10 pt-4 space-y-2">
                    <p className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-widest">Telegram</p>
                    <div className="flex justify-between gap-4 text-sm">
                      <dt className="text-on-surface-variant">Vínculo real (usado por el bot)</dt>
                      <dd className="text-primary font-mono text-right">
                        {selectedUser.telegram_chat_id || <span className="font-body-md text-on-surface-variant/60 italic">no vinculado</span>}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4 text-sm">
                      <dt className="text-on-surface-variant">Declarado en el alta</dt>
                      <dd className="text-on-surface-variant text-right">{selectedUser.telegram_id || '—'}</dd>
                    </div>
                    <p className="text-xs text-on-surface-variant/50">
                      "Declarado en el alta" es un dato de texto libre cargado en el formulario de registro; no es lo que consulta el bot para autorizar el acceso.
                    </p>
                  </div>

                  {selectedUser.status_changed_at && (
                    <div className="border-t border-white/10 pt-4 space-y-2">
                      <p className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-widest">Última transición de estado</p>
                      <div className="flex justify-between gap-4 text-sm">
                        <dt className="text-on-surface-variant">Cuándo</dt>
                        <dd className="text-on-surface text-right">{formatDateTime(selectedUser.status_changed_at)}</dd>
                      </div>
                      <div className="flex justify-between gap-4 text-sm">
                        <dt className="text-on-surface-variant">Quién</dt>
                        <dd className="text-on-surface text-right">
                          {resolvedChangedBy
                            ? (resolvedChangedBy.full_name || resolvedChangedBy.email || selectedUser.status_changed_by)
                            : selectedUser.status_changed_by || '—'}
                        </dd>
                      </div>
                      {selectedUser.status_reason && (
                        <div className="flex justify-between gap-4 text-sm">
                          <dt className="text-on-surface-variant">Motivo</dt>
                          <dd className="text-on-surface text-right">{selectedUser.status_reason}</dd>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Menú de acciones (⋮), tasks.md 4.1. Posicionado `fixed` respecto del
          botón que lo abrió (no `absolute` dentro de la celda) para no quedar
          recortado por el `overflow-hidden`/`overflow-x-auto` de la tabla. */}
      {openMenu && (() => {
        const profile = profiles.find((p) => p.id === openMenu.profileId);
        if (!profile) return null;
        const isSelf = profile.id === user?.id;
        const items = getMenuItems(profile.status, isSelf);
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
            <div
              className="fixed z-50 rounded-xl overflow-hidden shadow-2xl border border-white/10 py-1"
              style={{
                top: openMenu.top,
                left: openMenu.left,
                width: MENU_WIDTH,
                background: 'rgba(26, 26, 26, 0.95)',
                backdropFilter: 'blur(20px)',
              }}
              role="menu"
            >
              {items.map((item) => (
                <button
                  key={item.action}
                  type="button"
                  role="menuitem"
                  onClick={() => handleMenuSelect(profile, item.action)}
                  className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 hover:bg-white/10 transition-colors ${
                    item.danger ? 'text-error' : 'text-on-surface'
                  }`}
                >
                  <MaterialIcon icon={item.icon} className="text-[18px]" />
                  {item.label}
                </button>
              ))}
            </div>
          </>
        );
      })()}

      {/* Diálogo de confirmación (tasks.md 4.3/4.4). */}
      {pendingAction && (
        <ActionConfirmDialog
          pendingAction={pendingAction}
          onCancel={() => setPendingAction(null)}
          onConfirm={performAction}
        />
      )}
    </div>
  );
}
