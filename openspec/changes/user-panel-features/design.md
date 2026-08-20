## Context

`aura-frontend/` es un SPA Vite + React 19 + React Router 7 + Tailwind 4 que habla con Supabase **directamente desde el navegador con la anon key** (`src/lib/supabase.js`), autenticado por Supabase Auth (`AuthContext`). No hay backend propio: todo lo que el panel hace pasa por PostgREST y, por lo tanto, **por RLS**. La única excepción es el alta de usuarios, que va por una Edge Function (`supabase.functions.invoke('create-user')` en `RegisterUser.jsx`).

El bot de Telegram vive en el workflow n8n `codigo.json` (236 nodos, en la raíz del repo) y habla con la **misma** base de datos, pero con **service role** (credencial `Supabase Service Role` vía `httpHeaderAuth`), es decir **saltándose RLS**. Los dos escritores conviven sobre las mismas tablas.

Estado relevante encontrado en el relevamiento (verificado sobre el código, no asumido):

1. **`products` tiene una fila por usuario**, no una por producto: la migración `20260701000001_products_table.sql` agrega `products_user_id_unique` justamente para que el upsert `?on_conflict=user_id` funcione, con el comentario explícito *"One product record per user (product_data jsonb holds the full catalogue)"*.
2. **`product_data` es polimórfica hoy**: la rama PDF escribe un **array** (`product_data: $json.productos`, nodo `HTTP - Upsert producto pdf`); la rama de imagen escribe un **objeto suelto** `{producto, precio, detalle}` (`HTTP - Upsert producto imagen`, alimentado por `Code in JavaScript6` que hace `JSON.parse` de la respuesta de `Analyze an image`); la rama de texto emite **un item por producto** y por lo tanto dispara un POST por producto, quedando solo el último.
3. **Las tres escrituras pisan el documento completo** (`POST /rest/v1/products?on_conflict=user_id` + `Prefer: resolution=merge-duplicates`). No hay append en ningún lado: cargar un producto nuevo por el bot **borra los anteriores**.
4. **No existe instrumentación de uso**: ningún nodo de `codigo.json` registra generaciones ni publicaciones; Redis solo guarda estado transitorio con TTL; no hay tabla de eventos en `supabase/migrations/`.
5. **`profiles`** tiene al menos `id`, `email`, `full_name`, `company`, `role`, `telegram_chat_id`, `telegram_id`, `is_active`, `created_at` (por los `select` de `AuthContext`, `AdminPanel` y `ConnectionsPage`). `telegram_chat_id` es la clave con la que el bot resuelve la identidad: `HTTP - Chequear vinculacion` hace `profiles?telegram_chat_id=eq.<chat>&select=id`.
6. **Las plataformas soportadas** son cinco (`ConnectionsPage.jsx`): `instagram`, `facebook`, `threads`, `twitter`, `linkedin`.
7. **No hay runner de tests** en `aura-frontend/package.json` (solo `oxlint`).

## Goals / Non-Goals

**Goals:**

- Que el usuario vea su uso real (imágenes generadas/editadas, publicaciones hechas y programadas, desglose por red) sin poder ver jamás datos de otro usuario.
- Crear **una sola** fuente de verdad de uso, diseñada desde el principio para servir también al dashboard de admin (`admin-dashboard-metrics`).
- Que el usuario pueda corregir los datos de su cuenta, con una frontera nítida entre "datos de perfil" y "credenciales de acceso".
- Que el usuario administre su catálogo **sin riesgo de perderlo** — lo que implica arreglar la semántica de sobreescritura que ya existe hoy entre bot y base.
- No agregar dependencias npm ni servicios nuevos.

**Non-Goals:**

- Backfill histórico de métricas: no existe fuente de la cual reconstruirlo. Las métricas arrancan en cero el día que se activa el tracking.
- Dashboard de admin / agregación cross-usuario: es de `admin-dashboard-metrics`. Acá solo se deja la tabla y el contrato listos.
- Edición de `telegram_chat_id` desde el panel (ver D9).
- Edición de productos (update). Solo alta y baja, que es lo pedido. Editar es "borrar + agregar" en esta versión.
- Métricas de negocio derivadas de las redes (impresiones, alcance, engagement): eso vive en las APIs de las plataformas / Postiz, no en este change.
- Reescribir las ramas de análisis de producto del bot (Gemini, prompts): solo cambia **cómo persisten**, no cómo analizan.

## Decisions

### Gobernanza

Este change tiene **gobernanza mixta**. La política del proyecto asigna autonomía por dominio, y acá conviven tres dominios distintos en un solo change. Las reglas operativas:

- **Dos gates bloqueantes e independientes**, ambos en el Grupo 0 de `tasks.md`:
  - ⛔ **0.A — Políticas RLS** (HIGH, *"Config … that affect user data → Propose and wait for review before writing"*). Toda política RLS nueva sobre `profiles`, `products` y `usage_events` se presenta al usuario **como SQL literal**, con la explicación de a qué filas da acceso y a cuáles no, y se espera OK antes de aplicarla. Motivo: el panel usa la anon key; una política con un predicado flojo (o un `using (true)`) expone los datos de **todos** los usuarios a cualquier sesión autenticada. Bloquea a todas las tareas que lean o escriban desde el panel.
  - ⛔ **0.B — Credenciales de Supabase Auth** (HIGH, potencialmente CRITICAL por rozar gestión de acceso). Cambio de email y de contraseña. Se describe el flujo completo (qué endpoints, qué mails dispara Supabase, qué pasa si el usuario abandona a mitad) y se espera OK explícito. Bloquea **solo** al grupo de credenciales.
- **La aprobación no es transitiva**: 0.A aprobado no habilita 0.B, y ningún OK cubre grupos posteriores.
- **Sin gate** (flujo normal del proyecto): página de métricas, página de productos, campos simples de perfil, y la instrumentación en `codigo.json` — esta última con checkpoints MEDIUM: se avisa antes de tocar el archivo y se reporta qué nodos se insertaron.
- **Si la ejecución no es interactiva** y no se puede obtener confirmación, el agente **se detiene y reporta**; nunca asume aprobación.

### D1 — `usage_events`: una tabla append-only de eventos, no contadores agregados

> **Nota de apply (2026-08-18):** el esquema literal de abajo quedó SUPERSEDIDO
> antes de escribir código: `admin-dashboard-metrics` se archivó el mismo día
> y ya había creado `public.usage_events` en producción con otra forma (`id
> uuid`, `event_key` en vez de `event_uid`, sin `platform`/`status`/`source`,
> `user_id ... on delete set null`). Se reconcilió como UNA sola tabla,
> extendida de forma aditiva (migraciones `20260818160500_usage_events_extend_for_user_panel.sql`
> y las RLS de `20260818160000_user_panel_rls_policies.sql`), en vez de crear
> una segunda tabla. Detalle completo del análisis en engram
> (`opsx/user-panel-features/gate0`). Las columnas reales en producción hoy:
> `id uuid`, `event_key text unique`, `event_type`, `user_id uuid null`,
> `telegram_chat_id`, `provider`, `model`, `platform` (nueva), `status`
> (nueva), `source` (nueva), `quantity`, `input_tokens`, `output_tokens`,
> `metadata`, `occurred_at`, `created_at`. El CHECK de `event_type` se amplió
> para incluir `post_scheduled`. `event_uid` NUNCA se creó como columna — el
> `event_key` ya existente cumple la misma función de idempotencia.

**Decisión.** Fuente de verdad = filas de eventos crudos, agregadas en tiempo de consulta.

```sql
create table public.usage_events (
  id           bigserial primary key,
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  event_type   text        not null,   -- ver D2
  platform     text        null,       -- instagram|facebook|threads|twitter|linkedin; null si no aplica
  status       text        not null default 'success',   -- success|failed
  source       text        not null default 'telegram_bot',
  event_uid    text        not null,   -- idempotencia, ver D4
  metadata     jsonb       not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint usage_events_event_uid_key unique (event_uid)
);
create index usage_events_user_time_idx on public.usage_events (user_id, occurred_at desc);
create index usage_events_user_type_idx on public.usage_events (user_id, event_type);
create index usage_events_type_time_idx on public.usage_events (event_type, occurred_at desc); -- para el agregado de admin
```

**Alternativas descartadas.** (a) Columnas contador en `profiles` (`images_generated int`): imposible desglosar por red o por período, y el `UPDATE ... SET x = x + 1` concurrente desde n8n es exactamente el patrón de lost-update que este change está tratando de eliminar en otro lado. (b) Tabla pre-agregada por día/usuario/plataforma: más barata de leer, pero congela las dimensiones — si mañana se quiere desglosar por hora o por tipo de contenido hay que re-instrumentar. Con el volumen esperado (decenas de eventos por usuario por día) la agregación en query es holgadamente suficiente; si algún día no lo es, una vista materializada se agrega **encima** sin re-instrumentar.

### D2 — Contrato de eventos (interfaz compartida con `admin-dashboard-metrics`)

Este es el punto de acoplamiento entre los dos changes. **Es un contrato: no se cambia unilateralmente.**

| `event_type` | Cuándo se emite | `platform` | `metadata` |
|---|---|---|---|
| `image_generated` | Éxito de `Generate an image` | `null` | `{ "modelo": "<gemini model id>" }` |
| `image_edited` | Éxito de `Edit an image` | `null` | `{ "modelo": "<gemini model id>" }` |
| `post_published` | Éxito de `HTTP - Crear post Postiz`, **una fila por plataforma** publicada | plataforma | `{ "postiz_post_id": "…", "media_type": "image\|video" }` |
| `post_scheduled` | Publicación creada con fecha futura (rama de `Calcular fecha publicacion`), una fila por plataforma | plataforma | `{ "scheduled_for": "<ISO8601>" }` |

Reglas del contrato:

- `platform` usa **exactamente** los ids que ya usa el panel (`instagram`, `facebook`, `threads`, `twitter`, `linkedin`), no los nombres de Postiz ni los de Meta. Cualquier mapeo se hace en n8n al emitir, no en la lectura.
- Una publicación a N plataformas emite **N filas**, no una fila con un array. Esto hace que el desglose por red sea un `group by platform` trivial en los dos changes.
- `post_scheduled` y `post_published` son **eventos distintos**, no estados de una misma fila: una publicación programada que después se publica genera dos filas. El panel muestra "programadas pendientes" como `post_scheduled` cuyo `scheduled_for` es futuro.
- **Nunca** se guarda contenido del usuario: ni prompts, ni texto de la publicación, ni URLs de las imágenes. `metadata` es exclusivamente técnica. (Privacidad + esta tabla la va a leer también un admin.)
- `event_type` nuevos son aditivos; consumidores ignoran los desconocidos.

### D3 — Emisión fire-and-forget desde n8n, nunca bloqueante

> **Nota de apply (2026-08-18):** `post_published` y `post_scheduled` se
> emiten desde el MISMO nodo nuevo, `HTTP - Emit usage_events post_published_scheduled`,
> conectado en paralelo a la salida de `HTTP - Crear post Postiz` (no desde
> `Calcular fecha publicacion`, como sugería el texto original). Motivo: es
> el primer punto del grafo donde a la vez se conoce la programación
> (`tipo`/`fechaISO`, vía `Redis - Get programacion`, la misma fuente que ya
> lee `HTTP - Crear post Postiz`) Y las plataformas elegidas (`postsArray`,
> vía `Preparar integraciones`) — `Calcular fecha publicacion` corre antes en
> el grafo, cuando `Preparar integraciones` todavía no ejecutó. El nodo emite
> un array (bulk insert de PostgREST) con una fila por plataforma,
> eligiendo `event_type='post_published'` o `'post_scheduled'` según `prog.tipo`.
> `image_generated`/`image_edited` se emiten cada uno desde su propio nodo,
> en paralelo a `Generate an image` / `Edit an image` respectivamente.

**Decisión.** Los nodos de emisión usan `onError: "continueRegularOutput"` **como propiedad del nodo** (no dentro de `parameters` — mismo cuidado que documentó `input-security-hardening` 1.3), y se insertan en la cadena de forma que un fallo del `INSERT` no corte el flujo del usuario.

Esto es **deliberadamente opuesto** al fail-closed que rige los controles de seguridad del proyecto (`pdf-virus-scan`, magic bytes, ClamAV). La regla que los distingue: *un control decide si la operación sigue; la telemetría solo observa*. Perder un evento degrada un número en un dashboard; abortar una publicación por un fallo de telemetría rompe el producto.

`retryOnFail` queda en **false** para estos nodos: reintentar telemetría no aporta y multiplica el riesgo de duplicados (ver D4).

### D4 — Idempotencia por `event_uid`

**Problema real, no teórico.** Todos los nodos HTTP del workflow relevados tienen `retryOnFail: true` (hasta `maxTries: 3`). Un reintento tras un timeout donde el `INSERT` sí se aplicó duplicaría el evento y por lo tanto la métrica.

**Decisión.** Cada evento lleva un `event_uid` determinístico compuesto por `<execution_id>:<node_name>:<platform|->` (el `$execution.id` de n8n es estable dentro de una ejecución, incluidos sus reintentos). El `INSERT` va con `Prefer: resolution=ignore-duplicates` sobre `?on_conflict=event_uid`, de modo que el reintento sea un no-op. **Alternativa descartada**: deduplicar en la lectura (`count(distinct …)`) — traslada el costo y la complejidad a los dos consumidores en vez de resolverlo una vez en la escritura.

### D5 — `product_data` se normaliza a array, siempre

**Decisión.** Migración que convierte toda fila existente a array:

```sql
update public.products
   set product_data = case
     when jsonb_typeof(product_data) = 'array'  then product_data
     when product_data is null                   then '[]'::jsonb
     when jsonb_typeof(product_data) = 'object'  then jsonb_build_array(product_data)
     else '[]'::jsonb
   end;
alter table public.products
  add constraint products_product_data_is_array
  check (jsonb_typeof(product_data) = 'array');
```

El `CHECK` es lo que impide que la deriva vuelva: cualquier escritor (incluido el bot con service role) que intente escribir un objeto suelto **falla ruidosamente** en vez de corromper silenciosamente la forma. Por eso el `CHECK` se agrega **después** de convertir los nodos del bot (ver Migration Plan) — al revés rompería el bot en producción.

El **frontend igual lee defensivamente** (array | objeto | null → array), porque la migración y el deploy del panel no son atómicos entre sí.

### D6 — Alta y baja de productos vía RPC `security definer`, no read-modify-write desde el navegador

**Decisión.** Dos funciones Postgres, invocadas con `supabase.rpc(...)`:

```sql
create or replace function public.product_catalog_add(item jsonb) returns jsonb …
create or replace function public.product_catalog_remove(product_id text) returns jsonb …
```

Propiedades exigidas:

- **`auth.uid()` se resuelve adentro de la función**; el `user_id` **no** es parámetro. Un cliente no puede pedir que se le agregue un producto a otro usuario aunque manipule el request.
- **Una sola sentencia** de mutación (`update products set product_data = product_data || jsonb_build_array(normalized_item) where user_id = auth.uid()`), es decir atómica bajo el lock de fila de Postgres. **No hay ventana** entre leer y escribir.
- **Normalización en la escritura**: si un item del array carece de `id`, la función se lo asigna (`gen_random_uuid()::text`). Así los items heredados que el bot escribió sin id quedan direccionables para el borrado sin necesitar un backfill perfecto.
- `product_catalog_remove(product_id)` borra **por id**, no por índice. Borrar por índice es inaceptable acá: entre que el usuario ve la lista y aprieta "eliminar", el bot puede haber reescrito el array y el índice `2` ya es otro producto — se borraría el equivocado, en silencio.
- Ambas devuelven el `product_data` resultante, para que el frontend refresque con el estado real del servidor y no con su optimismo local.
- Se crea la fila con `product_data = '[]'` si el usuario todavía no tiene (upsert dentro de la función): el usuario nuevo que nunca usó el bot debe poder cargar su primer producto.

**Alternativas descartadas.** (a) Read-modify-write desde el cliente: la ventana de lost-update frente al bot es real y el resultado del choque es *perder el catálogo entero*, no un campo. (b) Concurrencia optimista con `updated_at` y reintento en el cliente: funciona, pero deja al navegador como responsable de la corrección de un dato compartido y obliga a una UX de conflicto que nadie pidió; la RPC lo hace innecesario. Igual se agrega `updated_at` (con trigger) porque sirve para mostrar "última actualización" y para diagnosticar quién escribió último.

### D7 — El bot pasa a hacer append en vez de pisar el catálogo

> **Nota de apply (2026-08-18, decisión del usuario en 0.3):** esta decisión
> quedó SUPERSEDIDA por una más precisa antes de escribir código: el bot NO
> acumula a secas (eso duplicaría productos en cada recarga del mismo ítem).
> Pasa a hacer **upsert por nombre**: cada producto nuevo se matchea contra
> el catálogo existente por `product_item_normalized_name()` (trim + espacios
> colapsados + lower, sobre la primera clave de nombre presente entre
> `producto`/`nombre`/`"nombre del producto"`/`name`/`titulo` — deliberadamente
> NO fuzzy, sin extensión `pg_trgm`, ver comentario en la migración); si
> matchea, actualiza ese item in-place (típicamente cambia el precio); si no,
> lo agrega. El bot no pregunta nada de forma interactiva. Implementado en la
> RPC `product_catalog_upsert_for_user` (migración
> `20260818161500_products_catalog_rpcs.sql`), consumida por los 3 nodos de
> upsert en `codigo.json`. El panel de Productos (Grupo 5) sigue siendo la
> válvula de escape manual para lo que el matching normalizado no resuelva
> (nombres apenas distintos, renombres).
>
> **Riesgo residual documentado, no resuelto en este apply:** los 3 nodos
> HTTP conservan `retryOnFail: true` (igual que antes). Un reintento de
> `product_catalog_upsert_for_user` sin match de nombre en ninguno de los dos
> intentos apendearía el mismo producto dos veces (a diferencia del
> comportamiento anterior de "pisar documento completo", que era idempotente
> ante reintentos por construcción). No se le agregó una clave de
> idempotencia dedicada a esta RPC (análoga a `event_key` en usage_events)
> porque estaba fuera del alcance decidido en 0.3; queda anotado para una
> iteración futura si se observan duplicados en producción.

**Decisión.** Los tres nodos `HTTP - Upsert producto pdf` / `… imagen` / `… informacion` dejan de hacer `POST /products?on_conflict=user_id` con el documento entero y pasan a llamar a la **misma** RPC de append (`POST /rest/v1/rpc/product_catalog_add_for_user`, variante que recibe `user_id` explícito porque el bot corre con service role y no tiene `auth.uid()`).

Esto arregla, de paso, un bug preexistente: hoy cada carga por el bot **borra todo lo anterior**, y la rama de texto (que emite un item por producto) termina guardando solo el último. No es un efecto colateral no deseado: sin este cambio, la funcionalidad "agregar producto desde el panel" es una promesa falsa, porque la siguiente foto que el usuario le mande al bot le borra lo que cargó a mano.

**Riesgo asumido y explícito**: esto cambia el comportamiento observable del bot (antes reemplazaba el catálogo, ahora acumula). Es un cambio de producto, no solo técnico → se confirma con el usuario en el checkpoint del grupo correspondiente, y se ofrece en el panel la baja de productos como válvula de escape para el catálogo que se acumule.

### D8 — Perfil: dos superficies separadas, no un formulario único

**Decisión.** La página se organiza en dos bloques visualmente separados, con verbos distintos:

| Bloque | Campos | Mecanismo | Gobernanza |
|---|---|---|---|
| **Datos de la cuenta** | `full_name`, `company` | `update public.profiles set … where id = auth.uid()` (RLS) | MEDIUM — autónomo con checkpoints |
| **Solo lectura** | `email` (actual), `role`, `is_active`, `created_at`, estado de vinculación de Telegram | `select` | — |
| ⛔ **Acceso y seguridad** | cambio de **email**, cambio de **contraseña** | `supabase.auth.updateUser()` | **HIGH — Grupo 0.B** |

Motivos de la separación (no es cosmética): guardar el nombre es una escritura idempotente y reversible; cambiar el email dispara un flujo de doble confirmación en Supabase que deja la cuenta en un estado intermedio observable, y cambiar la contraseña invalida el modo de acceso. Mezclarlos en un mismo formulario con un solo botón "Guardar" haría que un cambio trivial arrastre un efecto de seguridad — precisamente lo que la política de gobernanza busca evitar.

Puntos que el bloque de credenciales debe resolver **antes** de escribirse (parte del Grupo 0.B):

- **Reautenticación**: Supabase permite `updateUser({password})` con la sesión vigente. Se exige igualmente la contraseña actual (verificándola con un `signInWithPassword` previo) para que una sesión abierta y desatendida no alcance para secuestrar la cuenta.
- **Doble confirmación de email**: según la configuración del proyecto Supabase, cambiar el email manda confirmación al viejo y/o al nuevo, y **el cambio no es inmediato**. La UI debe reflejar "pendiente de confirmación", no "listo".
- **Desincronización `auth.users.email` vs `profiles.email`**: `AdminPanel` muestra `profiles.email`. Si el email de Auth cambia y `profiles` no, el admin ve un dato viejo. Hay que decidir: trigger en la base que propague, o propagación explícita al confirmar. Queda como Open Question 2.

### D9 — `telegram_chat_id` es de solo lectura en el panel

**Decisión.** Se muestra el estado de vinculación; no se edita.

`HTTP - Chequear vinculacion` resuelve `profiles?telegram_chat_id=eq.<chat_id>&select=id` — es decir, **ese campo ES la identidad** con la que el bot decide de qué usuario son los productos y las publicaciones. Si el panel permitiera escribirlo, un usuario podría apuntar su fila al `chat_id` de otro y quedar recibiendo/atribuyéndose la actividad ajena. La vinculación se hace por el flujo de códigos de `link-code-reproducible` y así queda. Cualquier política RLS de `update` sobre `profiles` debe, por lo tanto, **restringir las columnas actualizables** (`full_name`, `company`) y no habilitar `telegram_chat_id`, `role` ni `is_active`.

### D10 — Agregación de métricas en el cliente, sin librería de charting

**Decisión.** El panel trae las filas del rango elegido (`select ... where user_id = auth.uid() and occurred_at >= <desde>`) y agrega en JS con funciones **puras** (`aggregateUsage(events, range)`), o llama a una vista/RPC de agregación si el volumen lo pide. Los gráficos son SVG/CSS propios (barras y sparkline), consistentes con el lenguaje visual existente (`GlassCard`, `MaterialIcon`, `GradientButton`, tokens Tailwind `surface-*` / `primary`).

**Por qué**: agregar una librería de charts a un `package.json` que hoy tiene 5 dependencias, para cuatro tarjetas y un desglose de cinco barras, no se paga. Y las funciones de agregación puras son lo único de este change que es trivialmente testeable — son el mejor candidato si se incorpora un runner (Open Question 4).

**Límite declarado**: si un usuario superara ~5k eventos en el rango, se pasa a una RPC de agregación server-side (`usage_summary(from, to)`). Se deja anotado el umbral en vez de optimizar de entrada.

### D11 — RLS: lectura propia siempre, escritura mínima, inserción de eventos solo por service role

- `usage_events`: `select` donde `user_id = auth.uid()`. **Ninguna** política de `insert`/`update`/`delete` para roles cliente — el único escritor legítimo es el bot con service role (que ignora RLS). Un panel que no puede insertar eventos es un panel que no puede inflar sus propias métricas.
- `products`: `select` donde `user_id = auth.uid()`. Las mutaciones **no** se hacen por policy sino por las RPC `security definer` de D6.
- `profiles`: `select` propio y `update` propio **acotado por columnas** (D9).
- La política de lectura para admin (`role = 'admin'` leyendo todos los `usage_events`) **no** se define acá: es de `admin-dashboard-metrics`, que la agrega como delta sobre esta tabla.

## Risks / Trade-offs

- **[Las métricas arrancan vacías y eso se ve raro]** → Estado vacío explícito con la fecha de inicio del tracking ("registrando desde el DD/MM"), en vez de mostrar ceros sin explicación. No se inventan datos ni se estiman.
- **[Cambiar el bot de "pisar" a "append" altera el comportamiento del producto]** → Confirmación explícita con el usuario en el checkpoint (D7), más la baja de productos desde el panel como válvula de escape.
- **[El `CHECK` de array puede romper el bot si se aplica en el orden equivocado]** → El orden del Migration Plan es normativo: normalizar datos → migrar nodos del bot → recién entonces el `CHECK`.
- **[Una política RLS mal escrita expone datos de todos los usuarios]** → Gate 0.A: revisión humana del SQL antes de aplicarlo, y verificación posterior con dos sesiones de usuarios distintos (tarea explícita, no "confiar en la policy").
- **[Duplicación de eventos por reintentos de n8n]** → `event_uid` único + `ignore-duplicates` (D4), y `retryOnFail: false` en los nodos de telemetría.
- **[`codigo.json` es tocado en paralelo por `input-security-hardening`, `publish-video-platform-schedule` y `error-handling`]** → Aplicar los cambios de workflow de este change en una sola pasada, verificar el grafo por script (patrón ya usado en `input-security-hardening` 1.9) y no a ojo, y re-verificar el conteo de nodos y las aristas afectadas antes y después.
- **[El panel puede escribir el catálogo mientras el usuario está en medio de una carga por el bot]** → Las RPC atómicas eliminan la pérdida de datos, pero no el orden: el usuario podría ver su producto agregado "después" del que cargó por Telegram. Es aceptable; el catálogo es un conjunto, no una secuencia.
- **[La forma real de los items de `product_data` no está garantizada]** → Gemini devuelve `{producto, precio, detalle}` en la rama de imagen, pero las ramas de PDF y texto tienen otros prompts y pueden traer otras claves. El renderizado es **defensivo**: campos conocidos primero, resto como pares clave/valor, nada de romper la página por una clave faltante (Open Question 1).
- **[Sin runner de tests, la verificación es manual]** → Se guionan pruebas manuales reproducibles y se valida el SQL de RPC/policies directamente contra la base; se declara como deuda, no se simula cobertura (Open Question 4).

## Migration Plan

Orden **normativo** (invertir pasos rompe producción):

1. **RLS y tabla** (tras gate 0.A): crear `usage_events` con sus índices y su policy de `select` propio; agregar las policies de `profiles` y `products`. Verificar con dos usuarios distintos que ninguno ve al otro.
2. **Normalizar `product_data`** a array (update de backfill, sin `CHECK` todavía) y agregar `updated_at` + trigger.
3. **Crear las RPC** `product_catalog_add` / `product_catalog_remove` (`auth.uid()`, para el panel) y la variante `…_for_user` (service role, para el bot).
4. **Migrar los tres nodos de upsert del bot** a la RPC de append (D7) y verificar el grafo por script.
5. **Agregar el `CHECK`** `products_product_data_is_array` — recién ahora, con todos los escritores ya normalizados.
6. **Instrumentar** los eventos en `codigo.json` (D2/D3/D4) y verificar en la base que llegan filas con los `event_type` correctos y sin duplicados tras un reintento forzado.
7. **Frontend**: Productos → Métricas → Perfil (campos simples). El bloque de credenciales de Perfil (0.B) va al final y solo con su OK propio.

**Rollback**: cada paso es reversible por separado. 1–3 y 5 son migraciones SQL con su inverso trivial (drop policy / drop constraint / drop function). 4 y 6 son diffs acotados de `codigo.json` — se revierte el archivo. 7 es frontend: revertir el deploy. El único paso con pérdida potencial es el 2 si se corriera dos veces sobre datos ya normalizados: es idempotente por construcción (el `case` ya contempla `array`), pero igual se toma backup de `products` antes de correrlo.

## Open Questions

> **Nota de apply (2026-08-18):** OQ1 se resolvió con muestras reales
> extraídas de los prompts de `codigo.json` (no acceso en vivo a la base
> desde el agente) — ver `tasks.md` 0.4 y `src/lib/productCatalog.js`. OQ3
> queda pendiente de un chequeo manual en el Dashboard de Supabase ("Secure
> email change"); la UI de `ProfilePage.jsx` ya está preparada para el caso
> más conservador (doble confirmación) y no afirma éxito hasta que se
> confirme. OQ4 se resolvió: `node:test` nativo, sin dependencias nuevas
> (`aura-frontend/src/lib/*.test.js`, script `pnpm test`).

1. **¿Cuál es la forma real de los items de `product_data` en producción?** Se conoce el contrato de la rama de imagen (`{producto, precio, detalle}`); PDF y texto usan otros prompts. Hace falta una muestra real para decidir qué campos destacar en la UI y qué campos ofrecer en el alta manual. Default mientras tanto: destacar `producto`/`nombre`, `precio`, `detalle`/`descripcion`, y renderizar el resto genéricamente.
2. **`auth.users.email` vs `profiles.email`**: ¿se propaga con un trigger en la base, o explícitamente desde el panel al confirmarse el cambio? Afecta lo que ve el admin en `AdminPanel`. Decidir dentro del gate 0.B.
3. **¿El cambio de email debe requerir confirmación en el email viejo además del nuevo?** Depende de la configuración del proyecto Supabase (`Secure email change`). Hay que constatarla, no asumirla — cambia el copy y los estados de la UI.
4. **¿Se incorpora un runner de tests a `aura-frontend`?** Hoy no hay. Los helpers puros de agregación de métricas y de normalización de catálogo son los candidatos naturales. Decisión del usuario: incorporarlo (y hacer TDD real sobre esos helpers) o aceptar verificación manual guionada para este change.
5. **¿`post_scheduled` debe reconciliarse cuando la publicación programada efectivamente sale?** Hoy el diseño emite dos eventos independientes y el panel infiere "pendiente" por `scheduled_for > now()`. Si Postiz notificara la publicación real, se podría cerrar el ciclo — requiere webhook, fuera de alcance de este change.
