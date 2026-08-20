import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateName,
  validateEmail,
  validateMessage,
  validateContactPayload,
  isHoneypotFilled,
  escapeHtml,
  sanitizeHeaderValue,
  extractClientIp,
  NAME_MIN,
  NAME_MAX,
  MESSAGE_MIN,
  MESSAGE_MAX,
  EMAIL_MAX,
} from './validation.js';

// El rate limit por IP dejó de vivir acá (era un Map en memoria + checkRateLimit
// / pruneExpiredRateLimitEntries, ambas puras y testeadas con node:test). Se
// reemplazó por Postgres (contact_rate_limits + contact_rate_limit_check(),
// ver supabase/migrations/20260818210000_contact_rate_limits.sql) porque el
// Map no sobrevivía entre invocaciones reales de la Edge Function. Esa lógica
// ahora pega contra Supabase vía RPC desde index.ts, así que ya no es pura y
// no se testea con node:test -- mismo criterio que el resto del handler
// (create-user, admin-user-status no tienen tests de handler tampoco).

// --- validateName (tasks.md 3.1: 2-100 chars) ---

test('validateName: nombre válido no da error', () => {
  assert.equal(validateName('Ana'), null);
});

test('validateName: nombre vacío da error', () => {
  assert.ok(validateName(''));
  assert.ok(validateName('   '));
});

test('validateName: nombre de 1 char (bajo el mínimo) da error', () => {
  assert.ok(validateName('A'));
});

test('validateName: nombre de exactamente NAME_MIN es válido (límite inclusive)', () => {
  assert.equal(validateName('A'.repeat(NAME_MIN)), null);
});

test('validateName: nombre de exactamente NAME_MAX es válido (límite inclusive)', () => {
  assert.equal(validateName('A'.repeat(NAME_MAX)), null);
});

test('validateName: nombre de NAME_MAX + 1 da error', () => {
  assert.ok(validateName('A'.repeat(NAME_MAX + 1)));
});

test('validateName: undefined/null dan error sin explotar', () => {
  assert.ok(validateName(undefined));
  assert.ok(validateName(null));
});

// --- validateEmail (tasks.md 3.1: formato + <= 254 chars) ---

test('validateEmail: correo válido no da error', () => {
  assert.equal(validateEmail('ana@empresa.com'), null);
});

test('validateEmail: formato inválido da error', () => {
  assert.ok(validateEmail('no-es-un-mail'));
  assert.ok(validateEmail('falta-arroba.com'));
  assert.ok(validateEmail('sin-dominio@'));
});

test('validateEmail: vacío da error', () => {
  assert.ok(validateEmail(''));
});

test('validateEmail: excede EMAIL_MAX da error', () => {
  const local = 'a'.repeat(EMAIL_MAX);
  assert.ok(validateEmail(`${local}@empresa.com`));
});

// --- validateMessage (tasks.md 3.1: 10-2000 chars) ---

test('validateMessage: mensaje válido no da error', () => {
  assert.equal(validateMessage('Quiero información sobre Aura'), null);
});

test('validateMessage: mensaje corto (< MESSAGE_MIN) da error', () => {
  assert.ok(validateMessage('hola'));
});

test('validateMessage: mensaje de exactamente MESSAGE_MIN es válido', () => {
  assert.equal(validateMessage('a'.repeat(MESSAGE_MIN)), null);
});

test('validateMessage: mensaje de exactamente MESSAGE_MAX es válido', () => {
  assert.equal(validateMessage('a'.repeat(MESSAGE_MAX)), null);
});

test('validateMessage: mensaje de MESSAGE_MAX + 1 da error', () => {
  assert.ok(validateMessage('a'.repeat(MESSAGE_MAX + 1)));
});

// --- validateContactPayload (agregado, spec: campo faltante -> 400) ---

test('validateContactPayload: payload completo y válido -> valid true', () => {
  const result = validateContactPayload({
    name: 'Ana',
    email: 'ana@empresa.com',
    message: 'Quiero información sobre Aura y sus planes',
  });
  assert.deepEqual(result, { valid: true, error: null });
});

test('validateContactPayload: falta message -> valid false con error', () => {
  const result = validateContactPayload({ name: 'Ana', email: 'ana@empresa.com' });
  assert.equal(result.valid, false);
  assert.ok(result.error);
});

test('validateContactPayload: payload vacío/undefined no explota', () => {
  assert.equal(validateContactPayload(undefined).valid, false);
  assert.equal(validateContactPayload({}).valid, false);
});

// --- isHoneypotFilled (tasks.md 3.2) ---

test('isHoneypotFilled: company vacío o ausente -> false (humano)', () => {
  assert.equal(isHoneypotFilled(''), false);
  assert.equal(isHoneypotFilled(undefined), false);
  assert.equal(isHoneypotFilled(null), false);
  assert.equal(isHoneypotFilled('   '), false);
});

test('isHoneypotFilled: company con contenido -> true (bot)', () => {
  assert.equal(isHoneypotFilled('Acme Inc'), true);
});

// --- escapeHtml (tasks.md 3.4) ---

test('escapeHtml: escapa & < > " \'', () => {
  assert.equal(escapeHtml(`& < > " '`), '&amp; &lt; &gt; &quot; &#39;');
});

test('escapeHtml: texto plano sin caracteres especiales queda igual', () => {
  assert.equal(escapeHtml('Hola, soy Ana'), 'Hola, soy Ana');
});

test('escapeHtml: neutraliza intento de inyección de script', () => {
  const result = escapeHtml('<script>alert(1)</script>');
  assert.ok(!result.includes('<script>'));
  assert.equal(result, '&lt;script&gt;alert(1)&lt;/script&gt;');
});

// --- sanitizeHeaderValue (tasks.md 3.5) ---

test('sanitizeHeaderValue: elimina saltos de línea usados para inyectar headers', () => {
  const result = sanitizeHeaderValue('Ana\nBcc: atacante@evil.com');
  assert.ok(!result.includes('\n'));
  assert.ok(!result.includes('Bcc:'.concat('')) || !result.includes('\n'));
});

test('sanitizeHeaderValue: texto normal queda intacto', () => {
  assert.equal(sanitizeHeaderValue('Ana Pérez'), 'Ana Pérez');
});

test('sanitizeHeaderValue: elimina caracteres de control', () => {
  const result = sanitizeHeaderValue('Ana\r\n\x00Bcc');
  // eslint-disable-next-line no-control-regex
  assert.ok(!/[\r\n\x00]/.test(result));
});

// --- extractClientIp ---

test('extractClientIp: toma la primera IP de x-forwarded-for', () => {
  assert.equal(extractClientIp('1.2.3.4, 5.6.7.8'), '1.2.3.4');
});

test('extractClientIp: header ausente -> unknown', () => {
  assert.equal(extractClientIp(null), 'unknown');
  assert.equal(extractClientIp(undefined), 'unknown');
  assert.equal(extractClientIp(''), 'unknown');
});
