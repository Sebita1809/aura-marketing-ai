## Why

El análisis del workflow Aura (`HALLAZGOS-DEL-FLUJO-n8n.md`) documentó tres bugs de bajo riesgo pero de impacto real sobre el sistema y sobre la calidad del informe: (1) el código de vinculación de cuentas se genera con `Math.random()`, que no es criptográficamente seguro, en un código de un solo uso que habilita la vinculación de una cuenta [§2.8]; (2) el nodo `HTTP Request` consulta `profiles` con el literal `{chat_id}` sin interpolar, por lo que siempre consulta la string literal — nodo muerto y duplicado de `HTTP - Chequear vinculacion` [§3.6]; (3) tres nodos HTTP contra Supabase se llaman `Redis1`/`Redis10`/`Redis21`, nombres que confundieron al informe (el "campo `informacion_de_producto` en Redis" es en realidad `product_data` en Supabase) [§3.2].

## What Changes

> **Nota de verificación previa (resuelto en este cambio):** el nodo `HTTP Request` NO es huérfano de conexiones (tiene arista de entrada desde `Code in JavaScript` y de salida hacia `Redis1`), pero es **funcionalmente muerto**: su URL lleva el literal `{chat_id}`, ningún otro nodo lo referencia vía `$('HTTP Request')` (verificado, 0 ocurrencias), y su único consumidor `Redis1` no usa su output (lee `user_id` de `$('HTTP - Chequear vinculacion')`). Ver `design.md` D2 para la evidencia completa.

- **Bug 1 — RNG criptográfico para el código de vinculación**: en el nodo `Code - Generar código` se reemplaza `Math.floor(100000 + Math.random() * 900000)` por `randomInt(100000, 1000000)` de `node:crypto` (`const { randomInt } = require('crypto')`), preservando intacta la extracción de `chatId` y la forma de salida `[{ json: { code, chat_id } }]`. Como n8n **deshabilita los imports de módulos builtin por defecto**, se agrega `NODE_FUNCTION_ALLOW_BUILTIN=crypto` (privilegio mínimo) al servicio `n8n` en `docker-compose.yml`.
- **Bug 2 — Eliminación del nodo muerto `HTTP Request`**: se elimina el nodo del array `nodes` y del bloque `connections`, y se **reconecta `Code in JavaScript → HTTP - Upsert producto informacion`** (ex `Redis1`) para preservar la rama de upsert de productos, espejando la rama hermana `Code in JavaScript6 → Redis21`. **BREAKING**: la cantidad de nodos del workflow pasa de 116 a 115.
- **Bug 3 — Renombres descriptivos**: `Redis1` → `HTTP - Upsert producto informacion`, `Redis10` → `HTTP - Upsert producto pdf`, `Redis21` → `HTTP - Upsert producto imagen` (nodos `n8n-nodes-base.httpRequest` POST `/products`, estilo de nombre `HTTP - ...`). Se actualizan las 7 ocurrencias exactas en `codigo.json` (3 campos `name` + 4 entradas del bloque `connections`); verificado que **no existen referencias de expresiones `$('...')`** a estos nodos, por lo que el rename es de bajo riesgo.
- **Prueba offline**: test bajo `tests/rng/` (patrón `tests/eicar/`) que verifica el algoritmo sin requerir el stack vivo: rango [100000, 999999], longitud 6, y variabilidad entre llamadas consecutivas.

## Capabilities

### New Capabilities

- `bug-fixes`: correcciones de bajo riesgo al workflow n8n "Aura" — RNG criptográfico para el código de vinculación de cuentas, eliminación del nodo HTTP muerto con URL literal `{chat_id}` (y reconexión de la rama de upsert), y renombres descriptivos de los tres nodos HTTP mal nombrados `Redis1`/`Redis10`/`Redis21`.

### Modified Capabilities

*(Ninguna — no hay specs existentes que cambien sus requirements; verifica contra `openspec/specs/`)*

## Impact

- **n8n (`codigo.json`)**: nodo `Code - Generar código` (jsCode), nodo `HTTP Request` (eliminado), bloque `connections` (2 aristas del nodo eliminado + 1 reconexión), 3 nodos renombrados (7 ocurrencias).
- **Docker (`docker-compose.yml`)**: variable `NODE_FUNCTION_ALLOW_BUILTIN=crypto` en el servicio `n8n` (habilita `require('crypto')` en el Code node; mínimos privilegios, no `*`). Requiere recrear el contenedor n8n (pending-manual).
- **Pruebas**: nuevo `tests/rng/test-link-code.js` (no requiere stack vivo ni contenedores).
- **Documentación**: se actualiza el estado de remediación en `HALLAZGOS-DEL-FLUJO-n8n.md` (§2.8, §3.2, §3.6).
- **No se toca**: cadena ClamAV (`pdf-virus-scan`), migración de credenciales (`secrets-migration`), nodos Redis reales, ni `Redis`/`Redis2` (también HTTP con nombre confuso pero fuera de scope).
