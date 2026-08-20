// Genera archivos de prueba EICAR para el flujo de antivirus de la rama imagen/video
// (change input-security-hardening, capability media-virus-scan). Mismo patron que
// generate-test-pdfs.js (change pdf-virus-scan): el archivo NO necesita ser una imagen o
// video estructuralmente valido porque el escaneo ClamAV ocurre ANTES de Moderar
// imagen/video Gemini -- Telegram descarga el binario igual y clamav-rest lo escanea
// por bytes, no por extension.
// Uso: node tests/eicar/generate-test-media.js
// NO inicia contenedores: solo escribe archivos en tests/eicar/.
const fs = require('fs');
const path = require('path');

const outDir = __dirname;

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const eicarBytes = Buffer.from(EICAR, 'ascii');

// Caso malicioso confiable, dos nombres para poder probar tanto la rama "imagen" como
// la rama "video" del bot (Ruteo por tipo de media clasifica por mime_type/tipo, no por
// contenido real -- la validacion de firma real corre en 'Validar firma media', que en
// modo observacion (tasks.md 0.3 / 1.8) NO bloquea, asi que este archivo SI debe llegar
// a 'Escaneo ClamAV media' y ser rechazado ahi).
fs.writeFileSync(path.join(outDir, 'eicar-test-media.jpg'), eicarBytes);
fs.writeFileSync(path.join(outDir, 'eicar-test-media.mp4'), eicarBytes);

for (const f of ['eicar-test-media.jpg', 'eicar-test-media.mp4']) {
  const b = fs.readFileSync(path.join(outDir, f));
  console.log(`${f}: ${b.length} bytes`);
}
