# Tasks: error-handling

> El workflow vive en n8n; `codigo.json` es un export. Implementar editando `codigo.json` con cuidado y sincronizar al final con un re-import/re-export (tasks pending-manual). Orden de edición: **política retry por grupos (Capa 1) → Capa 2 (workflow de error, solo si se aprueba) → verificación offline → verificación en stack (pending-manual)**.
>
> **Auditoría base (evidencia, ya realizada).** 116 nodos. Nodos con `retryOnFail`: **0**. Nodos con `onError`: **1** («Escaneo ClamAV», `continueErrorOutput` en `parameters`). Nodos con `alwaysOutputData=true`: **3** (`HTTP - Leer producto informacion`, `HTTP - Leer producto imagen`, `HTTP - Chequear vinculacion`). 28 nodos Telegram SEND/edit excluidos; 4 nodos de descarga `resource: file` SÍ reintentan.
>
> **Política única de retry (design D1):** `"retryOnFail": true`, `"maxTries": 3`, `"waitBetweenTries": 1000` **a nivel de nodo** (formato real del export n8n; el design decía "en `parameters`", ver desviación abajo). **Excepción D5 (decisión de usuario):** `HTTP Request1` (`telegram_link_codes`) → **sin retry** (opción B). `HTTP - Crear post Postiz` y los 28 Telegram SEND/edit: **sin retry**.
>
> **DECISIONES DE USUARIO pendientes antes de implementar:** (a) Capa 2 sí/no; (b) `HTTP Request1` retry `maxTries: 2` o sin retry; (c) `waitBetweenTries` único 1000 ms o 3000 ms en Gemini; (d) si Capa 2: valor de `DEFAULT_ADMIN_CHAT_ID`.
>
> **DECISIONES RESUELTAS (2026-08-14):** (a) **Capa 2 SÍ** (se crea `error-workflow.json`); (b) `HTTP Request1` **sin retry** (insert no idempotente; riesgo documentado en `HALLAZGOS-DEL-FLUJO-n8n.md` §3.5); (c) **3000 ms en los 6 nodos Gemini/modelo** (4 Gemini + `Google Gemini Chat Model1` + `AI Agent1`), 1000 ms en el resto; (d) `DEFAULT_ADMIN_CHAT_ID` = placeholder `PONER_AQUI_CHAT_ID_ADMIN` a completar en la UI (pending-manual 4.2).
>
> **DESVIACIÓN vs design.md (D1):** el design indica agregar las claves de retry a `parameters`, pero el formato real del export n8n las persiste **a nivel de nodo** (igual que `alwaysOutputData` en este mismo export). Se aplican a nivel de nodo; el verificador las audita allí. Los 42 nodos conservan nombre, credencial, conexiones, posiciones y el resto de `parameters` intactos.

## 1. Capa 1 — Retries en nodos de red (configuración en `codigo.json`)

> Para cada nodo se agregan tres claves **a nivel de nodo** (junto a los parámetros existentes, que quedan intactos): `"retryOnFail": true`, `"maxTries": 3` y `"waitBetweenTries": 1000` (3000 en los 6 nodos Gemini/modelo). No cambian `method`, `url`, credencial, conexiones, posiciones ni el resto de `parameters`. **Editar agrupado por grupo.**

- [x] 1.1 **Lecturas Supabase (5 nodos)** — agregar retry a `HTTP - Leer producto informacion`, `HTTP - Leer producto imagen`, `HTTP - Chequear vinculacion`, `HTTP - Perfil publicacion`, `HTTP - Cuenta Instagram publicacion` (GET, idempotentes)
- [x] 1.2 **Upserts idempotentes Supabase (3 nodos)** — agregar retry a `HTTP - Upsert producto informacion`, `HTTP - Upsert producto pdf`, `HTTP - Upsert producto imagen` (POST `on_conflict=user_id` + `Prefer: resolution=merge-duplicates` → idempotentes)
- [x] 1.3 **Subida de imagen Postiz (1 nodo)** — agregar retry a `HTTP - Subir imagen Postiz` (POST `/upload`; riesgo aceptado: asset huérfano no visible, ver design D2)
- [x] 1.4 **Gemini (4 nodos)** — agregar retry a `Analyze document`, `Analyze an image`, `Generate an image`, `Edit an image` (con `waitBetweenTries: 3000`, decisión de usuario)
- [x] 1.5 **Agente con LLM (1 nodo)** — agregar retry a `AI Agent1` (el retry configurado en el nodo del agente cubre al subnodo `Google Gemini Chat Model1` y a la tool read-only de Google Sheets; ver design D2) — **CONFIRMADO por el usuario: SÍ** (idempotente). Además, por decisión de usuario, `Google Gemini Chat Model1` (nodo directo) lleva retry propio con `waitBetweenTries: 3000`
- [x] 1.6 **Descargas de archivos Telegram (4 nodos)** — agregar retry a `Get a file`, `Get a file1`, `Get a file2`, `Telegram Get a file publicacion` (resource `file`, descarga idempotente)
- [x] 1.7 **Escrituras Redis (23 nodos)** — agregar retry a los 21 `set`, a `Redis6` (`push`, caveat de `fotos_` documentado en design D2) y a `Redis - Expirar fotos` (`expire`); conservar intactos `expire`/`ttl` ya presentes (redis-expiration)
- [x] 1.8 **(N/A — decisión de usuario: sin retry) `HTTP Request1`** — NO se agregó retry (POST insert `telegram_link_codes` no idempotente; D5 opción B). Riesgo documentado en `HALLAZGOS-DEL-FLUJO-n8n.md` §3.5: si el insert falla, la vinculación muere sin aviso
- [x] 1.9 **No retry en excluidos (verificación negativa)** — confirmar que NO se agregó retry a: `Telegram Trigger`, `Wait`, `Escaneo ClamAV` (conserva `parameters.onError: continueErrorOutput`), los 28 nodos Telegram SEND/edit y `HTTP - Crear post Postiz` (verificado por `verify-retries.js`)

## 2. Capa 2 — Workflow de error con Error Trigger (solo si se aprueba)

> Workflow separado en `error-workflow.json` (design D4): Error Trigger → Code «Extraer chat y preparar aviso» → Telegram sendMessage (credencial `Telegram account` reutilizada). NO se toca `codigo.json` (el workflow principal se mantiene en 116 nodos).

- [x] 2.1 **CONFIRMAR con el usuario la decisión de incluir la Capa 2** — **CONFIRMADO: SÍ** (se implementa `error-workflow.json`)
- [x] 2.2 Crear `error-workflow.json` con: nodo `errorTrigger` (typeVersion 1) + nodo `n8n-nodes-base.code` + nodo `n8n-nodes-base.telegram` (`sendMessage`, credencial `Telegram account`); JSON válido de export n8n
- [x] 2.3 En el nodo Code, implementar la cadena de extracción de chat_id (design D4a): `$json.id_chat` → `node.data[0].json.chat.id` (legacy) → constante `DEFAULT_ADMIN_CHAT_ID` (placeholder a completar por el usuario) → no enviar si no hay target
- [x] 2.4 En el nodo Code, armar el mensaje en español: al usuario `⚠️ Ocurrió un error procesando tu solicitud. Volvé a intentar con /start.`; al admin, con detalle técnico (`Workflow: {{ $json.workflow }} · Nodo: {{ $json.lastNodeExecuted }} · Exec: {{ $json.executionId }}`)
- [x] 2.5 En `error-workflow.json`, conectar: `errorTrigger` main → Code → Telegram sendMessage (chatId = salida del Code)

## 3. Verificación offline (sin stack)

- [x] 3.1 Crear `tests/error-handling/verify-retries.js` (patrón de `tests/redis-expiration/verify-ttl.js`, sin stack ni contenedores): (a) audita `codigo.json` — todo nodo de la lista reintentada tiene `retryOnFail: true` + `maxTries` + `waitBetweenTries` (con la excepción D5), todo excluido no los tiene, «Escaneo ClamAV» conserva `parameters.onError`, los 3 nodos `alwaysOutputData` los conservan; (b) integridad: `JSON.parse` sin error, recuento de nodos = 116, `connections` coherente; (c) si Capa 2: `error-workflow.json` parsea y contiene `errorTrigger` + Code + Telegram `sendMessage`
- [x] 3.2 Correr `node tests/error-handling/verify-retries.js` y confirmar salida sin fallos (exit 0)
- [x] 3.3 No regresión: nodos de la cadena ClamAV, los 11 nodos migrados a credenciales (12 del `secrets-migration` menos el `HTTP Request` eliminado en `bug-fixes`), los renombrados por `bug-fixes` y los 23 nodos Redis con `expire`/`ttl` intactos (mismos parámetros; sin valores `eyJ`/`Bearer` literales) — verificado por el grupo 3

## 4. Pending-manual — despliegue y verificación funcional en el stack

> Requiere el stack levantado (`docker compose up -d`) y acceso a la UI de n8n.

- [x] 4.1 `error-workflow.json` importado como workflow separado en n8n.
- [x] 4.2 Seleccionado en Settings → Error Workflow del workflow principal; `DEFAULT_ADMIN_CHAT_ID` reemplazado por el chat_id real del admin en el nodo Code (hardcodeado, no queda como placeholder).
- [ ] 4.3 Re-importar `codigo.json` en n8n y guardar; verificar que los nodos de la lista muestran `Retry on Fail` con `maxTries`/`waitBetweenTries` y que los excluidos no — pending-manual: re-importar y revisar los nodos en la UI
- [ ] 4.4 Prueba funcional de retries: forzar un fallo transitorio (pausar el servicio Redis o un contenedor 2-3 s) y confirmar en el log de ejecución que el nodo se reintentó y continuó — pending-manual: requiere stack
- [ ] 4.5 (si Capa 2) Prueba funcional de notificación: provocar un error que agote los reintentos (bajar un servicio o request que devuelva error) y confirmar que el usuario recibe el aviso en español en Telegram — pending-manual: requiere stack + el error workflow seleccionado
- [ ] 4.6 Re-exportar el workflow principal desde n8n y sobrescribir `codigo.json` para dejarlo sincronizado; correr de nuevo el grupo 3 — pending-manual: re-export y re-correr `verify-retries.js`
- [ ] 4.7 Actualizar `HALLAZGOS-DEL-FLUJO-n8n.md` §3.5 con el estado de remediación real (política aplicada, nodos cubiertos, exclusiones, decisión de Capa 2) — pending-manual: confirmar el estado live y actualizar §3.5
