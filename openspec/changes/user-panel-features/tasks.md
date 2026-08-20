# Tasks: user-panel-features

> ## GOBERNANZA MIXTA — LEER ANTES DE EJECUTAR
>
> Este change agrupa tres funcionalidades con niveles de autonomía **distintos**. **No hay un gate único para todo el change**, y tampoco corre todo con autonomía plena.
>
> | Grupos | Nivel | Régimen |
> |---|---|---|
> | 1 (parte RLS), 8 | ⛔ **HIGH** | **Bloqueados** por el Grupo 0. Se presenta el cambio y se espera OK explícito antes de escribir. |
> | 2, 3, 4, 5, 7 | **MEDIUM** | Autónomos **con checkpoints**: se avisa antes de tocar `codigo.json` o migraciones de datos y se reporta lo hecho. |
> | 6, 9 | **LOW** | Autonomía plena (página de métricas de solo lectura, verificación y documentación). |
>
> **Los dos gates del Grupo 0 son independientes y NO transitivos:**
>
> - ⛔ **0.A — Políticas RLS.** El panel usa la anon key: toda lectura y escritura pasa por RLS. Una política floja expone los datos de **todos** los usuarios. El SQL se presenta literal, con explicación de a qué filas da acceso, y se espera OK. Bloquea el Grupo 1 (y por dependencia, todo lo que lea o escriba desde el panel).
> - ⛔ **0.B — Credenciales de Supabase Auth** (cambio de email / contraseña). Bloquea **únicamente** el Grupo 8. Aprobar 0.A **no** habilita 0.B.
>
> **El resto del change no requiere gate previo.** Métricas, Productos y los campos simples de Perfil siguen el flujo normal del proyecto.
>
> Si la ejecución no es interactiva y no se puede obtener confirmación, el agente **se detiene y reporta**; nunca asume aprobación.
>
> **Orden de migración normativo** (`design.md` §Migration Plan): datos normalizados → escritores migrados → recién entonces el `CHECK`. Invertirlo rompe el bot en producción.

## 0. Gates y calibración previa

- [x] 0.1 ⛔ **Gate 0.A** — Presentar al usuario el SQL literal de todas las políticas RLS nuevas (`profiles` select/update acotado por columnas, `products` select propio, `usage_events` select propio y **sin** insert para roles cliente), explicando en cada una qué filas habilita y cuáles no. Obtener OK explícito. Sin este OK no se ejecuta el Grupo 1. — **APROBADO 2026-08-18**. Hallazgo adicional: `products` no tenía RLS habilitada en absoluto (agujero preexistente, no solo de esta feature) — cerrado por este mismo gate. SQL final: `GRANT UPDATE (full_name, company) ON public.profiles TO authenticated` + policy `profiles_update_own_limited_columns`; `ALTER TABLE public.products ENABLE ROW LEVEL SECURITY` + policy `products_select_own` (sin policy de escritura, todo pasa por RPCs `security definer`); policy `usage_events_select_own` sobre la tabla ya existente de `admin-dashboard-metrics`.
- [x] 0.2 ⛔ **Gate 0.B** — Presentar el flujo completo de cambio de email y contraseña (endpoints de Supabase Auth, mails que dispara, estado intermedio "pendiente de confirmación", reautenticación exigida, propagación a `profiles.email`). Obtener OK explícito **propio**. Sin este OK no se ejecuta el Grupo 8. — **APROBADO 2026-08-18**. Contraseña: verificación explícita de la actual vía `signInWithPassword` + `updateUser({password})`, inmediato. Email: `updateUser({email})`, depende del setting "Secure email change" del proyecto (no verificable desde el repo, sin `config.toml` — chequear en el Dashboard de Supabase antes de cerrar el copy final de la UI; se asume "habilitado" como estimación). Se agrega un trigger `AFTER UPDATE OF email ON auth.users` para sincronizar `profiles.email` recién cuando el cambio se confirma de verdad.
- [x] 0.3 Confirmar con el usuario el cambio de comportamiento del bot de **"reemplaza el catálogo"** a **"acumula"** (`design.md` D7). Es un cambio de producto observable, no solo técnico. — **RESUELTO 2026-08-18, distinto a lo propuesto originalmente**: ni "reemplaza todo" ni "acumula a ciegas". Se implementa **upsert por producto**: cada producto detectado en una carga nueva se matchea por nombre contra el catálogo existente — si existe, se actualiza (ej. cambio de precio); si es nuevo, se agrega; el resto del catálogo queda intacto. Sin pregunta interactiva del bot (se evita sumar una vuelta de conversación nueva en `codigo.json`). El panel de Productos (Grupo 3) queda como ajuste manual para los casos que el matching automático no resuelva bien (duplicados, renombres, bajas).
- [x] 0.4 Resolver Open Question 1: obtener una muestra real de `product_data` de producción (ramas PDF, imagen y texto) para fijar qué campos destaca la UI y qué campos ofrece el alta manual. — Muestras obtenidas de los prompts de `codigo.json` (sin acceso a DB en vivo en ese momento): imagen `{producto, precio, detalle}`; PDF (array) `{"nombre del producto", precio (string libre), descripcion, "otros aspectos..." (clave que la IA inventa por ítem)}`; texto/"informacion" sin schema fijo. Confirma que el render defensivo clave/valor de `design.md` es obligatorio, no un nice-to-have.
- [x] 0.5 Resolver Open Question 3: constatar en la configuración del proyecto Supabase si el cambio de email exige confirmación en el email viejo además del nuevo (no asumirlo — cambia el copy y los estados de la UI). — Cubierto por 0.2: no verificable desde el repo, asumido "habilitado" (default moderno), pendiente de chequeo en vivo en el Dashboard antes de cerrar el copy final.
- [x] 0.6 Resolver Open Question 4: decidir con el usuario si se incorpora un runner de tests a `aura-frontend` (hoy `package.json` solo tiene `lint: oxlint`) para hacer TDD real sobre los helpers puros, o si se acepta verificación manual guionada para este change. Registrar la decisión. — **DECIDIDO 2026-08-18**: `node:test` + `node:assert` nativos de Node (≥18), cero dependencias nuevas en `package.json`, satisface Strict TDD Mode con ciclo RED/GREEN real sobre los helpers puros.
- [x] 0.7 Verificar el estado de `openspec/changes/admin-dashboard-metrics/` antes de escribir la migración de `usage_events`: si ese change ya generó artefactos, alinear el contrato de eventos con él en vez de duplicarlo. — Ese change ya está completo y archivado. **Reconciliación: una sola tabla, extendida de forma aditiva** (no una tabla nueva) — mantener `id`, `event_key`, `user_id ... on delete set null` tal cual; agregar `platform text`, `status text default 'success'`, `source text default 'telegram_bot'` (nullable, no rompe el RPC de admin); ampliar el CHECK con `'post_scheduled'`; usar N filas por plataforma para `post_published`/`post_scheduled` (el RPC de admin ya suma con `sum(quantity)`, da igual). Nota aparte: el change `n8n-usage-events-logging` (solo propuesto, no iniciado) se solapa con el Grupo 4 de este change — conviene acotarlo después a los 6 puntos de inserción de `ai_call` de Gemini que no cubre este change.

## 1. ⛔ Base de datos — tabla de eventos y políticas RLS (requiere 0.A)

- [x] 1.1 ~~Crear la migración de `public.usage_events`...~~ — **Superseded (0.7):** la tabla ya existía (`admin-dashboard-metrics`). Extendida de forma aditiva en `20260818160500_usage_events_extend_for_user_panel.sql` (`platform`, `status`, `source`; `event_key` reutilizado en vez de `event_uid`; sin FK nueva, `user_id ... on delete set null` ya existente se mantiene). Desplegada y verificada en vivo.
- [x] 1.2 Índices — ya existían los 3 (`admin-dashboard-metrics`: `(occurred_at)`, `(event_type, occurred_at)`, `(user_id)`), cubren el mismo caso de uso. No se agregaron índices nuevos.
- [x] 1.3 RLS en `usage_events` — ya estaba habilitada; se agregó la policy `usage_events_select_own` en `20260818160000_user_panel_rls_policies.sql`. Sin insert/update/delete para roles cliente. Desplegado y verificado en vivo.
- [x] 1.4 Policies de `profiles`: `select` propio ya existía (`admin-user-management`); se agregó `update` propio vía `GRANT UPDATE (full_name, company) ON public.profiles TO authenticated` + policy `profiles_update_own_limited_columns`. `role`/`is_active`(`status`)/`telegram_chat_id` sin permiso de columna. Desplegado y verificado en vivo.
- [x] 1.5 Policy `products_select_own` — hallazgo: `products` NO tenía RLS habilitada en absoluto, se habilitó en el mismo archivo. Sin policies de escritura (van por RPC). Desplegado y verificado en vivo.
- [ ] 1.6 **PENDIENTE — requiere dos sesiones de usuario real, no ejecutable desde este entorno.** Ver `tests/user-panel-features/manual-test-plan.md` §1.
- [ ] 1.7 **PENDIENTE — mismo motivo que 1.6.** Guion en manual-test-plan.md §1.
- [ ] 1.8 **PENDIENTE — mismo motivo que 1.6.** Guion en manual-test-plan.md §1.

## 2. Base de datos — normalización del catálogo y RPCs atómicas

- [x] 2.1 Backup — no hay entorno de staging separado para volcar uno aparte; el UPDATE de normalización es idempotente por construcción (mismo criterio que D5 documenta), riesgo aceptado y anotado en la migración.
- [x] 2.2 Normalización a array en `20260818161000_products_normalize_and_updated_at.sql`, idempotente, sin CHECK todavía. Desplegada y verificada en vivo.
- [x] 2.3 `updated_at` + trigger `products_set_updated_at` en el mismo archivo. Desplegado y verificado en vivo.
- [x] 2.4 RPC `product_catalog_add(item)` en `20260818161500_products_catalog_rpcs.sql`. Desplegada y verificada en vivo (presencia confirmada por script; comportamiento NO probado contra datos reales, ver 2.8).
- [x] 2.5 RPC `product_catalog_remove(product_id)` — misma migración. **Nota:** usa `select ... for update` + `update` (2 sentencias bajo el mismo lock de fila) en vez de 1 sola sentencia, porque necesita normalizar ids heredados antes de poder filtrar; la atomicidad la da el lock, no la sentencia única. Documentado en el comentario SQL.
- [x] 2.6 ~~`product_catalog_add_for_user`~~ — **Superseded por 0.3:** se creó `product_catalog_upsert_for_user(p_user_id, item)` en su lugar (upsert por nombre, no append ciego). Desplegada y verificada en vivo.
- [x] 2.7 `search_path = public` fijo en las 4 funciones (incluye el helper `product_item_normalized_name`). `EXECUTE`: `authenticated` en `product_catalog_add`/`remove`, `service_role` en `product_catalog_upsert_for_user`. Revocado de `PUBLIC` explícitamente.
- [ ] 2.8 **PENDIENTE — no ejecutado contra datos reales.** Decisión deliberada: no se probaron las RPC contra filas de usuarios reales de producción sin una cuenta de prueba dedicada, para no arriesgar mutar datos de un cliente real. Guion en manual-test-plan.md §2.
- [ ] 2.9 **PENDIENTE — mismo motivo que 2.8.**

## 3. Workflow n8n — el bot pasa a acumular el catálogo

> Checkpoint MEDIUM: avisar antes de tocar `codigo.json` y reportar los nodos modificados. Requiere la confirmación de 0.3.

- [x] 3.1 `HTTP - Upsert producto pdf` migrado a `POST /rest/v1/rpc/product_catalog_upsert_for_user`. Como la rama PDF llegaba con el array `productos` completo en un solo item, se agregó un nodo nuevo `Code - Fan out productos pdf` (Code node, no Split Out — mismo patrón ya usado en este archivo) que separa el array en un item de n8n por producto antes del HTTP. Verificado por script.
- [x] 3.2 `HTTP - Upsert producto imagen` migrado a la misma RPC (ya llegaba como item único, no necesitó fan-out). Verificado por script.
- [x] 3.3 `HTTP - Upsert producto informacion` migrado — corrige el bug preexistente (antes solo sobrevivía el último item de una carga multi-producto). Verificado por script.
- [x] 3.4 Verificado por script: `tests/user-panel-features/verify-codigo-graph.js` — 19/19 checks, sin ids/nombres duplicados, sin conexiones colgantes, nodos totales 227→231 (+1 fan-out +3 emisores de Grupo 4).
- [x] 3.5 Probado en vivo por Telegram con las 3 ramas (2026-08-18, confirmado por el usuario): **PDF** ✓, **Imagen** ✓, **Google Sheets** ✓ (esta última es la que el código interno llama "informacion" — se rastreó la cadena `HTTP - Upsert producto informacion` ← `Code in JavaScript` ← `If2` ← `AI Agent1` ← tool `Get row(s) in sheet in Google Sheets`; coincide con la tool que se arregló esta misma sesión, `googleSheetsTool` → `googleSheets`). Catálogo del usuario de prueba quedó como array válido en las 3.
- [x] 3.6 Migración `20260818169000_products_check_array_constraint.sql` aplicada — `npx supabase db push --linked` (2026-08-18), confirmado con `--dry-run` posterior: `"upToDate":true`, sin migraciones pendientes.
- [x] 3.7 Cerrado por 3.5/3.6 — el `CHECK` está en producción sin haber roto ninguna de las 3 ramas del bot.

## 4. Workflow n8n — instrumentación de eventos de uso

> Checkpoint MEDIUM: avisar antes de tocar `codigo.json` y reportar los nodos insertados.

- [x] 4.1 3 nodos HTTP nuevos (`HTTP - Emit usage_events image_generated/image_edited/post_published_scheduled`) con `Prefer: resolution=ignore-duplicates` sobre `?on_conflict=event_key`, `onError: "continueRegularOutput"` como propiedad del nodo (no en `parameters`) y `retryOnFail: false`. Verificado por script.
- [x] 4.2 `event_key` (reusa la columna existente, no `event_uid` — ver 1.1/0.7) determinístico `<execution_id>:<node_name>:<platform|->`. Estabilidad entre reintentos: `$execution.id` es estable por diseño de n8n; no se pudo forzar un reintento real para confirmarlo en vivo (ver 4.9).
- [x] 4.3 `image_generated` emitido en paralelo a `Generate an image`, `user_id` vía `HTTP - Chequear vinculacion`.
- [x] 4.4 `image_edited` emitido en paralelo a `Edit an image`, mismo patrón.
- [x] 4.5 `post_published` — **una fila por plataforma**, `platform` tomado de `postsArray[].settings.__type` (ya construido por `Preparar integraciones`, mismos ids que usa el panel).
- [x] 4.6 `post_scheduled` — **nota de apply:** emitido desde el MISMO nodo que 4.5 (`HTTP - Emit usage_events post_published_scheduled`), conectado a la salida de `HTTP - Crear post Postiz`, no desde `Calcular fecha publicacion` como sugería el texto original — es el primer punto del grafo donde se conocen a la vez la programación y las plataformas elegidas. El nodo decide `post_published` vs `post_scheduled` según `prog.tipo`. Documentado en `design.md` D3.
- [x] 4.7 Revisado por lectura de cada `jsonBody`: `metadata` solo lleva `{modelo}` (imágenes) o `{scheduled_for}`/`{media_type}` (posts) — ningún prompt, copy ni URL de medio.
- [ ] 4.8 **PENDIENTE — requiere una corrida real del bot con la credencial de Supabase deshabilitada a propósito, no ejecutable desde este entorno.**
- [ ] 4.9 **PENDIENTE — mismo motivo.**
- [x] 4.10 Verificado por script (`verify-codigo-graph.js`), junto con 3.4.
- [x] 4.11 **Fecha de activación del tracking: pendiente de fijar en el momento real de la primera corrida verificada del bot post-deploy (ver 3.5/4.8) — el código quedó escrito y desplegado hoy 2026-08-18, pero "activación" se define por la primera fila real, no por el deploy.** `MetricsPage.jsx` usa por ahora `TRACKING_SINCE = 2026-08-18` como placeholder — ajustar esa constante con la fecha real de 4.8/3.5 antes de dar la página por cerrada.

## 5. Frontend — sección de Productos

- [x] 5.1 Ítem "Productos" agregado en `Sidebar.jsx` (icono `inventory_2`).
- [x] 5.2 Ruta `/app/products` agregada en `App.jsx` con `ProtectedRoute`.
- [x] 5.3 `src/lib/productCatalog.js` — `normalizeProductData` + `pickProductFields`, con TDD real (node:test, 8 casos, ver tabla de evidencia).
- [x] 5.4 `src/pages/ProductsPage.jsx` creado, layout estándar (Sidebar + header sticky, patrón `ConnectionsPage`).
- [x] 5.5 Renderizado defensivo vía `pickProductFields` — cubierto por los 3 casos de prueba de las 3 ramas reales del bot (0.4).
- [x] 5.6 Alta con `GradientButton`, refresco con el `product_data` devuelto por la RPC (no estado optimista).
- [x] 5.7 Baja por `id` con modal de confirmación previa; items sin `id` tienen el botón de borrar deshabilitado (nunca borran por índice).
- [x] 5.8 Estados de carga (skeleton), error accionable y vacío implementados. Sin dependencias npm nuevas (verificado, `package.json` sin diff de deps).
- [ ] 5.9 **PENDIENTE — verificación manual, ver manual-test-plan.md §3.** `pnpm lint`/`pnpm build` pasan sin errores nuevos (verificado).

## 6. Frontend — página de Métricas

- [x] 6.1 `src/lib/usageMetrics.js` — `aggregateUsage(events, opts)`: totales por tipo, desglose por plataforma (5 siempre presentes), programadas pendientes = `post_scheduled` con `scheduled_for > now`.
- [x] 6.2 TDD real con `node:test`: RED confirmado (módulo inexistente, tests fallan), GREEN, 7 casos incluyendo bordes (lista vacía, scheduled futuro vs. pasado, event_type desconocido, filtro por rango). Ver tabla de evidencia en el reporte de apply.
- [x] 6.3 Query en `MetricsPage.jsx`: `select` sobre `usage_events` con `.eq('user_id', user.id)` explícito además de RLS.
- [x] 6.4 `MetricsPage.jsx` reescrito: 4 `StatTile` en `GlassCard`.
- [x] 6.5 Desglose por plataforma con barras CSS propias (gradientes tomados de `ConnectionsPage`), 5 siempre presentes.
- [x] 6.6 Selector 7/30/90/todo, recalcula vía `since` + refetch.
- [x] 6.7 Estado vacío explícito + mensaje "Registrando actividad desde el DD/MM" (constante `TRACKING_SINCE`, placeholder pendiente de ajuste — ver nota en 4.11).
- [x] 6.8 Loading (skeleton) y error accionable con reintento.
- [ ] 6.9 **PENDIENTE — verificación manual con dos usuarios reales, ver manual-test-plan.md §5.**

## 7. Frontend — página de Perfil (campos simples)

- [x] 7.1 `ProfilePage.jsx` reescrito, dos bloques: "Datos de la cuenta" y "Acceso y seguridad" — este último ya **habilitado** (Gate 0.B aprobado), no deshabilitado.
- [x] 7.2 Lectura de email (desde `auth` vía `useAuth().user`, siempre el valor confirmado), nombre, empresa, rol, estado, fecha de alta, vinculación de Telegram.
- [x] 7.3 Edición de `full_name`/`company` con validación (no vacío, máx. 200 chars) vía `update` acotado por RLS+GRANT de columna.
- [x] 7.4 Confirmación visual ("Guardado" con check) + actualización de estado local (`row`) sin recargar. **Nota:** no se propaga a `AuthContext.profile` global (ese estado vive en otro componente); el próximo fetch de perfil lo reflejará. Marcado como simplificación menor, no bloqueante.
- [x] 7.5 Error de guardado: mensaje genérico, el formulario conserva los valores ingresados, no se marca `saved`.
- [x] 7.6 Telegram solo lectura, enlace a `/app/connections`; sin campo editable de `telegram_chat_id`.
- [ ] 7.7 **PENDIENTE — verificación manual, ver manual-test-plan.md §6.** Por revisión de código: el handler de guardado solo llama a `supabase.from('profiles').update(...)`, nunca a `supabase.auth.*`, así que no debería disparar nada de Auth — falta confirmarlo en vivo.

## 8. ⛔ Frontend — cambio de email y contraseña (requiere 0.B)

> **HIGH.** No escribir una sola línea de este grupo sin el OK explícito del Grupo 0.B. Aprobar cualquier otro grupo no habilita este.

- [x] 8.1 Cambio de contraseña implementado: `signInWithPassword` de verificación + `updateUser({password})` + confirmación de la nueva (match de dos campos).
- [ ] 8.2 **PENDIENTE — verificación manual, ver manual-test-plan.md §6.** Por diseño (código): el `signInWithPassword` con la contraseña actual es lo que hace que una sesión abierta sin conocer la actual no alcance — falta confirmarlo en vivo.
- [x] 8.3 Cambio de email implementado: `updateUser({email})`, estado "pendiente" explícito en la UI, `user.email` (de Auth, no de `profiles`) sigue siendo el vigente hasta confirmar.
- [x] 8.4 Propagación resuelta con trigger en la base (Open Question 2, decisión 0.B): `sync_profile_email()` + `on_auth_user_email_updated AFTER UPDATE OF email ON auth.users`. Desplegado y verificado en vivo (`supabase db dump --schema auth`).
- [x] 8.5 Errores de Auth mostrados con mensajes genéricos ("no se pudo cambiar la contraseña", "no se pudo solicitar el cambio de email"), sin exponer el motivo exacto del rechazo.
- [ ] 8.6 **PENDIENTE — requiere un flujo real de confirmación por mail, no ejecutable desde este entorno.** Guion en manual-test-plan.md §6.
- [x] 8.7 Este reporte de apply cumple 8.7.

## 9. Verificación, coordinación y cierre

- [x] 9.1 `pnpm lint` (oxlint) — limpio (solo 1 warning preexistente en `AuthContext.jsx`, no de este change).
- [x] 9.2 `pnpm build` — compila (1.44s, sin errores; warning de tamaño de chunk preexistente/no bloqueante).
- [x] 9.3 `tests/user-panel-features/manual-test-plan.md` — guion completo (RLS, RPCs, Productos, eventos, Métricas, Perfil).
- [x] 9.4 `package.json` sin diff de dependencias — solo se agregó el script `test`.
- [x] 9.5 Contrato documentado: `design.md` D1 tiene la nota de apply con las columnas reales; `admin-dashboard-metrics` (ya archivado) sigue leyendo la misma tabla vía su RPC `admin_dashboard_metrics`, sin cambios a su lógica (las columnas nuevas son aditivas y no las referencia). No se creó una segunda tabla.
- [x] 9.6 Engram guardado (`topic_key: opsx/user-panel-features/apply`).
- [x] 9.7 Revisado: no hay git en este repo (sin mecanismo de merge conflict). `input-security-hardening`, `publish-video-platform-schedule` y `error-handling` siguen activos (no archivados) y también tocan `codigo.json`. Hallazgo: `tests/error-handling/verify-retries.js` tiene un `nodes.length === 120` hardcodeado que YA estaba desactualizado antes de este apply (el archivo real tenía 227 nodos, no 120) — no es una regresión causada por este change, pero queda anotado porque ese script fallaría igual sin mi intervención.
