# Tasks: bug-fixes

> El workflow vive en n8n; `codigo.json` es un export. Implementar editando `codigo.json` con cuidado y sincronizar al final con un re-import/re-export (tasks pending-manual). Orden de edición: **Bug 1 (RNG) → Bug 3 (renombres) → Bug 2 (eliminación + reconexión)**, porque la reconexión del Bug 2 debe referenciar el nombre final del nodo renombrado en Bug 3 (`HTTP - Upsert producto informacion`).
>
> **Scope extension aprobada (Bug 3):** además de `Redis1`/`Redis10`/`Redis21`, se renombran los dos nodos de lectura con el mismo naming confuso: `Redis` → **`HTTP - Leer producto informacion`** y `Redis2` → **`HTTP - Leer producto imagen`** (nombres finales elegidos tras inspección de URLs y ramas; ver tasks 2.5/2.6). Total de referencias editadas: `Redis1` 2, `Redis10` 2, `Redis21` 3, `Redis` 3 (name + clave fuente + entrada en `connections["Send a text message6"]`) + 1 expresión `$('Redis')` en `Edit an image`, `Redis2` 5 (name + clave fuente + entradas en `connections["Send a text message4"]`/`connections["Switch"]`/`connections["Redis28"]`) + 1 expresión `$('Redis2')` en `Generate an image`.

## 1. Bug 1 — RNG criptográfico para el código de vinculación

> Verificado en docs/source de n8n: el Code node deshabilita los imports de módulos builtin por defecto (`NODE_FUNCTION_ALLOW_BUILTIN` vacío → `require('crypto')` falla). El env var es prerrequisito del `require`; aplica al sandbox in-process (vm2) y a task runners.

- [x] 1.1 Agregar la variable `NODE_FUNCTION_ALLOW_BUILTIN=crypto` al bloque `environment:` del servicio `n8n` en `docker-compose.yml` (privilegio mínimo: solo `crypto`, no `*`)
- [x] 1.2 En `codigo.json`, reemplazar el `jsCode` del nodo `Code - Generar código` (id `48bb4ea3-0a55-4fdd-9890-12c6c74112de`): cambiar `const code = Math.floor(100000 + Math.random() * 900000).toString();` por el patrón `const { randomInt } = require('crypto');` + `const code = randomInt(100000, 1000000).toString();`, **preservando** las líneas `const chatId = $('Code in JavaScript7').first().json.id_chat.toString();` y `return [{ json: { code, chat_id: chatId } }];`
- [x] 1.3 Crear `tests/rng/test-link-code.js` (patrón de `tests/eicar/`, sin stack ni contenedores): ejecuta el mismo algoritmo (`require('crypto')` + `randomInt(100000, 1000000)`) y verifica: (a) entero en `[100000, 999999]`, (b) `String(x).length === 6`, (c) en N=200 llamadas hay al menos 2 valores distintos
- [x] 1.4 Correr `node tests/rng/test-link-code.js` y confirmar salida sin fallos
- [ ] 1.5 pending-manual: recrear el contenedor n8n (`docker compose up -d n8n` para aplicar el env var), re-importar `codigo.json` y verificar en la UI que el nodo `Code - Generar código` ejecuta sin error de sandbox (el flujo real de `/start <código>` llega a `HTTP Request1` con un código de 6 dígitos)

## 2. Bug 3 — Renombres descriptivos (5 nodos: los 3 de upsert + los 2 de lectura)

> Auditoría previa (evidencia, ya realizada): 0 referencias de expresiones para los 3 de upsert (`$('Redis1')`/`$('Redis10')`/`$('Redis21')` = 0) y 1 expresión por nodo de lectura (`$('Redis')` en `Edit an image`, `$('Redis2')` en `Generate an image`). Ocurrencias exactas totales — `Redis1`: 2 (name + `node` en `connections["HTTP Request"]`), `Redis10`: 2 (name + `node` en `connections["Code in JavaScript1"]`), `Redis21`: 3 (name + clave fuente en `connections` + `node` en `connections["Code in JavaScript6"]`), `Redis`: 3 (name + clave fuente en `connections` + `node` en `connections["Send a text message6"]`) + 1 expresión, `Redis2`: 5 (name + clave fuente en `connections` + `node` en `connections["Send a text message4"]`/`connections["Switch"]`/`connections["Redis28"]`) + 1 expresión. **Ojo con prefijos:** buscar siempre por string exacto con comillas (`"Redis1"` no debe matchear `"Redis10"`; `"Redis2"` no debe tocar `"Redis21"`). Los nodos Redis reales (`n8n-nodes-base.redis`: `Redis3`, `Redis4`… `Redis36`) **no se tocan**.

- [x] 2.1 Registrar la auditoría de referencias como evidencia (ver nota de grupo arriba) y confirmar por búsqueda exacta que existen exactamente 2/2/3/3/5 ocurrencias y 1/1 referencias de expresión para `Redis1`/`Redis10`/`Redis21`/`Redis`/`Redis2` antes de editar
- [x] 2.2 Renombrar `Redis1` → `HTTP - Upsert producto informacion`: actualizar el campo `"name"` del nodo y la entrada `"node"` en `connections["HTTP Request"]` (luego Bug 2 la reemplaza por la reconexión desde `Code in JavaScript`)
- [x] 2.3 Renombrar `Redis10` → `HTTP - Upsert producto pdf`: actualizar el campo `"name"` del nodo y la entrada `"node"` en `connections["Code in JavaScript1"]`
- [x] 2.4 Renombrar `Redis21` → `HTTP - Upsert producto imagen`: actualizar el campo `"name"` del nodo, la clave fuente `"Redis21": {...}` en `connections` y la entrada `"node"` en `connections["Code in JavaScript6"]`
- [x] 2.5 Renombrar `Redis` → `HTTP - Leer producto informacion` (extensión aprobada): nodo de lectura GET `/products?...&select=product_data` que alimenta la rama de edición de publicidad (`Redis30` → `Get a file1` → `Edit an image`). Actualizar `"name"`, clave fuente en `connections`, entrada `"node"` en `connections["Send a text message6"]` y la expresión `$('Redis')` en el prompt de `Edit an image`
- [x] 2.6 Renombrar `Redis2` → `HTTP - Leer producto imagen` (extensión aprobada): nodo de lectura GET `/products?...&select=product_data` que alimenta la rama de generación de imagen publicitaria (`Redis24` → `Generate an image`). Actualizar `"name"`, clave fuente en `connections`, entradas `"node"` en `connections["Send a text message4"]`/`connections["Switch"]`/`connections["Redis28"]` y la expresión `$('Redis2')` en el prompt de `Generate an image`
- [x] 2.7 Verificar con búsqueda exacta (con comillas) que no quedan `"Redis1"`/`"Redis10"`/`"Redis21"`/`"Redis"`/`"Redis2"` ni `$('Redis1')`/`$('Redis10')`/`$('Redis21')`/`$('Redis')`/`$('Redis2')` en `codigo.json`, y que los nodos Redis reales (`Redis3`…`Redis36`) siguen intactos
- [ ] 2.8 pending-manual: tras el re-import, confirmar en la UI que las cinco ramas (información/PDF/imagen/lecturas) siguen conectadas a los nodos renombrados

## 3. Bug 2 — Eliminación del nodo muerto `HTTP Request` y reconexión de la rama de upsert

> Auditoría previa (evidencia): `HTTP Request` (id `ed044423-acee-4271-9ad8-ab41171e9140`, URL con literal `{chat_id}`) tiene aristas `Code in JavaScript → HTTP Request → (ex Redis1)`; **0** referencias `$('HTTP Request')`; su output no es consumido (el upsert lee `user_id` de `$('HTTP - Chequear vinculacion')`). No es huérfano de conexiones pero es **funcionalmente muerto**: FIX de la URL no repara la cadena (el upsert recibiría filas de profiles como `product_data`). Decisión aprobada: **eliminar + reconectar** (opción (a) de design D2). **Efecto:** recuento de nodos 116 → **115**.

- [x] 3.1 Eliminar del array `nodes` el objeto con `"name": "HTTP Request"`
- [x] 3.2 Eliminar del bloque `connections` la clave `"HTTP Request"` (su única salida apuntaba a `HTTP - Upsert producto informacion`, ex `Redis1`)
- [x] 3.3 En `connections["Code in JavaScript"].main[0]`, reemplazar la entrada `{"node": "HTTP Request", "type": "main", "index": 0}` por `{"node": "HTTP - Upsert producto informacion", "type": "main", "index": 0}` (reconexión directa; `Code in JavaScript` queda con dos downstreams: `Code in JavaScript2` y `HTTP - Upsert producto informacion`). Opción (a) aprobada y ejecutada: la rama de upsert de "información" pasa de no-op silencioso a upsert activo (cambio de comportamiento intencional)
- [x] 3.4 Verificar: 115 nodos; ninguna entrada de `connections` referencia o sale de `HTTP Request`; `HTTP - Upsert producto informacion` tiene input desde `Code in JavaScript` y 0 entradas colgantes
- [x] 3.5 Documentar en la verificación final que el recuento esperado es 115 (desviación del "116" del brief, que asumía que no se eliminaría ningún nodo)

## 4. Verificación final de integridad (offline, sin stack)

- [x] 4.1 Parseo: `Get-Content -Raw codigo.json | ConvertFrom-Json` (PowerShell) sin error, o `node -e "JSON.parse(require('fs').readFileSync('codigo.json','utf8'))"` — también `pinData` vacío y `meta` intacto
- [x] 4.2 Recuento de nodos = **115** (116 − `HTTP Request` eliminado) y bloque `connections` coherente: toda arista apunta a un nodo existente; solo los cambios previstos (eliminación de `HTTP Request`, reconexión en `Code in JavaScript`, renombres)
- [x] 4.3 Cero referencias viejas (búsqueda exacta con comillas): `"Redis1"`, `"Redis10"`, `"Redis21"`, `"Redis"`, `"Redis2"` y `$('Redis1')`, `$('Redis10')`, `$('Redis21')`, `$('Redis')`, `$('Redis2')` → 0 ocurrencias
- [x] 4.4 Cero `Math.random` en el texto crudo de `codigo.json` → 0 ocurrencias; confirmar que la única generación de código usa `randomInt`
- [x] 4.5 No regresión: nodos de la cadena ClamAV (`IF - Límite de tamaño PDF`, `Escaneo ClamAV`, `IF - PDF limpio`, `PDF muy grande`, `PDF rechazado`) y los 11 nodos migrados a credenciales que permanecen tras el cambio (`secrets-migration`; el 12.º, `HTTP Request`, fue eliminado por Bug 2) intactos (mismos parámetros; sin valores `eyJ`/`Bearer` literales)
- [x] 4.6 Verificación de la lógica de los nodos renombrados: `HTTP - Upsert producto informacion` conserva `jsonBody` (`user_id: $('HTTP - Chequear vinculacion').item.json.id`, `product_data: $json`) y credencial "Supabase Service Role"; igual para `HTTP - Upsert producto pdf` (`$json.productos`) y `HTTP - Upsert producto imagen`; los de lectura `HTTP - Leer producto informacion`/`HTTP - Leer producto imagen` conservan URL e interpolación `user_id`, y las expresiones `$('HTTP - Leer producto informacion')`/`$('HTTP - Leer producto imagen')` están actualizadas en los prompts de `Edit an image`/`Generate an image`

## 5. Pending-manual — despliegue y verificación funcional en el stack

> Requiere el stack levantado (`docker compose up -d`) y acceso a la UI de n8n y a Supabase.

- [ ] 5.1 Recrear el contenedor n8n: `docker compose up -d n8n` (aplica `NODE_FUNCTION_ALLOW_BUILTIN=crypto`)
- [ ] 5.2 Re-importar `codigo.json` en n8n (Workflows → New → Import from File) y guardar; verificar que los nodos renombrados existen y las conexiones se preservaron
- [ ] 5.3 Verificación funcional de vinculación (Bug 1): `/start <código>` genera un código de 6 dígitos y `HTTP Request1` inserta en `telegram_link_codes` con HTTP 2xx — confirma que el Code node ejecuta con `require('crypto')` sin error de sandbox
- [ ] 5.4 Verificación funcional de upserts (Bug 2/3): ejercitar las tres ramas (información/PDF/imagen) y confirmar que `HTTP - Upsert producto informacion`, `HTTP - Upsert producto pdf` y `HTTP - Upsert producto imagen` responden HTTP 2xx
- [ ] 5.5 Re-exportar el workflow desde n8n y sobrescribir `codigo.json` para dejarlo sincronizado; correr de nuevo el grupo 4 (verificación offline)
