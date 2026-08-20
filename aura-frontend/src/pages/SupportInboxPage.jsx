import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Sidebar from '../components/Sidebar';
import GlassCard from '../components/GlassCard';
import GradientButton from '../components/GradientButton';
import MaterialIcon from '../components/MaterialIcon';
import { useSupport } from '../hooks/useSupport';
import { sortByLastActivity, countUnread } from '../lib/supportLogic';

// Bandeja "Comunicados y Reportes" del admin (support-inbox-admin,
// design.md D8): layout de página admin tomando UsersPage.jsx como
// referencia (Sidebar + header sticky + GlassCard). Master-detail: lista de
// tickets a la izquierda, hilo del ticket seleccionado a la derecha -- es
// una superficie de trabajo, no un modal (design.md: "no cabe en un modal").

const CATEGORY_LABELS = { problema: 'Problema', duda: 'Duda', sugerencia: 'Sugerencia' };

const STATUS_FILTERS = [
  { value: '', label: 'Todos' },
  { value: 'open', label: 'Abiertos' },
  { value: 'answered', label: 'Respondidos' },
  { value: 'closed', label: 'Cerrados' },
];

const STATUS_META = {
  open: { label: 'Abierto', text: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/20' },
  answered: { label: 'Respondido', text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  closed: { label: 'Cerrado', text: 'text-on-surface-variant', bg: 'bg-on-surface-variant/10', border: 'border-white/10' },
};

function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META.open;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${meta.bg} ${meta.text} ${meta.border}`}>
      {meta.label}
    </span>
  );
}

function formatDateTime(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

function requesterLabel(ticket) {
  const p = ticket.profiles;
  return p?.company || p?.full_name || p?.email || (ticket.user_id ? ticket.user_id.substring(0, 8).toUpperCase() : '—');
}

export default function SupportInboxPage() {
  const {
    listAllTickets, listMessages, sendMessage, markAsRead, setTicketStatus, subscribeToSupport,
  } = useSupport();

  const [tickets, setTickets] = useState([]);
  const [ticketMessages, setTicketMessages] = useState({}); // ticketId -> messages[], solo para el conteo de no leídos en la lista
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState(null);

  const [reply, setReply] = useState('');
  const [replyError, setReplyError] = useState(null);
  const [replySending, setReplySending] = useState(false);
  const [statusActionLoading, setStatusActionLoading] = useState(false);

  // Ancla al final del hilo -- se scrollea sola cada vez que cambian los
  // mensajes, para que el admin siempre vea los últimos sin tener que
  // scrollear a mano (mismo patrón que SupportModal.jsx del lado usuario).
  const messagesEndRef = useRef(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listAllTickets(statusFilter ? { status: statusFilter } : {});
      setTickets(sortByLastActivity(data));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [listAllTickets, statusFilter]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  // Para el indicador de no leídos por fila y el total de la sección
  // (tasks.md 5.4) se trae, en paralelo, el conteo de mensajes de usuario
  // sin leer de cada ticket visible. Volumen chico (design.md "un puñado de
  // clientes"), así que N queries pequeñas acá es razonable -- no justifica
  // una vista/RPC agregada nueva.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        tickets.map(async (t) => {
          try {
            const msgs = await listMessages(t.id);
            return [t.id, msgs];
          } catch {
            return [t.id, []];
          }
        })
      );
      if (!cancelled) setTicketMessages(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets.map((t) => t.id).join(',')]);

  const unreadByTicket = useMemo(() => {
    const map = {};
    for (const t of tickets) {
      map[t.id] = countUnread(ticketMessages[t.id] || [], { viewerRole: 'admin' });
    }
    return map;
  }, [tickets, ticketMessages]);

  const totalUnread = useMemo(
    () => Object.values(unreadByTicket).reduce((sum, n) => sum + n, 0),
    [unreadByTicket]
  );

  const openThread = useCallback(async (ticketId) => {
    setSelectedId(ticketId);
    setThreadError(null);
    setThreadLoading(true);
    setReply('');
    setReplyError(null);
    try {
      const data = await listMessages(ticketId);
      setMessages(data);
      setTicketMessages((prev) => ({ ...prev, [ticketId]: data }));
      const unreadIds = data.filter((m) => m.sender_role === 'user' && m.read_at == null).map((m) => m.id);
      if (unreadIds.length > 0) {
        await markAsRead(unreadIds);
        const refreshed = data.map((m) => (unreadIds.includes(m.id) ? { ...m, read_at: new Date().toISOString() } : m));
        setMessages(refreshed);
        setTicketMessages((prev) => ({ ...prev, [ticketId]: refreshed }));
      }
    } catch (err) {
      setThreadError(err.message);
    } finally {
      setThreadLoading(false);
    }
  }, [listMessages, markAsRead]);

  // Realtime + fallback a polling (tasks.md 5.10/2.7): un ticket o respuesta
  // nueva del usuario reordena/marca no leído sin recargar la página. Si el
  // hilo de ese ticket ya está abierto en pantalla, el mensaje nuevo se
  // marca leído enseguida (mismo criterio que openThread) -- si no, la
  // campanita se queda marcando "no leído" hasta cerrar y volver a entrar.
  useEffect(() => {
    const refresh = () => {
      loadTickets();
      if (selectedId) {
        listMessages(selectedId).then((data) => {
          setMessages(data);
          setTicketMessages((prev) => ({ ...prev, [selectedId]: data }));
          const unreadIds = data.filter((m) => m.sender_role === 'user' && m.read_at == null).map((m) => m.id);
          if (unreadIds.length > 0) {
            markAsRead(unreadIds).then(() => {
              const refreshed = data.map((m) => (unreadIds.includes(m.id) ? { ...m, read_at: new Date().toISOString() } : m));
              setMessages(refreshed);
              setTicketMessages((prev) => ({ ...prev, [selectedId]: refreshed }));
            }).catch(() => {});
          }
        }).catch(() => {});
      }
    };
    const unsubscribe = subscribeToSupport({ onMessage: refresh, onTicket: refresh, onPollFallback: refresh });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const handleSendReply = async (e) => {
    e.preventDefault();
    setReplyError(null);
    const trimmed = reply.trim();
    if (!trimmed) {
      setReplyError('El mensaje no puede estar vacío.');
      return;
    }
    setReplySending(true);
    try {
      const message = await sendMessage(selectedId, trimmed);
      setMessages((prev) => [...prev, message]);
      setReply('');
      // Optimista: refleja answered + reordena al tope sin esperar el refetch.
      setTickets((prev) => sortByLastActivity(
        prev.map((t) => (t.id === selectedId ? { ...t, status: t.status === 'open' ? 'answered' : t.status, last_message_at: message.created_at } : t))
      ));
    } catch (err) {
      setReplyError(err.message);
    } finally {
      setReplySending(false);
    }
  };

  const handleStatusChange = async (nextStatus) => {
    setStatusActionLoading(true);
    try {
      await setTicketStatus(selectedId, nextStatus);
      setTickets((prev) => prev.map((t) => (t.id === selectedId ? { ...t, status: nextStatus } : t)));
    } catch (err) {
      setThreadError(err.message);
    } finally {
      setStatusActionLoading(false);
    }
  };

  const selectedTicket = tickets.find((t) => t.id === selectedId) || null;
  const isFiltered = statusFilter !== '';

  return (
    <div className="min-h-screen bg-background text-on-background font-body-md">
      <Sidebar />
      <main className="md:ml-64 min-h-screen overflow-y-auto relative">
        <header className="h-16 flex items-center justify-between px-margin-desktop bg-surface-container-lowest/80 backdrop-blur-xl border-b border-white/10 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <h2 className="font-headline-lg text-headline-lg font-bold text-primary">Comunicados y Reportes</h2>
            {totalUnread > 0 && (
              <span className="px-2.5 py-1 rounded-full bg-error/15 text-error text-xs font-bold">
                {totalUnread} sin leer
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-surface-container-high border border-white/10 flex items-center justify-center">
              <MaterialIcon icon="account_circle" className="text-[20px]" />
            </div>
          </div>
        </header>

        <div className="p-margin-desktop max-w-container-max mx-auto space-y-4">
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
                  statusFilter === f.value ? 'bg-primary/15 text-primary border border-primary/30' : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface border border-transparent'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4">
            {/* Lista */}
            <GlassCard hover={false} className="overflow-hidden">
              {loading ? (
                <div className="p-8 text-center">
                  <MaterialIcon icon="autorenew" className="text-primary text-3xl animate-spin mx-auto mb-3" />
                  <p className="text-on-surface-variant text-sm">Cargando consultas...</p>
                </div>
              ) : error ? (
                <div className="p-8 text-center">
                  <MaterialIcon icon="error" className="text-error text-3xl mx-auto mb-3" />
                  <p className="text-on-surface-variant text-sm mb-3">{error}</p>
                  <button onClick={loadTickets} className="text-primary font-bold text-sm hover:underline">Intentar de nuevo</button>
                </div>
              ) : tickets.length === 0 ? (
                <div className="p-8 text-center">
                  <MaterialIcon icon="forum" className="text-outline text-4xl mx-auto mb-3" />
                  <p className="text-on-surface-variant text-sm">
                    {isFiltered ? 'No hay consultas que coincidan con este filtro.' : 'Todavía no llegó ninguna consulta.'}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-white/5 max-h-[70vh] overflow-y-auto">
                  {tickets.map((t) => {
                    const unread = unreadByTicket[t.id] || 0;
                    return (
                      <button
                        key={t.id}
                        onClick={() => openThread(t.id)}
                        className={`w-full text-left p-4 flex items-start gap-3 hover:bg-white/[0.03] transition-colors ${selectedId === t.id ? 'bg-primary/5' : ''}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-on-surface truncate">{requesterLabel(t)}</p>
                            {unread > 0 && (
                              <span className="w-5 h-5 rounded-full bg-error text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                                {unread}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-on-surface-variant truncate">{t.subject}</p>
                          <p className="text-xs text-outline mt-1">{formatDateTime(t.last_message_at)} · {CATEGORY_LABELS[t.category] || t.category}</p>
                        </div>
                        <StatusPill status={t.status} />
                      </button>
                    );
                  })}
                </div>
              )}
            </GlassCard>

            {/* Hilo */}
            {/* Alto fijo (no min-h): antes crecía con la cantidad de
                mensajes y terminaba empujando el scroll de toda la página
                en vez de scrollear el hilo en su propio contenedor. */}
            <GlassCard hover={false} className="p-5 flex flex-col h-[600px]">
              {!selectedTicket ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <MaterialIcon icon="chat" className="text-outline text-4xl mb-3" />
                  <p className="text-on-surface-variant text-sm">Elegí una consulta de la lista para ver el hilo.</p>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3 pb-3 mb-3 border-b border-white/5 shrink-0">
                    <div className="min-w-0">
                      <p className="font-bold text-on-surface truncate">{selectedTicket.subject}</p>
                      <p className="text-xs text-on-surface-variant">{requesterLabel(selectedTicket)} · {CATEGORY_LABELS[selectedTicket.category] || selectedTicket.category}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusPill status={selectedTicket.status} />
                      {selectedTicket.status !== 'closed' ? (
                        <button
                          onClick={() => handleStatusChange('closed')}
                          disabled={statusActionLoading}
                          className="text-xs font-bold text-error hover:underline disabled:opacity-50"
                        >
                          Cerrar
                        </button>
                      ) : (
                        <button
                          onClick={() => handleStatusChange('open')}
                          disabled={statusActionLoading}
                          className="text-xs font-bold text-primary hover:underline disabled:opacity-50"
                        >
                          Reabrir
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-3 min-h-0 themed-scrollbar">
                    {threadLoading ? (
                      <div className="space-y-2">
                        {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-xl bg-surface-container-highest animate-pulse" />)}
                      </div>
                    ) : threadError ? (
                      <div className="p-4 rounded-xl bg-error/10 border border-error/20 text-error text-sm">{threadError}</div>
                    ) : (
                      messages.map((m) => {
                        const isMine = m.sender_role === 'admin';
                        return (
                          <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${isMine ? 'bg-primary/15 border border-primary/20' : 'bg-surface-container-highest border border-white/10'} text-on-surface`}>
                              <p className="whitespace-pre-wrap break-words">{m.body}</p>
                              <p className="text-[10px] text-on-surface-variant mt-1">
                                {isMine ? 'Soporte' : requesterLabel(selectedTicket)} · {formatDateTime(m.created_at)}
                              </p>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  <form onSubmit={handleSendReply} className="pt-4 mt-2 border-t border-white/5 shrink-0 space-y-2">
                    {selectedTicket.status === 'closed' ? (
                      <p className="text-xs text-on-surface-variant p-3 rounded-xl bg-surface-container-lowest border border-white/5">
                        Esta consulta está cerrada. Reabrila para poder responder.
                      </p>
                    ) : (
                      <>
                        <div className="flex gap-2">
                          <textarea
                            rows={2}
                            value={reply}
                            onChange={(e) => setReply(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey && !replySending) {
                                e.preventDefault();
                                handleSendReply(e);
                              }
                            }}
                            placeholder="Escribí tu respuesta..."
                            className="flex-1 bg-surface-container-lowest border border-white/10 focus:border-primary/50 focus:ring-1 focus:ring-primary/50 rounded-xl py-2.5 px-3.5 text-on-surface outline-none transition-all placeholder:text-outline/40 resize-none"
                          />
                          <GradientButton type="submit" loading={replySending} className="px-5 shrink-0">
                            <MaterialIcon icon="send" size="text-[18px]" />
                          </GradientButton>
                        </div>
                        {replyError && <p className="text-error text-xs">{replyError}</p>}
                      </>
                    )}
                  </form>
                </>
              )}
            </GlassCard>
          </div>
        </div>
      </main>
    </div>
  );
}
