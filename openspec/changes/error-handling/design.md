# Design: Manejo de fallos del workflow n8n (error-handling)

## Context

El workflow "Aura" (exportado en `codigo.json`, **116 nodos**) no tiene estrategia de manejo de fallos (`HALLAZGOS-DEL-FLUJO-n8n.md` §3.5). Verificado sobre el export:

- Nodos con `retryOnFail`: **0**.
- Nodos con `onError`: **1** («Escaneo ClamAV», `continueErrorOutput`, dentro de `parameters`).
- Nodos con `alwaysOutputData=true`: **3** (`HTTP - Leer producto informacion`, `HTTP - Leer producto imagen`, `HTTP - Chequear vinculacion`).

Si Gemini agota cuota, Telegram limita tasa, Postiz falla o Redis se reinicia, la ejecución muere y el usuario queda esperando sin aviso. Este cambio implementa la opción (a) de §3.5: **es configuración, no desarrollo**.

### Auditoría de nodos de red (evidencia)

| Nodo | Tipo / versión | Operación | URL (resumen) | Idempotente | Config actual |
|---|---|---|---|---|---|
| HTTP - Upsert producto informacion | httpRequest 4.4 | POST | `/products?on_conflict=user_id` + `Prefer: resolution=merge-duplicates` | ✅ sí (upsert) | sin retry |
| HTTP - Upsert producto pdf | httpRequest 4.4 | POST | `/products?on_conflict=user_id` + `Prefer` | ✅ sí (upsert) | sin retry |
| HTTP - Upsert producto imagen | httpRequest 4.4 | POST | `/products?on_conflict=user_id` + `Prefer` | ✅ sí (upsert) | sin retry |
| HTTP - Leer producto informacion | httpRequest 4.4 | GET | `/products?user_id=eq...&select=product_data` | ✅ sí (read) | `alwaysOutputData: true` |
| HTTP - Leer producto imagen | httpRequest 4.4 | GET | `/products?user_id=eq...&select=product_data` | ✅ sí (read) | `alwaysOutputData: true` |
| HTTP - Chequear vinculacion | httpRequest 4.4 | GET | `/profiles?telegram_chat_id=eq...&select=id` | ✅ sí (read) | `alwaysOutputData: true` |
| HTTP Request1 | httpRequest 4.4 | POST | `/telegram_link_codes` (insert chat_id+code) | ❌ **no** (insert) | sin retry |
| HTTP - Perfil publicacion | httpRequest 4.4 | GET | `/profiles?select=id&telegram_chat_id=eq...` | ✅ sí (read) | sin retry |
| HTTP - Cuenta Instagram publicacion | httpRequest 4.4 | GET | `/social_accounts?...&is_connected=eq.true` | ✅ sí (read) | sin retry |
| HTTP - Subir imagen Postiz | httpRequest 4.4 | POST | `/api/public/v1/upload` | ✅ de facto (asset huérfano, no visible al usuario) | sin retry |
| HTTP - Crear post Postiz | httpRequest 4.4 | POST | `/api/public/v1/posts` (`type: 'now'`) | ❌ **no** (publica duplicados) | sin retry |
| Escaneo ClamAV | httpRequest 4.4 | POST | `clamav-rest:9000/v2/scan` | ✅ (scan sin efectos) | `parameters.onError: continueErrorOutput` |
| Analyze document | googleGemini 1.1 | document | Gemini API | ✅ (análisis) | sin retry |
| Analyze an image | googleGemini 1.1 | analyze | Gemini API | ✅ (análisis) | sin retry |
| Generate an image | googleGemini 1.1 | generate | Gemini API | ✅ (generación idempotente de efectos) | sin retry |
| Edit an image | googleGemini 1.1 | edit | Gemini API | ✅ (edición) | sin retry |
| Google Gemini Chat Model1 | lmChatGoogleGemini 1 | subnodo LM del agente | Gemini API | ✅ (chat) | sin retry |
| AI Agent1 | langchain.agent 3.1 | agente (usa Chat Model1 + Google Sheets) | — | ✅ (tools read-only) | sin retry |
| Get row(s) in sheet in Google Sheets | googleSheetsTool 4.7 | subnodo tool del agente | Google Sheets API | ✅ (read) | sin retry |
| Get a file / Get a file1 / Get a file2 | telegram 1.2 | `resource: file` (download) | Telegram Bot API | ✅ (download idempotente) | sin retry |
| Telegram Get a file publicacion | telegram 1.2 | `resource: file` (download) | Telegram Bot API | ✅ (download) | sin retry |
| 23 nodos Redis de escritura | redis 1 (+1 community) | 21 `set` + 1 `push` + 1 `expire` | Redis | ✅ (set/push/expire idempotentes de efectos) | sin retry; con `expire`/`ttl` (redis-expiration) |
| 28 nodos Telegram SEND/edit | telegram 1.2 | `sendMessage`/`sendPhoto`/`editMessageText`/`editMessageReplyMarkup` | Telegram Bot API | ❌ retry duplica mensajes visibles | sin retry |
| Telegram Trigger | telegramTrigger 1.2 | trigger (punto de entrada) | — | ❌ no lleva retry | sin retry |
| Wait | wait 1.1 | pausa de 10 min | — | ❌ no es falla de red | sin retry |

**Conteos:** de los 116 nodos, **40 son nodos de red/e/s** con falla potencial (excluyendo trigger, wait y ClamAV ya cubierto). Los **28 nodos Telegram SEND/edit** se excluyen deliberadamente. Los nodos de lógica (12 `code`, 9 `if`, 2 `switch`, 1 `aggregate`, 9 sticky notes, 1 trigger) no se tocan.

## Goals / Non-Goals

**Goals:**
- **G1.** Los nodos de red cuyo fallo transitorio dejaría al usuario colgado reintentan solos un número acotado de veces (Capa 1).
- **G2.** Retry solo donde es seguro: no duplica efectos visibles al usuario (mensajes/publicaciones) ni rompe invariantes de datos.
- **G3.** El usuario recibe aviso si la ejecución falla tras agotar los reintentos (Capa 2), con instrucción de reintentar `/start`.
- **G4.** Cambio de configuración: cero nodos nuevos en el workflow principal, 116 nodos intactos, sin cambios de máquina de estados, claves Redis, credenciales ni `connections`.
- **G5.** Verificación posible offline (sin stack vivo) + verificación live opcional.

**Non-Goals:**
- No se cambia la máquina de estados ni el espacio de claves.
- No se toca la cadena ClamAV (`pdf-virus-scan`), la migración de credenciales (`secrets-migration`), ni los renombres/reconexión (`bug-fixes`).
- No se implementa lógica de retry personalizada en `code` (solo configuración de nodo nativa de n8n).
- No se garantiza cero duplicados ante fallos no idempotentes: se documenta el riesgo y se excluyen los casos de efecto visible.
- No se crea un sistema de colas/reintentos manual de sesiones a medio procesar.

## Decisions

### D1 — Política única de retry (Capa 1)

Un solo policy para todos los nodos reintentados: **`"retryOnFail": true`, `"maxTries": 3`, `"waitBetweenTries": 1000`** (ms).

- **Justificación de `maxTries: 3`**: cubre el caso típico de fallo transitorio (reset de conexión, 5xx de Supabase, arranque de Redis, 429 de Gemini). Más reintentos alargan la espera del usuario sin ganancia proporcional; menos no cubren picos cortos. n8n ejecuta hasta `maxTries` intentos con `waitBetweenTries` entre ellos.
- **Justificación de `waitBetweenTries: 1000` ms**: suficiente para dejar pasar la mayoría de los rate-limits cortos (Telegram/Google) sin agregar latencia perceptible. El nodo `Wait` más largo del flujo es de 10 min; 1 s extra por intento no impacta la UX.
- **Alternativa considerada**: `waitBetweenTries: 3000` ms en los nodos Gemini (más amigable con 429). Se descarta para mantener una sola política simple y predecible; el usuario puede ajustar por nodo si lo prefiere (open question).
- Se aplica **sin** `onError` ni `continueOnFail`: el fallo tras agotar intentos **sigue deteniendo** la ejecución, que es justo lo que habilita a la Capa 2 a notificar.

### D2 — Nodos que reciben retry (seguro)

| Nodo | Por qué es seguro |
|---|---|
| HTTP - Leer producto informacion / imagen / Chequear vinculacion / Perfil publicacion / Cuenta Instagram publicacion | GET de Supabase, idempotentes por naturaleza |
| HTTP - Upsert producto informacion / pdf / imagen | POST idempotente: `on_conflict=user_id` + `Prefer: resolution=merge-duplicates` → repetir no duplica filas |
| HTTP - Subir imagen Postiz | POST `/upload`: un retry puede crear un segundo asset **huérfano** en Postiz (no visible al usuario); riesgo aceptado y documentado |
| Analyze document / Analyze an image / Generate an image / Edit an image | API de Google, friendly a rate limits; repetir regenera el mismo tipo de salida (costo API extra si el primer intento alcanzó billing, ver riesgos) |
| Google Gemini Chat Model1 (subnodo LM del agente) | chat de LLM; reintentar re-ejecuta la misma llamada (coste API, sin efecto visible duplicado). **Aplicar el retry en el nodo del agente `AI Agent1`**: en n8n el retry configurado en el subnodo no siempre es eficaz según versión; configurarlo en el agente es la vía soportada y seguro (sus tools son read-only: lectura de Google Sheets) |
| AI Agent1 | reintentar re-ejecuta el agente: LM + tool de lectura. Sin efectos de escritura → seguro. Config aquí cubre tanto al Chat Model como a la tool |
| Get a file / Get a file1 / Get a file2 / Telegram Get a file publicacion | descarga idempotente de archivos (resource `file`), sin efectos visibles |
| 23 nodos Redis de escritura (21 `set` + 1 `push` + 1 `expire`) | baratos e idempotentes de efectos. **Caveat `Redis6` (`push` a `fotos_`)**: un retry puede duplicar un `file_id` en la lista; impacto nulo (el loop de análisis procesa la foto dos veces a lo sumo) — aceptado |

### D3 — Nodos excluidos deliberadamente (sin retry)

| Nodo | Motivo |
|---|---|
| Telegram Trigger | punto de entrada; un retry del trigger no tiene sentido (el webhook vuelve a disparar) |
| Wait | pausa intencional, no es una falla de red |
| Escaneo ClamAV | ya tiene `onError: continueErrorOutput` en `parameters` — se conserva tal cual (el fallo de scan NO debe reintentar: el flujo sigue por la rama de error) |
| **28 nodos Telegram SEND/edit** | un retry **duplica un mensaje visible** al usuario (o edita un mensaje que quizá ya se editó). Además reintentar contra la Bot API mientras se está en rate-limit empeora el 429. Se recomienda **sin retry**. Alternativa (decisión de usuario): retry con `maxTries: 2` y aceptar riesgo de doble mensaje — **no recomendado** |
| HTTP - Crear post Postiz | POST `type: 'now'` **no idempotente**: un retry publica un post duplicado en las redes conectadas (visible, difícil de deshacer). Se recomienda **sin retry**; si falla, la Capa 2 avisa al usuario y este reintenta `/start` |
| HTTP Request1 (`telegram_link_codes`) | POST **insert no idempotente**: un retry crea una fila duplicada. **Decisión de usuario** (D5): retry con `maxTries: 2` (riesgo: fila huérfana inocua) o sin retry (riesgo: el usuario no obtiene el código de vinculación y el flujo muere sin aviso) |

### D4 — Capa 2: workflow de error con Error Trigger (nuevo archivo `error-workflow.json`)

El enfoque canónico de n8n: un **workflow separado** con un nodo **`n8n-nodes-base.errorTrigger`** (v1) que n8n dispara automáticamente cuando **cualquier** workflow del espacio falla. Nodos del workflow nuevo:

1. **Error Trigger** (`n8n-nodes-base.errorTrigger`). Proporciona el item de error con: `executionId`, `time`, `error` (mensaje), `workflow` (nombre), `workflowId`, `lastNodeExecuted`. En versiones recientes de n8n el item de error **no** garantiza los datos de entrada del nodo que falló (el campo `node` con los datos de entrada fue deprecado); por eso el chat_id se extrae con cadena de fallbacks (ver D4a).
2. **Code — «Extraer chat y preparar aviso»** (`n8n-nodes-base.code`). Lógica de extracción robusta del `chat_id`:
   1. `$json.id_chat` (si el payload lo trae directamente);
   2. recorrer `$json.node.data[0].json` buscando `chat.id` (formato legacy del item del Telegram Trigger);
   3. fallback: constante `DEFAULT_ADMIN_CHAT_ID` configurada en el nodo (chat del admin/owner) — **pendiente de que el usuario la complete**;
   4. si no hay chat_id ni admin configurado, el nodo no envía (se registra el error en el execution log).
   El mensaje se arma en español: `⚠️ Ocurrió un error procesando tu solicitud. Volvé a intentar con /start.` (si hay chat_id de usuario) o con detalle técnico (`Workflow: <workflow> · Nodo: <lastNodeExecuted> · Exec: <executionId>`) si va al admin.
3. **Telegram — «Enviar aviso de error»** (`n8n-nodes-base.telegram`, `sendMessage`, credencial `Telegram account` reutilizada). `chatId` = salida del Code; `text` = mensaje armado.

**Alternativa mínima (si el usuario la prefiere):** solo Capa 1 (retries) y documentar «el usuario no recibe aviso» como limitación aceptada. La Capa 2 queda separable en tasks y se puede omitir.

**D4a — Extracción de chat_id (open decision).** El payload del Error Trigger no garantiza el chat del usuario en n8n moderno. La cadena de fallbacks anterior cubre el caso legacy y el caso «sin datos» (admin). **Queda como decisión de usuario** qué valor poner en `DEFAULT_ADMIN_CHAT_ID` (chat id numérico del admin) y si se acepta que, sin chat_id del usuario, el aviso vaya solo al admin.

### D5 — Decisión de usuario: los dos POST no idempotentes

| Nodo | Opción A (recomendada) | Opción B |
|---|---|---|
| HTTP Request1 (`telegram_link_codes` insert) | retry `maxTries: 2` + riesgo de fila duplicada **documentado** (fila huérfana inocua; el código devuelto por la segunda respuesta es el que se muestra) | sin retry: si el insert falla, el flujo de vinculación muere sin aviso |
| HTTP - Crear post Postiz | **sin retry**: si falla, la Capa 2 avisa y el usuario reintenta `/start` | retry `maxTries: 2` + riesgo de **post duplicado visible** en redes — **no recomendado** |

### D6 — Verificación offline sin stack

Script `tests/error-handling/verify-retries.js` (patrón de `tests/redis-expiration/verify-ttl.js`, sin stack ni contenedores) que:

- (a) audita `codigo.json` estáticamente: todo nodo de la lista de reintentados tiene `retryOnFail: true` + `maxTries` + `waitBetweenTries`; todo nodo excluido **no** los tiene; los 3 nodos con `alwaysOutputData` los conservan;
- (b) verifica integridad: `JSON.parse` sin error, recuento de nodos = **116**, bloque `connections` coherente;
- (c) si se incluye la Capa 2, valida `error-workflow.json`: parsea, contiene `errorTrigger`, el Code de extracción y un nodo Telegram `sendMessage`.

## Risks and Trade-offs

- **Duplicados en POST no idempotentes** (HTTP Request1 si D5-A; Postiz si el usuario elige retry) → mitigación: riesgo acotado y documentado; se recomienda la opción segura por nodo (D5).
- **Doble mensaje si se reintenta un nodo Telegram SEND** → se excluyen los 28 nodos SEND/edit de forma deliberada; el usuario puede optar por reintentarlos (no recomendado).
- **Coste de reintentos en Gemini**: si el primer intento alcanzó a facturar y el retry re-ejecuta, hay un coste API extra → aceptado; el retry reduce el abandono del usuario (objetivo del cambio).
- **El Error Trigger avisa sobre TODOS los workflows del espacio n8n**, no solo el principal → el workflow nuevo es genérico y el mensaje incluye el nombre del workflow; si el usuario quiere acotarlo, n8n no permite filtrar por workflow en el Error Trigger (limitación documentada).
- **El chat_id del usuario no está garantizado en el payload de error (n8n moderno)** → cadena de fallbacks con `DEFAULT_ADMIN_CHAT_ID`; si no se configura el admin y no hay chat_id, no se envía nada (solo queda en el log de ejecución).
- **Retry en subnodos de LangChain** puede no ser eficaz en todas las versiones de n8n → se configura el retry en el nodo del agente `AI Agent1` (vía soportada) y se documenta.
- **Redis6 (`push` a `fotos_`)**: retry puede duplicar un `file_id` en la lista → impacto nulo (el loop procesa la foto dos veces como máximo).
- **Sin verificación live en este entorno** → los cambios se validan offline; la verificación funcional queda como pending-manual.

## Migration

1. Aplicar en `codigo.json`: agregar `retryOnFail`/`maxTries`/`waitBetweenTries` a `parameters` de los nodos de D2 (por grupos: Supabase → Postiz upload → Gemini/agente → descargas Telegram → Redis).
2. (si Capa 2) Crear `error-workflow.json` con Error Trigger + Code + Telegram sendMessage.
3. Verificación offline: `node tests/error-handling/verify-retries.js`.
4. (pending-manual) Importar `error-workflow.json` en n8n; en Settings → Error Workflow, seleccionar el workflow de error.
5. (pending-manual) Probar fallo real (bajar un servicio o forzar un error) y confirmar que el usuario recibe el aviso.
6. Actualizar `HALLAZGOS-DEL-FLUJO-n8n.md` §3.5 (estado de remediación).

## Open Questions

- ¿`waitBetweenTries` único de 1000 ms, o 3000 ms en los nodos Gemini? (propuesto: 1000 ms global)
- ¿HTTP Request1 (`telegram_link_codes`) con retry `maxTries: 2` (D5-A recomendada) o sin retry?
- ¿HTTP - Crear post Postiz sin retry (recomendado) o con retry y riesgo de duplicado?
- ¿Se incluye la Capa 2 (workflow de error) o solo la Capa 1?
- ¿Cuál es el `DEFAULT_ADMIN_CHAT_ID` a configurar en el nodo Code del error workflow (si se incluye la Capa 2)?
- ¿Se reintenta `AI Agent1` completo (configuración en el nodo agente) o se deja el retry a los nodos Gemini sueltos y se excluye el agente?
