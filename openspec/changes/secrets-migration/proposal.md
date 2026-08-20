## Why

`codigo.json` (el export del workflow n8n del bot "Aura", 116 nodos) contiene **secretos en texto plano**: el JWT `service_role` de Supabase (20 ocurrencias del token, en los headers `apikey` y `Authorization` de 10 nodos HTTP) y la API key de Postiz (2 ocurrencias, en el header `Authorization` de 2 nodos). El `service_role` omite Row Level Security (quien lo tenga puede leer/modificar/borrar cualquier fila: `profiles`, `social_accounts` con los OAuth tokens, `products`, `telegram_link_codes`), no expira hasta 2036 y quedó commiteado en el historial de Git del repositorio (ver `HALLAZGOS-DEL-FLUJO-n8n.md`, PARTE 0). Mientras tanto, el resto del workflow ya usa correctamente credenciales gestionadas por n8n (`telegramApi`, `redis`, `googlePalmApi`, `googleSheetsOAuth2Api`) — el problema es SOLO los nodos HTTP genéricos con headers literales. Este cambio migra esos headers secretos a credenciales n8n de tipo **Header Auth** (`httpHeaderAuth`), dejando `codigo.json` sin ningún secreto (solo referencias por nombre), y documenta el procedimiento de export saneado para el anexo de la tesis.

## What Changes

- **Migración de credenciales (n8n / `codigo.json`)**: en los 12 nodos HTTP afectados se reemplaza la autenticación por headers literales por una credencial genérica de tipo Header Auth:
  - `"authentication": "genericCredentialType"` + `"genericAuthType": "httpHeaderAuth"` en `parameters`.
  - Se eliminan de `headerParameters` los valores literales secretos (JWT `service_role`, API key de Postiz).
  - Se agrega el bloque `"credentials": { "httpHeaderAuth": { "id": "<placeholder>", "name": "<nombre credencial>" } }` a nivel nodo.
- **Nodos Supabase (10)**: `Redis`, `Redis1`, `Redis2`, `Redis10`, `Redis21`, `HTTP Request`, `HTTP - Chequear vinculacion`, `HTTP Request1`, `HTTP - Perfil publicacion`, `HTTP - Cuenta Instagram publicacion` → credencial **"Supabase Service Role"** (header `apikey` = JWT `service_role`). El header redundante `Authorization: Bearer <mismo JWT>` se elimina (llevan el mismo token; ver design D2).
- **Nodos Postiz (2)**: `HTTP - Subir imagen Postiz` y `HTTP - Crear post Postiz` → credencial **"Postiz API Key"** (header `Authorization` = API key, sin prefijo `Bearer`, tal como está hoy).
- **Headers no secretos conservados como literales**: `Prefer: resolution=merge-duplicates` (nodos upsert `Redis1`, `Redis10`, `Redis21`) y `Content-Type: application/json` (`HTTP - Crear post Postiz`).
- **Estado final**: `codigo.json` sin `eyJ*` (JWTs), sin la API key de Postiz y sin headers `Authorization`/`apikey` literales con valores; solo referencias de credenciales por nombre. El nodo huérfano `HTTP Request` (con el literal `{chat_id}`) se migra igualmente pero **no se borra** (su eliminación es un cambio bug-fix aparte).
- **Documentación**: procedimiento de export saneado (export sin credenciales, solo referencias id/name) para el anexo de la tesis, y notas de operación.

## Capabilities

### New Capabilities

- `secrets-http-auth`: Migración de secretos hardcodeados en nodos HTTP del workflow n8n a credenciales gestionadas de tipo Header Auth (`httpHeaderAuth`) — cubre la transformación de nodos, la verificación de que el export no contiene secretos, y el procedimiento de export saneado para el anexo.

### Modified Capabilities

*(Ninguna — no hay specs existentes en `openspec/specs/` que cambien sus requirements: `dashboard-social-connections`, `meta-oauth`, `token-manager`, `x-twitter-oauth` no tocan autenticación de nodos HTTP genéricos ni la gestión de credenciales del workflow.)*

## Impact

- **n8n / `codigo.json`**: 12 nodos HTTP modificados (10 Supabase + 2 Postiz); se re-importa el workflow al editor para que las credenciales se asocien por nombre.
- **n8n (UI, pending-manual)**: crear las 2 credenciales Header Auth ("Supabase Service Role", "Postiz API Key") y re-importar `codigo.json`.
- **Supabase / Postiz**: la **rotación** de la clave `service_role` y la API key de Postiz queda **fuera de scope** (acción manual del usuario), pero es **prerrequisito** antes de crear las credenciales en n8n.
- **Seguridad**: sin cambios en endpoints, URLs, métodos ni bodies — solo la forma de autenticar. La URL `https://legffrhakunfignlaftl.supabase.co` permanece en los nodos (es la dirección del proyecto, no un secreto).
- **Sin tocar**: la cadena ClamAV del cambio anterior (`IF - Límite de tamaño PDF`, `Escaneo ClamAV`, `IF - PDF limpio`, `PDF muy grande`, `PDF rechazado`) y los demás 104 nodos.
