# Tasks: redis-expiration

> El workflow vive en n8n; `codigo.json` es un export. Implementar editando `codigo.json` con cuidado y sincronizar al final con un re-import/re-export (tasks pending-manual). Orden de edición: **nodos SET (grupo 1) → fotos (grupo 2, solo si D2-A) → verificación offline (grupo 3) → verificación en stack (grupo 4)**.
>
> **Auditoría base (evidencia, ya realizada).** 29 nodos `n8n-nodes-base.redis` (typeVersion 1, credencial `redis`). Escrituras: **21 `set`** + **1 `push`** (Redis6, `fotos_`). Lecturas (NO se tocan): Redis27 (`get chat_`), Redis30, «Redis - Get foto publicidad postiz» (`get publicidad_`), Redis24 (`get especificaciones_`), «Redis - Get descripcion» (`get descripcion_`), Redis7 (`llen fotos_`), Redis8 (`pop fotos_`).
>
> **21 nodos `set` por familia:** `chat_` → Redis36, Redis35, Redis33, Redis32, Redis26, Redis25, Redis20, Redis22, Redis19, Redis18, Redis12, Redis11, Redis9, Redis13 (reseteo, valor `""`), «Redis - Estado descripcion», Redis28 (16). `especificaciones_` → Redis23, Redis3 (2). `especificaciones_rehacer_` → Redis5 (1). `publicidad_` → Redis4 (1). `descripcion_` → «Redis - Guardar descripcion» (1).
>
> **TTL (segundos) por familia:** `TTL_CHAT`=86400, `TTL_ESPECIFICACIONES`=86400, `TTL_ESPECIFICACIONES_REHACER`=86400, `TTL_PUBLICIDAD`=86400, `TTL_DESCRIPCION`=86400, `TTL_FOTOS`=86400. **Valores propuestos; si el usuario aprueba otro valor, reemplazar en todo el archivo.**

## 1. TTL nativo en los 21 nodos `set` (parámetros `expire` + `ttl`)

> Para cada nodo se agregan dos claves al objeto `parameters` (junto a `operation`/`key`/`value`): `"expire": true` y `"ttl": <constante de familia>`. El nodo built-in de n8n ejecuta `client.set(key, value)` seguido de `client.expire(key, ttl)` — un solo nodo, TTL refrescado en cada escritura. No cambian `key`, `value`, credencial ni conexiones. **Editar agrupado por familia.**

- [x] 1.1 **Familia `chat_` (TTL 86400)** — agregar `expire: true` + `ttl: 86400` a los `parameters` de: Redis36, Redis35, Redis33, Redis32, Redis26, Redis25, Redis20, Redis22, Redis19, Redis18, Redis12, Redis11, Redis9, Redis28 (14 nodos con valor de estado)
- [x] 1.2 **`Redis13` (reseteo, familia `chat_`, TTL 86400)** — agregar `expire: true` + `ttl: 86400` a sus `parameters`; **mantener** `operation: set` y `value: ""` (NO convertir en `delete`: el evaluador lee la clave con `get` y espera un string presente; ver design D3)
- [x] 1.3 **«Redis - Estado descripcion» (familia `chat_`, TTL 86400)** — agregar `expire: true` + `ttl: 86400`
- [x] 1.4 **Familia `especificaciones_` (TTL 86400)** — Redis23 y Redis3: agregar `expire: true` + `ttl: 86400`
- [x] 1.5 **`Redis5` (especificaciones_rehacer_, TTL 86400)** — agregar `expire: true` + `ttl: 86400`
- [x] 1.6 **`Redis4` (publicidad_, TTL 86400)** — agregar `expire: true` + `ttl: 86400`
- [x] 1.7 **«Redis - Guardar descripcion» (descripcion_, TTL 86400)** — agregar `expire: true` + `ttl: 86400`
- [x] 1.8 **Verificación parcial (script del grupo 3, `--audit-only`):** los 21 nodos `set` tienen `expire: true` y `ttl` de su familia; 0 escrituras sin expiración — verificado por `tests/redis-expiration/verify-ttl.js` (parte a)

## 2. `fotos_` — TTL en la lista (DECISIÓN DE USUARIO pendiente)

> La operación `push` del nodo built-in no soporta TTL y no existe operación `EXPIRE`. **D2-A (recomendado)**: nodo de comunidad «Redis Enhanced» (`@fancyheat/n8n-nodes-redis-enhanced`, type `redisEnhanced`, operación `expire`, params `key` = `fotos_{{ $('Code in JavaScript7').item.json.id_chat }}` + `seconds` = 86400) como **rama colgante** a la salida de `Redis6` (fan-out aditivo: `Redis6` sigue alimentando a «Send a text message7»; el nuevo nodo no consume su salida). Requiere instalar el community node ANTES de re-importar. **D2-B (sin dependencias)**: no se agrega nodo; se documenta auto-limpieza (Redis borra la lista al hacer `pop` del último elemento) + barrido manual `KEYS fotos_*`/`DEL` para sesiones abandonadas; el requisito de spec para `fotos_` queda como desviación documentada.

- [x] 2.1 **CONFIRMAR con el usuario la decisión D2-A o D2-B** antes de ejecutar el grupo 2 (design D2 / spec «fotos_») — **decisión: D2-A** (confirmada por el usuario en el brief de implementación)
- [x] 2.2 (si D2-A) Agregar el nodo `Redis - Expirar fotos` a `nodes` (`type: "@fancyheat/n8n-nodes-redis-enhanced"`, typeVersion por capturar del export real, `parameters: {"operation": "expire", "key": "=fotos_{{ $('Code in JavaScript7').item.json.id_chat }}", "seconds": 86400}`, credencial `redis`, posición al lado de Redis6) — **desviación verificada en source de n8n y del paquete:** el `type` real del nodo es `@fancyheat/n8n-nodes-redis-enhanced.redisEnhanced` (node description `name: 'redisEnhanced'`, packageName + nodeName); `typeVersion: 1`; params reales del paquete: `operation: expire`, `key`, `seconds` (verificado en `RedisEnhanced.node.js` v0.1.7)
- [x] 2.3 (si D2-A) En `connections`, agregar una arista de salida `"Redis6": main[0]` → `Redis - Expirar fotos` (index 0) **manteniendo** la arista existente a «Send a text message7»; la salida del nuevo nodo queda sin conexiones (sumidero colgante)
- [x] 2.4 (si D2-B) Documentar en `HALLAZGOS-DEL-FLUJO-n8n.md` §3.1 el procedimiento de barrido manual de `fotos_*` y la desviación de spec — **N/A: se eligió D2-A**
- [x] 2.5 (si D2-A) Verificación parcial (script del grupo 3): existe el nodo `expire` sobre `fotos_` alcanzable desde `Redis6`, su output no es consumido, y «Send a text message7» sigue recibiendo la salida de `Redis6` — verificado por `tests/redis-expiration/verify-ttl.js`

## 3. Verificación offline (sin stack)

- [x] 3.1 Crear `tests/redis-expiration/verify-ttl.js` (patrón de `tests/rng/`, sin stack ni contenedores): (a) audita `codigo.json` — todo nodo `set` tiene `expire: true` y `ttl` = constante de su familia; recuento de nodos con expiración == recuento de escrituras (22 con D2-A); lectura exacta por familia; verifica que los nodos de lectura no tienen `expire`/`ttl` ni cambios en `key`/`value`/credential/`connections`; (b) simula `client.set()` + `client.expire()` contra un mock en memoria (clave con `ttl` restante = constante; re-escritura re-arma el TTL completo; la clave se reporta expirada tras el TTL)
- [x] 3.2 Correr `node tests/redis-expiration/verify-ttl.js` y confirmar salida sin fallos
- [x] 3.3 Parseo de integridad: `node -e "JSON.parse(require('fs').readFileSync('codigo.json','utf8'))"` sin error; recuento de nodos = 115 (D2-B) o 116 (D2-A); bloque `connections` coherente (toda arista apunta a un nodo existente)
- [x] 3.4 No regresión: nodos de la cadena ClamAV, los 11 nodos migrados a credenciales y los renombrados por `bug-fixes` intactos (mismos parámetros; sin valores `eyJ`/`Bearer` literales)

## 4. Pending-manual — despliegue y verificación funcional en el stack

> Requiere el stack levantado (`docker compose up -d`), acceso a la UI de n8n y a `redis-cli`.

- [x] 4.1 Community node `@fancyheat/n8n-nodes-redis-enhanced` instalado en n8n (Settings → Community Nodes) — se destapó como blocker al intentar correr el workflow durante la verificación funcional de `link-code-reproducible`, no antes. El `type` coincide con lo esperado (`@fancyheat/n8n-nodes-redis-enhanced.redisEnhanced`), el workflow corre sin error de "Unrecognized node type".
- [ ] 4.2 Re-importar `codigo.json` en n8n y guardar; verificar que los 21 nodos `set` muestran el TTL y que «Redis - Expirar fotos» (si D2-A) existe conectado a Redis6 — pending-manual: re-importar y confirmar TTL + nodo expire + fan-out
- [ ] 4.3 Verificación live de TTL: desde `redis-cli`, tras un mensaje real al bot, `TTL chat_<id>`/`TTL especificaciones_<id>` (y `TTL fotos_<id>` si D2-A) → 86400 — pending-manual: requiere stack + mensaje real al bot
- [ ] 4.4 Verificación de refresco: enviar un segundo mensaje dentro de la misma sesión y confirmar que `TTL chat_<id>` vuelve a 86400 (no decrece) — pending-manual: requiere stack
- [ ] 4.5 Verificación de expiración: dejar transcurrir el TTL (o usar `PEXPIRE`/`EXPIRE` manual como atajo) y confirmar que las claves desaparecen (`EXISTS` → 0) — pending-manual: requiere stack
- [ ] 4.6 (si D2-A) Verificación de no-regresión de la rama de fotos: el flujo de subida → análisis → respuesta sigue funcionando («Send a text message7» recibe los items de Redis6 como antes) — pending-manual: requiere stack
- [ ] 4.7 Re-exportar el workflow desde n8n y sobrescribir `codigo.json` para dejarlo sincronizado; correr de nuevo el grupo 3 — pending-manual: re-export y re-correr `verify-ttl.js`
- [ ] 4.8 Actualizar `HALLAZGOS-DEL-FLUJO-n8n.md` §3.1 con el estado de remediación real (mecanismo aplicado, TTL por familia, decisión fotos) — pending-manual: confirmar el estado live y actualizar §3.1 (nota inicial ya agregada en implementación)
