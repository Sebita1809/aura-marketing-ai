## Why

El workflow del bot "Aura" (export en `codigo.json`) persiste estado efímero de sesión en Redis **sin ninguna política de expiración** — verificado en `HALLAZGOS-DEL-FLUJO-n8n.md` §3.1: cero `EXPIRE`, cero `TTL`, cero `DELETE`. Las claves `especificaciones_<id>`, `especificaciones_rehacer_<id>`, `descripcion_<id>`, `publicidad_<id>` y la lista `fotos_<id>` quedan **indefinidamente** en Redis, incluyendo los `file_id` de Telegram de las imágenes de producto que suben los usuarios (preocupación de privacidad/almacenamiento). El único "reseteo" es el nodo `Redis13`, que sobrescribe `chat_<id>` con un valor vacío (resetea el estado, no borra nada). El informe de tesis afirma que estos datos "se eliminan solos" — es factualmente falso, y este cambio implementa la opción **(a)** de §3.1: convertir la promesa en mecanismo.

## What Changes

> **Decisión de mecanismo (evidencia):** el nodo Redis built-in de n8n (`n8n-nodes-base.redis`, typeVersion 1) no tiene operación `EXPIRE` ni `command`; pero la operación **`set` soporta de forma nativa los parámetros `expire` (boolean) + `ttl` (segundos)**, que n8n ejecuta como `client.set(key, value)` seguido de `client.expire(key, ttl)` en el mismo nodo (verificado en el source de n8n). No hace falta ningún nodo nuevo para las claves string.

- **TTL nativo en los 21 nodos SET** (parámetros `"expire": true` + `"ttl": <constante>`): 16 nodos de `chat_<chat_id>` (incluido el reseteo `Redis13`), 2 de `especificaciones_<chat_id>`, 1 de `especificaciones_rehacer_<chat_id>`, 1 de `publicidad_<chat_id>` y 1 de `descripcion_<chat_id>`. Cada escritura refresca el TTL (la clave expira a las 24 h de su **última** escritura).
- **TTL en la lista `fotos_<chat_id>` (1 nodo `push`/LPUSH, `Redis6`)**: la operación `push` no soporta TTL y no existe `EXPIRE` en el nodo built-in, por lo que se agrega un nodo `Redis - Expirar fotos` (comunidad "Redis Enhanced", operación `expire`) como rama colgante a la salida de `Redis6` — **DECISIÓN DE USUARIO** (alternativa sin dependencias: auto-limpieza + barrido manual; ver design D2).
- **TTL por familia de clave, un solo valor por familia** (constantes nombradas en el design): `chat_` 86400 s (24 h), `especificaciones_` 86400 s, `especificaciones_rehacer_` 86400 s, `descripcion_` 86400 s, `publicidad_` 86400 s, `fotos_` 86400 s — **valores propuestos, ajustables, para confirmar por el usuario**.
- **`Redis13` (reseteo) se conserva como SET con valor vacío** y recibe el TTL de la familia `chat_` — **no** se convierte en DEL (evita que el evaluador de estados vea una clave ausente en vez de un estado vacío).
- **Verificación offline** (sin stack): script `tests/redis-expiration/verify-ttl.js` que audita `codigo.json` (todo nodo de escritura SET tiene `expire: true` con el `ttl` de su familia; recuento de escrituras == recuento de expiraciones; la lista `fotos_` tiene su nodo `expire`) y simula SET+EXPIRE contra un mock en memoria (incluida la renovación del TTL en cada escritura).
- **Verificación live** (pending-manual): mensaje real al bot, `TTL <clave>` desde `redis-cli`, y confirmación de que las claves desaparecen tras el TTL.

## Capabilities

### New Capabilities

- `redis-key-expiration`: política de expiración para las claves de sesión efímeras del workflow — TTL aplicado y refrescado en cada escritura para las 6 familias de clave (`chat_`, `especificaciones_`, `especificaciones_rehacer_`, `descripcion_`, `publicidad_`, `fotos_`), sin alterar la máquina de estados, los nombres de clave, las conexiones ni las credenciales.

### Modified Capabilities

*(Ninguna — los specs existentes en `openspec/specs/` (`dashboard-social-connections`, `meta-oauth`, `token-manager`, `x-twitter-oauth`) no tocan el workflow n8n ni su espacio de claves Redis.)*

## Impact

- **n8n / `codigo.json`**: 21 nodos Redis de escritura `set` modificados (solo `parameters`); 1 nodo nuevo `Redis - Expirar fotos` (si se aprueba D2-A) como fan-out colgante de `Redis6`; sin cambios en la máquina de estados, nombres de clave, bloque `connections` existente ni credenciales. Recuento de nodos: 115 → **116** (solo si se agrega el nodo de expiración de fotos; si se aprueba D2-B, se mantiene en 115).
- **n8n (UI, pending-manual)**: si D2-A, instalar el community node `@fancyheat/n8n-nodes-redis-enhanced` ANTES de re-importar `codigo.json`; re-importar y verificar TTL.
- **Redis (servidor)**: sin cambios de configuración — la expiración la emiten los propios nodos del workflow. Solo cambio de observación: los `file_id` dejan de acumularse.
- **Pruebas**: nuevo `tests/redis-expiration/verify-ttl.js` (no requiere stack vivo ni contenedores).
- **Documentación**: actualizar el estado de remediación de §3.1 en `HALLAZGOS-DEL-FLUJO-n8n.md`.
- **No se toca**: cadena ClamAV (`pdf-virus-scan`), migración de credenciales (`secrets-migration`), renombres y reconexión (`bug-fixes`), ni los nodos de lectura de Redis (`get`/`llen`/`pop`).
