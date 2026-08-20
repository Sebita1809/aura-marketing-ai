## Context

El flujo de vinculación de Telegram tiene dos caminos desconectados:

- **Path real (funciona hoy):** el bot genera un código de 6 dígitos (`Code - Generar código`, `crypto.randomInt`) y lo inserta en `public.telegram_link_codes` (`HTTP Request1`, POST `/rest/v1/telegram_link_codes` con `{ chat_id, code }`). La web llama a `supabase.rpc('link_telegram_with_code', { p_code })` y espera `{ success, chat_id, error }` (`aura-frontend/src/pages/ConnectionsPage.jsx:371-395`). Ambos objetos (tabla y RPC) existen solo en la DB live, creados a mano; **no están en ninguna migración del repo** (`HALLAZGOS-DEL-FLUJO-n8n.md` §2.8, N.3).
- **Path muerto:** `IF - Vinculacion Telegram` (condición `message.text startsWith "/start "`) está **desconectado** — no figura en el bloque `connections` de `codigo.json` (verificado: 0 aristas de entrada y salida). El camino `/start <código>` no valida nada.

Esquema live de `telegram_link_codes` (provisto por el usuario): `id uuid PK`, `chat_id text`, `code bpchar UNIQUE`, `expires_at timestamptz NOT NULL`, `used_at timestamptz NULL`, `created_at timestamptz`. Sin FK. `telegram_link_tokens` (migración `20260630000002`) es otra tabla legacy **no usada por ningún código**.

Restricciones del estado actual (`codigo.json`, 116 nodos): el flujo principal es `Telegram Trigger → Code in JavaScript7 (id_chat/id_mensaje) → HTTP - Chequear vinculacion → Code in JavaScript9 (linked?) → IF - Ya vinculado → [out0 linked: Redis27 | out1: Code - Generar código → HTTP Request1 → Telegram - Token invalido1 → Redis13]`. Cambios previos que NO se deben regresionar: credenciales `httpHeaderAuth` ("Supabase Service Role"/"Postiz API Key"), retries por política (`HTTP Request1` sin retry, D5), TTL Redis, cadena ClamAV, nodos renombrados.

## Goals / Non-Goals

**Goals:**
- Materializar el camino real en una migración idempotente (`CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` + `CREATE OR REPLACE FUNCTION` + `GRANT`) que corra igual en la DB live (tabla ya existe) y en DBs nuevas.
- Implementar el contrato exacto del RPC que el frontend ya consume: `{ success, chat_id, error }`.
- Reconectar `IF - Vinculacion Telegram` y agregar la validación `/start <código>` en el bot (116 → 120 nodos) **sin tocar el resto del grafo**.
- Dejar el flujo verificable offline desde la fuente (test estático).

**Non-Goals:**
- No tocar `telegram_link_tokens` (legacy no usado; limpieza futura documentada, fuera de scope).
- No tocar el frontend web (`ConnectionsPage.jsx` ya llama al RPC — sin edición).
- No modificar la generación de código (`Code - Generar código` / `HTTP Request1` INSERT) — ya funciona con el DEFAULT de `expires_at`.
- No dropear el RPC si existe live — `CREATE OR REPLACE` lo alinea al repo.

## Decisions

### D1 — Columna `code`: `text` con `CHECK` (no `bpchar`)

La tabla live usa `bpchar`. Para la migración se elige **`text NOT NULL UNIQUE CHECK (char_length(code) = 6)`**.

- El RPC compara `WHERE code = p_code` (ambos `text`): sin cast implícito ni semántica de padding de `bpchar`.
- PostgREST filtra `code=eq.<código>` (uso del nuevo nodo n8n): caso estándar para `text`.
- El frontend valida `telegramCode.length !== 6` y el nodo genera exactamente 6 dígitos (`crypto.randomInt(100000, 1000000)`): el `CHECK` replica esa invariante en la DB.
- `bpchar(6)` **nunca** agrega padding con valores de exactamente 6 chars, pero sus comparaciones (`bpchar = text`) requieren casts cuya semántica depende de espacios a la derecha: sutileza sin beneficio.
- **Drift conocido (documentado, no bloqueante):** en la DB live la columna sigue siendo `bpchar` (la migración no altera columnas existentes; `ALTER` sería riesgoso y está fuera de scope). Ambos tipos se comportan idéntico para códigos de 6 dígitos exactos. Limpieza futura opcional: `ALTER ... ALTER COLUMN code TYPE text`.
- *Alternativa considerada:* `bpchar(6)` para espejar la DB live → rechazada por las semánticas de comparación.

### D2 — RLS en `telegram_link_codes`: ENABLE, sin políticas

`ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY` **sin políticas** y **sin** `FORCE ROW LEVEL SECURITY`.

- Únicos consumidores de la tabla: (a) n8n con `service_role` (bypasea RLS siempre); (b) el RPC `link_telegram_with_code` que es `SECURITY DEFINER` (el owner bypasea RLS salvo `FORCE`). El frontend **nunca** lee la tabla directamente — solo llama al RPC (verificado en `ConnectionsPage.jsx`).
- Cero políticas = `anon`/`authenticated` jamás leen códigos en bruto → default más seguro.
- Idempotente: re-habilitar RLS es un no-op, tanto en la DB live como en DBs nuevas → reproducible.
- *Alternativa considerada:* dejar RLS deshabilitado → rechazada (peor postura de seguridad, no reproducible).

### D3 — Dónde insertar `IF - Vinculacion Telegram` en el grafo (aristas exactas)

Grafos actuales (bloque `connections` verificado):

```
Code in JavaScript7 --main[0]--> HTTP - Chequear vinculacion   ← única arista que cambia de destino
```

Después del cambio (se modifica 1 arista existente, se agregan 4 nodos y 6 aristas):

| Nodo origen | Output | Nodo destino |
|---|---|---|
| `Code in JavaScript7` | main[0] | `IF - Vinculacion Telegram` |
| `IF - Vinculacion Telegram` | main[0] **(TRUE = /start)** | `HTTP - Validar codigo` |
| `IF - Vinculacion Telegram` | main[1] **(FALSE = normal)** | `HTTP - Chequear vinculacion` |
| `HTTP - Validar codigo` | main[0] | `IF - Codigo valido` |
| `IF - Codigo valido` | main[0] **(TRUE = válido)** | `Telegram - Codigo valido` |
| `IF - Codigo valido` | main[1] **(FALSE = inválido)** | `Telegram - Codigo invalido` |
| `Telegram - Codigo valido` | — | *termina (sin aristas salientes)* |
| `Telegram - Codigo invalido` | — | *termina (sin aristas salientes)* |

- Semántica de salidas del nodo IF en n8n: **output 0 = TRUE, output 1 = FALSE** (consistente con `IF - Ya vinculado`: out0 → `Redis27` con `linked=true`, out1 → `Code - Generar código`).
- `HTTP - Chequear vinculacion` **no cambia sus parámetros**: su URL referencia `$('Code in JavaScript7').item.json.id_chat`, que sigue siendo un nodo upstream de la ejecución.
- El resto del subgrafo (`HTTP - Chequear vinculacion → Code in JavaScript9 → IF - Ya vinculado → ...`) queda intacto.

### D4 — Expresión de extracción del código `/start`

El nodo `IF - Vinculacion Telegram` recibe como input el output de `Code in JavaScript7` (`{ id_chat, id_mensaje }`, **sin** `message`). Por lo tanto **no** se puede usar `$('IF - Vinculacion Telegram').item.json.message.text` — el json del item no lo contiene.

Se usa la referencia directa al trigger, que es el mismo patrón que ya usa la condición del propio IF:

```
Condición (ya presente, intacta): {{ $('Telegram Trigger').first().json.message?.text ?? '' }}
Extracción del código (nueva):    {{ $('Telegram Trigger').first().json.message.text.split(' ')[1] }}
```

- Trigger real: `n8n-nodes-base.telegramTrigger` (verificado en `codigo.json`, línea 2806) → `message.text` es la estructura estándar de Telegram.
- `/start 123456` → `split(' ')[1]` = `"123456"`.
- Caso borde: `/start` sin código → `split(' ')[1]` = `undefined` → el filtro `code=eq.undefined` no matchea nada → rama inválida. Comportamiento aceptable (no crashea).
- *Alternativa considerada:* parsear `$json.message.text` en el item corriente → inválida porque el json corriente proviene de `Code in JavaScript7`.

### D5 — Nodos nuevos y conteo

4 nodos nuevos (116 → **120**, verificado: recuento actual 116):

1. **`HTTP - Validar codigo`** (`n8n-nodes-base.httpRequest` v4.4):
   `url =https://legffrhakunfignlaftl.supabase.co/rest/v1/telegram_link_codes?select=id&code=eq.{{ $('Telegram Trigger').first().json.message.text.split(' ')[1] }}&used_at=is.null&expires_at=gt.{{ $now.toISO() }}`, `authentication: genericCredentialType` + `genericAuthType: httpHeaderAuth`, `sendHeaders: false`, credencial "Supabase Service Role", `retryOnFail: true`, `maxTries: 3`, `waitBetweenTries: 1000` (GET idempotente → política de lecturas), `position: [9040, 102560]`.
2. **`IF - Codigo valido`** (`n8n-nodes-base.if` v2.3): condición `={{ $json.length > 0 }}` (respuesta array con items → válido), formato `conditions`/`operator boolean "true"` idéntico a `IF - Ya vinculado`, `position: [9360, 102560]`. Sin retry (los IF no llevan retry por política).
3. **`Telegram - Codigo valido`** (`n8n-nodes-base.telegram` v1.2): `chatId ={{ $('Code in JavaScript7').item.json.id_chat }}`, `text "=✅ Código válido. Completá la vinculación desde la web."`, credencial `telegramApi` "Telegram account", `webhookId` para respetar el formato de export, `position: [9680, 101216]`. **Sin retry** (sends Telegram excluidos por política).
4. **`Telegram - Codigo invalido`**: igual pero `text "=❌ Código inválido o expirado."`, `position: [9680, 102560]`. **Sin retry**.

### D6 — El bot valida, la web vincula

El bot **valida** la existencia/vigencia del código (GET con `used_at=is.null&expires_at=gt.<now>`) y responde en Telegram. El **vínculo final lo aplica la web** vía `link_telegram_with_code`: el bot (que corre con `service_role`) no puede conocer `auth.uid()` del usuario web — es imposible que asocie el código al perfil correcto. La rama `/start` termina en los mensajes de Telegram; la autorización del vínculo queda en el RPC autenticado. Esto preserva el diseño actual (la web ya consume el RPC).

### D7 — Idempotencia de la migración y drift con la DB live

Todos los objetos usan sintaxis idempotente:
- `CREATE TABLE IF NOT EXISTS` — no-op en la DB live (no altera el esquema existente, incl. `bpchar` de `code`, D1); crea todo en DBs nuevas.
- `CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_expires` sobre `expires_at`.
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` — no-op si ya está habilitada.
- `CREATE OR REPLACE FUNCTION link_telegram_with_code(text)` — alinea el RPC existente al repo (si live ya lo tiene a mano, lo sobreescribe con la versión versionada).
- `GRANT EXECUTE ... TO authenticated` — no-op si ya existe.

### D8 — `expires_at` DEFAULT (prerrequisito del INSERT n8n)

`expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes')`. Es **obligatorio**: `HTTP Request1` POSTea solo `{ chat_id, code }` (verificado en `codigo.json`); sin el DEFAULT el insert fallaría por `NOT NULL`. El flujo actual funciona en live justamente porque la tabla live tiene ese DEFAULT — la migración lo materializa para DBs nuevas. El mensaje al usuario dice "Válido 15 minutos" (coherente).

### D9 — Tipo de `profiles.telegram_chat_id` (asumido `text`)

El RPC ejecuta `UPDATE profiles SET telegram_chat_id = found.chat_id` donde `found.chat_id` es `text` (columna `chat_id text` de `telegram_link_codes`). Se asume `profiles.telegram_chat_id` `text`: el frontend guarda `chat_id` como string y n8n consulta `profiles?telegram_chat_id=eq.<id_chat>` (funciona con `text`). **Verificación pending-manual:** si en live es numérico, agregar cast `found.chat_id::bigint` en el UPDATE (1 línea). La migración versionada asume `text` y se documenta la condición.

### D10 — Política de retry en nodos nuevos

- `HTTP - Validar codigo`: **con retry** `maxTries: 3`, `waitBetweenTries: 1000` (GET idempotente; grupo "lecturas Supabase").
- `IF - Codigo valido`: sin retry (los IF no llevan retry en la política existente).
- `Telegram - Codigo valido` / `Telegram - Codigo invalido`: **sin retry** (los 28+2 sends Telegram están excluidos).
- `HTTP Request1` (existente) conserva **sin retry** (D5 de error-handling: insert no idempotente) — no se toca.

## Risks / Trade-offs

- [Drift `code`: `bpchar` (live) vs `text` (fresh)] → Ambos idénticos para códigos de 6 dígitos; documentado en D1; limpieza futura con `ALTER` opcional.
- [Habilitar RLS rompe un consumidor directo desconocido] → No existe consumidor directo (web solo usa el RPC, n8n `service_role`); el RPC `SECURITY DEFINER` bypasea RLS; se audita en el test offline y en el pending-manual.
- [Re-import/re-export de n8n reformatea `codigo.json`] → Patrón ya usado en cambios previos: edición manual + re-import + re-export + re-correr el verificador (pending-manual).
- [`/start` sin código produce filtro `eq.undefined`] → No matchea → mensaje inválido; sin crash.
- [`profiles.telegram_chat_id` numérico en live] → Cast de 1 línea en pending-manual (D9); verificación en la migración.
- [`auth.uid()` NULL bajo `service_role`] → Documentado en el RPC (return temprano); el RPC es solo para usuarios web autenticados.
- [Expresión `$now.toISO()` en la URL del nodo n8n] → `$now` es un `DateTime` de Luxon en n8n con `.toISO()`; patrón estándar; se verifica en el pending-manual funcional.
- [Nodos nuevos con ids placeholder] → Se generan UUIDs reales al editar `codigo.json`; el test no depende de ids.

## Migration Plan

1. **Crear** `aura-frontend/supabase/migrations/20260814000001_telegram_link_codes_reproducible.sql` con: tabla idempotente, índice, RLS, RPC, GRANT (secciones D1-D8).
2. **Editar** `codigo.json` (D3-D5): rewire `Code in JavaScript7` → `IF - Vinculacion Telegram`; agregar 4 nodos; agregar 6 aristas nuevas.
3. **Verificar offline**: `node tests/link-code/verify-link-flow.js` + actualizar y correr `verify-retries.js` y `verify-ttl.js` (recuento 116 → 120, listas).
4. **Deploy (pending-manual)**: aplicar la migración en Supabase (SQL Editor o `supabase db push`); re-importar `codigo.json`; prueba funcional `/start` (válido/inválido/expirado) y RPC web; re-exportar y re-correr verificadores.
5. **Rollback**: para el RPC — `DROP FUNCTION`; para RLS — `DISABLE ROW LEVEL SECURITY`; para el índice — `DROP INDEX`. La tabla **no** se dropea en live (tiene datos); en envs nuevos se puede dropar libremente.

## Open Questions

- **Tipo de `profiles.telegram_chat_id`** en la DB live (text vs numérico) — define si el RPC necesita cast (D9). Verificación pending-manual.
- **¿La tabla live ya tiene RLS habilitado?** — irrelevante para la idempotencia, pero se registra el estado en el pending-manual.
- **¿`link_telegram_with_code` ya existe live con otra firma/return?** — `CREATE OR REPLACE` la alinea; si live usara otro nombre de parámetro o tipo de retorno distinto, el pending-manual lo detecta.
