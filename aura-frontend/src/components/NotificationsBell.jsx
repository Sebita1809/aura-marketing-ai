import { useState, useEffect, useCallback, useRef } from 'react';
import MaterialIcon from './MaterialIcon';
import { useSupport } from '../hooks/useSupport';

// Campanita de notificaciones de soporte (support-notifications, design.md
// D8). Resuelto en la conversación con el usuario (checkpoint 6.7, tasks.md):
// es el indicador de "tenés respuestas nuevas sin leer" del sistema de
// tickets -- un atajo al mismo SupportModal, no una feature aparte -- y NO
// se monta en ConnectionsPage.jsx (esa campanita ya es de otra feature,
// aviso de token de red social vencido; no se toca ni se fusiona).
//
// Mismo marcado de badge que ya usa ConnectionsPage.jsx para su propia
// campanita (posición del badge, tamaños), para que las dos campanitas del
// producto se vean consistentes aunque cuenten cosas distintas.

function formatTime(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

function excerpt(body, max = 80) {
  if (!body) return '';
  const trimmed = body.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export default function NotificationsBell() {
  const { getUnreadCount, listRecentAdminReplies, markAsRead, subscribeToSupport } = useSupport();

  const [unreadCount, setUnreadCount] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState(null);
  const containerRef = useRef(null);

  const refreshCount = useCallback(() => {
    getUnreadCount().then(setUnreadCount).catch(() => {});
  }, [getUnreadCount]);

  const refreshNotifications = useCallback(() => {
    setNotifLoading(true);
    setNotifError(null);
    listRecentAdminReplies({ limit: 20 })
      .then(setNotifications)
      .catch((err) => setNotifError(err.message))
      .finally(() => setNotifLoading(false));
  }, [listRecentAdminReplies]);

  useEffect(() => {
    refreshCount();
  }, [refreshCount]);

  // Realtime + fallback a polling de 60s (tasks.md 6.8): actualiza el badge
  // siempre; si el panel está abierto, también refresca la lista.
  useEffect(() => {
    const handleChange = () => {
      refreshCount();
      if (panelOpen) refreshNotifications();
    };
    const unsubscribe = subscribeToSupport({ onMessage: handleChange, onPollFallback: handleChange });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen) return undefined;
    refreshNotifications();
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setPanelOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [panelOpen, refreshNotifications]);

  const openTicket = (notification) => {
    setPanelOpen(false);
    document.dispatchEvent(new CustomEvent('open-support', { detail: { ticketId: notification.ticket_id } }));
    // No re-marca lo ya leído (tasks.md 6.5).
    if (notification.read_at == null) {
      markAsRead([notification.id]).catch(() => {});
      setNotifications((prev) => prev.map((n) => (n.id === notification.id ? { ...n, read_at: new Date().toISOString() } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setPanelOpen((v) => !v)}
        className="relative w-10 h-10 flex items-center justify-center text-on-surface-variant hover:text-primary transition-colors"
        aria-label="Notificaciones de soporte"
        aria-haspopup="true"
        aria-expanded={panelOpen}
      >
        <MaterialIcon icon="notifications" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-error rounded-full text-[10px] font-bold text-white flex items-center justify-center shadow-lg shadow-error/50">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {panelOpen && (
        <div className="absolute left-0 top-full mt-2 w-80 max-w-[90vw] rounded-2xl overflow-hidden shadow-2xl z-50 glass-card-solid">
          <div className="p-4 border-b border-white/10">
            <p className="font-bold text-on-surface text-sm">Respuestas de soporte</p>
          </div>
          <div className="max-h-96 overflow-y-auto themed-scrollbar">
            {notifLoading ? (
              <div className="p-6 text-center">
                <MaterialIcon icon="autorenew" className="text-primary animate-spin text-2xl" />
              </div>
            ) : notifError ? (
              <div className="p-4 text-error text-sm">{notifError}</div>
            ) : notifications.length === 0 ? (
              <div className="p-6 text-center">
                <MaterialIcon icon="mail" className="text-outline text-3xl mx-auto mb-2" />
                <p className="text-on-surface-variant text-sm">Todavía no hay respuestas de soporte.</p>
              </div>
            ) : (
              <ul className="divide-y divide-white/5">
                {notifications.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => openTicket(n)}
                      className={`w-full text-left px-4 py-3 hover:bg-white/5 transition-colors flex items-start gap-2 ${n.read_at == null ? 'bg-primary/5' : ''}`}
                    >
                      {n.read_at == null && <span className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm truncate ${n.read_at == null ? 'font-bold text-on-surface' : 'text-on-surface-variant'}`}>
                          {n.support_tickets?.subject || 'Tu consulta'}
                        </p>
                        <p className="text-xs text-on-surface-variant truncate">{excerpt(n.body)}</p>
                        <p className="text-[10px] text-outline mt-0.5">{formatTime(n.created_at)}</p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
