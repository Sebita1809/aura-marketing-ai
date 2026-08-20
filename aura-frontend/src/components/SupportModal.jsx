import { useState, useEffect, useCallback, useRef } from 'react';
import MaterialIcon from './MaterialIcon';
import GradientButton from './GradientButton';
import { useAuth } from '../context/AuthContext';
import { useSupport } from '../hooks/useSupport';
import { sortByLastActivity } from '../lib/supportLogic';

// Modal de soporte del usuario (support-ticket-submission, design.md D8):
// mismo patrón visual/chrome que ContactModal.jsx (overlay + Escape + lock de
// scroll), pero con dos vistas internas -- lista de tickets propios +
// formulario de consulta nueva, e hilo de un ticket seleccionado.

const CATEGORIES = [
  { value: 'problema', label: 'Problema' },
  { value: 'duda', label: 'Duda' },
  { value: 'sugerencia', label: 'Sugerencia' },
];

const STATUS_META = {
  open: { label: 'Abierto', text: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/20' },
  answered: { label: 'Respondido', text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  closed: { label: 'Cerrado', text: 'text-on-surface-variant', bg: 'bg-on-surface-variant/10', border: 'border-white/10' },
};

const SUBJECT_MAX = 150;
const BODY_MAX = 4000;

function formatDateTime(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META.open;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${meta.bg} ${meta.text} ${meta.border}`}>
      {meta.label}
    </span>
  );
}

export default function SupportModal({ isOpen, onClose, initialTicketId = null }) {
  const { user } = useAuth();
  const {
    listMyTickets, createTicket, listMessages, sendMessage, markAsRead, subscribeToSupport,
  } = useSupport();

  // 'list' = historial + form de consulta nueva; 'thread' = hilo de un ticket.
  const [view, setView] = useState('list');
  const [tickets, setTickets] = useState([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [ticketsError, setTicketsError] = useState(null);

  const [selectedTicket, setSelectedTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState(null);

  // --- Formulario de consulta nueva (tasks.md 4.2/4.3) ---
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0].value);
  const [body, setBody] = useState('');
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // --- Caja de respuesta del hilo (tasks.md 4.6/4.7) ---
  const [reply, setReply] = useState('');
  const [replyError, setReplyError] = useState(null);
  const [replySending, setReplySending] = useState(false);

  const initialTicketHandled = useRef(false);

  // Ancla al final del hilo -- se scrollea sola cada vez que cambian los
  // mensajes, para que siempre se vean los últimos sin scrollear a mano.
  const messagesEndRef = useRef(null);
  useEffect(() => {
    if (view === 'thread') messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, view]);

  const loadTickets = useCallback(async () => {
    setTicketsLoading(true);
    setTicketsError(null);
    try {
      const data = await listMyTickets();
      setTickets(sortByLastActivity(data));
    } catch (err) {
      setTicketsError(err.message);
    } finally {
      setTicketsLoading(false);
    }
  }, [listMyTickets]);

  const openThread = useCallback(async (ticket) => {
    setSelectedTicket(ticket);
    setView('thread');
    setThreadError(null);
    setThreadLoading(true);
    setReply('');
    setReplyError(null);
    try {
      const data = await listMessages(ticket.id);
      setMessages(data);
      const unreadIds = data.filter((m) => m.sender_role === 'admin' && m.read_at == null).map((m) => m.id);
      if (unreadIds.length > 0) {
        markAsRead(unreadIds).catch(() => {}); // best-effort, no bloquea la lectura del hilo
      }
    } catch (err) {
      setThreadError(err.message);
    } finally {
      setThreadLoading(false);
    }
  }, [listMessages, markAsRead]);

  const backToList = () => {
    setView('list');
    setSelectedTicket(null);
    setMessages([]);
    loadTickets();
  };

  useEffect(() => {
    if (!isOpen) {
      initialTicketHandled.current = false;
      return;
    }
    loadTickets();
  }, [isOpen, loadTickets]);

  // Si NotificationsBell pide abrir directo en un ticket (tasks.md 6.4), se
  // hace una sola vez por apertura del modal (no cada vez que loadTickets
  // termine) para no pisar una navegación que el usuario ya hizo a mano.
  useEffect(() => {
    if (!isOpen || !initialTicketId || initialTicketHandled.current || ticketsLoading) return;
    initialTicketHandled.current = true;
    const ticket = tickets.find((t) => t.id === initialTicketId);
    if (ticket) openThread(ticket);
  }, [isOpen, initialTicketId, tickets, ticketsLoading, openThread]);

  // Realtime + fallback a polling (tasks.md 2.7/6.8/D5): mientras el modal
  // está abierto, cualquier cambio relevante refresca la vista activa. Si el
  // hilo ya está abierto, la respuesta nueva del admin se marca leída al
  // toque (mismo criterio que openThread) -- si no, la campanita se queda
  // marcando "no leído" hasta cerrar el chat y volver a entrar.
  useEffect(() => {
    if (!isOpen) return undefined;
    const refresh = () => {
      if (view === 'thread' && selectedTicket) {
        listMessages(selectedTicket.id).then((data) => {
          setMessages(data);
          const unreadIds = data.filter((m) => m.sender_role === 'admin' && m.read_at == null).map((m) => m.id);
          if (unreadIds.length > 0) markAsRead(unreadIds).catch(() => {});
        }).catch(() => {});
      } else {
        loadTickets();
      }
    };
    const unsubscribe = subscribeToSupport({
      onMessage: refresh,
      onTicket: refresh,
      onPollFallback: refresh,
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, view, selectedTicket?.id]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    // El scroll real de cada página no vive en <body> -- cada página tiene su
    // propio <main className="... overflow-y-auto">, así que bloquear solo
    // body no evita que la rueda del mouse siga desplazando la página detrás
    // del modal. Se bloquea también ese <main>.
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      if (mainEl) mainEl.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleClose = () => {
    setView('list');
    setSelectedTicket(null);
    setSubject('');
    setCategory(CATEGORIES[0].value);
    setBody('');
    setFormError(null);
    onClose();
  };

  const handleSubmitTicket = async (e) => {
    e.preventDefault();
    setFormError(null);
    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();
    if (!trimmedSubject) {
      setFormError('El asunto no puede estar vacío.');
      return;
    }
    if (!trimmedBody) {
      setFormError('La descripción no puede estar vacía.');
      return;
    }
    if (trimmedSubject.length > SUBJECT_MAX) {
      setFormError(`El asunto no puede superar los ${SUBJECT_MAX} caracteres.`);
      return;
    }
    if (trimmedBody.length > BODY_MAX) {
      setFormError(`La descripción no puede superar los ${BODY_MAX} caracteres.`);
      return;
    }
    if (!CATEGORIES.some((c) => c.value === category)) {
      setFormError('Elegí una categoría válida.');
      return;
    }

    setSubmitting(true);
    try {
      const ticket = await createTicket({ subject: trimmedSubject, category, body: trimmedBody });
      // Éxito: limpia el formulario, agrega la consulta al tope del
      // historial sin recargar (tasks.md 4.7).
      setSubject('');
      setCategory(CATEGORIES[0].value);
      setBody('');
      setTickets((prev) => sortByLastActivity([{ ...ticket, last_message_at: ticket.created_at }, ...prev]));
    } catch (err) {
      // Error: conserva lo escrito (tasks.md 4.7) -- no se toca subject/body/category.
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

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
      const message = await sendMessage(selectedTicket.id, trimmed);
      setMessages((prev) => [...prev, message]);
      setReply('');
      setSelectedTicket((t) => (t ? { ...t, status: t.status === 'answered' ? 'open' : t.status } : t));
    } catch (err) {
      setReplyError(err.message);
    } finally {
      setReplySending(false);
    }
  };

  const isClosed = selectedTicket?.status === 'closed';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center bg-black/85 backdrop-blur-sm transition-opacity duration-300 p-4 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="support-modal-title"
    >
      <div className="glass-card w-full max-w-xl rounded-3xl p-6 md:p-8 relative shadow-[0_0_30px_4px_rgba(221,183,255,0.15)] max-h-[85vh] flex flex-col">
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-primary/20 rounded-full blur-[80px] pointer-events-none" />

        <div className="relative z-10 flex flex-col min-h-0 flex-1">
          <div className="flex justify-between items-start mb-6 shrink-0">
            <div className="flex items-center gap-3">
              {view === 'thread' && (
                <button onClick={backToList} className="text-outline hover:text-on-surface transition-colors" aria-label="Volver al historial">
                  <MaterialIcon icon="arrow_back" />
                </button>
              )}
              <div>
                <h3 id="support-modal-title" className="font-headline-lg text-headline-lg text-primary">
                  {view === 'thread' ? (selectedTicket?.subject || 'Consulta') : 'Soporte'}
                </h3>
                <p className="text-on-surface-variant text-sm mt-1">
                  {view === 'thread' ? 'Historial de esta consulta' : 'Creá una consulta o revisá tu historial'}
                </p>
              </div>
            </div>
            <button onClick={handleClose} className="text-outline hover:text-on-surface transition-colors p-1" aria-label="Cerrar">
              <MaterialIcon icon="close" />
            </button>
          </div>

          {view === 'list' ? (
            <div className="flex-1 overflow-y-auto space-y-6 min-h-0">
              {/* Historial */}
              {ticketsLoading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => <div key={i} className="h-14 rounded-xl bg-surface-container-highest animate-pulse" />)}
                </div>
              ) : ticketsError ? (
                <div className="p-4 rounded-xl bg-error/10 border border-error/20 text-error text-sm">
                  {ticketsError}
                  <button onClick={loadTickets} className="block mt-2 font-bold hover:underline">Reintentar</button>
                </div>
              ) : tickets.length > 0 ? (
                <div className="space-y-2">
                  <p className="font-label-sm text-on-surface-variant uppercase tracking-widest text-[10px]">Tus consultas</p>
                  {tickets.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => openThread(t)}
                      className="w-full text-left p-3.5 rounded-xl bg-surface-container-lowest border border-white/10 hover:border-primary/40 transition-all flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-on-surface truncate">{t.subject}</p>
                        <p className="text-xs text-on-surface-variant">{formatDateTime(t.last_message_at)}</p>
                      </div>
                      <StatusPill status={t.status} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-6 rounded-xl bg-surface-container-lowest border border-white/5 text-center">
                  <MaterialIcon icon="support_agent" className="text-outline text-4xl mb-2" />
                  <p className="text-on-surface-variant text-sm">Todavía no tenés consultas. Creá la primera acá abajo.</p>
                </div>
              )}

              {/* Formulario de consulta nueva */}
              <form onSubmit={handleSubmitTicket} className="space-y-4 pt-2 border-t border-white/5">
                <p className="font-label-sm text-on-surface-variant uppercase tracking-widest text-[10px] pt-4">Nueva consulta</p>
                <div className="space-y-1.5">
                  <label className="font-label-sm text-label-sm text-outline ml-1">Asunto</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={SUBJECT_MAX}
                    placeholder="Resumen breve de tu consulta"
                    className="w-full bg-surface-container-lowest border border-white/10 focus:border-primary/50 focus:ring-1 focus:ring-primary/50 rounded-xl py-3 px-4 text-on-surface outline-none transition-all placeholder:text-outline/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="font-label-sm text-label-sm text-outline ml-1">Categoría</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full bg-surface-container-lowest border border-white/10 focus:border-primary/50 focus:ring-1 focus:ring-primary/50 rounded-xl py-3 px-4 text-on-surface outline-none transition-all"
                  >
                    {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="font-label-sm text-label-sm text-outline ml-1">Descripción</label>
                  <textarea
                    rows={3}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    maxLength={BODY_MAX}
                    placeholder="Contanos el detalle de tu consulta..."
                    className="w-full bg-surface-container-lowest border border-white/10 focus:border-primary/50 focus:ring-1 focus:ring-primary/50 rounded-xl py-3 px-4 text-on-surface outline-none transition-all placeholder:text-outline/40 resize-none"
                  />
                </div>
                {formError && <p className="text-error text-sm">{formError}</p>}
                <GradientButton type="submit" loading={submitting} className="w-full py-4">
                  Enviar consulta
                </GradientButton>
              </form>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center gap-2 mb-3 shrink-0">
                <StatusPill status={selectedTicket?.status} />
                <span className="text-xs text-on-surface-variant">
                  {CATEGORIES.find((c) => c.value === selectedTicket?.category)?.label}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0 themed-scrollbar">
                {threadLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-xl bg-surface-container-highest animate-pulse" />)}
                  </div>
                ) : threadError ? (
                  <div className="p-4 rounded-xl bg-error/10 border border-error/20 text-error text-sm">{threadError}</div>
                ) : (
                  messages.map((m) => {
                    const isMine = m.sender_id === user?.id;
                    return (
                      <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                            isMine
                              ? 'bg-primary/15 border border-primary/20 text-on-surface'
                              : 'bg-surface-container-highest border border-white/10 text-on-surface'
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">{m.body}</p>
                          <p className="text-[10px] text-on-surface-variant mt-1">
                            {m.sender_role === 'admin' ? 'Soporte' : 'Vos'} · {formatDateTime(m.created_at)}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={handleSendReply} className="pt-4 mt-2 border-t border-white/5 shrink-0 space-y-2">
                {isClosed ? (
                  <p className="text-xs text-on-surface-variant p-3 rounded-xl bg-surface-container-lowest border border-white/5">
                    Esta consulta está cerrada, no se pueden enviar más mensajes.
                  </p>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <textarea
                        rows={2}
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        onKeyDown={(e) => {
                          // Enter envía, Shift+Enter agrega un salto de línea.
                          if (e.key === 'Enter' && !e.shiftKey && !replySending) {
                            e.preventDefault();
                            handleSendReply(e);
                          }
                        }}
                        maxLength={BODY_MAX}
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
