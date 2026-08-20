import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { normalizeSupportError } from '../lib/supportLogic';

// Capa de acceso a datos del sistema de soporte (design.md D6): centraliza
// las queries y la suscripción Realtime que, si no, se duplicarían en cuatro
// superficies (SupportModal, SupportInboxPage, NotificationsBell x2 páginas).
//
// Cada componente que llama useSupport() obtiene su PROPIA instancia de
// `loading`/`error` (son useState locales al hook, no un store global), así
// que el spinner de un componente nunca pisa el de otro -- sigue el mismo
// patrón que AdminDashboard.jsx/ConnectionsPage.jsx (loading/error locales a
// la página), solo que la query en sí vive acá para no repetirla.
//
// Ninguna función de acá arma `sender_role` a partir de un parámetro del
// componente: siempre se deriva de `profile.role` (tasks.md 2.4), porque el
// componente que llama no es una fuente confiable de identidad -- la policy
// de la migración lo re-valida server-side de todos modos, pero el cliente
// no debe ni intentar mentir.

const POLL_INTERVAL_MS = 60000;

export function useSupport() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const role = profile?.role === 'admin' ? 'admin' : 'user';

  // Envoltorio común: fija loading/error alrededor de cualquier operación
  // async de Supabase y normaliza el error a español (tasks.md 2.8) antes de
  // devolverlo -- nunca se propaga `err.message` crudo a la UI.
  const run = useCallback(async (fn) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fn();
      return result;
    } catch (err) {
      const message = normalizeSupportError(err);
      setError(message);
      console.error('Error de soporte:', err?.message || err);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  // --- Tickets ---------------------------------------------------------------

  const listMyTickets = useCallback(() => run(async () => {
    if (!user?.id) return [];
    const { data, error: fetchError } = await supabase
      .from('support_tickets')
      .select('id, subject, category, status, created_at, updated_at, last_message_at')
      .eq('user_id', user.id)
      .order('last_message_at', { ascending: false });
    if (fetchError) throw fetchError;
    return data || [];
  }), [run, user?.id]);

  const listAllTickets = useCallback(({ status } = {}) => run(async () => {
    let query = supabase
      .from('support_tickets')
      .select('id, user_id, subject, category, status, created_at, updated_at, last_message_at, profiles:user_id (full_name, company, email)')
      .order('last_message_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error: fetchError } = await query;
    if (fetchError) throw fetchError;
    return data || [];
  }), [run]);

  // Crea el ticket y, a continuación, su primer mensaje (design.md D1: la
  // descripción inicial vive en support_messages, no en support_tickets). Si
  // el segundo insert falla, el ticket ya existe en el servidor pero no hay
  // forma de dejarlo "huérfano visible" en la UI porque acá nunca se
  // devuelve como éxito -- el componente recibe el error y no lo agrega al
  // historial local (tasks.md 2.3); en el próximo listMyTickets() sí
  // aparecerá (sin mensajes), y el usuario puede reintentar la respuesta
  // desde el hilo.
  const createTicket = useCallback(({ subject, category, body }) => run(async () => {
    if (!user?.id) throw new Error('No hay sesión activa.');
    const { data: ticket, error: ticketError } = await supabase
      .from('support_tickets')
      .insert({ user_id: user.id, subject, category })
      .select('id, subject, category, status, created_at, updated_at, last_message_at')
      .single();
    if (ticketError) throw ticketError;

    const { error: messageError } = await supabase
      .from('support_messages')
      .insert({ ticket_id: ticket.id, sender_id: user.id, sender_role: 'user', body });
    if (messageError) throw messageError;

    return ticket;
  }), [run, user?.id]);

  const setTicketStatus = useCallback((ticketId, status) => run(async () => {
    const { error: updateError } = await supabase
      .from('support_tickets')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', ticketId);
    if (updateError) throw updateError;
  }), [run]);

  // --- Mensajes ----------------------------------------------------------------

  const listMessages = useCallback((ticketId) => run(async () => {
    const { data, error: fetchError } = await supabase
      .from('support_messages')
      .select('id, ticket_id, sender_id, sender_role, body, read_at, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });
    if (fetchError) throw fetchError;
    return data || [];
  }), [run]);

  const sendMessage = useCallback((ticketId, body) => run(async () => {
    if (!user?.id) throw new Error('No hay sesión activa.');
    const { data, error: insertError } = await supabase
      .from('support_messages')
      .insert({ ticket_id: ticketId, sender_id: user.id, sender_role: role, body })
      .select('id, ticket_id, sender_id, sender_role, body, read_at, created_at')
      .single();
    if (insertError) throw insertError;
    return data;
  }), [run, user?.id, role]);

  const markAsRead = useCallback((messageIds) => run(async () => {
    if (!messageIds || messageIds.length === 0) return;
    const { error: updateError } = await supabase
      .from('support_messages')
      .update({ read_at: new Date().toISOString() })
      .in('id', messageIds)
      .is('read_at', null); // no re-marca lo ya leído (tasks.md 6.5)
    if (updateError) throw updateError;
  }), [run]);

  // `getUnreadCount` cuenta del lado del usuario común (respuestas de admin
  // sin leer dentro de SUS tickets); la RLS de support_messages_select ya
  // acota el universo a sus propios tickets, así que no hace falta un join
  // explícito acá. Para el total del admin (mensajes de usuario sin leer en
  // TODOS los tickets) se usa el mismo filtro, la RLS lo amplía solo (via
  // support_messages_select para is_admin()).
  const getUnreadCount = useCallback(() => run(async () => {
    const otherRole = role === 'admin' ? 'user' : 'admin';
    const { count, error: countError } = await supabase
      .from('support_messages')
      .select('*', { count: 'exact', head: true })
      .eq('sender_role', otherRole)
      .is('read_at', null);
    if (countError) throw countError;
    return count ?? 0;
  }), [run, role]);

  // Últimas respuestas de admin, con el asunto del ticket embebido (usado por
  // NotificationsBell, tasks.md 6.3). La RLS de support_messages_select ya
  // acota esto a los tickets propios de quien llama -- no hace falta
  // filtrar por user_id acá.
  const listRecentAdminReplies = useCallback(({ limit = 20 } = {}) => run(async () => {
    const { data, error: fetchError } = await supabase
      .from('support_messages')
      .select('id, ticket_id, sender_role, body, read_at, created_at, support_tickets:ticket_id (subject)')
      .eq('sender_role', 'admin')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (fetchError) throw fetchError;
    return data || [];
  }), [run]);

  // --- Realtime ------------------------------------------------------------

  // Canal único de soporte. `handlers.onMessage`/`onTicket` se llaman en
  // cada INSERT/UPDATE que la RLS deja pasar; `handlers.onPollFallback` es
  // el degradado a refresco periódico si el canal no llega a suscribirse
  // (CHANNEL_ERROR/TIMED_OUT) -- nunca un error bloqueante (tasks.md 6.8).
  // El caller es responsable de invocar la función de limpieza devuelta
  // dentro del cleanup de su propio useEffect (mismo patrón que el
  // addEventListener/removeEventListener de Sidebar.jsx y ConnectionsPage.jsx).
  const subscribeToSupport = useCallback((handlers = {}) => {
    const channelName = `support-messaging-${Math.random().toString(36).slice(2)}`;
    const channel = supabase.channel(channelName);

    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'support_messages' },
      (payload) => handlers.onMessage?.(payload)
    );

    if (handlers.onTicket) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'support_tickets' },
        (payload) => handlers.onTicket(payload)
      );
    }

    let pollTimer = null;
    const startPolling = () => {
      if (pollTimer || !handlers.onPollFallback) return;
      pollTimer = setInterval(handlers.onPollFallback, POLL_INTERVAL_MS);
    };

    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        startPolling();
      }
    });

    return () => {
      supabase.removeChannel(channel);
      if (pollTimer) clearInterval(pollTimer);
    };
  }, []);

  return {
    loading,
    error,
    role,
    listMyTickets,
    listAllTickets,
    createTicket,
    setTicketStatus,
    listMessages,
    sendMessage,
    markAsRead,
    getUnreadCount,
    listRecentAdminReplies,
    subscribeToSupport,
  };
}

export default useSupport;
