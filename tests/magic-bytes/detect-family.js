// Función pura de derivación de familia por firma binaria (magic bytes).
//
// Fuente de verdad: openspec/changes/input-security-hardening/design.md, decisión D1.
// Esta MISMA lógica se embebe (copiada literal, sin imports) dentro de los nodos Code
// de n8n "Validar firma PDF" y "Validar firma media" en codigo.json, porque los nodos
// Code de n8n no pueden hacer `require()` de archivos del repo (no hay
// NODE_FUNCTION_ALLOW_EXTERNAL ni acceso al filesystem del host). Este archivo existe
// para poder probar la lógica de forma aislada (tests/magic-bytes/detect-family.test.js)
// ANTES de tocar el workflow (task 1.2). Si se cambia la tabla de firmas acá, hay que
// replicar el cambio a mano en los dos nodos Code — no hay una única fuente ejecutada
// en ambos lugares.
//
// Devuelve 'pdf' | 'image' | 'video' | 'unknown'. Nunca lanza excepción por firma no
// reconocida: eso es un resultado válido ('unknown'), no un error. Solo lanza si el
// argumento no es un Buffer utilizable (eso sí es un error real de invocación).

/**
 * @param {Buffer} buffer
 * @param {number} offset
 * @param {number[]} bytes
 * @returns {boolean}
 */
function matchesBytes(buffer, offset, bytes) {
  if (buffer.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buffer[offset + i] !== bytes[i]) return false;
  }
  return true;
}

/**
 * Deriva la familia real de un binario a partir de sus primeros bytes.
 * @param {Buffer} buffer
 * @returns {'pdf'|'image'|'video'|'unknown'}
 */
function detectFamily(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('detectFamily espera un Buffer');
  }
  if (buffer.length === 0) return 'unknown';

  // --- pdf: %PDF- en offset 0 ---
  if (matchesBytes(buffer, 0, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return 'pdf';
  }

  // --- image ---
  // JPEG: FF D8 FF
  if (matchesBytes(buffer, 0, [0xff, 0xd8, 0xff])) return 'image';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    matchesBytes(buffer, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return 'image';
  }
  // GIF8 (cubre GIF87a y GIF89a): 47 49 46 38
  if (matchesBytes(buffer, 0, [0x47, 0x49, 0x46, 0x38])) return 'image';
  // WEBP: RIFF....WEBP -> "RIFF" offset 0 + "WEBP" offset 8
  if (
    matchesBytes(buffer, 0, [0x52, 0x49, 0x46, 0x46]) &&
    matchesBytes(buffer, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return 'image';
  }

  // --- video ---
  // ISO-BMFF (MP4/MOV/3GP): "ftyp" en offset 4
  if (matchesBytes(buffer, 4, [0x66, 0x74, 0x79, 0x70])) return 'video';
  // Matroska/WebM: 1A 45 DF A3
  if (matchesBytes(buffer, 0, [0x1a, 0x45, 0xdf, 0xa3])) return 'video';

  return 'unknown';
}

module.exports = { detectFamily, matchesBytes };
