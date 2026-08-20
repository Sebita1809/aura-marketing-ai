// Verificación offline del cambio link-code-reproducible.
// Uso: node tests/link-code/verify-link-flow.js
// NO requiere stack n8n ni contenedores:
//   (a) audita estáticamente codigo.json — 232 nodos (actualizado 2026-08-18, creció por cambios
//       no relacionados a este change); `IF - Vinculacion Telegram` tiene
//       arista de entrada desde `Code in JavaScript7` y ambos outputs (`HTTP - Validar codigo`
//       / `HTTP - Chequear vinculacion`); existen los 4 nodos nuevos con tipo, parámetros,
//       credencial y política de retry esperados; la rama de validación termina (0 aristas
//       salientes de los 2 nodos Telegram).
//   (b) audita la migración 20260814000001_telegram_link_codes_reproducible.sql — existe y
//       contiene la tabla idempotente, el índice, RLS, el RPC `link_telegram_with_code`
//       y el GRANT EXECUTE para authenticated.
//   (c) no regresión: 0 secretos literales (eyJ / Bearer / apikey), cadena ClamAV intacta,
//       retries por política intactos, credenciales intactas, nodos Redis TTL intactos,
//       `HTTP Request1` conserva sin retry (D5 de error-handling).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CODIGO = path.join(ROOT, 'codigo.json');
const MIGRATION = path.join(ROOT, 'aura-frontend', 'supabase', 'migrations', '20260814000001_telegram_link_codes_reproducible.sql');

// Cadena ClamAV (pdf-virus-scan)
const CLAMAV_CHAIN = ['IF - L\u00edmite de tama\u00f1o PDF', 'Escaneo ClamAV', 'IF - PDF limpio', 'PDF muy grande', 'PDF rechazado'];

// Nodos del flujo de vinculación previo que NO se deben regresionar
const YA_VINCULADO_OUTS = ['Redis27', 'Code - Generar c\u00f3digo'];

let fallas = 0;
function check(cond, msg) {
  if (cond) {
    console.log('OK   -', msg);
  } else {
    fallas++;
    console.log('FAIL -', msg);
  }
}

// ---------- (a) Auditoría de codigo.json ----------
console.log('--- (a) Auditoría de codigo.json ---');

let w;
try {
  w = JSON.parse(fs.readFileSync(CODIGO, 'utf8'));
  check(true, 'codigo.json parsea como JSON');
} catch (e) {
  check(false, 'codigo.json parsea como JSON: ' + e.message);
  process.exit(1);
}

const byName = new Map(w.nodes.map((n) => [n.name, n]));
const outEdges = (name, outIndex) => {
  const c = w.connections[name];
  if (!c || !c.main) return [];
  const arr = c.main[outIndex];
  if (!arr) return [];
  return arr.map((e) => e.node);
};

// 1) Recuento actualizado 2026-08-18: 232 nodos (creció por cambios no relacionados a este change).
check(w.nodes.length === 232, `recuento de nodos = ${w.nodes.length} (esperado 232)`);

// 2) IF - Vinculacion Telegram: existe, tipo IF, arista de entrada desde Code in JavaScript7
//    y ambos outputs (TRUE = /start, FALSE = normal).
const ifVinculacion = byName.get('IF - Vinculacion Telegram');
check(!!ifVinculacion, 'existe el nodo "IF - Vinculacion Telegram"');
check(!!ifVinculacion && ifVinculacion.type === 'n8n-nodes-base.if' && ifVinculacion.typeVersion === 2.3,
  'IF - Vinculacion Telegram es n8n-nodes-base.if v2.3');

const entradaVinculacion = Object.entries(w.connections || {}).filter(([src, outs]) =>
  (outs.main || []).some((arr) => (arr || []).some((e) => e.node === 'IF - Vinculacion Telegram'))).map(([src]) => src);
check(entradaVinculacion.length === 1 && entradaVinculacion[0] === 'Code in JavaScript7',
  `IF - Vinculacion Telegram recibe entrada desde Code in JavaScript7 (${entradaVinculacion.join(', ') || 'ninguna'})`);

const out0Vinculacion = outEdges('IF - Vinculacion Telegram', 0);
const out1Vinculacion = outEdges('IF - Vinculacion Telegram', 1);
check(out0Vinculacion.length === 1 && out0Vinculacion[0] === 'HTTP - Validar codigo',
  'IF - Vinculacion Telegram main[0] (TRUE = /start) → HTTP - Validar codigo');
check(out1Vinculacion.length === 1 && out1Vinculacion[0] === 'HTTP - Chequear vinculacion',
  'IF - Vinculacion Telegram main[1] (FALSE = normal) → HTTP - Chequear vinculacion');

// 3) HTTP - Validar codigo: GET Supabase, credencial httpHeaderAuth "Supabase Service Role",
//    retry 3×1000 a nivel de nodo.
const hValidar = byName.get('HTTP - Validar codigo');
check(!!hValidar, 'existe el nodo "HTTP - Validar codigo"');
if (hValidar) {
  check(hValidar.type === 'n8n-nodes-base.httpRequest' && hValidar.typeVersion === 4.4,
    'HTTP - Validar codigo es n8n-nodes-base.httpRequest v4.4');
  check(!hValidar.parameters.method || hValidar.parameters.method === 'GET',
    'HTTP - Validar codigo es GET');
  check(typeof hValidar.parameters.url === 'string' &&
    hValidar.parameters.url.includes('/rest/v1/telegram_link_codes?') &&
    hValidar.parameters.url.includes('code=eq.{{ $(\'Telegram Trigger\').first().json.message.text.split(\' \')[1] }}') &&
    hValidar.parameters.url.includes('used_at=is.null') &&
    hValidar.parameters.url.includes('expires_at=gt.{{ $now.toISO() }}'),
    'HTTP - Validar codigo consulta telegram_link_codes con code=eq.<código> & used_at=is.null & expires_at=gt.<now>');
  check(hValidar.parameters.authentication === 'genericCredentialType' &&
    hValidar.parameters.genericAuthType === 'httpHeaderAuth' && hValidar.parameters.sendHeaders !== true,
    'HTTP - Validar codigo usa authentication=genericCredentialType + httpHeaderAuth + sendHeaders no-true (n8n omite el default false al exportar)');
  check(hValidar.credentials && hValidar.credentials.httpHeaderAuth &&
    hValidar.credentials.httpHeaderAuth.name === 'Supabase Service Role',
    'HTTP - Validar codigo referencia la credencial httpHeaderAuth "Supabase Service Role"');
  const enParams = hValidar.parameters && ('retryOnFail' in hValidar.parameters || 'maxTries' in hValidar.parameters || 'waitBetweenTries' in hValidar.parameters);
  check(hValidar.retryOnFail === true && hValidar.maxTries === 3 && hValidar.waitBetweenTries === 1000 && !enParams,
    'HTTP - Validar codigo lleva retry 3×1000 a nivel de nodo');
}

// 4) IF - Codigo valido: condición ={{ !!$json.id }}, sin retry.
//    (Fix post-verificación funcional: el nodo HTTP de n8n separa cada elemento de un array JSON
//    de respuesta en un ítem individual, así que con un match $json es { id: "..." } — no un array —
//    y `.length` da undefined. La condición real tiene que chequear la presencia de `id`.)
const ifValido = byName.get('IF - Codigo valido');
check(!!ifValido, 'existe el nodo "IF - Codigo valido"');
if (ifValido) {
  check(ifValido.type === 'n8n-nodes-base.if' && ifValido.typeVersion === 2.3,
    'IF - Codigo valido es n8n-nodes-base.if v2.3');
  const cond = ifValido.parameters && ifValido.parameters.conditions;
  const left = cond && cond.conditions && cond.conditions[0] && cond.conditions[0].leftValue;
  const op = cond && cond.conditions && cond.conditions[0] && cond.conditions[0].operator;
  check(left === '={{ !!$json.id }}' && op && op.type === 'boolean' && op.operation === 'true',
    'IF - Codigo valido evalúa ={{ !!$json.id }} con operator boolean "true"');
  check(!(ifValido.retryOnFail || ifValido.maxTries || ifValido.waitBetweenTries), 'IF - Codigo valido no lleva retry');
}

// 5) Telegram - Codigo valido: sendMessage, credencial telegramApi "Telegram account", sin retry.
const telValido = byName.get('Telegram - Codigo valido');
check(!!telValido, 'existe el nodo "Telegram - Codigo valido"');
if (telValido) {
  check(telValido.type === 'n8n-nodes-base.telegram' && telValido.typeVersion === 1.2,
    'Telegram - Codigo valido es n8n-nodes-base.telegram v1.2');
  check(telValido.parameters.chatId === "={{ $('Code in JavaScript7').item.json.id_chat }}",
    'Telegram - Codigo valido envía al id_chat de Code in JavaScript7');
  check(telValido.parameters.text === '=✅ Código válido. Completá la vinculación desde la web.',
    'Telegram - Codigo valido envía el mensaje de código válido');
  check(telValido.credentials && telValido.credentials.telegramApi &&
    telValido.credentials.telegramApi.name === 'Telegram account',
    'Telegram - Codigo valido usa la credencial telegramApi "Telegram account"');
  check(!(telValido.retryOnFail || telValido.maxTries || telValido.waitBetweenTries), 'Telegram - Codigo valido no lleva retry');
}

// 6) Telegram - Codigo invalido: igual con el mensaje de código inválido, sin retry.
const telInvalido = byName.get('Telegram - Codigo invalido');
check(!!telInvalido, 'existe el nodo "Telegram - Codigo invalido"');
if (telInvalido) {
  check(telInvalido.type === 'n8n-nodes-base.telegram' && telInvalido.typeVersion === 1.2,
    'Telegram - Codigo invalido es n8n-nodes-base.telegram v1.2');
  check(telInvalido.parameters.chatId === "={{ $('Code in JavaScript7').item.json.id_chat }}",
    'Telegram - Codigo invalido envía al id_chat de Code in JavaScript7');
  check(telInvalido.parameters.text === '=❌ Código inválido o expirado.',
    'Telegram - Codigo invalido envía el mensaje de código inválido');
  check(telInvalido.credentials && telInvalido.credentials.telegramApi &&
    telInvalido.credentials.telegramApi.name === 'Telegram account',
    'Telegram - Codigo invalido usa la credencial telegramApi "Telegram account"');
  check(!(telInvalido.retryOnFail || telInvalido.maxTries || telInvalido.waitBetweenTries), 'Telegram - Codigo invalido no lleva retry');
}

// 7) Wiring de la rama: HTTP - Validar codigo → IF - Codigo valido → (TRUE/FALSE) los 2 Telegram.
check(outEdges('HTTP - Validar codigo', 0).join(',') === 'IF - Codigo valido',
  'HTTP - Validar codigo main[0] → IF - Codigo valido');
check(outEdges('IF - Codigo valido', 0).join(',') === 'Telegram - Codigo valido',
  'IF - Codigo valido main[0] (TRUE = válido) → Telegram - Codigo valido');
check(outEdges('IF - Codigo valido', 1).join(',') === 'Telegram - Codigo invalido',
  'IF - Codigo valido main[1] (FALSE = inválido) → Telegram - Codigo invalido');

// 8) La rama TERMINA: 0 aristas salientes de los 2 nodos Telegram de validación, y no alimentan
//    la generación de código ni HTTP Request1.
check(w.connections['Telegram - Codigo valido'] === undefined,
  'Telegram - Codigo valido no tiene aristas salientes (rama termina)');
check(w.connections['Telegram - Codigo invalido'] === undefined,
  'Telegram - Codigo invalido no tiene aristas salientes (rama termina)');
const targetsRama = [...outEdges('HTTP - Validar codigo', 0), ...outEdges('IF - Codigo valido', 0), ...outEdges('IF - Codigo valido', 1)];
check(!targetsRama.includes('Code - Generar c\u00f3digo') && !targetsRama.includes('HTTP Request1'),
  'la rama de validación no alimenta Code - Generar código ni HTTP Request1');

// 9) HTTP - Chequear vinculacion no cambia sus parámetros (URL sigue referenciando Code in JavaScript7)
//    y HTTP Request1 conserva sin retry.
// URL actualizada 2026-08-18: se agregó el filtro &status=eq.active (endurecimiento no
// relacionado a este change, solo matchear perfiles activos) — sigue referenciando
// Code in JavaScript7, que es lo que este check audita.
const hChequear = byName.get('HTTP - Chequear vinculacion');
check(!!hChequear && hChequear.parameters.url === "=https://legffrhakunfignlaftl.supabase.co/rest/v1/profiles?telegram_chat_id=eq.{{ $('Code in JavaScript7').item.json.id_chat }}&status=eq.active&select=id",
  'HTTP - Chequear vinculacion conserva su URL (referencia a Code in JavaScript7)');
check(outEdges('HTTP - Chequear vinculacion', 0).join(',') === 'Code in JavaScript9',
  'HTTP - Chequear vinculacion sigue alimentando Code in JavaScript9 (flujo normal intacto)');
const hInsert = byName.get('HTTP Request1');
check(!!hInsert && !(hInsert.retryOnFail || hInsert.maxTries || hInsert.waitBetweenTries),
  'HTTP Request1 conserva sin retry (D5 de error-handling)');

// 10) IF - Ya vinculado conserva sus outputs (linked → Redis27, else → Code - Generar código).
check(outEdges('IF - Ya vinculado', 0).join(',') === 'Redis27' && outEdges('IF - Ya vinculado', 1).join(',') === 'Code - Generar c\u00f3digo',
  'IF - Ya vinculado conserva outputs (Redis27 / Code - Generar código)');

// ---------- (b) Auditoría de la migración ----------
console.log('\n--- (b) Auditoría de la migración ---');

check(fs.existsSync(MIGRATION), `existe ${path.relative(ROOT, MIGRATION)}`);
if (fs.existsSync(MIGRATION)) {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  check(/CREATE TABLE IF NOT EXISTS public\.telegram_link_codes/.test(sql),
    'la migración contiene CREATE TABLE IF NOT EXISTS public.telegram_link_codes');
  check(/char_length\(code\)\s*=\s*6/.test(sql),
    'la migración contiene el CHECK de exactamente 6 caracteres sobre code');
  check(/CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_expires\s+ON public\.telegram_link_codes\s+\(expires_at\)/.test(sql),
    'la migración contiene el índice idx_telegram_link_codes_expires sobre expires_at');
  check(/ALTER TABLE public\.telegram_link_codes ENABLE ROW LEVEL SECURITY/.test(sql),
    'la migración habilita ROW LEVEL SECURITY sin políticas');
  check(/CREATE OR REPLACE FUNCTION public\.link_telegram_with_code\(p_code text\)/.test(sql),
    'la migración contiene CREATE OR REPLACE FUNCTION public.link_telegram_with_code(p_code text)');
  check(/SECURITY DEFINER/.test(sql) && /SET search_path = public/.test(sql),
    'el RPC es SECURITY DEFINER con search_path = public');
  check(/code = p_code\s+AND used_at IS NULL\s+AND expires_at > now\(\)/.test(sql),
    'el RPC busca code = p_code AND used_at IS NULL AND expires_at > now()');
  check(/UPDATE public\.profiles\s+SET telegram_chat_id = found_chat\s+WHERE id = auth\.uid\(\)/.test(sql),
    'el RPC vincula profiles.telegram_chat_id al chat_id del código para auth.uid()');
  check(/UPDATE public\.telegram_link_codes\s+SET used_at = now\(\)/.test(sql),
    'el RPC marca el código como usado (used_at = now())');
  check(/GRANT EXECUTE ON FUNCTION public\.link_telegram_with_code\(text\) TO authenticated/.test(sql),
    'la migración contiene GRANT EXECUTE ... TO authenticated');
  check(!/telegram_link_tokens/.test(sql.replace(/--.*$/gm, '')),
    'la migración no toca telegram_link_tokens (solo documentación)');
}

// ---------- (c) No regresión ----------
console.log('\n--- (c) No regresión ---');

const raw = fs.readFileSync(CODIGO, 'utf8');
const noSecrets = !raw.includes('eyJ') && !raw.includes('Bearer ') && !raw.includes('apikey');
check(noSecrets, 'sin secretos literales en codigo.json (eyJ=0, Bearer =0, apikey=0)');
check((raw.match(/supabase\.co/g) || []).length === 13,
  'supabase.co aparece 13 veces (10 previas + 3 por los emisores usage_events)');

const names = new Set(w.nodes.map((n) => n.name));
for (const name of CLAMAV_CHAIN) {
  check(names.has(name), `cadena ClamAV conserva nodo «${name}»`);
}

// Retry por política: HTTP - Chequear vinculacion sigue en la lista W1000; sin claves en parameters.
const hChequearRetry = byName.get('HTTP - Chequear vinculacion');
check(!!hChequearRetry && hChequearRetry.retryOnFail === true && hChequearRetry.maxTries === 3 && hChequearRetry.waitBetweenTries === 1000,
  'HTTP - Chequear vinculacion conserva retry 3×1000 (política de lecturas)');
let enParams = 0;
for (const n of w.nodes) {
  if (n.parameters && ('retryOnFail' in n.parameters || 'maxTries' in n.parameters || 'waitBetweenTries' in n.parameters)) enParams++;
}
check(enParams === 0, `0 nodos con claves de retry dentro de parameters (formato real de n8n: nivel de nodo; ${enParams})`);

// Credenciales intactas.
const telLegacy = byName.get('Telegram - Token invalido1');
check(!!telLegacy && telLegacy.credentials && telLegacy.credentials.telegramApi &&
  telLegacy.credentials.telegramApi.name === 'Telegram account',
  'Telegram - Token invalido1 conserva la credencial telegramApi "Telegram account"');

// Redis TTL intacto (subset de redis-expiration): Redis13 expire+ttl y el nodo expire de fotos_.
const r13 = byName.get('Redis13');
check(!!r13 && r13.parameters.expire === true && r13.parameters.ttl === 86400,
  'Redis13 conserva expire:true + ttl 86400 (redis-expiration)');
check(names.has('Redis - Expirar fotos'), 'nodo "Redis - Expirar fotos" conservado (redis-expiration)');

// Coherencia global: toda arista apunta a un nodo existente.
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

if (fallas > 0) {
  console.log(`\n${fallas} verificacion(es) fallida(s)`);
  process.exit(1);
}
console.log('\nTodas las verificaciones pasaron.');
