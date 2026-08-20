# Tasks: secrets-migration

## 1. Supabase — migración de credenciales en los nodos HTTP

> Los 10 nodos Supabase dejan de autenticar con headers literales (`apikey` + `Authorization: Bearer <JWT service_role>`) y pasan a la credencial Header Auth **"Supabase Service Role"** (header `apikey` = JWT rotado). El header redundante `Authorization` se elimina (mismo JWT; ver design D2). La implementación se hace editando `codigo.json` con cuidado; n8n es la fuente de verdad y el re-import sincroniza (tasks 4.4/4.7).

- [x] 1.1 Grupo A — nodos sin headers no secretos (7): en `Redis`, `Redis2`, `HTTP Request` (huérfano con literal `{chat_id}`: migrar credencial, NO borrar), `HTTP - Chequear vinculacion`, `HTTP Request1`, `HTTP - Perfil publicacion`, `HTTP - Cuenta Instagram publicacion` — reemplazar en `parameters` los headers literales `apikey`/`Authorization` por `"authentication": "genericCredentialType"` + `"genericAuthType": "httpHeaderAuth"`, eliminar el bloque `headerParameters` y poner `"sendHeaders": false`; agregar a nivel nodo `"credentials": { "httpHeaderAuth": { "id": "<placeholder>", "name": "Supabase Service Role" } }`. Conservar íntegros `url`, `method`, `sendBody`/`specifyBody`/`jsonBody`, `type`, `typeVersion`, `position`, `id`, `name`, `alwaysOutputData` y `options`.
- [x] 1.2 Grupo B — nodos upsert que conservan el header `Prefer` (3): en `Redis1`, `Redis10`, `Redis21` — misma transformación de autenticación que 1.1, pero manteniendo `"sendHeaders": true` y `headerParameters` SOLO con la entrada literal `{ "name": "Prefer", "value": "resolution=merge-duplicates" }` (los headers `apikey`/`Authorization` se eliminan); agregar el bloque `credentials.httpHeaderAuth` → "Supabase Service Role".
- [x] 1.3 Verificar por inspección que ninguno de los 10 nodos mantiene valores JWT (`eyJ...`) en `headerParameters` y que todos referencian la credencial "Supabase Service Role" (name exacto).

## 2. Postiz — migración de credenciales en los nodos HTTP

> Los 2 nodos Postiz dejan de autenticar con el header literal `Authorization: 704b5278...` (API key sin prefijo `Bearer`) y pasan a la credencial Header Auth **"Postiz API Key"**.

- [x] 2.1 `HTTP - Subir imagen Postiz` (POST `http://postiz:5000/api/public/v1/upload`): eliminar el header literal `Authorization` de `headerParameters`, poner `"sendHeaders": false` (sin headers no secretos), agregar `"authentication": "genericCredentialType"` + `"genericAuthType": "httpHeaderAuth"` y `"credentials": { "httpHeaderAuth": { "id": "<placeholder>", "name": "Postiz API Key" } }`. Conservar el `bodyParameters` multipart (`file` → `formBinaryData`/`inputDataFieldName: data`).
- [x] 2.2 `HTTP - Crear post Postiz` (POST `http://postiz:5000/api/public/v1/posts`): eliminar el header literal `Authorization`, conservar `"sendHeaders": true` con `headerParameters` SOLO con `{ "name": "Content-Type", "value": "application/json" }`, agregar `authentication` genérica + bloque `credentials.httpHeaderAuth` → "Postiz API Key". Conservar `jsonBody` intacto.

## 3. Verificación de cero secretos en `codigo.json`

- [x] 3.1 Scan de patrones secretos sobre el archivo completo (PowerShell, texto crudo): `eyJ` → 0 ocurrencias; API key de Postiz `<ROTADA-2026-08-18-ver-nota-en-tasks.md-4.1>` → 0; `Bearer ` → 0; header `"apikey"` → 0; `supabase.co` → exactamente 10 (las URLs de los nodos, no un secreto).
- [x] 3.2 Parseo e integridad: `Get-Content -Raw | ConvertFrom-Json` sin error; recuento de nodos = 116; bloque `connections` idéntico al original (ninguna conexión tocada); `pinData` vacío.
- [x] 3.3 No regresión sobre la cadena ClamAV del cambio anterior: verificar que `IF - Límite de tamaño PDF`, `Escaneo ClamAV`, `IF - PDF limpio`, `PDF muy grande` y `PDF rechazado` están intactos (mismos parámetros, incluyendo `On Error → Continue Error Output` y URL `http://clamav-rest:9000/v2/scan`).
- [x] 3.4 Verificación por inspección de los 12 nodos migrados: cada uno tiene `authentication: genericCredentialType`, `genericAuthType: httpHeaderAuth` y `credentials.httpHeaderAuth` con el `name` correcto ("Supabase Service Role" ×10, "Postiz API Key" ×2); los headers no secretos (`Prefer`, `Content-Type`) se conservan.

## 4. Pending-manual — credenciales en n8n, re-import y verificación funcional

> Requiere el stack levantado (`docker compose up -d`) y el acceso a la UI de n8n y a Supabase/Postiz.

- [x] 4.1 **Prerrequisito:** el JWT `service_role` filtrado (público en GitHub, y expuesto además en esta sesión de chat al pegarlo por error) quedó completamente inutilizado — en vez de solo "rotar" el JWT legacy, se migró el proyecto al sistema nuevo de Supabase (Publishable/Secret keys) y se activó **"Disable legacy API keys"**, matando de raíz tanto el `anon` como el `service_role` viejos. Frontend migrado a `VITE_SUPABASE_ANON_KEY` = Publishable key nueva; 4 Edge Functions (`token-manager`, `auth-meta-callback`, `auth-x-callback`, `create-user`) migradas de `SUPABASE_SERVICE_ROLE_KEY` a `JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS'))['default']`. Verificado post-desactivación: frontend sigue logueado, `token-manager` responde 200 vía curl. API key de Postiz: **rotada** (ver 4.3 — actualizado 2026-08-18, sesión posterior a la que dejó esta nota pendiente).
- [x] 4.2 Credencial n8n **"Supabase Service Role"** creada (Header Auth, `apikey` = Secret key nueva) y reasignada a los 11 nodos que la usan (los 10 originales + `HTTP - Validar codigo` de `link-code-reproducible`).
- [x] 4.3 Credencial n8n **"Postiz API Key"** creada tras rotar la key de Postiz (2026-08-18). Verificado en `codigo.json`: ambos nodos Postiz referencian `credentials.httpHeaderAuth = "Postiz API Key"` (id `kAaCGLh1mMYY2giG`), sin headers literales. Verificado además que la key vieja (la que estaba en texto plano en este repo, ya redactada — ver docs/secret-sanitization-procedure.md y design.md) devuelve 401 contra el Postiz real, igual que una key inválida de control.
- [x] 4.4 Re-importado `codigo.json` en n8n y credenciales reasignadas para los 11 nodos Supabase (confirmado sin íconos rojos) y para los 2 nodos Postiz (desbloqueado por 4.3).
- [~] 4.5 Vinculación de cuentas: no re-verificada puntualmente en esta sesión, pero el flujo se ejercita indirectamente por el uso real del bot (ver 4.6) y por `tests/link-code/verify-link-flow.js` (auditoría estática, en verde). Sin corrida end-to-end dedicada de `/start <código>` documentada acá.
- [~] 4.6 Catálogo: **verificado con datos reales** — upsert vía las 3 ramas del bot (PDF/imagen/texto) y vía la web probado por el usuario el 2026-08-18; confirmado en la base que `products.updated_at` es de esa fecha y el array creció a 43 productos, todavía válido como array (soporta el CHECK de la migración `products_check_array_constraint`, ya aplicada). Publicación por Postiz: **sin verificar** — no hay eventos `post_published_scheduled` en `usage_events` a la fecha de esta nota, o sea que una publicación real todavía no se ejecutó/confirmó post-rotación.
- [x] 4.7 `codigo.json` ya refleja las credenciales de los 11 nodos Supabase + 2 nodos Postiz (verificado por inspección directa del archivo, 2026-08-18); no hizo falta un re-export adicional para esta verificación.

## 5. Documentación del procedimiento de export saneado (anexo de tesis)

- [x] 5.1 Crear `docs/secret-sanitization-procedure.md` con el procedimiento de export sin credenciales: 1) export desde la UI de n8n (incluye solo referencias `id`/`name`, nunca valores); 2) correr el scan de secretos (patrones de task 3.1); 3) reemplazar los `id` reales de credenciales por `<placeholder>` en la copia de anexo; 4) confirmar `pinData` vacío; 5) adjuntar como anexo [A-50].
- [x] 5.2 Documentar en notas de ops la migración: nombres de credenciales, headers conservados, decisión D2 (dependencia del header `apikey`, `Authorization` eliminado), y que la rotación de claves es prerrequisito de la UI — referenciar `design.md`.
- [x] 5.3 Actualizar `HALLAZGOS-DEL-FLUJO-n8n.md` PARTE 0/§0.2 para reflejar la remediación aplicada (nodos migrados a credenciales, export saneado) y lo que queda como acción manual (rotación, purga de historial Git si el repo es público/privado).
