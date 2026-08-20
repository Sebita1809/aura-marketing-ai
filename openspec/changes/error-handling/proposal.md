## Why

El workflow del bot "Aura" (export en `codigo.json`, 116 nodos) **no tiene ninguna estrategia de manejo de fallos** — verificado en `HALLAZGOS-DEL-FLUJO-n8n.md` §3.5: cero nodos con `retryOnFail`, un solo `onError` («Escaneo ClamAV», `continueErrorOutput`) y tres nodos con `alwaysOutputData`. Si Gemini agota cuota, Telegram limita tasa, Postiz falla o Redis se reinicia, **la ejecución muere y el usuario queda esperando sin ningún aviso**. El informe de tesis lo señaló ([M-15]) y la auditoría del export lo confirma con evidencia. Este cambio implementa la opción recomendada en §3.5: **"es configuración, no desarrollo"** — retries en los nodos de red + notificación de error al usuario.

## What Changes

> **Auditoría base (evidencia, ya realizada).** 116 nodos. Nodos con `retryOnFail=true`: **0**. Nodos con `onError`: **1** («Escaneo ClamAV», dentro de `parameters`, `continueErrorOutput`). Nodos con `alwaysOutputData=true`: **3** (`HTTP - Leer producto informacion`, `HTTP - Leer producto imagen`, `HTTP - Chequear vinculacion`). El detalle por nodo de red está en el design (tabla de auditoría).

- **Capa 1 — Retries en nodos de red (configuración pura, solo `parameters` en `codigo.json`).** Agregar `"retryOnFail": true` + `"maxTries": N` + `"waitBetweenTries": ms` a los nodos de red cuyo fallo dejaría al usuario colgado y cuya repetición es segura: lecturas Supabase (GET, idempotentes), upserts Supabase (POST con `on_conflict=user_id` + `Prefer: resolution=merge-duplicates` → idempotentes), lectura de perfil/cuenta Instagram (GET), subida de imagen Postiz (POST idempotente-de-hecho: el duplicado es un asset huérfano, no visible al usuario), los 4 nodos Gemini (`Analyze document`, `Analyze an image`, `Generate an image`, `Edit an image`), `Google Gemini Chat Model1` y `Get row(s) in sheet in Google Sheets` (subnodos del agente), los 4 nodos Telegram de descarga de archivos (`Get a file`, `Get a file1`, `Get a file2`, `Telegram Get a file publicacion`) y los 23 nodos Redis de escritura (baratos, idempotentes). Política propuesta única: `retryOnFail: true`, `maxTries: 3`, `waitBetweenTries: 1000` ms.
- **Exclusiones deliberadas (Capa 1):** `Telegram Trigger` (punto de entrada, no lleva retry), `Wait` (pausa intencional, no es falla de red), `Escaneo ClamAV` (ya tiene `onError: continueErrorOutput` — se conserva tal cual), **todos los nodos Telegram de envío/edición de mensajes** (un retry duplica un mensaje visible al usuario), `HTTP - Crear post Postiz` (POST `type: 'now'` **no idempotente**: un retry publica posts duplicados en redes sociales) y `HTTP Request1` (insert en `telegram_link_codes` **no idempotente**: un retry crea filas duplicadas) — estas dos últimas son **decisiones de usuario** documentadas en el design (alternativa: retry con `maxTries` bajo y riesgo documentado).
- **Capa 2 — Notificación de error al usuario (opcional, separable).** Nuevo workflow separado `error-workflow.json` con un nodo **Error Trigger** (se dispara cuando cualquier workflow del espacio de n8n falla) + un nodo **Code** que extrae el `chat_id` del usuario con fallback al chat del admin + un nodo **Telegram sendMessage** que avisa en español («ocurrió un error, volvé a intentar /start»). Requiere (pending-manual): que el usuario lo seleccione en n8n Settings → Error Workflow y complete el chat del admin en el nodo Code. La Capa 2 es **opcional**: si el usuario prefiere el mínimo, se omite y se documenta la limitación "sin aviso al usuario" como aceptada.
- **Verificación offline (sin stack):** script estático que confirma que los nodos esperados tienen `retryOnFail`/`maxTries`/`waitBetweenTries`, que los excluidos no lo tienen, que el JSON parsea, que el recuento de nodos sigue en 116, y que `error-workflow.json` (si se incluye) parsea y contiene Error Trigger + Telegram sendMessage.
- **Verificación live (pending-manual):** seleccionar el error workflow en n8n y probar un fallo forzado (bajar un servicio o una request que devuelva error) para confirmar que el usuario recibe el mensaje.

## Capabilities

### New Capabilities

- `network-node-retries`: política de reintentos para los nodos de red del workflow — qué nodos llevan `retryOnFail`/`maxTries`/`waitBetweenTries` (lecturas, upserts idempotentes, Gemini, descargas Telegram, escrituras Redis), qué nodos se excluyen deliberadamente y por qué (idempotencia, duplicación visible al usuario, trigger/Wait/ClamAV), sin cambiar la máquina de estados, nombres de nodos, credenciales ni conexiones.
- `error-notification-workflow`: workflow separado de notificación de errores — se dispara ante cualquier fallo de ejecución, extrae el `chat_id` del usuario con fallback al chat del admin, y envía un mensaje en español para que el usuario sepa que ocurrió un error y cómo reintentar.

### Modified Capabilities

*(Ninguna — los specs existentes en `openspec/specs/` (`dashboard-social-connections`, `meta-oauth`, `token-manager`, `x-twitter-oauth`) no tocan el workflow n8n ni su manejo de errores.)*

## Impact

- **n8n / `codigo.json`**: ~43-44 nodos de red modificados (solo `parameters`, agregando las 3 claves de retry); recuento de nodos se mantiene en **116** (no se agregan ni quitan nodos en la Capa 1). Sin cambios en la máquina de estados, nombres de nodos, clave `connections` existente ni credenciales.
- **n8n (nuevo archivo)**: `error-workflow.json` (nuevo workflow separado, solo si se aprueba la Capa 2) — a importar manualmente en n8n.
- **n8n (UI, pending-manual)**: seleccionar el error workflow en Settings → Error Workflow; probar un fallo real.
- **Pruebas**: nuevo script de verificación estática offline (patrón de `tests/redis-expiration/verify-ttl.js`, sin stack ni contenedores).
- **Documentación**: actualizar el estado de remediación de §3.5 en `HALLAZGOS-DEL-FLUJO-n8n.md`.
- **No se toca**: cadena ClamAV (`pdf-virus-scan`), migración de credenciales (`secrets-migration`), renombres y reconexión (`bug-fixes`), expiración Redis (`redis-expiration`), ni los nodos de lógica (`code`, `if`, `switch`, `aggregate`).
