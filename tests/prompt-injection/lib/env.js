// Parser minimo de .env, ejecutado en runtime por run-campaign.js (nunca por el agente/herramienta
// de lectura directamente: ese camino esta bloqueado por permisos del proyecto a proposito).
// No depende de la libreria `dotenv` (no esta instalada en el repo) para no requerir `npm install`.
'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Lee un archivo .env simple (KEY=VALUE por linea, comentarios con #, comillas opcionales)
 * y devuelve un objeto plano. No lanza si el archivo no existe: devuelve {}.
 */
function parseEnvFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return {};
  }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Carga GOOGLE_API_KEY desde el .env en la raiz del repo (dos niveles arriba de tests/prompt-injection),
 * con fallback a process.env.GOOGLE_API_KEY si ya esta exportada en el shell.
 */
function loadGoogleApiKey(repoRoot) {
  const envPath = path.join(repoRoot, '.env');
  const parsed = parseEnvFile(envPath);
  const key = parsed.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY;
  return key || null;
}

module.exports = { parseEnvFile, loadGoogleApiKey };
