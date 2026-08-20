# Notas de ops — Migración de secretos a credenciales Header Auth de n8n

Cambio: `secrets-migration` — ver `openspec/changes/secrets-migration/` (`design.md`, `specs/secrets-http-auth/spec.md`, `tasks.md`).

## Resumen

Los 12 nodos HTTP genéricos (`n8n-nodes-base.httpRequest`) de `codigo.json` autenticaban con **headers literales con secretos**: 10 nodos Supabase con el JWT `service_role` (`apikey` + `Authorization: Bearer <jwt>`) y 2 nodos Postiz con la API key (`Authorization: 704b...`). Se migraron a **credenciales genéricas de tipo Header Auth** (`httpHeaderAuth`) referenciadas por nombre. El export de n8n guarda credenciales como referencias `{ id, name }`, nunca sus valores; por lo tanto `codigo.json` quedó **sin secretos** (verificado: `eyJ`=0, API key=0, `Bearer `=0, `"apikey"`=0, `supabase.co`=10 — solo URLs).

## Credenciales a crear en la UI de n8n

En n8n: **Settings → Credentials → New → HTTP Header Auth**. Los nombres deben coincidir **exactamente** (el re-import matchea por `name`; los `id` con `<placeholder>` no se usan para el match).

| Nombre de credencial (name) | Header Name | Header Value | La usan |
|---|---|---|---|
| `Supabase Service Role` | `apikey` | JWT `service_role` **rotado** | 10 nodos Supabase (`Redis`, `Redis1`, `Redis2`, `Redis10`, `Redis21`, `HTTP Request`, `HTTP - Chequear vinculacion`, `HTTP Request1`, `HTTP - Perfil publicacion`, `HTTP - Cuenta Instagram publicacion`) |
| `Postiz API Key` | `Authorization` | API key de Postiz **rotada**, **sin** el prefijo `Bearer` | 2 nodos Postiz (`HTTP - Subir imagen Postiz`, `HTTP - Crear post Postiz`) |

> La clave Postiz actual se usaba como `Authorization: 704b5278...` (la API key pelada, sin `Bearer`). La credencial debe reproducir exactamente eso: header `Authorization` con el valor tal cual (decisión D2 de `design.md`).

## Headers no secretos conservados

Se conservaron como literales (los únicos que siguen vivos en `headerParameters`):

- `Redis1`, `Redis10`, `Redis21` → `Prefer: resolution=merge-duplicates` (control de upsert de PostgREST). Estos tres nodos conservan `"sendHeaders": true`.
- `HTTP - Crear post Postiz` → `Content-Type: application/json` (`"sendHeaders": true`; el `specifyBody: json` no lo agrega automáticamente en este nodo).

Los demás 8 nodos migrados quedaron con `"sendHeaders": false` y sin `headerParameters`. Total de bloques `headerParameters` en el archivo: 4 (los 3 `Prefer` + el `Content-Type`).

## Decisión de diseño D2 — `Authorization` eliminado en los nodos Supabase

- Los headers `apikey` y `Authorization` llevaban el **mismo** JWT `service_role`.
- n8n permite **una sola** credencial `httpHeaderAuth` por nodo → no se pueden mantener dos headers secretos vía credencial en un mismo nodo.
- El header `apikey` (presente hoy y que la credencial sigue aportando) es suficiente para que el gateway de Supabase autentique la petición con ese JWT; el `Authorization` era redundante y se eliminó (0 ocurrencias de `Authorization` en el archivo).
- **Fallback documentado (solo si la validación funcional fallara):** una segunda credencial Header Auth `Supabase Service Role Bearer` (header `Authorization`, valor `Bearer <jwt>`) en los nodos que lo requieran — sujeto a que la versión de n8n permita múltiples credenciales por nodo. No se espera necesario.

## Orden de ejecución en el entorno real (pending-manual)

> Estas tareas son las de la sección 4 de `openspec/changes/secrets-migration/tasks.md` (pendientes manuales). Requieren el stack levantado (`docker compose up -d`) y acceso a la UI de n8n y a Supabase/Postiz.

1. **Rotación de claves (prerrequisito absoluto, fuera de scope de implementación):**
   - Rotar el `service_role` en Supabase: **Project Settings → API → Rotate**.
   - Rotar la API key de Postiz.
   - Guardar los nuevos valores en un **gestor de secretos** (NO en el repo). La migración no invalida las claves viejas: mientras no roten, siguen siendo válidas y el incidente no está cerrado.
2. **Crear las credenciales** "Supabase Service Role" y "Postiz API Key" en n8n (tabla de arriba) — **después** de rotar, para que los valores rotados sean los que queden guardados en n8n.
3. **Re-importar `codigo.json`** en n8n (Workflows → New → Import from File), verificar que los 12 nodos asocian las credenciales por nombre y guardar; si n8n no matchea por nombre, asociar manualmente en cada nodo.
4. **Verificación funcional:** vinculación de cuenta (`/start <código>` → `HTTP - Chequear vinculacion`, `HTTP Request1`), upsert de catálogo (`Redis1`/`Redis10`/`Redis21`), publicación por Postiz (`HTTP - Subir imagen Postiz` + `HTTP - Crear post Postiz`).
5. **Re-exportar** el workflow desde n8n y sobrescribir `codigo.json` para dejarlo sincronizado; correr de nuevo el scan de la sección "Verificación" del anexo (`docs/secret-sanitization-procedure.md` §2).

## Rollback

Restaurar `codigo.json` desde el estado previo (backup o control de versiones) y re-importar en n8n devuelve el flujo a los headers literales. **No hacer rollback sin antes rotar las claves** (el rollback reintroduce los secretos viejos en el archivo). Las credenciales creadas en n8n pueden eliminarse desde Settings → Credentials sin afectar otros workflows.

## Archivos relacionados

- `openspec/changes/secrets-migration/design.md` — decisiones D1–D6 y plan de migración.
- `openspec/changes/secrets-migration/specs/secrets-http-auth/spec.md` — especificación técnica.
- `docs/secret-sanitization-procedure.md` — procedimiento de export saneado para el anexo [A-50].
- `HALLAZGOS-DEL-FLUJO-n8n.md` §0.2 y §0.4 — alerta de seguridad original y estado de remediación.
