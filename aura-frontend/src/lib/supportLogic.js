// Helpers puros del sistema de soporte (support-messaging, design.md D1/D3/D4).
// Sin dependencias de React/Supabase -- testeados con node:test. Se usan desde
// useSupport.js y los componentes para reordenar/recontar de forma optimista
// sin esperar un refetch, y para no filtrar detalle interno de las policies
// de RLS en los mensajes de error que ve el usuario.

/**
 * Replica exactamente el CASE de la migración
 * (support_messages_after_insert trigger, 20260818200000_support_messaging.sql):
 * un mensaje de admin sobre un ticket 'open' lo pasa a 'answered'; un mensaje
 * del usuario sobre un ticket 'answered' lo vuelve a 'open'. Cualquier otra
 * combinación (incluido 'closed', que no acepta mensajes nuevos por policy)
 * deja el estado sin cambios.
 *
 * @param {'open'|'answered'|'closed'} currentStatus
 * @param {'user'|'admin'} senderRole
 * @returns {'open'|'answered'|'closed'}
 */
export function nextTicketStatus(currentStatus, senderRole) {
  if (senderRole === 'admin' && currentStatus === 'open') return 'answered';
  if (senderRole === 'user' && currentStatus === 'answered') return 'open';
  return currentStatus;
}

/**
 * Cuenta mensajes no leídos desde el punto de vista de `viewerRole`: un
 * usuario cuenta las respuestas del admin sin leer; un admin cuenta los
 * mensajes de usuarios sin leer. Nunca cuenta los mensajes del propio rol
 * (design.md D4).
 *
 * @param {Array<{sender_role: 'user'|'admin', read_at: string|null}>} messages
 * @param {{viewerRole: 'user'|'admin'}} opts
 */
export function countUnread(messages, { viewerRole }) {
  const otherRole = viewerRole === 'admin' ? 'user' : 'admin';
  let count = 0;
  for (const m of messages || []) {
    if (m && m.sender_role === otherRole && m.read_at == null) count += 1;
  }
  return count;
}

/**
 * Orden por actividad reciente (last_message_at desc), sin mutar el array de
 * entrada -- los componentes lo llaman después de un update optimista sobre
 * el estado de React, y mutar in-place ahí rompería la identidad esperada
 * por setState.
 *
 * @param {Array<{last_message_at: string}>} tickets
 */
export function sortByLastActivity(tickets) {
  return [...(tickets || [])].sort(
    (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
  );
}

// Códigos de error de Postgres/PostgREST relevantes acá:
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const ERROR_MESSAGES = {
  '42501': 'No tenés permiso para realizar esta acción.', // insufficient_privilege / RLS
  '23514': 'Los datos ingresados no son válidos.', // check_violation
  '23503': 'No se pudo completar la operación: referencia inválida.', // foreign_key_violation
};
const DEFAULT_MESSAGE = 'Ocurrió un error. Intentá de nuevo.';

/**
 * Normaliza un error de Supabase a un mensaje en español apto para mostrar en
 * la UI (tasks.md 2.8): nunca reenvía `error.message` tal cual, porque ese
 * texto puede citar el nombre de una policy, una tabla o una constraint
 * interna.
 *
 * @param {{code?: string, message?: string}|null|undefined} error
 */
export function normalizeSupportError(error) {
  if (!error) return DEFAULT_MESSAGE;
  return ERROR_MESSAGES[error.code] || DEFAULT_MESSAGE;
}
