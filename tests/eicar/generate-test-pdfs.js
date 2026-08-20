// Genera los PDFs de prueba para el flujo EICAR del bot Aura (change pdf-virus-scan).
// Uso: node tests/eicar/generate-test-pdfs.js
// NO inicia contenedores: solo escribe archivos en tests/eicar/.
const fs = require('fs');
const path = require('path');

const outDir = __dirname;

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

// 1. Caso malicioso CONFIABLE: contenido = cadena EICAR exacta (68 bytes).
//    ClamAV detecta EICAR SOLO si el archivo empieza con la cadena de 68 chars
//    y mide exactamente 68 bytes (hasta 128 permitiendo whitespace). Al ser un
//    "documento" nombrado .pdf, Telegram lo descarga igual y el escaneo ocurre
//    ANTES de Gemini, asi que no necesita ser un PDF estructuralmente valido.
const eicarBytes = Buffer.from(EICAR, 'ascii');
fs.writeFileSync(path.join(outDir, 'eicar-test.pdf'), eicarBytes);

// 2. Caso malicioso alternativo: EICAR embebido como string literal en un PDF
//    minimo valido (sin compresion). NOTA: ClamAV es estricto y normalmente NO
//    detecta EICAR en medio de otro archivo; se genera por completitud con el
//    design.md, pero el caso confiable es #1.
function minimalPdf(text) {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const stream = Buffer.from(content, 'ascii').toString('latin1');
  const objs = [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    `5 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
    'trailer << /Root 1 0 R >>',
    '%%EOF',
  ].join('\n');
  return Buffer.from(objs, 'latin1');
}
fs.writeFileSync(path.join(outDir, 'eicar-embedded-in-pdf.pdf'), minimalPdf(EICAR));

// 3. Caso limpio: PDF minimo valido con texto de catalogo (no malicioso).
const clean = minimalPdf('CATALOGO DE PRODUCTOS 2026 - Mermeladas artesanales - $1.200 - $2.500 - $3.000');
fs.writeFileSync(path.join(outDir, 'catalogo-limpio.pdf'), clean);

for (const f of fs.readdirSync(outDir).filter((f) => f.endsWith('.pdf'))) {
  const b = fs.readFileSync(path.join(outDir, f));
  console.log(`${f}: ${b.length} bytes`);
}
