// Prueba aislada de la función de derivación de familia por firma binaria (task 1.2).
// Corre ANTES de tocar codigo.json, per §Gobernanza CRITICAL del change
// input-security-hardening (grupo 1, capability binary-signature-validation).
//
// No usa un framework externo (mismo estilo que tests/eicar/, tests/redis-expiration/):
// script Node plano, exit code 0 si todo pasa, 1 si algo falla.
//
// Uso: node tests/magic-bytes/detect-family.test.js

const assert = require('node:assert/strict');
const { detectFamily } = require('./detect-family.js');

/** Buffer sintético: bytes exactos + relleno para simular un archivo real. */
function synth(bytesAtStart, totalLength = 64, offsetOfBytes = 0) {
  const buf = Buffer.alloc(Math.max(totalLength, offsetOfBytes + bytesAtStart.length), 0xaa);
  Buffer.from(bytesAtStart).copy(buf, offsetOfBytes);
  return buf;
}

const cases = [
  // --- familia pdf ---
  {
    name: 'PDF válido (%PDF-1.4 ...)',
    buffer: synth([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
    expected: 'pdf',
  },

  // --- familia image ---
  {
    name: 'JPEG válido (FF D8 FF E0 ...)',
    buffer: synth([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
    expected: 'image',
  },
  {
    name: 'PNG válido (89 50 4E 47 0D 0A 1A 0A ...)',
    buffer: synth([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    expected: 'image',
  },
  {
    name: 'GIF válido (GIF89a)',
    buffer: synth([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
    expected: 'image',
  },
  {
    name: 'GIF válido (GIF87a)',
    buffer: synth([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]),
    expected: 'image',
  },
  {
    name: 'WEBP válido (RIFF....WEBP)',
    buffer: (() => {
      const buf = Buffer.alloc(64, 0xaa);
      Buffer.from([0x52, 0x49, 0x46, 0x46]).copy(buf, 0); // RIFF
      Buffer.from([0x00, 0x00, 0x00, 0x00]).copy(buf, 4); // tamaño chunk, irrelevante para el test
      Buffer.from([0x57, 0x45, 0x42, 0x50]).copy(buf, 8); // WEBP
      return buf;
    })(),
    expected: 'image',
  },

  // --- familia video ---
  {
    name: 'MP4 válido (ISO-BMFF, ftyp en offset 4)',
    buffer: synth([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
    expected: 'video',
  },
  {
    name: 'MOV válido (ISO-BMFF, ftyp en offset 4, brand qt)',
    buffer: synth([0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]),
    expected: 'video',
  },
  {
    name: 'WebM/Matroska válido (1A 45 DF A3)',
    buffer: synth([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]),
    expected: 'video',
  },

  // --- contra-casos: deben dar 'unknown', nunca aceptarse por accidente ---
  {
    name: 'Contra-caso: ejecutable Windows PE (4D 5A) disfrazado',
    buffer: synth([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]),
    expected: 'unknown',
  },
  {
    name: 'Contra-caso: ZIP (50 4B 03 04) — también cubre .docx/.xlsx/.apk',
    buffer: synth([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]),
    expected: 'unknown',
  },
  {
    name: 'Contra-caso: texto plano',
    buffer: Buffer.from('Este es un catalogo de productos en texto plano, no un binario real.', 'utf8'),
    expected: 'unknown',
  },
  {
    name: 'Contra-caso: binario vacío',
    buffer: Buffer.alloc(0),
    expected: 'unknown',
  },
  {
    name: 'Contra-caso: buffer más corto que cualquier firma conocida',
    buffer: Buffer.from([0x25, 0x50]), // empieza como %PDF- pero está truncado
    expected: 'unknown',
  },
  {
    name: 'Contra-caso: RIFF sin WEBP en offset 8 (p.ej. WAV, AVI RIFF)',
    buffer: (() => {
      const buf = Buffer.alloc(64, 0xaa);
      Buffer.from([0x52, 0x49, 0x46, 0x46]).copy(buf, 0); // RIFF
      Buffer.from([0x00, 0x00, 0x00, 0x00]).copy(buf, 4);
      Buffer.from([0x57, 0x41, 0x56, 0x45]).copy(buf, 8); // WAVE, no WEBP
      return buf;
    })(),
    expected: 'unknown',
  },
];

let passed = 0;
let failed = 0;

for (const { name, buffer, expected } of cases) {
  try {
    const actual = detectFamily(buffer);
    assert.equal(actual, expected, `esperado '${expected}', obtenido '${actual}'`);
    console.log(`PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${err.message}`);
    failed++;
  }
}

console.log(`\n${passed}/${cases.length} casos OK, ${failed} fallidos.`);

if (failed > 0) {
  process.exitCode = 1;
}
