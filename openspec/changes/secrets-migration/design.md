# Design: secrets-migration

## Context

El workflow n8n del bot "Aura" (116 nodos, export en `codigo.json`) autentica 12 nodos HTTP genéricos (`n8n-nodes-base.httpRequest`) con **headers literales con secretos**:

- **10 nodos Supabase** consultan/insertan en `https://legffrhakunfignlaftl.supabase.co/rest/v1/...` con los headers `apikey` y `Authorization: Bearer <JWT>` (el JWT `service_role`, idéntico en ambos, aparece 20 veces en total). El JWT: `eyJhbGciOiJIUzI1NiIs...` (payload `role: service_role`, `exp` 2098337019 ≈ año 2036).
- **2 nodos Postiz** postean a `http://postiz:5000/api/public/v1/upload` y `/api/public/v1/posts` con header literal `Authorization: <ROTADA-2026-08-18-ver-nota-en-tasks.md-4.1>` (API key, sin prefijo `Bearer`).

El resto del workflow ya usa credenciales n8n correctamente: `telegramApi` (Telegram), `redis` (Redis), `googlePalmApi` (Gemini), `googleSheetsOAuth2Api` (Google Sheets). Es decir: el patrón de "credencial gestionada" ya es la convención del proyecto; estos 12 nodos son la excepción por usar el nodo HTTP genérico con headers escritos a mano.

**Restricciones del entorno (verificadas):**
- `n8nio/n8n:latest` en Docker (`docker-compose.yml`); los exports de n8n incluyen las credenciales como **referencias** (`credentials: { <tipo>: { id, name } }`), nunca sus valores.
- En un nodo, el objeto `credentials` es un mapa claveado **por tipo de credencial** → un nodo puede tener **una sola** credencial `httpHeaderAuth`. Esto impide mantener DOS headers secretos vía credencial en un mismo nodo.
- `codigo.json` tiene `pinData` pero vacío (no hay datos pineados que dupliquen secretos).
- Windows host, PowerShell. `codigo.json` es la fuente editable para este cambio; n8n (UI) es la fuente de verdad del workflow y el re-import lo confirma.

## Goals / Non-Goals

**Goals:**
- Eliminar de `codigo.json` todo valor literal secreto (JWT `service_role`, API key de Postiz, headers `apikey`/`Authorization` con valores).
- Reemplazarlos por credenciales n8n de tipo Header Auth (`httpHeaderAuth`), referenciadas por nombre.
- Conservar el comportamiento funcional exacto de los 12 nodos (mismos endpoints, métodos, bodies y headers no secretos).
- Proveer verificación automatizable de "cero secretos" sobre el export.
- Documentar el procedimiento de export saneado para el anexo de la tesis (export sin credenciales).

**Non-Goals:**
- **No** rotar la clave `service_role` ni la API key de Postiz (acción manual del usuario en Supabase/Postiz; solo se documenta como prerrequisito).
- **No** borrar el nodo huérfano `HTTP Request` (literal `{chat_id}`) — su eliminación es un cambio bug-fix aparte; acá solo se le migran las credenciales.
- **No** tocar la cadena ClamAV del cambio `pdf-virus-scan` (`IF - Límite de tamaño PDF`, `Escaneo ClamAV`, `IF - PDF limpio`, `PDF muy grande`, `PDF rechazado`) ni los otros 104 nodos.
- **No** limpiar el historial de Git de repositorios externos (fuera de alcance; el usuario decide si purga el historial).
- **No** mover a variables de entorno del contenedor n8n los secretos (`$env`): la dirección pedida es credenciales n8n (ver D1).
- **No** alterar `docker-compose.yml` (los secretos del servicio Postiz, p.ej. `FACEBOOK_APP_SECRET`, no viven en `codigo.json` y quedan fuera de este cambio).
- **No** cambiar la URL del proyecto Supabase (no es un secreto; es el endpoint que los nodos necesitan).

## Decisions

### D1. Tipo de credencial: n8n **Header Auth genérica** (`httpHeaderAuth`)

Cada nodo afectado pasa de `sendHeaders` con valores literales a la autenticación por credencial genérica del nodo HTTP Request:

```jsonc
// ANTES (nodo Supabase, extracto)
"parameters": {
  "url": "=https://legffrhakunfignlaftl.supabase.co/rest/v1/products?user_id=eq.{{ $('HTTP - Chequear vinculacion').item.json.id }}&select=product_data",
  "sendHeaders": true,
  "headerParameters": {
    "parameters": [
      { "name": "apikey", "value": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
      { "name": "Authorization", "value": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }
    ]
  },
  "options": {}
}

// DESPUÉS (mismo nodo, extracto)
"parameters": {
  "url": "=https://legffrhakunfignlaftl.supabase.co/rest/v1/products?user_id=eq.{{ $('HTTP - Chequear vinculacion').item.json.id }}&select=product_data",
  "authentication": "genericCredentialType",
  "genericAuthType": "httpHeaderAuth",
  "sendHeaders": false
},
"credentials": {
  "httpHeaderAuth": {
    "id": "<placeholder>",
    "name": "Supabase Service Role"
  }
}
```

- `"authentication": "genericCredentialType"` + `"genericAuthType": "httpHeaderAuth"` es el par que el nodo HTTP Request usa para activar una credencial genérica de tipo Header Auth.
- Si quedan headers no secretos (D3), se conserva `"sendHeaders": true` con `headerParameters` depurado.
- El `id` de la credencial en el export se reemplaza por el placeholder `<placeholder>` (el import de n8n asocia por `name`).

**Alternativas descartadas:**
- **Variables de entorno (`=$env.VAR`) en `headerParameters`**: funcionaría pero exige configurar env en el contenedor n8n, duplica la gestión de secretos fuera de n8n y no aprovecha el sistema de credenciales que el proyecto ya usa para el resto del bot.
- **Tipo de credencial predefinido** (p.ej. `supabaseApi`): n8n no expone un tipo Supabase utilizable desde un nodo HTTP Request genérico.
- **Nodo Code que inyecte headers**: más complejo, sin beneficios, y rompe el patrón de credenciales.

### D2. Nombres de credenciales y mapeo de headers

Dos credenciales Header Auth, una por proveedor:

| Credencial (name) | Header que aporta | Valor | Nodos que la usan |
|---|---|---|---|
| `Supabase Service Role` | `apikey` | JWT `service_role` (rotado) | 10 nodos Supabase |
| `Postiz API Key` | `Authorization` | API key de Postiz (rotada) | 2 nodos Postiz |

**Supabase — se elimina el header `Authorization: Bearer <jwt>`:** ambos headers llevan el MISMO JWT `service_role`. La restricción "una sola credencial `httpHeaderAuth` por nodo" (D-context) impide conservar dos headers secretos vía credencial, y el header `apikey` (que ya está presente hoy y seguirá estándolo vía credencial) es suficiente para que el gateway de Supabase autentique la petición con ese JWT. Se elimina el `Authorization` redundante. **Fallback documentado:** si en el entorno real el gateway exigiera ambos (no esperado), la alternativa es una segunda credencial Header Auth `Supabase Service Role Bearer` (header `Authorization`, valor `Bearer <jwt>`) en los nodos que lo requieran — sujeto a que la versión de n8n permita múltiples credenciales por nodo.

**Postiz — sin prefijo `Bearer`:** el header actual es `Authorization: 704b5278...` (la API key pelada). La credencial debe reproducir exactamente eso: name header `Authorization`, value la API key tal cual.

### D3. Headers no secretos conservados como literales

Se conservan los headers que no son secretos en `headerParameters` (con `sendHeaders: true`):

- `Redis1`, `Redis10`, `Redis21` → `Prefer: resolution=merge-duplicates` (control de upsert de PostgREST).
- `HTTP - Crear post Postiz` → `Content-Type: application/json` (el `specifyBody: json` no lo agrega automáticamente en este nodo).

Los demás nodos quedan con `sendHeaders: false` y sin `headerParameters`.

### D4. Alcance sobre los nodos

Los 12 nodos afectados y su agrupación por perfil de headers:

**Grupo A — sin headers no secretos (7):** `Redis`, `Redis2`, `HTTP Request` (huérfano, literal `{chat_id}` — se migra, no se borra), `HTTP - Chequear vinculacion`, `HTTP Request1`, `HTTP - Perfil publicacion`, `HTTP - Cuenta Instagram publicacion`. Quedan con `sendHeaders: false`, sin `headerParameters`.

**Grupo B — conservan `Prefer` (3):** `Redis1`, `Redis10`, `Redis21` (POST upsert a `/products?on_conflict=user_id`). Quedan con `sendHeaders: true` y `headerParameters` solo con `Prefer`.

**Postiz (2):** `HTTP - Subir imagen Postiz` (sin headers no secretos) y `HTTP - Crear post Postiz` (conserva `Content-Type: application/json`).

Los nodos conservan íntegros `type`, `typeVersion`, `position`, `id`, `name`, `url`, `method`, `sendBody`/`specifyBody`/`jsonBody`, `bodyParameters` (el multipart de `HTTP - Subir imagen Postiz`), `alwaysOutputData` y `options`. **No se modifica ninguna conexión** (bloque `connections` queda intacto).

### D5. Verificación de "cero secretos" en `codigo.json`

Reglas automatizables sobre el archivo final:

1. `eyJ` → **0** ocurrencias (ningún JWT).
2. `<ROTADA-2026-08-18-ver-nota-en-tasks.md-4.1>` (API key Postiz) → **0**.
3. `Bearer ` → **0** (ningún header de autorización literal).
4. `"apikey"` como valor de header → **0**.
5. `supabase.co` → exactamente **10** ocurrencias (las URLs de los nodos; la URL no es un secreto).
6. Los 12 nodos tienen `"authentication":"genericCredentialType"`, `"genericAuthType":"httpHeaderAuth"` y bloque `credentials.httpHeaderAuth` con `name` correcto.
7. `Get-Content -Raw | ConvertFrom-Json` parsea sin error; recuento de nodos sigue en 116; los 5 nodos de la cadena ClamAV no fueron tocados (verificar por nombre/id).

### D6. Export saneado para el anexo de la tesis

Los exports de n8n **no incluyen valores de credenciales**: el JSON guarda solo `credentials: { <tipo>: { id, name } }`, mientras que los valores viven en la base de datos de n8n. Una vez migrado, el export queda limpio por construcción. Procedimiento documentado (task 5.1, `docs/secret-sanitization-procedure.md`):

1. Exportar el workflow desde la UI de n8n (Workflows → ... → Export).
2. Verificar con el scan de D5 que no hay secretos.
3. Para la versión de anexo, reemplazar los `id` reales de credenciales por `<placeholder>` (evita filtrar UUIDs internos de n8n) y confirmar que `pinData` está vacío.
4. Adjuntar el export saneado como anexo [A-50] junto con esta documentación.

## Risks / Trade-offs

| Riesgo | Mitigación |
|---|---|
| Eliminar el header `Authorization` en los nodos Supabase rompe la autenticación si el gateway lo exigiera | Baja probabilidad: ambos headers llevan el mismo JWT y `apikey` ya está presente hoy; se valida funcionalmente en la task pending-manual 4.5/4.6. Fallback documentado en D2 (segunda credencial). |
| El import de `codigo.json` en n8n no asocia automáticamente las credenciales por nombre | El import de n8n resuelve por `name`; si no, se asocia manualmente en el editor (task 4.4 pending-manual). Los `id` con `<placeholder>` se ignoran para el match. |
| Quedar un secreto residual fuera de los 12 nodos (p.ej. en `pinData`, expresiones, otra rama) | `pinData` está vacío hoy; el scan D5 (grep `eyJ`, API key, `Bearer `) sobre el archivo completo lo detecta; se agrega verificación en la task 3.1. |
| El valor `<placeholder>` como `id` de credencial rompe el export al re-importar | No: n8n no valida el formato del id en el import y asocia por nombre; se confirma en la task pending-manual 4.4. |
| Editar `codigo.json` sin reflejarlo en n8n (y viceversa) deja el export desincronizado | Convención del proyecto (igual que `pdf-virus-scan`): n8n es la fuente de verdad; el re-import (task 4.4) sincroniza; el export final (task 4.7) vuelve a `codigo.json`. |
| El usuario crea credenciales con nombres distintos a los planeados y el re-import no matchea | Se documentan los nombres exactos ("Supabase Service Role", "Postiz API Key") en tasks 4.2/4.3; si el usuario elige otros, ajustar los `name` en `codigo.json` antes del re-import. |
| La rotación de claves no se hace (quedan válidas a pesar de la migración) | La migración no invalida la clave vieja; la rotación es prerrequisito explícito (task 4.1, fuera de scope de implementación) y condición para considerar el incidente cerrado (PARTE 0 de `HALLAZGOS-DEL-FLUJO-n8n.md`). |

## Migration Plan

**Deploy (orden):**
1. **Rotación (manual, fuera de scope):** rotar `service_role` en Supabase (Project Settings → API → Rotate) y la API key de Postiz; registrar los nuevos valores en un gestor de secretos (no en el repo).
2. **Implementación:** editar `codigo.json` (tasks 1–2), correr el scan de verificación (task 3) hasta obtener cero secretos.
3. **n8n UI (pending-manual):** crear las credenciales "Supabase Service Role" y "Postiz API Key" (Header Auth), re-importar `codigo.json`, asociar por nombre, guardar.
4. **Verificación funcional (pending-manual):** vinculación de cuenta por código, upsert de catálogo, publicación por Postiz; re-exportar `codigo.json` para dejarlo sincronizado.
5. **Anexo:** documentar el procedimiento de export saneado (`docs/secret-sanitization-procedure.md`) y regenerar el export del anexo [A-50].

**Rollback:**
- Restaurar `codigo.json` desde el estado previo (backup del archivo o control de versiones) y re-importar en n8n; el workflow vuelve a los headers literales (estado actual, con los secretos — se recomienda NO hacer rollback sin antes rotar las claves).
- Las credenciales creadas en n8n pueden eliminarse desde Settings → Credentials sin efecto sobre otros workflows.

## Open Questions

- **Confirmación del usuario:** ¿se acepta la decisión D2 de depender del header `apikey` únicamente (eliminando el `Authorization` redundante) en los nodos Supabase, o se prefiere el fallback de dos credenciales? (Defecto: `apikey` solo.)
- **Nombres exactos de credenciales:** ¿"Supabase Service Role" y "Postiz API Key" son los nombres definitivos? El re-import matchea por nombre exacto.
- **Rotación:** ¿cuándo se ejecuta la rotación de `service_role` y de la API key de Postiz? Debe ocurrir antes de crear las credenciales en n8n (task 4.1).
- **Export del anexo:** ¿se adjunta el export saneado de `codigo.json` como anexo [A-50] con los `id` de credenciales en `<placeholder>`? (Defecto: sí.)
