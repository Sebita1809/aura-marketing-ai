## Why

El camino real de vinculación de Telegram vive solo como objetos creados a mano en la DB live: la tabla `telegram_link_codes` no aparece en ninguna migración del repo y el RPC `link_telegram_with_code` que consume el frontend (`ConnectionsPage.jsx`) no está definido en ningún lado del código (ver `HALLAZGOS-DEL-FLUJO-n8n.md` §2.8 y N.3). Además, la rama de validación `/start <código>` del bot — el nodo `IF - Vinculacion Telegram` — está desconectada (0 aristas de entrada y salida): el bot genera y envía un código sin poder validarlo. Esto hace que el sistema no sea reproducible desde la fuente y deja la validación en un RPC invisible.

## What Changes

- **Supabase — migración nueva e idempotente** `aura-frontend/supabase/migrations/20260814000001_telegram_link_codes_reproducible.sql`:
  - Materializa la tabla real `public.telegram_link_codes` (`CREATE TABLE IF NOT EXISTS`) con el esquema live: `id uuid PK DEFAULT gen_random_uuid()`, `chat_id text NOT NULL`, `code text UNIQUE NOT NULL` con `CHECK (char_length(code) = 6)`, `expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes')`, `used_at timestamptz NULL`, `created_at timestamptz NOT NULL DEFAULT now()`.
  - Índice `idx_telegram_link_codes_expires` sobre `expires_at` (`CREATE INDEX IF NOT EXISTS`).
  - `ENABLE ROW LEVEL SECURITY` sin políticas de acceso directo (n8n escribe con `service_role` y el RPC es `SECURITY DEFINER`; ambos bypasean RLS — se documenta la decisión en design D2).
  - `CREATE OR REPLACE FUNCTION public.link_telegram_with_code(p_code text)` `SECURITY DEFINER SET search_path = public`: valida código vigente y no usado, vincula `profiles.telegram_chat_id = chat_id` para `auth.uid()`, marca `used_at`, y devuelve `{ success, chat_id, error }` — el contrato exacto que espera `ConnectionsPage.jsx` (líneas 371-395).
  - `GRANT EXECUTE ON FUNCTION public.link_telegram_with_code(text) TO authenticated;`
  - **`telegram_link_tokens` (y su migración) se deja intacta**: legacy no usado por ningún código (deep-link nunca implementado); limpieza futura documentada, fuera de scope.
- **n8n (`codigo.json`, 116 → 120 nodos)** — reconectar `IF - Vinculacion Telegram` entre `Code in JavaScript7` y `HTTP - Chequear vinculacion`, y agregar la rama de validación `/start <código>`:
  - `HTTP - Validar codigo` (GET `telegram_link_codes?code=eq.<código>&used_at=is.null&expires_at=gt.<now>`, credencial "Supabase Service Role", retry 3×1000 según política).
  - `IF - Codigo valido` (respuesta con items → válido).
  - `Telegram - Codigo valido` ("✅ Código válido. Completá la vinculación desde la web.") y `Telegram - Codigo invalido` ("❌ Código inválido o expirado."), credencial "Telegram account", sin retry.
  - La rama **termina** (no continúa al flujo normal ni dispara la generación de código).
- **Verificación** — test offline `tests/link-code/verify-link-flow.js` (nuevo) y actualización de los recuentos en `tests/error-handling/verify-retries.js` y `tests/redis-expiration/verify-ttl.js` (116 → 120).

## Capabilities

### New Capabilities
- `telegram-link-code`: reproducción del flujo de vinculación de Telegram — tabla `telegram_link_codes` materializada en migración, RPC `link_telegram_with_code` que ejecuta el vínculo desde la web, y validación `/start <código>` en el bot antes del flujo normal.

### Modified Capabilities
<!-- Ninguna: no cambian requisitos de ninguna spec existente (x-twitter-oauth, token-manager, dashboard-social-connections, meta-oauth). -->

## Impact

- `aura-frontend/supabase/migrations/20260814000001_telegram_link_codes_reproducible.sql` (nueva migración idempotente; corre en la DB live donde la tabla ya existe y en DBs nuevas).
- `codigo.json` (workflow n8n, 116 → 120 nodos; se modifica 1 arista existente — `Code in JavaScript7` → `IF - Vinculacion Telegram` — y se agregan 4 nodos + 6 aristas nuevas; el resto queda intacto).
- `tests/link-code/verify-link-flow.js` (nuevo); `tests/error-handling/verify-retries.js` y `tests/redis-expiration/verify-ttl.js` (recuentos 116 → 120 y listas nuevas).
- Sin cambios en el frontend web (`ConnectionsPage.jsx` ya llama al RPC).
- Sin cambios en `telegram_link_tokens` ni en su migración.
- Dependencias: n8n (expresión `$now.toISO()` de Luxon para el filtro `expires_at`), Supabase/PostgREST (filtros `eq`, `is.null`, `gt`).
