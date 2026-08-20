# Design: bug-fixes

## Context

El workflow "Aura" de n8n (export en `codigo.json`, 116 nodos) es un bot de Telegram que ingesta catálogos de productos, los procesa con Gemini y persiste en Supabase. El análisis `HALLAZGOS-DEL-FLUJO-n8n.md` documentó tres bugs. Este diseño fue precedido por una **auditoría real sobre `codigo.json`** (verificado con Node) que corrige dos suposiciones del informe:

1. **Bug 1 — RNG inseguro [§2.8]**: el nodo `Code - Generar código` (id `48bb4ea3-0a55-4fdd-9890-12c6c74112de`, pos `[9408, 92672]`) genera el código de 6 dígitos con:
   ```
   const code = Math.floor(100000 + Math.random() * 900000).toString();
   const chatId = $('Code in JavaScript7').first().json.id_chat.toString();
   return [{ json: { code, chat_id: chatId } }];
   ```
   Es un código de un solo uso que habilita la vinculación de una cuenta: `Math.random()` no es criptográficamente seguro.

2. **Bug 2 — Nodo `HTTP Request` con literal `{chat_id}` [§3.6]**: el nodo (id `ed044423-acee-4271-9ad8-ab41171e9140`, pos `[9296, 99808]`) tiene URL `=https://legffrhakunfignlaftl.supabase.co/rest/v1/profiles?telegram_chat_id=eq.{chat_id}&select=id` — `{chat_id}` es literal, no una expresión de n8n (le faltan las llaves dobles). **Resultado de la auditoría (revisa la suposición de "huérfano" del informe):**
   - **NO es huérfano de conexiones**: tiene arista de entrada (`Code in JavaScript` → `HTTP Request`) y de salida (`HTTP Request` → `Redis1`).
   - **Sí es funcionalmente muerto**: (a) la URL con el literal nunca matchea un perfil real; (b) **0 referencias** a `$('HTTP Request')` en cualquier nodo (verificado por serialización completa); (c) su único consumidor `Redis1` **no usa su output** — `Redis1` lee `user_id` de `$('HTTP - Chequear vinculacion').item.json.id` (el nodo bueno) y usa `$json` para `product_data`, recibiendo el resultado de la query de profiles en lugar de los items de productos.
   - La cadena `Code in JavaScript → HTTP Request → Redis1` está **rota silenciosamente**: `HTTP Request` no devuelve filas (o devuelve `[]`), por lo que `Redis1` hoy es un no-op.

3. **Bug 3 — Nombres engañosos `Redis1`/`Redis10`/`Redis21` [§3.2]**: los tres son nodos `n8n-nodes-base.httpRequest` (POST `https://<proyecto>.supabase.co/rest/v1/products?on_conflict=user_id` con header `Prefer: resolution=merge-duplicates` y credencial "Supabase Service Role"), no nodos Redis. **Auditoría de referencias:** 0 referencias de expresiones (`$('Redis1')` / `$('Redis10')` / `$('Redis21')` = 0 en todos los nodos); 7 ocurrencias exactas totales (3 campos `name` + 4 entradas del bloque `connections`):
   - `Redis1`: 2 ocurrencias — campo `name` + `node` en el bloque `connections` de `HTTP Request`.
   - `Redis10`: 2 ocurrencias — campo `name` + `node` en el bloque `connections` de `Code in JavaScript1`.
   - `Redis21`: 3 ocurrencias — campo `name` + clave fuente `"Redis21": {...}` en `connections` + `node` en el bloque de `Code in JavaScript6`.

   **Scope extension aprobada por el usuario — `Redis` y `Redis2` (los de lectura) también se renombran:** ambos son `n8n-nodes-base.httpRequest` (GET `https://<proyecto>.supabase.co/rest/v1/products?user_id=eq.{{ $('HTTP - Chequear vinculacion').item.json.id }}&select=product_data`, credencial "Supabase Service Role"), lecturas del catálogo `product_data` con el mismo problema de naming. **Auditoría adicional:** `Redis` = 3 ocurrencias (campo `name` + clave fuente `"Redis": {...}` en `connections` + `node` en `connections["Send a text message6"]`) + **1 referencia de expresión** `$('Redis')` en el prompt de `Edit an image`; `Redis2` = 5 ocurrencias (campo `name` + clave fuente `"Redis2": {...}` en `connections` + `node` en `connections["Send a text message4"]`, `connections["Switch"]` y `connections["Redis28"]`) + **1 referencia de expresión** `$('Redis2')` en el prompt de `Generate an image`. Estas dos referencias de expresión hacen que el rename de los nodos de lectura **no sea tan trivial** como el de los 3 de upsert: hay que actualizar también los prompts de Gemini.

**Contexto de runtime n8n (verificado en docs/source de n8n):** el Code node de n8n ejecuta en un sandbox que **deshabilita los imports de módulos builtin por defecto** (`NODE_FUNCTION_ALLOW_BUILTIN` vacío → `require('crypto')` falla). El contenedor `n8nio/n8n:latest` de `docker-compose.yml` no define esa variable hoy.

## Goals / Non-Goals

**Goals:**
- Generar el código de vinculación con un RNG criptográficamente seguro (`crypto.randomInt`), con verificación offline (sin stack vivo).
- Eliminar el nodo `HTTP Request` muerto y dejar la rama de upsert de productos coherente (mismo patrón que sus hermanas).
- Renombrar los **5 nodos HTTP con nombres engañosos** (`Redis1`/`Redis10`/`Redis21` + los de lectura `Redis`/`Redis2` — scope extension aprobada) a nombres descriptivos consistentes con la convención `HTTP - ...`, sin romper referencias ni conexiones.
- Dejar `codigo.json` íntegro: parsea, recuento de nodos correcto (115), conexiones coherentes, cero referencias viejas, cero `Math.random`.

**Non-Goals:**
- No tocar la cadena ClamAV del cambio `pdf-virus-scan` ni la migración de credenciales de `secrets-migration`.
- No renombrar los nodos Redis reales (`n8n-nodes-base.redis`: `Redis3`…`Redis36`).
- No resolver la discrepancia `telegram_link_codes` vs `telegram_link_tokens` (§2.8), la expiración Redis (§3.1) ni el manejo de fallos (§3.5).
- No cambiar el patrón existente `user_id: $('HTTP - Chequear vinculacion').item.json.id` en los nodos de upsert (riesgo compartido preexistente de las ramas activas).
- No implementar en el editor n8n: la fuente de verdad es `codigo.json`; el re-import y la verificación funcional quedan como tareas pending-manual.

## Decisions

### D1. Bug 1 — `require('crypto')` + `randomInt` + habilitar el módulo en docker-compose

**Decisión:** usar `const { randomInt } = require('crypto')` y `randomInt(100000, 1000000)` en el Code node, y agregar la variable de entorno `NODE_FUNCTION_ALLOW_BUILTIN=crypto` al servicio `n8n` de `docker-compose.yml`.

**Racional:**
- El patrón `const { randomInt } = require('crypto')` es el estándar de Node para RNG seguro y es el recomendado por la documentación de n8n para el Code node.
- n8n **deshabilita los imports de módulos builtin por defecto** (`NODE_FUNCTION_ALLOW_BUILTIN` sin setear = lista vacía; confirmado en el source `packages/nodes-base/nodes/Code/JavaScriptSandbox.ts`: `builtin: builtIn?.split(',') ?? []`). Sin el env var, `require('crypto')` lanza un error de permisos del sandbox. La variable aplica tanto al sandbox in-process (vm2) como a los task runners (si estuvieran configurados).
- Privilegio mínimo: `crypto` (no `*`), para no ampliar la superficie del Code node.
- El jsCode resultante preserva exactamente la lógica restante (extracción de `id_chat` de `Code in JavaScript7` y salida `[{ json: { code, chat_id: chatId } }]`):

  ```js
  const { randomInt } = require('crypto');
  const code = randomInt(100000, 1000000).toString();
  const chatId = $('Code in JavaScript7').first().json.id_chat.toString();
  return [{ json: { code, chat_id: chatId } }];
  ```

**Alternativa considerada (descartada):** usar el global `crypto` de WebCrypto (Node 18+) con `crypto.getRandomValues()`. Motivos del descarte: (a) WebCrypto no expone `randomInt` — habría que derivar el entero con `%` (bias de módulo) y (b) la disponibilidad del global `crypto` dentro del sandbox del Code node no está garantizada en todas las configuraciones de n8n; el approach con `require` + env var es determinístico y verificable offline con Node.

**Requisito de despliegue:** recrear el contenedor n8n (`docker compose up -d n8n`) para que tome el env var — tarea pending-manual.

### D2. Bug 2 — Eliminar `HTTP Request` y reconectar `Code in JavaScript → HTTP - Upsert producto informacion`

**Decisión:** **eliminar** el nodo `HTTP Request` (array `nodes` + bloque `connections`) y **reconectar** `Code in JavaScript` directamente al upsert de productos (ex `Redis1`, renombrado en Bug 3 a `HTTP - Upsert producto informacion`).

**Evidencia (auditoría sobre `codigo.json`):**
- Aristas reales: `Code in JavaScript → HTTP Request` y `HTTP Request → Redis1`; cero referencias `$('HTTP Request')`; `Redis1` no consume el output de `HTTP Request` para `user_id` (usa `$('HTTP - Chequear vinculacion')`).
- La rama hermana `Code in JavaScript6 → Redis21` es el patrón correcto: el nodo Code parsea el JSON de Gemini en items y los alimenta directo al POST `/products` con `product_data: $json`. Reconectar `Code in JavaScript → HTTP - Upsert producto informacion` espeja exactamente ese patrón (ambos upserts usan `product_data: $json`).

**Por qué no "arreglar la expresión" (alternativa descartada):** corregir la URL a `={{ $('Code in JavaScript7').item.json.id_chat }}` **no repara la cadena** — `HTTP Request` pasaría el resultado de la query de profiles (`[{id}]`) como `$json` a `Redis1`, que entonces haría upsert de `product_data: {id: ...}` (perfil, no producto). El nodo es redundante por diseño: la resolución del perfil ya la hace `HTTP - Chequear vinculacion`, y `user_id` ya se lee de ahí. FIX = cambia el modo de falla, no lo corrige.

**Efecto del cambio:** la rama pasa de **no-op silencioso** a **upsert activo** (el flujo de "información" vía `AI Agent1` persistirá productos como ya hacen las ramas PDF e imagen). Este es un cambio de comportamiento intencional; ver Open Questions para la confirmación y la alternativa conservadora (borrar sin reconectar).

**Ediciones exactas en `codigo.json`:**
1. `nodes[]`: eliminar el objeto con `"name": "HTTP Request"`.
2. `connections`: eliminar la clave `"HTTP Request"` (única salida → `HTTP - Upsert producto informacion`).
3. `connections["Code in JavaScript"].main[0]`: reemplazar la entrada `{"node": "HTTP Request", "type": "main", "index": 0}` por `{"node": "HTTP - Upsert producto informacion", "type": "main", "index": 0}` (queda junto a `Code in JavaScript2`).

**Resultado:** 115 nodos (116 − 1). Esta es una desviación deliberada del check "116 nodos" del brief (heredado de la convención de cambios previos que no eliminaban nodos); ver Open Questions.

### D3. Bug 3 — Renombres descriptivos con auditoría completa de referencias

**Decisión:** renombrar los **5** nodos HTTP con nombres engañosos a nombres descriptivos con la convención `HTTP - ...` del workflow, actualizando todas las ocurrencias exactas (campos `name`, claves/entradas de `connections` y referencias de expresión) y verificando cero referencias residuales.

| Nodo actual | Rama (verificada por aristas) | Nombre final |
|---|---|---|
| `Redis1` | `If2 → Code in JavaScript` (flujo "información"/agente Google Sheets) | `HTTP - Upsert producto informacion` |
| `Redis10` | `If3 → Code in JavaScript1` (rama PDF: `Analyze document` → ClamAV) | `HTTP - Upsert producto pdf` |
| `Redis21` | `Analyze an image → Code in JavaScript6` (rama imagen) | `HTTP - Upsert producto imagen` |
| `Redis` | `Send a text message6 →` lectura GET `/products?user_id=eq...&select=product_data` que alimenta `Redis30 → Get a file1 → Edit an image` (edición de publicidad, rama "información") | `HTTP - Leer producto informacion` |
| `Redis2` | `Send a text message4`/`Switch`/`Redis28 →` lectura GET `/products?user_id=eq...&select=product_data` que alimenta `Redis24 → Generate an image` (generación de imagen publicitaria, rama "imagenes") | `HTTP - Leer producto imagen` |

> **Nombres de los nodos de lectura (extensión aprobada, elegidos tras inspección):** `Redis` y `Redis2` tienen URL y parámetros idénticos (GET del mismo catálogo `product_data`); el nombre los distingue por la **rama consumidora** — `Redis` sirve la edición de la publicidad de "información" (`Edit an image` usa `$('HTTP - Leer producto informacion')`) y `Redis2` sirve la generación de imagen publicitaria (`Generate an image` usa `$('HTTP - Leer producto imagen')`). Se descartó `HTTP - Leer producto pdf` para `Redis2` porque la rama PDF nunca lee productos (solo upserta vía `HTTP - Upsert producto pdf`).

**Técnica de búsqueda/edición segura (crítica):** `Redis1` es **prefijo** de `Redis10` y `Redis2` es prefijo de `Redis21`, por lo que las búsquedas deben ser por string exacto con comillas: `"Redis1"`, `"Redis10"`, `"Redis21"`, `"Redis"`, `"Redis2"` (JSON) y `$('Redis1')`, `$('Redis10')`, `$('Redis21')`, `$('Redis')`, `$('Redis2')` (expresiones). No usar `Redis1` a secas (matchearía `Redis10`). Los nodos Redis reales (`Redis3`…`Redis36`, `n8n-nodes-base.redis`) **no se tocan**.

**Referencias a actualizar por nodo (total 17):**
- `Redis1` → 2 (campo `name` + `node` en `connections["HTTP Request"]` — que luego Bug 2 reemplaza por la reconexión desde `Code in JavaScript`).
- `Redis10` → 2 (campo `name` + `node` en `connections["Code in JavaScript1"]`).
- `Redis21` → 3 (campo `name` + clave fuente en `connections` + `node` en `connections["Code in JavaScript6"]`).
- `Redis` → 4 (campo `name` + clave fuente en `connections` + `node` en `connections["Send a text message6"]` + expresión `$('Redis')` en el prompt de `Edit an image`).
- `Redis2` → 6 (campo `name` + clave fuente en `connections` + `node` en `connections["Send a text message4"]`/`connections["Switch"]`/`connections["Redis28"]` + expresión `$('Redis2')` en el prompt de `Generate an image`).

**Orden entre bugs (dependencia):** Bug 3 (renombres) se ejecuta **antes** de Bug 2 (eliminación + reconexión) para que la reconexión referencie el nombre final (`HTTP - Upsert producto informacion`) y ninguna edición toque dos veces la misma entrada.

### D4. Verificación offline (no requiere stack vivo)

- Test `tests/rng/test-link-code.js` (patrón `tests/eicar/`): ejecuta el algoritmo con `require('crypto')` y verifica que cada valor es entero en `[100000, 999999]`, que `String(x).length === 6`, y que en N=200 llamadas hay al menos 2 valores distintos (variabilidad).
- Verificación de integridad sobre `codigo.json` con PowerShell/Node: `ConvertFrom-Json` parsea; 115 nodos; bloque `connections` coherente (toda arista apunta a nodos existentes; solo los cambios previstos: eliminación de `HTTP Request` y reconexión en `Code in JavaScript`); cero `"Redis1"`/`"Redis10"`/`"Redis21"` y cero `$('Redis1')`/`$('Redis10')`/`$('Redis21')`; cero `Math.random`; `pinData` vacío; cadena ClamAV y credenciales intactas (no regresión).

## Risks / Trade-offs

| Riesgo | Mitigación |
|---|---|
| `require('crypto')` falla si el env var no se aplica (Code node deshabilita módulos por defecto) | El cambio agrega `NODE_FUNCTION_ALLOW_BUILTIN=crypto` (mínimo privilegio) y lo marca como prerrequisito del pending-manual; la task offline verifica el algoritmo con Node local (que siempre expone `crypto`), y la task 1.5 verifica el nodo en la UI tras el re-import. |
| Bug 2 activa la rama de upsert de "información" (hoy no-op silencioso) — cambio de comportamiento | Decisión explícita en D2, aprobada por el usuario (opción (a): eliminar + reconectar). La rama espeja el patrón probado de `Redis21`; el `user_id` usa el mismo `$('HTTP - Chequear vinculacion')` que las ramas activas. |
| Rename rompe referencias por prefijos (`Redis1` ⊂ `Redis10`, `Redis2` ⊂ `Redis21`) | Búsqueda exacta con comillas + verificación final de cero referencias residuales (task 2.7/4.3). Auditado: 2 referencias de expresiones totales (`$('Redis')` y `$('Redis2')`), 17 ocurrencias exactas totales, todas actualizadas. |
| Rename de los nodos de lectura rompe los prompts de Gemini (`$('Redis')`, `$('Redis2')`) | Auditado y actualizado: las expresiones en `Edit an image` y `Generate an image` se renombraron junto con los nodos (task 2.5/2.6). |
| Nodos ClamAV / credenciales tocados por error | Non-goals explícitos + verificación de no regresión (task 4.5). |
| Re-export del editor n8n desincroniza `codigo.json` | Tasks pending-manual: re-importar, verificar y re-exportar al final (convención de los cambios previos). |

## Migration Plan

**Deploy:**
1. Editar `codigo.json` en el orden: Bug 1 (jsCode) → Bug 3 (renombres) → Bug 2 (eliminación + reconexión).
2. Editar `docker-compose.yml`: `NODE_FUNCTION_ALLOW_BUILTIN=crypto` en el servicio `n8n`.
3. Crear y correr `tests/rng/test-link-code.js` (offline, sin stack).
4. Correr la verificación de integridad del grupo 4 (Parseo, recuento 115, conexiones, cero referencias, cero `Math.random`).
5. pending-manual: `docker compose up -d n8n`, re-importar `codigo.json` en la UI, verificar el flujo de vinculación y las tres ramas de upsert, re-exportar para sincronizar.

**Rollback:**
- `codigo.json` se restaura desde git (o re-export previo); `docker-compose.yml` se revierte quitando el env var.
- El único efecto del rollback es volver al estado actual (RNG no seguro, nodo muerto presente, nombres viejos) — sin impacto funcional adicional.

## Open Questions (resueltas en implementación)

- **Bug 2 — ¿Eliminar Y reconectar, o solo eliminar?** **RESUELTO:** el usuario aprobó la opción (a) — eliminar + reconectar (`Code in JavaScript → HTTP - Upsert producto informacion`), repara la rama de "información" (hoy no-op silencioso). La alternativa conservadora queda descartada y documentada.
- **Bug 2 — Recuento de nodos:** **RESUELTO:** con la eliminación el recuento pasa a **115**; la verificación final (task 4.2) confirma 115 nodos y documenta la desviación del "116" del brief.
- **Bug 3 — ¿Renombrar también `Redis` y `Redis2`?** **RESUELTO:** el usuario aprobó la extensión de scope; `Redis` → `HTTP - Leer producto informacion` y `Redis2` → `HTTP - Leer producto imagen` (nombres finales elegidos tras inspección de ramas en D3).
