// Verificación offline del cambio error-handling.
// Uso: node tests/error-handling/verify-retries.js
// NO requiere stack n8n ni contenedores:
//   (a) audita estáticamente codigo.json — todo nodo reintentado tiene retryOnFail:true + maxTries:3
//       + waitBetweenTries (3000 en los nodos Gemini/modelo, 1000 en el resto), todo nodo excluido
//       NO los tiene, «Escaneo ClamAV» conserva parameters.onError, los 3 nodos alwaysOutputData los
//       conservan, y los nodos Redis de escritura conservan expire/ttl (redis-expiration).
//   (b) integridad: el JSON parsea, recuento = 232 nodos, bloque connections coherente, sin secretos
//       (eyJ / Bearer / apikey = 0), sin referencias stale de bug-fixes (Redis1/10/21, Math.random).
//   (c) Capa 2: error-workflow.json parsea y contiene errorTrigger + Code + Telegram sendMessage
//       con la credencial «Telegram account».
//
// DESVIACIÓN vs design.md (D1): el design indica agregar las claves a `parameters`, pero el formato
// real de export de n8n las persiste a NIVEL DE NODO (hermanas de `parameters`, igual que
// `alwaysOutputData` en este mismo export). Se aplican a nivel de nodo y el test las audita allí.
//
// Conteos actualizados 2026-08-18: el flujo creció de 120 a 232 nodos por cambios no relacionados
// a este change (usage_events, fan-out pdf, link-code-reproducible, media_existente, rate-limiting,
// plataformas/programación). Se re-derivaron todas las listas hardcodeadas desde codigo.json real:
// - 2 nodos Gemini nuevos (`Moderar video Gemini`, `Moderar imagen Gemini`) siguen la convención
//   waitBetweenTries:3000 de los nodos de modelo.
// - `Get a file1` ya no existe (removido en algún punto); se sacó de NOMBRES_DESCARGA.
// - 2 nodos Telegram de descarga nuevos (`Telegram - Get a file media existente`,
//   `Telegram Get a file media existente publicacion`) siguen la convención de descarga (W1000).
// - 3 nodos Redis de lectura/borrado (`Redis - Get imagen limpia`, `Redis - Borrar descripcion`,
//   `Redis - Borrar media existente`) ahora SÍ llevan retryOnFail (operaciones idempotentes get/delete,
//   consistente con el mismo criterio que ya se aplicaba a otras lecturas HTTP) — se documentan
//   aparte como excepción confirmada, no como violación del invariante original.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CODIGO = path.join(ROOT, 'codigo.json');
const ERROR_WF = path.join(ROOT, 'error-workflow.json');

// Nodos reintentados con waitBetweenTries 3000 (Gemini / modelo): decisión de usuario.
const W3000 = [
  'Analyze document',
  'Analyze an image',
  'Generate an image',
  'Edit an image',
  'Google Gemini Chat Model1',
  'AI Agent1',
  'Moderar video Gemini',
  'Moderar imagen Gemini',
];

// Nodos reintentados con waitBetweenTries 1000.
const W1000 = [
  // Lecturas Supabase (GET idempotentes)
  'HTTP - Leer producto informacion',
  'HTTP - Leer producto imagen',
  'HTTP - Chequear vinculacion',
  'HTTP - Perfil publicacion',
  'HTTP - Cuenta Instagram publicacion',
  'HTTP - Validar codigo', // link-code-reproducible: GET de validación /start (lectura idempotente)
  // Upserts idempotentes Supabase (POST on_conflict=user_id + Prefer merge-duplicates)
  'HTTP - Upsert producto informacion',
  'HTTP - Upsert producto pdf',
  'HTTP - Upsert producto imagen',
  // Subida Postiz (asset huérfano no visible; riesgo aceptado design D2)
  'HTTP - Subir imagen Postiz',
  'HTTP - Subir media existente Postiz',
  // Llamadas HTTP crudas a la API de Telegram (type httpRequest, no n8n-nodes-base.telegram)
  'Telegram - Elegir plataformas',
  'Edit - Teclado plataformas',
  // Descargas de archivos Telegram (resource: file)
  'Get a file',
  'Get a file2',
  'Telegram Get a file publicacion',
  'Telegram - Get a file media existente',
  'Telegram Get a file media existente publicacion',
  // 33 nodos Redis de escritura (31 set + 1 push + 1 expire)
  'Redis36', 'Redis35', 'Redis33', 'Redis32', 'Redis5', 'Redis4', 'Redis26',
  'Redis25', 'Redis20', 'Redis23', 'Redis22', 'Redis19', 'Redis18', 'Redis12',
  'Redis11', 'Redis9', 'Redis6', 'Redis3', 'Redis13',
  'Redis - Estado descripcion', 'Redis - Guardar descripcion', 'Redis28',
  'Redis - Expirar fotos', 'Redis - Guardar imagen limpia', 'Redis - Estado programacion',
  'Redis - Estado fecha personalizada', 'Redis - Guardar programacion',
  'Redis - Guardar integraciones', 'Redis - Init seleccion', 'Redis - Estado plataformas',
  'Redis - Guardar seleccion', 'Redis - Estado publicidad existente', 'Redis - Guardar media existente',
  // 3 nodos Redis de lectura/borrado que también llevan retry (idempotentes: get/delete)
  'Redis - Get imagen limpia', 'Redis - Borrar descripcion', 'Redis - Borrar media existente',
];

// Nodos excluidos deliberadamente (D3 / D5): NO llevan retry.
const EXCLUIDOS = [
  'Telegram Trigger',
  'Wait',
  'Escaneo ClamAV',
  'HTTP - Crear post Postiz',
  'HTTP Request1', // D5 decisión de usuario: sin retry (insert no idempotente)
  'Get row(s) in sheet in Google Sheets', // tool read-only del agente: cubierto por el retry del agente
];

const NOMBRES_DESCARGA = [
  'Get a file', 'Get a file2', 'Telegram Get a file publicacion',
  'Telegram - Get a file media existente', 'Telegram Get a file media existente publicacion',
];

// ClamAV chain (pdf-virus-scan)
const CLAMAV_CHAIN = ['IF - L\u00edmite de tama\u00f1o PDF', 'Escaneo ClamAV', 'IF - PDF limpio', 'PDF muy grande', 'PDF rechazado'];

const ALWAYS_OUTPUT_DATA = ['HTTP - Leer producto informacion', 'HTTP - Leer producto imagen', 'HTTP - Chequear vinculacion'];

let fallas = 0;
function check(cond, msg) {
  if (cond) {
    console.log('OK   -', msg);
  } else {
    fallas++;
    console.log('FAIL -', msg);
  }
}

let w;
try {
  w = JSON.parse(fs.readFileSync(CODIGO, 'utf8'));
  check(true, 'codigo.json parsea como JSON');
} catch (e) {
  check(false, 'codigo.json parsea como JSON: ' + e.message);
  process.exit(1);
}

const byName = new Map(w.nodes.map((n) => [n.name, n]));

// ---------- (a) Auditoría de retries ----------
console.log('--- (a) Auditoría de retries en codigo.json ---');

const RETIRADOS = [...W3000, ...W1000];

// 0) Ningún nodo del listado puede faltar (verificación de nombres contra el audit del design).
let faltantes = RETIRADOS.filter((n) => !byName.has(n));
check(faltantes.length === 0, `todos los nodos reintentados existen en codigo.json (${RETIRADOS.length})`);

// 1) Todo reintentado tiene las 3 claves a NIVEL DE NODO con los valores correctos.
let malos = 0;
for (const name of RETIRADOS) {
  const n = byName.get(name);
  if (!n) continue;
  const esperado = W3000.includes(name) ? 3000 : 1000;
  const enParams = n.parameters && 'retryOnFail' in n.parameters;
  const okNivelNodo = n.retryOnFail === true && n.maxTries === 3 && n.waitBetweenTries === esperado;
  if (enParams) malos++;
  if (!okNivelNodo) malos++;
  check(okNivelNodo && !enParams, `nodo ${name} tiene retryOnFail:true, maxTries:3, waitBetweenTries:${esperado} a nivel de nodo`);
}
check(malos === 0, `0 nodos reintentados sin la política esperada (${malos})`);

// 2) Los 6 nodos modelo/Gemini usan 3000; el resto 1000.
check(
  W3000.every((name) => byName.has(name) && byName.get(name).waitBetweenTries === 3000),
  `los ${W3000.length} nodos Gemini/modelo llevan waitBetweenTries:3000 (${W3000.join(', ')})`,
);

// 3) Exclusiones: ningún nodo excluido tiene claves de retry.
let excluidosConRetry = 0;
for (const name of EXCLUIDOS) {
  const n = byName.get(name);
  if (!n) { check(false, `no existe nodo excluido ${name}`); continue; }
  const tiene = n.retryOnFail || n.maxTries || n.waitBetweenTries ||
    (n.parameters && ('retryOnFail' in n.parameters || 'maxTries' in n.parameters || 'waitBetweenTries' in n.parameters));
  if (tiene) excluidosConRetry++;
  check(!tiene, `excluido ${name} NO tiene claves de retry`);
}
check(excluidosConRetry === 0, `0 nodos excluidos con retry (${excluidosConRetry})`);

// 4) Los nodos Telegram SEND/edit (todos los n8n-nodes-base.telegram salvo las 5 descargas) sin retry.
const telSends = w.nodes.filter((n) => n.type === 'n8n-nodes-base.telegram' && !NOMBRES_DESCARGA.includes(n.name));
check(telSends.length === 47, `hay ${telSends.length} nodos Telegram SEND/edit excluidos (esperado 47)`);
let telConRetry = telSends.filter((n) => n.retryOnFail || n.maxTries || n.waitBetweenTries);
check(telConRetry.length === 0, 'ningún nodo Telegram SEND/edit lleva retry');

// 5) No hay NINGÚN nodo con retry fuera de la lista retirada (el conjunto de retryOnFail == RETIRADOS).
const conRetry = new Set(w.nodes.filter((n) => n.retryOnFail === true).map((n) => n.name));
const fueraDeLista = [...conRetry].filter((n) => !RETIRADOS.includes(n));
check(fueraDeLista.length === 0, `el conjunto de nodos con retryOnFail coincide exactamente con la lista (${conRetry.size}/${RETIRADOS.length})`);
check(RETIRADOS.every((n) => conRetry.has(n)), `todos los ${RETIRADOS.length} nodos de la lista llevan retryOnFail:true`);

// 6) «Escaneo ClamAV» conserva onError = continueErrorOutput (sin retry).
//    (n8n serializa onError como propiedad de nivel superior del nodo, no dentro de parameters.)
const clam = byName.get('Escaneo ClamAV');
check(clam && clam.onError === 'continueErrorOutput',
  '«Escaneo ClamAV» conserva onError = continueErrorOutput');
check(clam && clam.parameters && clam.parameters.options && clam.parameters.options.timeout === 60000,
  '«Escaneo ClamAV» conserva timeout 60000');

// 7) Los 3 nodos alwaysOutputData:true los conservan; Redis3 conserva su alwaysOutputData:false.
for (const name of ALWAYS_OUTPUT_DATA) {
  const n = byName.get(name);
  check(n && n.alwaysOutputData === true, `${name} conserva alwaysOutputData:true`);
}
check(byName.get('Redis3').alwaysOutputData === false, 'Redis3 conserva alwaysOutputData:false');

// 8) Los 33 nodos Redis de escritura conservan operación y expiración (redis-expiration).
const redisWrite = w.nodes.filter((n) => n.type.match(/redis/) && ['set', 'push', 'expire'].includes(n.parameters.operation));
check(redisWrite.length === 33, `hay ${redisWrite.length} nodos Redis de escritura (esperado 33)`);
let redisMalo = 0;
for (const n of redisWrite) {
  if (n.parameters.operation === 'set' && !(n.parameters.expire === true && n.parameters.ttl === 86400)) redisMalo++;
  if (n.parameters.operation === 'expire' && n.parameters.seconds !== 86400) redisMalo++;
  if (n.parameters.operation === 'push' && (n.parameters.expire || n.parameters.ttl)) redisMalo++;
  if (!n.credentials || !n.credentials.redis) redisMalo++;
}
check(redisMalo === 0, 'los 33 nodos Redis de escritura conservan operación, expire/ttl y credencial redis');

// 9) Los nodos Redis de lectura/pop/llen/delete NO tienen expire/ttl, salvo los 5 `incr` de
//    rate-limiting (rate-limiting change, fuera del scope de redis-expiration): esos SÍ llevan
//    expire:true + un ttl dinámico propio (expresión, no la constante 86400 de las familias de
//    chat) porque son contadores de cuota con su propia ventana de expiración.
const CON_RETRY_AUNQUE_LECTURA = ['Redis - Get imagen limpia', 'Redis - Borrar descripcion', 'Redis - Borrar media existente'];
const CON_TTL_DINAMICO_RATE_LIMIT = [
  'Redis - RL incr msg corta', 'Redis - RL incr msg larga',
  'Redis - RL incr file corta', 'Redis - RL incr file larga', 'Redis - RL incr notified',
];
const redisRead = w.nodes.filter((n) => n.type.match(/redis/) && !['set', 'push', 'expire'].includes(n.parameters.operation));
check(redisRead.length === 21, `hay ${redisRead.length} nodos Redis de lectura (esperado 21)`);
let redisReadMalo = redisRead.filter((n) => !CON_TTL_DINAMICO_RATE_LIMIT.includes(n.name) && (n.parameters.expire || n.parameters.ttl)).length;
check(redisReadMalo === 0, 'ningún nodo Redis de lectura lleva expire/ttl (salvo los 5 `incr` de rate-limiting, con ttl dinámico propio)');
let redisReadRetryMalo = redisRead.filter((n) => !!n.retryOnFail !== CON_RETRY_AUNQUE_LECTURA.includes(n.name)).length;
check(redisReadRetryMalo === 0,
  `los nodos Redis de lectura llevan retry si y solo si están en la excepción confirmada (${CON_RETRY_AUNQUE_LECTURA.join(', ')})`);

// 10) Los 16 nodos migrados a credenciales conservan authentication/genericAuthType y su credencial
//     (10 Supabase + 2 Postiz del secrets-migration menos el nodo `HTTP Request` eliminado en bug-fixes
//     + 1 `HTTP - Validar codigo` de link-code-reproducible + 3 emisores usage_events
//     + 1 `HTTP - Subir media existente Postiz`).
const migrados = w.nodes.filter((n) => n.parameters && n.parameters.genericAuthType === 'httpHeaderAuth');
check(migrados.length === 16, `hay ${migrados.length} nodos HTTP con genericAuthType httpHeaderAuth (esperado 16)`);
let migradosMalo = 0;
for (const n of migrados) {
  if (n.parameters.authentication !== 'genericCredentialType') migradosMalo++;
  if (!n.credentials || !n.credentials.httpHeaderAuth || !n.credentials.httpHeaderAuth.name) migradosMalo++;
}
check(migradosMalo === 0, 'los 16 nodos migrados conservan authentication=genericCredentialType + credencial httpHeaderAuth');

// ---------- (b) Integridad ----------
console.log('\n--- (b) Integridad de codigo.json ---');

check(w.nodes.length === 232, `recuento de nodos = ${w.nodes.length} (esperado 232)`);

const names = new Set(w.nodes.map((n) => n.name));
let aristasMalas = 0;
for (const [from, outs] of Object.entries(w.connections || {})) {
  if (!names.has(from)) aristasMalas++;
  for (const type of Object.keys(outs)) {
    for (const entry of outs[type]) {
      for (const e of entry) {
        const tgt = Array.isArray(e.node) ? e.node[0] : e.node;
        if (!names.has(tgt)) aristasMalas++;
      }
    }
  }
}
check(aristasMalas === 0, 'bloque connections coherente (0 aristas apuntando a nodos inexistentes)');

const raw = fs.readFileSync(CODIGO, 'utf8');
const noSecrets =
  !raw.includes('eyJ') && !raw.includes('Bearer ') && !raw.includes('apikey');
check(noSecrets, 'sin secretos literales en codigo.json (eyJ=0, Bearer =0, apikey=0)');
check((raw.match(/supabase\.co/g) || []).length === 13,
  'supabase.co aparece 13 veces (10 previas + 3 por los emisores usage_events)');
check(!raw.includes('Redis1"') && !raw.includes('Redis10"') && !raw.includes('Redis21"') && !raw.includes('Math.random'),
  'sin referencias stale de bug-fixes (Redis1/Redis10/Redis21, Math.random)');
check(JSON.stringify(w.pinData) === '{}', 'pinData vacío');

// Retry a nivel de nodo, NO dentro de parameters (desviación vs design.md D1 documentada arriba).
let enParams = 0;
for (const n of w.nodes) {
  if (n.parameters && ('retryOnFail' in n.parameters || 'maxTries' in n.parameters || 'waitBetweenTries' in n.parameters)) enParams++;
}
check(enParams === 0, `0 nodos con claves de retry dentro de parameters (formato real de n8n: nivel de nodo; ${enParams})`);

// ClamAV chain presente (pdf-virus-scan)
for (const name of CLAMAV_CHAIN) {
  check(names.has(name), `cadena ClamAV conserva nodo «${name}»`);
}

// ---------- (c) Capa 2: error-workflow.json ----------
console.log('\n--- (c) Capa 2: error-workflow.json ---');

let ew;
try {
  ew = JSON.parse(fs.readFileSync(ERROR_WF, 'utf8'));
  check(true, 'error-workflow.json parsea como JSON');
} catch (e) {
  check(false, 'error-workflow.json parsea como JSON: ' + e.message);
}

if (ew) {
  const tipos = {};
  for (const n of ew.nodes || []) tipos[n.type] = (tipos[n.type] || 0) + 1;
  check((ew.nodes || []).length === 3, `error-workflow.json tiene ${(ew.nodes || []).length} nodos (esperado 3)`);
  check(tipos['n8n-nodes-base.errorTrigger'] === 1, 'contiene 1 nodo n8n-nodes-base.errorTrigger');
  check(tipos['n8n-nodes-base.code'] === 1, 'contiene 1 nodo n8n-nodes-base.code');
  check(tipos['n8n-nodes-base.telegram'] === 1, 'contiene 1 nodo n8n-nodes-base.telegram');

  const code = (ew.nodes || []).find((n) => n.type === 'n8n-nodes-base.code');
  check(!!code && /DEFAULT_ADMIN_CHAT_ID/.test(code.parameters.jsCode || ''), 'nodo Code extrae chat_id con fallback DEFAULT_ADMIN_CHAT_ID');
  check(!!code && /id_chat/.test(code.parameters.jsCode || ''), 'nodo Code prueba $json.id_chat primero');
  check(!!code && /node\.data/.test(code.parameters.jsCode || ''), 'nodo Code cubre el caso legacy node.data[0].json.chat.id');
  check(!!code && /\/start/.test(code.parameters.jsCode || ''), 'mensaje al usuario instruye reintentar con /start');
  check(!!code && /executionId/.test(code.parameters.jsCode || ''), 'mensaje al admin incluye executionId');

  const tel = (ew.nodes || []).find((n) => n.type === 'n8n-nodes-base.telegram');
  check(!!tel && tel.credentials && tel.credentials.telegramApi && tel.credentials.telegramApi.name === 'Telegram account',
    'nodo Telegram reutiliza la credencial «Telegram account» (telegramApi)');
  check(!!tel && tel.parameters.chatId === '={{ $json.chatId }}' && tel.parameters.text === '={{ $json.text }}',
    'nodo Telegram consume chatId/text del nodo Code');

  // Conexión: errorTrigger → Code → Telegram
  const conn = ew.connections || {};
  const t = conn['Error Trigger'] || conn['errorTrigger'];
  const afterTrigger = t && t.main && t.main[0] ? t.main[0].map((e) => e.node) : [];
  const afterCode = conn['Extraer chat y preparar aviso'] && conn['Extraer chat y preparar aviso'].main[0]
    ? conn['Extraer chat y preparar aviso'].main[0].map((e) => e.node) : [];
  check(afterTrigger.includes('Extraer chat y preparar aviso'), 'errorTrigger main → nodo Code');
  check(afterCode.includes('Enviar aviso de error'), 'nodo Code main → nodo Telegram sendMessage');
}

if (fallas > 0) {
  console.log(`\n${fallas} verificacion(es) fallida(s)`);
  process.exit(1);
}
console.log('\nTodas las verificaciones pasaron.');
