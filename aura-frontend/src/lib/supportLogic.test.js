import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTicketStatus, countUnread, sortByLastActivity, normalizeSupportError } from './supportLogic.js';

// --- nextTicketStatus: mirrors the DB trigger's CASE, used for optimistic UI ---

test('nextTicketStatus: open -> answered cuando responde un admin', () => {
  assert.equal(nextTicketStatus('open', 'admin'), 'answered');
});

test('nextTicketStatus: answered -> open cuando responde el usuario', () => {
  assert.equal(nextTicketStatus('answered', 'user'), 'open');
});

// --- Triangulación: casos donde NO hay transición ---

test('nextTicketStatus: open + mensaje de user se queda en open (no retrocede)', () => {
  assert.equal(nextTicketStatus('open', 'user'), 'open');
});

test('nextTicketStatus: answered + mensaje de admin se queda en answered', () => {
  assert.equal(nextTicketStatus('answered', 'admin'), 'answered');
});

test('nextTicketStatus: closed nunca cambia, ni con user ni con admin', () => {
  assert.equal(nextTicketStatus('closed', 'user'), 'closed');
  assert.equal(nextTicketStatus('closed', 'admin'), 'closed');
});

// --- countUnread: badge del usuario cuenta respuestas de admin; badge del admin cuenta mensajes de usuario ---

test('countUnread para un usuario cuenta solo mensajes de admin no leídos', () => {
  const messages = [
    { sender_role: 'admin', read_at: null },
    { sender_role: 'admin', read_at: '2026-08-18T10:00:00Z' },
    { sender_role: 'user', read_at: null },
  ];
  assert.equal(countUnread(messages, { viewerRole: 'user' }), 1);
});

test('countUnread para un admin cuenta solo mensajes de user no leídos', () => {
  const messages = [
    { sender_role: 'user', read_at: null },
    { sender_role: 'user', read_at: null },
    { sender_role: 'admin', read_at: null },
  ];
  assert.equal(countUnread(messages, { viewerRole: 'admin' }), 2);
});

// --- Triangulación: lista vacía y todo leído ---

test('countUnread sobre lista vacía da 0', () => {
  assert.equal(countUnread([], { viewerRole: 'user' }), 0);
});

test('countUnread cuando todo está leído da 0', () => {
  const messages = [
    { sender_role: 'admin', read_at: '2026-08-18T10:00:00Z' },
    { sender_role: 'admin', read_at: '2026-08-18T11:00:00Z' },
  ];
  assert.equal(countUnread(messages, { viewerRole: 'user' }), 0);
});

// --- sortByLastActivity: orden descendente por last_message_at, sin mutar el original ---

test('sortByLastActivity ordena de más reciente a más antiguo', () => {
  const tickets = [
    { id: 'a', last_message_at: '2026-08-10T00:00:00Z' },
    { id: 'b', last_message_at: '2026-08-18T00:00:00Z' },
    { id: 'c', last_message_at: '2026-08-15T00:00:00Z' },
  ];
  const sorted = sortByLastActivity(tickets);
  assert.deepEqual(sorted.map((t) => t.id), ['b', 'c', 'a']);
});

test('sortByLastActivity no muta el array original', () => {
  const tickets = [
    { id: 'a', last_message_at: '2026-08-10T00:00:00Z' },
    { id: 'b', last_message_at: '2026-08-18T00:00:00Z' },
  ];
  const original = [...tickets];
  sortByLastActivity(tickets);
  assert.deepEqual(tickets, original);
});

// --- normalizeSupportError: mensajes en español, sin filtrar detalle interno de policy ---

test('normalizeSupportError mapea violación de RLS a mensaje de permisos', () => {
  const msg = normalizeSupportError({ code: '42501', message: 'new row violates row-level security policy for table "support_messages"' });
  assert.equal(msg, 'No tenés permiso para realizar esta acción.');
  assert.ok(!msg.includes('row-level security'));
  assert.ok(!msg.includes('support_messages'));
});

test('normalizeSupportError mapea violación de CHECK a mensaje de datos inválidos', () => {
  const msg = normalizeSupportError({ code: '23514', message: 'new row for relation "support_tickets" violates check constraint "support_tickets_category_check"' });
  assert.equal(msg, 'Los datos ingresados no son válidos.');
});

// --- Triangulación: error desconocido / sin code ---

test('normalizeSupportError da un mensaje genérico ante un error desconocido', () => {
  const msg = normalizeSupportError({ message: 'network timeout' });
  assert.equal(msg, 'Ocurrió un error. Intentá de nuevo.');
});

test('normalizeSupportError no rompe si el error es null/undefined', () => {
  assert.equal(normalizeSupportError(null), 'Ocurrió un error. Intentá de nuevo.');
  assert.equal(normalizeSupportError(undefined), 'Ocurrió un error. Intentá de nuevo.');
});
