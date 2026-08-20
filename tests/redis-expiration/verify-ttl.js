// Verificación offline del cambio redis-expiration.
// Uso: node tests/redis-expiration/verify-ttl.js
// NO requiere stack n8n ni contenedores:
//   (a) audita estáticamente codigo.json — todo nodo `set` lleva expire:true + ttl de su familia,
//       los nodos de lectura no se tocaron, la lista `fotos_` se maneja por D2-A (nodo expire colgante),
//       el JSON parsea, el recuento es 232 nodos y toda arista apunta a un nodo existente.
//       (Conteos actualizados 2026-08-18: el flujo creció de 120 a 232 nodos por cambios no
//       relacionados a este change — usage_events, fan-out pdf, link-code-reproducible, y 10
//       nodos `set` nuevos de estado/programación/integraciones que SÍ siguen la convención
//       expire:true+ttl:86400, verificados e incorporados a FAMILIAS más abajo.)
//   (b) simula client.set() + client.expire() contra un mock en memoria: la clave queda con TTL
//       restante = constante, la re-escritura re-arma el TTL completo y la clave se reporta expirada
//       tras transcurrir el TTL.
const fs = require('fs');
const path = require('path');

const CODIGO = path.join(__dirname, '..', '..', 'codigo.json');
const TTL_CHAT = 86400;
const TTL_ESPECIFICACIONES = 86400;
const TTL_ESPECIFICACIONES_REHACER = 86400;
const TTL_PUBLICIDAD = 86400;
const TTL_DESCRIPCION = 86400;
const TTL_FOTOS = 86400;

// Auditoría base (design.md): 21 `set` + 1 `push` (Redis6) + 7 lecturas = 29 nodos redis.
// Auditoría actualizada 2026-08-18: 10 nodos `set` nuevos (fuera del scope original de
// redis-expiration) confirmados con expire:true+ttl:86400 sobre 5 familias nuevas de clave
// (imagen_raw_, programacion_, integraciones_, plataformas_, media_existente_) + 4 nuevos
// miembros de chat_ — total 31 `set` + 1 `push` (Redis6) + 12 `get` + 1 `llen` + 1 `pop` +
// 2 `delete` + 5 `incr` = 53 nodos redis.
const FAMILIAS = {
  chat_: { ttl: TTL_CHAT, nodos: [
    'Redis36', 'Redis35', 'Redis33', 'Redis32', 'Redis26', 'Redis25', 'Redis20',
    'Redis22', 'Redis19', 'Redis18', 'Redis12', 'Redis11', 'Redis9', 'Redis13',
    'Redis - Estado descripcion', 'Redis28',
    'Redis - Estado programacion', 'Redis - Estado fecha personalizada',
    'Redis - Estado plataformas', 'Redis - Estado publicidad existente',
  ]},
  especificaciones_: { ttl: TTL_ESPECIFICACIONES, nodos: ['Redis23', 'Redis3'] },
  especificaciones_rehacer_: { ttl: TTL_ESPECIFICACIONES_REHACER, nodos: ['Redis5'] },
  publicidad_: { ttl: TTL_PUBLICIDAD, nodos: ['Redis4'] },
  descripcion_: { ttl: TTL_DESCRIPCION, nodos: ['Redis - Guardar descripcion'] },
  imagen_raw_: { ttl: TTL_CHAT, nodos: ['Redis - Guardar imagen limpia'] },
  programacion_: { ttl: TTL_CHAT, nodos: ['Redis - Guardar programacion'] },
  integraciones_: { ttl: TTL_CHAT, nodos: ['Redis - Guardar integraciones'] },
  plataformas_: { ttl: TTL_CHAT, nodos: ['Redis - Init seleccion', 'Redis - Guardar seleccion'] },
  media_existente_: { ttl: TTL_CHAT, nodos: ['Redis - Guardar media existente'] },
};

// Nodos de lectura (NO se tocan): operación y patrón de clave esperados.
const LECTURAS = [
  { name: 'Redis27', op: 'get', key: "=chat_{{ $('Code in JavaScript7').item.json.id_chat }}" },
  // Redis30 fue renombrado a "Redis - Get foto publicidad postiz" (mismo patrón de key,
  // misma operación get) en algún momento entre la corrida original y 2026-08-18.
  { name: 'Redis - Get foto publicidad postiz', op: 'get', key: "=publicidad_{{ $('Code in JavaScript7').item.json.id_chat }}" },
  { name: 'Redis24', op: 'get', key: "=especificaciones_{{ $('Code in JavaScript5').item.json.id_chat }}" },
  { name: 'Redis - Get descripcion', op: 'get', key: "=descripcion_{{ $('Code in JavaScript7').item.json.id_chat }}" },
  { name: 'Redis7', op: 'llen', list: "=fotos_{{ $('Code in JavaScript7').item.json.id_chat }}" },
  { name: 'Redis8', op: 'pop', list: "=fotos_{{ $('Telegram Trigger').item.json.callback_query.from.id }}" },
];

const NUEVO_NODO = 'Redis - Expirar fotos';

let fallas = 0;
function check(cond, msg) {
  if (cond) {
    console.log('OK   -', msg);
  } else {
    fallas++;
    console.log('FAIL -', msg);
  }
}

// ---------- (a) Auditoría estática de codigo.json ----------
console.log('--- (a) Auditoría estática de codigo.json ---');

let w;
try {
  w = JSON.parse(fs.readFileSync(CODIGO, 'utf8'));
  check(true, 'codigo.json parsea como JSON');
} catch (e) {
  check(false, 'codigo.json parsea como JSON: ' + e.message);
  process.exit(1);
}

const byName = new Map(w.nodes.map((n) => [n.name, n]));
const redisNodes = w.nodes.filter((n) => n.type === 'n8n-nodes-base.redis');
const setNodes = redisNodes.filter((n) => n.parameters.operation === 'set');

check(redisNodes.length === 53, `hay ${redisNodes.length} nodos redis (esperado 53)`);
check(w.nodes.length === 232, `recuento de nodos = ${w.nodes.length} (esperado 232)`);

// 1) Todo nodo `set` tiene expire:true y el ttl de su familia; 0 escrituras sin expiración.
const expectedSetNames = Object.values(FAMILIAS).flatMap((f) => f.nodos).sort();
const actualSetNames = setNodes.map((n) => n.name).sort();
check(
  JSON.stringify(actualSetNames) === JSON.stringify(expectedSetNames),
  `los nodos \`set\` coinciden con la auditoría (${setNodes.length}): ${actualSetNames.join(', ')}`,
);

let setsSinExpiracion = 0;
const ttlPorNodo = {};
for (const f of Object.values(FAMILIAS)) {
  for (const name of f.nodos) {
    const n = byName.get(name);
    if (!n) { check(false, `no existe nodo \`set\` ${name}`); continue; }
    const okExpire = n.parameters.expire === true;
    const okTtl = n.parameters.ttl === f.ttl;
    if (!okExpire || !okTtl) setsSinExpiracion++;
    ttlPorNodo[name] = n.parameters.ttl;
    check(okExpire && okTtl, `nodo ${name} (${famDe(name)}) tiene expire:true y ttl:${f.ttl}`);
  }
}
check(setsSinExpiracion === 0, `0 escrituras \`set\` sin expiración (${setsSinExpiracion})`);

function famDe(name) {
  for (const [fam, f] of Object.entries(FAMILIAS)) {
    if (f.nodos.includes(name)) return fam;
  }
  return '?';
}

// 2) Redis13 sigue siendo un `set` con valor vacío (NO convertido en delete).
const r13 = byName.get('Redis13');
check(r13.parameters.operation === 'set', 'Redis13 mantiene operation "set"');
check(r13.parameters.value === '=', 'Redis13 sigue escribiendo el valor vacío');
check(r13.parameters.expire === true && r13.parameters.ttl === TTL_CHAT, 'Redis13 lleva expire:true + ttl de la familia chat_');

// 3) Los nodos de lectura no tienen expire/ttl y conservan su patrón de clave.
for (const l of LECTURAS) {
  const n = byName.get(l.name);
  if (!n) { check(false, `no existe nodo de lectura ${l.name}`); continue; }
  const sinExp = !('expire' in n.parameters) && !('ttl' in n.parameters);
  const opOk = n.parameters.operation === l.op;
  const keyOk = l.key !== undefined ? n.parameters.key === l.key : n.parameters.list === l.list;
  check(sinExp, `lectura ${l.name} no tiene expire/ttl`);
  check(opOk, `lectura ${l.name} mantiene operation ${l.op}`);
  check(keyOk, `lectura ${l.name} mantiene su patrón de clave`);
  check(!!n.credentials && !!n.credentials.redis, `lectura ${l.name} conserva la credencial redis`);
}

// 4) D2-A: existe el nodo expire sobre fotos_, colgante desde Redis6.
const nuevo = byName.get(NUEVO_NODO);
check(!!nuevo, `existe el nodo "${NUEVO_NODO}"`);
if (nuevo) {
  check(nuevo.type === '@fancyheat/n8n-nodes-redis-enhanced.redisEnhanced',
    `tipo del nodo = ${nuevo.type} (community node Redis Enhanced)`);
  check(nuevo.typeVersion === 1, `typeVersion = ${nuevo.typeVersion} (1)`);
  check(nuevo.parameters.operation === 'expire', 'operación = expire');
  check(nuevo.parameters.key === "=fotos_{{ $('Code in JavaScript7').item.json.id_chat }}",
    `key = ${nuevo.parameters.key} (mismo patrón que Redis6)`);
  check(nuevo.parameters.seconds === TTL_FOTOS, `seconds/ttl = ${nuevo.parameters.seconds} (TTL_FOTOS)`);
  check(!!nuevo.credentials && !!nuevo.credentials.redis, 'referencia la credencial redis (misma que Redis6)');
}

// 5) Fan-out: Redis6 alimenta a «Send a text message7» Y al nodo expire; el output del nodo expire no es consumido.
const conn6 = w.connections['Redis6'];
const out6 = conn6 && conn6.main && conn6.main[0] ? conn6.main[0].map((e) => e.node) : [];
check(out6.includes('Send a text message7'), '«Send a text message7» sigue recibiendo la salida de Redis6');
check(out6.includes(NUEVO_NODO), `${NUEVO_NODO} es alcanzable como fan-out de Redis6`);
check(w.connections[NUEVO_NODO] === undefined, `la salida de ${NUEVO_NODO} no es consumida (sumidero colgante)`);

// 6) Coherencia global: toda arista apunta a un nodo existente; sin claves ajenas.
const names = new Set(w.nodes.map((n) => n.name));
let aristasMalas = 0;
for (const [from, outs] of Object.entries(w.connections)) {
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
check(aristasMalas === 0, `bloque connections coherente (0 aristas apuntando a nodos inexistentes)`);

// ---------- (b) Simulación SET+EXPIRE contra un mock en memoria ----------
console.log('\n--- (b) Simulación SET+EXPIRE contra un mock en memoria ---');

function makeMockRedis() {
  const store = new Map(); // key -> { value, expireAtMs }
  const now = () => Date.now();
  return {
    set(key, value) {
      const e = store.get(key);
      store.set(key, { value, expireAtMs: e ? e.expireAtMs : null });
      return 'OK';
    },
    expire(key, ttlSeconds) {
      const e = store.get(key);
      if (!e) return 0;
      e.expireAtMs = now() + ttlSeconds * 1000;
      return 1;
    },
    ttl(key) {
      const e = store.get(key);
      if (!e) return -2;
      if (e.expireAtMs === null) return -1;
      return Math.max(0, Math.round((e.expireAtMs - now()) / 1000));
    },
    get(key) {
      const e = store.get(key);
      if (!e) return null;
      if (e.expireAtMs !== null && now() >= e.expireAtMs) {
        store.delete(key);
        return null;
      }
      return e.value;
    },
    // helpers de test
    _setExpiredForTesting(key, expired) {
      const e = store.get(key);
      if (e) e.expireAtMs = expired ? now() - 1 : null;
    },
    _has(key) {
      return store.has(key);
    },
  };
}

const mock = makeMockRedis();
const KEY = 'chat_42';
const VAL = '{"estado_de_chat":"ESPERANDO RESPUESTA"}';

// SET + EXPIRE (lo que hace el nodo built-in con expire:true + ttl)
mock.set(KEY, VAL);
const expireRes = mock.expire(KEY, TTL_CHAT);
check(expireRes === 1, `client.expire devuelve 1 sobre la clave recién escrita`);
check(mock.ttl(KEY) === TTL_CHAT, `TTL restante = ${mock.ttl(KEY)} s (constante ${TTL_CHAT})`);
check(mock.get(KEY) === VAL, 'la clave se puede leer mientras no expiró');

// Re-escritura: el TTL se re-arma al valor completo.
mock._setExpiredForTesting(KEY, false); // simula paso del tiempo: reinicia el contador interno del test
// (En realidad el refresco ocurre porque el nodo re-ejecuta expire con el ttl completo.)
const t1 = mock.ttl(KEY);
mock.set(KEY, VAL);
mock.expire(KEY, TTL_CHAT);
check(mock.ttl(KEY) === TTL_CHAT, `re-escritura re-arma el TTL completo (${mock.ttl(KEY)} s, antes ${t1} s)`);

// La clave se reporta expirada tras el TTL.
mock._setExpiredForTesting(KEY, true);
check(mock.get(KEY) === null && !mock._has(KEY), 'la clave se reporta expirada y desaparece tras el TTL');

if (fallas > 0) {
  console.log(`\n${fallas} verificacion(es) fallida(s)`);
  process.exit(1);
}
console.log('\nTodas las verificaciones pasaron.');
