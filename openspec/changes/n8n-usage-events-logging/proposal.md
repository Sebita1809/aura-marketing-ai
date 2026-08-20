## Why

El dashboard de admin (`admin-dashboard-metrics`, aplicado 2026-08-18) ya tiene el sustrato de datos listo — tabla `usage_events`, tabla de precios `ai_model_prices`, y el RPC agregador `admin_dashboard_metrics` — pero está vacío: el workflow n8n (`codigo.json`) genera imágenes, las edita/rehace y publica posts sin escribir ningún registro. Tres de los cuatro KPIs del dashboard (costo estimado, publicaciones, imágenes) muestran hoy el estado degradado "sin datos aún" porque no existe ningún productor de eventos. Este change es ese productor: instrumenta `codigo.json` para que cada acción facturable/contable quede loggeada.

El contrato exacto de qué escribir, con qué payload y en qué puntos del workflow ya está definido y versionado en `docs/usage-events-contract.md` — este change lo implementa, no lo diseña de nuevo.

## What Changes

- **`codigo.json`** — agregar nodos `n8n-nodes-base.httpRequest` (clonados de `HTTP - Upsert producto imagen`, credencial "Supabase Service Role", `Prefer: resolution=ignore-duplicates`) en 8 puntos de inserción, todos con `onError: continueRegularOutput` para no romper el camino feliz (riesgo R5 del change hermano):
  - Después de `Generate an image` → evento `image_generated`.
  - Después de `Edit an image` → evento `image_edited`.
  - Después de `HTTP - Crear post Postiz` → evento `post_published` (`quantity` = cantidad de plataformas).
  - Después de cada uno de los 6 nodos Gemini de texto/moderación/análisis (`Moderar imagen Gemini`, `Moderar video Gemini`, `Clasificador injection Gemini - Generate`, `Clasificador injection Gemini - Edit`, `Analyze document`, `Analyze an image`) → evento `ai_call`, capturando `usageMetadata` cuando el nodo lo expone.
- Cada nodo nuevo arma `event_key` como `<execution_id>:<node_name>:<item_index>` (idempotencia ante reintentos de n8n, ver `usage-events-tracking` spec, requisito "Duplicate event submissions are ignored").
- **Sin cambios de esquema**: no se toca la migración de `admin-dashboard-metrics`; este change solo escribe filas que ya caben en el contrato existente.
- **Verificación offline** siguiendo la convención del repo (`tests/n8n-usage-events-logging/verify-instrumentation.js`): audita estáticamente que los 8 nodos nuevos existen con el tipo/credencial/headers/`event_key` esperados, que están conectados como fan-out del nodo de origen (no reemplazan ni reconectan el camino feliz existente), y que ninguno de los conteos de nodos/conexiones de los changes previos sobre `codigo.json` (`link-code-reproducible`, `error-handling`, `redis-expiration`, etc.) regresiona.

## Capabilities

### New Capabilities
(ninguna — este change no introduce un capability nuevo; implementa un productor para el capability `usage-events-tracking` ya especificado por `admin-dashboard-metrics`)

### Modified Capabilities
- `usage-events-tracking`: el requisito "The event contract for producers is documented in the repository" ya está satisfecho (change previo). Este change no cambia ningún requisito de esa spec — la implementa. Si al instrumentar aparece un caso no cubierto por el contrato (p. ej. un nodo Gemini que no expone `usageMetadata` de la forma documentada), se actualiza el contrato como parte de este change, no se improvisa en `codigo.json`.

## Impact

- **Modificado**: `codigo.json` (+8 nodos `httpRequest` de logging, 0 nodos existentes reconectados).
- **Nuevo**: `tests/n8n-usage-events-logging/verify-instrumentation.js`.
- **Dependencias**: ninguna — reutiliza la credencial "Supabase Service Role" y el patrón HTTP ya existentes.
- **Coordinación**: `codigo.json` tiene otros changes en progreso en paralelo (ver `admin-dashboard-metrics/design.md` Context). Este change agrega nodos nuevos sin tocar los existentes — conflicto de merge de bajo riesgo, pero el recuento total de nodos hay que re-verificarlo contra el estado de `codigo.json` al momento de aplicar, no contra un número fijo de este proposal.
- **Efecto en el dashboard**: una vez aplicado y verificado con una corrida real del bot, los KPIs de costo/publicaciones/imágenes de `admin-dashboard-metrics` dejan de mostrar "sin datos aún" — el `first_event_at` del RPC pasa de `null` a la fecha de la primera corrida instrumentada.
- **Seguridad/gobernanza**: LOW-MEDIUM. No toca Auth, RLS ni el modelo de datos; los nodos nuevos escriben con una credencial `service_role` que ya existe y ya se usa en el mismo workflow. El único requisito no negociable es el de riesgo R5 (loguear no puede romper publicar/generar), que se verifica por script (todos los nodos de logging con `onError: continueRegularOutput`).
