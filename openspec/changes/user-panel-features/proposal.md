## Why

El panel de usuario de Aura (`aura-frontend/`) tiene hoy **tres de sus cuatro secciones vacías o inexistentes**. `MetricsPage.jsx` y `ProfilePage.jsx` (ambas ya ruteadas en `App.jsx` y visibles en el `Sidebar` con los labels "Métricas" y "Perfil") son placeholders literales — 51 líneas cada una, sin una sola query, con el texto *"Esta sección estará disponible próximamente"*. Y no existe ninguna sección de Productos, pese a que el catálogo del usuario (`products.product_data`) es el insumo central que el bot usa para generar publicidades: hoy el usuario **no tiene forma de ver, corregir ni borrar** lo que el bot le extrajo de sus PDFs e imágenes, ni de saber cuánto usó el servicio.

El pedido concreto del usuario es cerrar esas tres brechas: ver su uso (imágenes y publicaciones, con desglose por red social), poder editar los datos de su cuenta de Aura, y administrar su catálogo de productos.

## What Changes

> **Gobernanza — MIXTA.** Este change agrupa tres funcionalidades con niveles de autonomía **distintos**. No hay un único gate para todo el change:
>
> | Bloque | Nivel | Régimen de ejecución |
> |---|---|---|
> | Métricas (página, solo lectura) | **LOW** | Autonomía plena. |
> | Instrumentación de eventos en `codigo.json` + tabla `usage_events` | **MEDIUM** | Implementar con checkpoints; decisiones no obvias se elevan al usuario. |
> | Productos (ver / agregar / eliminar) | **MEDIUM** *(subido desde LOW — ver justificación abajo)* | Implementar con checkpoints. |
> | Perfil — campos simples (`full_name`, `company`) | **MEDIUM** | Implementar con checkpoints. |
> | Perfil — **credenciales de Supabase Auth (email / contraseña)** | ⛔ **HIGH** | **Grupo 0.B bloqueante**: se describe el cambio y se espera OK explícito del usuario ANTES de escribir código. |
> | **Políticas RLS** nuevas sobre `profiles`, `products`, `usage_events` | ⛔ **HIGH** | **Grupo 0.A bloqueante**: el SQL se presenta y se aprueba antes de aplicarse. Una política mal escrita expone los datos de TODOS los usuarios. |
>
> Los dos gates son **independientes y no transitivos**: aprobar 0.A no habilita 0.B ni viceversa. El resto del change (página de métricas, página de productos, campos simples de perfil) corre con el flujo normal del proyecto, **sin** gate previo. Detalle operativo en `design.md` §Gobernanza y en la cabecera de `tasks.md`.

### 1. Página de Métricas (`/app/metrics`) — reemplaza el placeholder

- Tarjetas de uso del **usuario autenticado**: imágenes generadas, imágenes editadas, publicaciones realizadas, publicaciones programadas pendientes.
- **Desglose por red social** (`instagram`, `facebook`, `threads`, `twitter`/X, `linkedin` — las cinco que hoy soporta `ConnectionsPage`) para las publicaciones.
- Selector de rango temporal (7 / 30 / 90 días / todo) y serie temporal simple de actividad.
- Estados explícitos de vacío ("todavía no hay actividad registrada") y de **corte histórico**: las métricas solo existen **desde la activación del tracking**, porque hoy no hay ninguna fuente de la cual reconstruir el pasado. Esto se comunica en la UI, no se disimula.

### 2. Instrumentación de uso — tabla `usage_events` + eventos en el workflow n8n

Hoy **no existe ningún registro** de cuántas imágenes generó un usuario ni cuántas publicaciones hizo: ni en Supabase, ni en Redis (que solo guarda estado transitorio con TTL), ni en `codigo.json`. Sin instrumentación, la página de Métricas no tiene qué mostrar. Este change **crea la fuente de verdad**:

- Tabla nueva `public.usage_events` (append-only, una fila por evento, con `user_id`, `event_type`, `platform`, `occurred_at` y `event_uid` único para idempotencia).
- Emisión de eventos desde `codigo.json` en los puntos donde el hecho realmente ocurre: después de `Generate an image`, de `Edit an image`, y de `HTTP - Crear post Postiz` (un evento por plataforma publicada, más el caso programado que pasa por `Calcular fecha publicacion`).
- La emisión es **fire-and-forget**: telemetría, nunca un control. Si falla el registro del evento, el flujo del usuario continúa igual (`onError: continueRegularOutput`) — política deliberadamente **opuesta** al fail-closed de los controles de seguridad del proyecto (`pdf-virus-scan`, `input-security-hardening`).

> **Coordinación con `admin-dashboard-metrics`.** Ese change hermano necesita exactamente la misma instrumentación, pero agregada sobre todos los usuarios. Al momento de escribir esta propuesta, `openspec/changes/admin-dashboard-metrics/` contiene **únicamente su `.openspec.yaml`** (cero artefactos): este change llega primero a la decisión, así que **define y es dueño de la tabla `usage_events` y de la instrumentación en `codigo.json`**. `admin-dashboard-metrics` **debe reutilizarla** — misma tabla, mismas columnas, mismos `event_type` — cambiando únicamente la agregación (sin `WHERE user_id = auth.uid()`, más una política RLS de lectura para `role = 'admin'` que es responsabilidad de ese change). **No debe proponerse una segunda tabla de métricas.** El contrato de eventos queda documentado en `design.md` §Contrato de eventos, que es la interfaz entre ambos changes.

### 3. Página de Perfil (`/app/profile`) — reemplaza el placeholder

- **Lectura**: email, nombre, empresa, rol, estado de vinculación con Telegram, fecha de alta.
- **Edición autónoma (MEDIUM)**: `full_name` y `company` en `public.profiles`.
- ⛔ **Edición con gate HIGH**: **cambio de email y cambio de contraseña** vía `supabase.auth.updateUser()`. No son "un campo más de un formulario": el email es el identificador de login y su cambio en Supabase dispara un flujo de doble confirmación (mail al viejo y al nuevo) que deja la cuenta en un estado intermedio; la contraseña es la credencial de acceso. Además, `profiles.email` se muestra en el `AdminPanel`, con lo cual un cambio de email en Auth deja las dos fuentes desincronizadas si no se propaga. Toda esta sub-parte queda detrás del **Grupo 0.B** de `tasks.md`.
- **Fuera de alcance, explícitamente**: editar `telegram_chat_id` desde el panel. Ese campo es el **binding de identidad** que el bot usa (`HTTP - Chequear vinculacion` resuelve `profiles.telegram_chat_id → profiles.id`); permitir escribirlo a mano habilitaría a un usuario a apropiarse del canal de otro. La vinculación sigue siendo responsabilidad exclusiva del flujo de códigos ya entregado por `link-code-reproducible`. En Perfil se muestra **solo lectura**, con enlace a ese flujo.

### 4. Sección nueva de Productos (`/app/products`) — item de navegación nuevo

- Ítem nuevo en el `Sidebar` de usuario (hoy solo Conexiones / Métricas / Perfil) + ruta protegida nueva en `App.jsx`.
- Listado del catálogo, alta manual de un producto y baja de un producto.
- **El modelo de datos obliga a un diseño no estándar** (ver `design.md`): `products` tiene **una fila por usuario** (`products_user_id_unique`) y el catálogo entero vive embebido en la columna `product_data jsonb`. No es un CRUD relacional.
- **BREAKING (datos, no API): normalización de `product_data` a array.** El relevamiento del workflow encontró que hoy la columna es **polimórfica y se sobreescribe entera**: la rama PDF escribe un **array** (`product_data: $json.productos`), la rama de imagen escribe un **objeto suelto** (`{producto, precio, detalle}`), y la rama de texto/información hace un POST **por cada producto**, con lo cual solo sobrevive el último. Los tres nodos (`HTTP - Upsert producto pdf`, `HTTP - Upsert producto imagen`, `HTTP - Upsert producto informacion`) hacen `POST ...?on_conflict=user_id` con `Prefer: resolution=merge-duplicates` y **pisan el documento completo**: hoy el bot ya destruye el catálogo previo en cada carga. Este change normaliza `product_data` a **siempre array** (migración con backfill) y convierte las escrituras del bot en **append atómico**, para que lo que el usuario agregue desde el panel no lo borre el bot en la siguiente carga.

**Por qué Productos sube de LOW a MEDIUM** (la tabla de gobernanza del proyecto ubicaría un CRUD de catálogo en LOW, "full autonomy si los tests pasan"): porque acá no hay aislamiento por fila. Un `UPDATE` mal formado sobre `product_data` no corrompe *un* producto, **borra el catálogo entero del usuario en una sola sentencia**, y hay un **segundo escritor concurrente** (el bot, con service role y semántica de sobreescritura total) sobre el mismo documento. Es pérdida de datos de usuario, no un CRUD aislado. Se ejecuta con checkpoints.

## Capabilities

### New Capabilities

- `user-usage-metrics`: Página de métricas del usuario autenticado — totales de imágenes generadas/editadas, publicaciones realizadas y programadas, desglose por red social, rango temporal y estados de vacío/corte histórico. Solo lectura, siempre acotada a `auth.uid()`.
- `usage-event-tracking`: Fuente de verdad de uso — tabla `public.usage_events` append-only con contrato de eventos versionado (`event_type`, `platform`, `event_uid` idempotente) e instrumentación fire-and-forget en `codigo.json` en generación de imagen, edición de imagen y publicación/programación vía Postiz. **Compartida con `admin-dashboard-metrics`.**
- `user-account-profile`: Página de perfil — visualización de los datos de la cuenta y edición de los campos simples (`full_name`, `company`); cambio de email y contraseña de Supabase Auth como sub-capacidad bajo gobernanza HIGH; `telegram_chat_id` de solo lectura.
- `user-product-catalog`: Administración del catálogo del usuario sobre `products.product_data` — normalización a array, lectura defensiva de datos heredados polimórficos, y alta/baja **atómicas del lado del servidor** (RPC `security definer`) para eliminar la ventana de lost-update frente al bot.

### Modified Capabilities

*(Ninguna. `openspec/specs/` contiene hoy `dashboard-social-connections`, `meta-oauth`, `token-manager` y `x-twitter-oauth`; ninguna cambia sus requirements. El `Sidebar` gana un ítem y `App.jsx` una ruta, pero eso es implementación de las capabilities nuevas, no un cambio de requirement de la capability de conexiones.)*

## Impact

- **Frontend (`aura-frontend/src/`)**:
  - Reescritura completa de `pages/MetricsPage.jsx` y `pages/ProfilePage.jsx` (hoy placeholders).
  - Página nueva `pages/ProductsPage.jsx` + ruta `/app/products` en `App.jsx` + ítem nuevo en `components/Sidebar.jsx` (icono Material `inventory_2`).
  - Hooks/helpers nuevos de acceso a datos (`src/lib/` o `src/hooks/`) para métricas, perfil y catálogo.
  - Reutiliza los componentes existentes `GlassCard`, `MaterialIcon`, `GradientButton` y el layout de header/sidebar ya usado por `ConnectionsPage`. Sin dependencias nuevas de npm: los gráficos se resuelven con SVG/CSS propios, no se agrega una librería de charting.
- **Supabase — migraciones nuevas en `aura-frontend/supabase/migrations/`**:
  - `usage_events` (tabla + índices `(user_id, occurred_at desc)` y `(user_id, event_type)` + unicidad de `event_uid`).
  - Normalización de `products.product_data` a array (backfill de las filas existentes con forma de objeto) + `updated_at` con trigger.
  - RPCs `security definer` de alta/baja de producto (atómicas, resuelven el usuario por `auth.uid()`).
  - ⛔ Políticas RLS (Grupo 0.A): `select`/`update` propios en `profiles`, `select` propio en `products`, `select` propio en `usage_events`; **sin** política de `insert` en `usage_events` para roles cliente (solo escribe el service role del bot).
- **Workflow n8n (`codigo.json`, 236 nodos, fuente de verdad versionada — repo raíz)**:
  - Nodos nuevos de emisión de eventos tras `Generate an image`, `Edit an image` y `HTTP - Crear post Postiz` (+ rama de programación).
  - Modificación de los tres nodos de upsert de productos para pasar de "pisar el documento" a "append atómico" vía la RPC compartida.
  - Riesgo asumido: `codigo.json` es también el objeto de trabajo de `input-security-hardening`, `publish-video-platform-schedule` y `error-handling`. Coordinar el orden de aplicación para evitar conflictos de merge sobre el mismo archivo.
- **Seguridad / privacidad**: `usage_events` guarda uso por usuario. No se registran prompts, ni contenido de imágenes, ni texto de publicaciones — solo contadores y metadatos mínimos (plataforma, timestamp, resultado). Queda declarado en el diseño para que no se filtre contenido del usuario a una tabla de telemetría.
- **Tests**: el proyecto **no tiene runner de tests en `aura-frontend`** (`package.json` solo declara `lint: oxlint`). La verificación de este change se apoya en lint + pruebas manuales guionadas + validación SQL de las migraciones y las RPCs; si se quiere TDD real sobre los helpers puros (agregación de métricas, normalización del catálogo), hay que incorporar un runner primero — decisión que `design.md` deja como Open Question.
- **Changes relacionados**: provee la instrumentación que `admin-dashboard-metrics` consumirá; no bloquea ni depende de `input-security-hardening`.
