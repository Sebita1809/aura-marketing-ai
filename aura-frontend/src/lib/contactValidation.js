// Validación client-side del formulario de contacto (landing-contact-email,
// tasks.md 5.2: "mismos límites que la sección 3.1"). Deliberadamente
// duplicada respecto a la validación server-side de
// supabase/functions/send-contact-email/validation.js -- son runtimes
// distintos (Vite/browser vs. Deno Edge Function) sin un punto de import
// común razonable, y el spec exige que el server valide "independientemente
// de la validación del frontend" (contact-email-delivery spec, Requirement
// "Validación y límites de entrada"). Esta copia es solo UX (feedback
// inmediato); la copia server-side sigue siendo la autoridad de seguridad.
//
// Si los límites cambian, hay que actualizar ambos archivos.

export const NAME_MIN = 2;
export const NAME_MAX = 100;
export const EMAIL_MAX = 254;
export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 2000;

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {unknown} name
 * @returns {string|null}
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
 * @param {{name?: unknown, email?: unknown, message?: unknown}} payload
 * @returns {{valid: boolean, error: string|null}}
 */
export function validateContactPayload(payload) {
  const p = payload || {};
  const error = validateName(p.name) || validateEmail(p.email) || validateMessage(p.message);
  return { valid: error === null, error };
}
