// Generador de PDFs minimos validos, con texto en posiciones/tamanos arbitrarios, para armar
// el banco sintetico de casos de prompt injection en la superficie `pdf`. Extiende el patron
// ya usado en tests/eicar/generate-test-pdfs.js (minimalPdf) a multiples bloques de texto por
// pagina, necesario para simular letra chica de pie de pagina y payloads fragmentados.
// No requiere ninguna libreria de PDF: son objetos PDF 1.4 sin compresion, escritos a mano.
'use strict';

function escapePdfText(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * blocks: [{ text, size=11, x=54, y=700 }]
 * Cada bloque se dibuja como una linea simple (BT ... Tj ET). Para texto largo, el llamador
 * debe partirlo en varias lineas (varios bloques con distinto y) porque este generador no
 * hace wrap automatico: es intencional, mantiene el generador simple y auditable.
 */
function buildMinimalPdf(blocks) {
  const ops = blocks
    .map((b) => {
      const size = b.size ?? 11;
      const x = b.x ?? 54;
      const y = b.y ?? 700;
      return `BT /F1 ${size} Tf ${x} ${y} Td (${escapePdfText(b.text)}) Tj ET`;
    })
    .join('\n');
  const streamBody = Buffer.from(ops, 'latin1');
  const objs = [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    `5 0 obj << /Length ${streamBody.length} >> stream\n${streamBody.toString('latin1')}\nendstream endobj`,
    'trailer << /Root 1 0 R >>',
    '%%EOF',
  ].join('\n');
  return Buffer.from(objs, 'latin1');
}

/**
 * Igual que buildMinimalPdf pero parte automaticamente lineas largas en varios bloques,
 * bajando `y` a medida que agrega lineas. Util para el contenido "normal" del catalogo
 * (varios productos) mezclado con el bloque de letra chica.
 */
function buildCatalogPdf({ title, products, footnote, footnoteSize = 5 }) {
  const blocks = [];
  let y = 740;
  blocks.push({ text: title, size: 16, x: 54, y });
  y -= 30;
  for (const p of products) {
    blocks.push({ text: p, size: 11, x: 54, y });
    y -= 22;
  }
  if (footnote) {
    // Letra chica, pie de pagina, esquina inferior: exactamente el patron descrito en el
    // prompt endurecido de "Analyze document" como senal sospechosa.
    blocks.push({ text: footnote, size: footnoteSize, x: 54, y: 30 });
  }
  return buildMinimalPdf(blocks);
}

module.exports = { buildMinimalPdf, buildCatalogPdf, escapePdfText };
