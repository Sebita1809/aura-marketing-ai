// Helpers puros de la Edge Function send-contact-email (landing-contact-email,
// design.md Decisión 5). Sin dependencias de Deno/Supabase -- testeados con
// node:test (aura-frontend/supabase/functions/send-contact-email/validation.test.js)
// e importados tal cual desde index.ts (Deno soporta imports relativos .js).
//
// Mantener este archivo libre de APIs específicas de Deno (Deno.env, fetch a
// Resend, etc.) es lo que permite testear la validación, el escapado y el
// rate limit sin un runtime Deno ni mocks de red.

export const NAME_MIN = 2;
export const NAME_MAX = 100;
export const EMAIL_MAX = 254;
export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 2000;

// Regex de formato "razonable" (design.md D5.2): no pretende cubrir el RFC
// completo, solo rechazar strings que obviamente no son un email.
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {unknown} name
 * @returns {string|null} mensaje de error, o null si es válido
 */
export function validateName(name) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return 'El nombre es requerido.';
  }
  const trimmed = name.trim();
  if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
    return `El nombre debe tener entre ${NAME_MIN} y ${NAME_MAX} caracteres.`;
  }
  return null;
}

/**
 * @param {unknown} email
 * @returns {string|null}
 */
export function validateEmail(email) {
  if (typeof email !== 'string' || email.trim().length === 0) {
    return 'El correo es requerido.';
  }
  const trimmed = email.trim();
  if (trimmed.length > EMAIL_MAX) {
    return `El correo no puede superar los ${EMAIL_MAX} caracteres.`;
  }
  if (!EMAIL_REGEX.test(trimmed)) {
    return 'Ingresá un correo válido.';
  }
  return null;
}

/**
 * @param {unknown} message
 * @returns {string|null}
 */
export function validateMessage(message) {
  if (typeof message !== 'string' || message.trim().length === 0) {
    return 'El mensaje es requerido.';
  }
  const trimmed = message.trim();
  if (trimmed.length < MESSAGE_MIN || trimmed.length > MESSAGE_MAX) {
    return `El mensaje debe tener entre ${MESSAGE_MIN} y ${MESSAGE_MAX} caracteres.`;
  }
  return null;
}

/**
 * Valida el payload completo del formulario de contacto (name, email,
 * message). No valida `company` -- ese es el honeypot, ver isHoneypotFilled.
 *
 * @param {{name?: unknown, email?: unknown, message?: unknown}} payload
 * @returns {{valid: boolean, error: string|null}}
 */
export function validateContactPayload(payload) {
  const p = payload || {};
  const error = validateName(p.name) || validateEmail(p.email) || validateMessage(p.message);
  return { valid: error === null, error };
}

/**
 * Honeypot (design.md D5.1): el campo `company` está oculto por CSS para
 * humanos pero visible para bots que autocompletan todos los inputs. Si
 * viene con contenido, es un bot.
 *
 * @param {unknown} company
 * @returns {boolean}
 */
export function isHoneypotFilled(company) {
  return typeof company === 'string' && company.trim().length > 0;
}

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapa `& < > " '` para interpolar de forma segura en el cuerpo HTML del
 * correo (design.md D5.4 / tasks.md 3.4). No es un sanitizador de HTML
 * general -- alcanza porque el resultado nunca se usa como HTML de entrada,
 * solo como texto plano escapado dentro de un template fijo.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  const str = value == null ? '' : String(value);
  return str.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

/**
 * Neutraliza saltos de línea y caracteres de control (tasks.md 3.5) para
 * valores que se interpolan en headers de correo (`subject`, `reply_to`).
 * Sin esto, un `name` como "Ana\nBcc: atacante@evil.com" podría inyectar
 * headers adicionales en algunos clientes SMTP.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeHeaderValue(value) {
  const str = value == null ? '' : String(value);
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\r\n\x00-\x1f\x7f]/g, ' ').trim();
}

/**
 * Extrae la primera IP de un header `x-forwarded-for` (que puede traer una
 * cadena "cliente, proxy1, proxy2"). Devuelve 'unknown' si no hay header --
 * eso agrupa a todos los requests sin IP bajo la misma clave de rate limit,
 * lo cual es intencional (mejor limitar de más ese caso raro que no limitar
 * nada).
 *
 * @param {string|null|undefined} forwardedFor
 * @returns {string}
 */
export function extractClientIp(forwardedFor) {
  if (typeof forwardedFor !== 'string' || forwardedFor.trim().length === 0) {
    return 'unknown';
  }
  return forwardedFor.split(',')[0].trim() || 'unknown';
}

// El rate limit por IP (antes un Map en memoria del isolate, ver git history
// de este archivo) se movió a Postgres: tabla public.contact_rate_limits +
// función public.contact_rate_limit_check(), ver
// supabase/migrations/20260818210000_contact_rate_limits.sql. Motivo: en
// producción, Supabase no reusa el isolate de forma confiable entre
// invocaciones consecutivas de este proyecto -- el Map en memoria nunca
// acumulaba estado entre requests (verificado en vivo: 9 requests seguidos
// desde la misma IP, 0 bloqueados por 429). El check-and-increment ahora
// vive en la DB (llamada RPC desde index.ts), que sí es compartida entre
// isolates. Esa parte NO es pura -- pega contra Supabase -- así que no se
// testea acá con node:test, mismo criterio que el resto del handler.
