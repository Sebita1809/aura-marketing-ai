// Test del contrato /v2/scan con un archivo EICAR, sin pasar por el filesystem bloqueado por Defender.
// Uso: node tests/eicar/scan-rest-test.js
// NO inicia contenedores: solo hace POST al servicio clamav-rest (host:8082 o internal:9000).
const fs = require('fs');
const path = require('path');

const BASE = process.env.SCAN_URL || 'http://localhost:8082/v2/scan';
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

async function multipartScan(filename, content) {
  const boundary = '----formboundary' + Date.now();
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`,
      'utf8'
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);
  const res = await fetch(BASE, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body });
  const text = await res.text();
  return { status: res.status, body: text };
}

(async () => {
  // 1. EICAR puro (mismo contenido que eicar-test.pdf)
  let r = await multipartScan('eicar-test.pdf', Buffer.from(EICAR, 'ascii'));
  console.log('EICAR puro      ->', r.status, r.body);

  // 2. PDF limpio (mismo contenido que catalogo-limpio.pdf si existe y es legible)
  const cleanPath = path.join(__dirname, 'catalogo-limpio.pdf');
  let cleanBuf = Buffer.from('CATALOGO DE PRODUCTOS 2026 - Mermeladas artesanales', 'latin1');
  try { cleanBuf = fs.readFileSync(cleanPath); } catch (_) { /* Defender puede bloquear la lectura; usamos el fallback */ }
  r = await multipartScan('catalogo-limpio.pdf', cleanBuf);
  console.log('PDF limpio      ->', r.status, r.body);
})();
