## Context

**Lo que existe hoy.** El panel de admin de `aura-frontend` (Vite + React 19 + Tailwind 4 + `@supabase/supabase-js`, sin backend propio) tiene dos rutas admin: `/admin` (`AdminPanel.jsx`, tabla de `profiles` etiquetada erróneamente "Dashboard" en el sidebar) y `/admin/register-user` (`RegisterUser.jsx`, alta de usuario, etiquetada "Gestión de Usuarios"). Existe además `MetricsPage.jsx` en `/app/metrics`, pero es un placeholder "próximamente" del lado **usuario**, no del admin. No hay dashboard de admin de ningún tipo.

**Lo que falta en los datos.** El esquema Supabase tiene `profiles`, `products` (una fila por usuario, catálogo en `product_data jsonb`), `social_accounts` y `telegram_link_codes`. **No hay ninguna tabla que registre uso**: ni imágenes generadas, ni publicaciones, ni consumo de Google AI. El workflow n8n (`codigo.json`, 236 nodos) genera imágenes con `Generate an image` y `Edit an image` (`models/gemini-3-pro-image-preview`), usa `models/gemini-2.5-flash` para moderación, clasificación de prompt-injection y análisis de documentos/imágenes, y publica con `HTTP - Crear post Postiz` — y **ninguno de esos nodos escribe un registro**. Las tres métricas de uso pedidas simplemente no tienen fuente de datos: hay que crearla.

**Cómo escribe n8n en Supabase hoy.** Con nodos `n8n-nodes-base.httpRequest` contra PostgREST (`https://<project>.supabase.co/rest/v1/<tabla>`), `authentication: genericCredentialType` + `genericAuthType: httpHeaderAuth`, credencial **"Supabase Service Role"** (ver `HTTP - Upsert producto imagen`, que hace POST con `Prefer: resolution=merge-duplicates`). El `user_id` de Supabase ya está disponible en el flujo: `HTTP - Chequear vinculacion` (rama de imágenes) y `HTTP - Perfil publicacion` (rama de publicación) devuelven `profiles.id` a partir de `telegram_chat_id`. Es decir: **el patrón de escritura y la identidad del usuario ya existen**; solo falta la tabla destino y los nodos que la escriban.

**Restricciones que condicionan el diseño.**
- Sin backend propio: la agregación corre en Postgres (vista/RPC) o en una Edge Function; no hay servidor donde poner lógica.
- El frontend usa la **anon key** y opera bajo RLS; cualquier lectura de métricas globales tiene que pasar por una frontera que verifique rol.
- `codigo.json` está siendo modificado por 4 changes en progreso (`input-security-hardening`, `publish-video-platform-schedule`, `error-handling`, `pdf-virus-scan`): tocarlo desde este change multiplicaría conflictos.
- El change hermano `admin-user-management` va a reclamar `/admin` y `AdminPanel.jsx`; ambos changes tocan `Sidebar.jsx`.
- No existe integración con la API de billing de Google Cloud, y no hay credencial ni intención de crearla en este cambio: cualquier cifra de costo es una **estimación**, no facturación.

## Goals / Non-Goals

**Goals:**
- Dar al admin las 4 métricas pedidas en una sola pantalla: clientes, costo estimado de Google AI, publicaciones realizadas, imágenes generadas (nuevas + rehechas).
- Crear un modelo de datos de uso **genérico y extensible** que sirva para métricas futuras sin migraciones nuevas por cada métrica.
- Agregar en Postgres, no en el cliente: una sola llamada para pintar todo el dashboard, sin descargar filas crudas al browser.
- Impedir por diseño que un usuario no-admin lea métricas globales.
- Dejar el contrato de evento tan preciso que el change de n8n sea mecánico (copiar un nodo HTTP existente y cambiarle el body).
- Que el dashboard sea honesto: el costo se muestra rotulado como estimación y el período sin datos se muestra como "sin datos", nunca como "$0 gastado".

**Non-Goals:**
- **No** se implementa la escritura de eventos en `codigo.json` (change hermano `n8n-usage-events-logging`, decisión D8).
- **No** se integra la Cloud Billing API de Google (D3).
- **No** se toca `/admin` ni `AdminPanel.jsx` (D6) — territorio de `admin-user-management`.
- **No** se hace backfill histórico: no existen datos previos que recuperar (Riesgo R2).
- **No** se agregan métricas por cliente en el dashboard de admin más allá del desglose por modelo (OQ4).
- **No** se toca `MetricsPage.jsx` (`/app/metrics`, dashboard de usuario final) — es otra pantalla, otro público, otro change.

## Decisions

### D1 — Un log de eventos genérico (`usage_events`), no contadores por métrica

Se elige una tabla **append-only** de eventos con `event_type`, en lugar de (a) columnas contador en `profiles` (`images_generated int`), o (b) una tabla por métrica (`generated_images`, `published_posts`).

- Agregar una métrica nueva (videos, PDFs analizados, mensajes procesados) es un `event_type` nuevo, **sin migración**.
- Permite cortar por período, por usuario y por modelo con la misma tabla; los contadores no permiten "últimos 30 días".
- Append-only encaja con un productor sin transacciones (n8n): un INSERT que falla no corrompe estado, a diferencia de un `UPDATE ... SET count = count + 1`.
- Costo: filas que crecen sin techo. Con el volumen real (un bot de Telegram con decenas de clientes) son miles de filas al mes — irrelevante para Postgres con los índices de D4. Retención/rollup queda documentada como trabajo futuro, no se implementa (Riesgo R4).

Esquema (columnas normativas en la spec `usage-events-tracking`):

```
usage_events(
  id uuid PK default gen_random_uuid(),
  event_key text UNIQUE NOT NULL,          -- idempotencia, D9
  event_type text NOT NULL CHECK (event_type IN
    ('image_generated','image_edited','post_published','ai_call')),
  user_id uuid NULL REFERENCES profiles(id) ON DELETE SET NULL,
  telegram_chat_id text NULL,              -- identidad de respaldo, D7
  provider text NOT NULL DEFAULT 'google',
  model text NULL,                         -- ej. 'models/gemini-3-pro-image-preview'
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  input_tokens integer NULL,
  output_tokens integer NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
)
```

### D2 — El costo se calcula al leer, contra `ai_model_prices` con `effective_from`

Alternativa descartada: que n8n escriba `estimated_cost_usd` en cada evento. Se descarta porque obligaría a mantener la tabla de precios **dentro del workflow** (un Code node con precios hardcodeados), y a reescribir historia con un UPDATE masivo cada vez que se corrige un precio o se descubre que la estimación estaba mal.

Se elige: `public.ai_model_prices(model, unit, unit_cost_usd, effective_from, notes)` donde `unit ∈ ('image','input_token','output_token')`, y el RPC hace el join tomando **el precio vigente a la fecha del evento** (`effective_from <= occurred_at`, el más reciente). Ventajas: corregir un precio es un INSERT con `effective_from`; la historia previa conserva el precio que estaba vigente; n8n no sabe nada de precios (queda tonto y estable).

### D3 — El costo es una estimación por invocación/token, explícitamente rotulada

No hay Cloud Billing API. El costo se estima así:
- Modelos de **imagen** (`gemini-3-pro-image-preview`): `cantidad de imágenes × precio por imagen`.
- Modelos de **texto/multimodal** (`gemini-2.5-flash` en moderación, clasificador de injection, análisis de documento/imagen): `input_tokens × precio_input + output_tokens × precio_output` cuando n8n reporta `usageMetadata`; si no lo reporta, se usa el fallback declarado en `ai_model_prices.notes` (tokens promedio asumidos por invocación) y el evento queda con `input_tokens IS NULL`.

Consecuencias que la UI debe honrar (son requisitos, no cosmética): el KPI se titula "Costo estimado Google AI", lleva la nota "estimación por invocación — no es facturación de Google Cloud", y el desglose por modelo indica qué porción viene de tokens medidos y qué porción de fallback. Los precios seed se cargan marcados como estimados y quedan pendientes de confirmación del usuario (OQ2).

### D4 — Agregación en un único RPC de Postgres, no N queries desde el cliente

Alternativas: (a) varias queries `count` desde el browser; (b) una vista materializada; (c) una Edge Function en Deno.

Se elige un RPC `admin_dashboard_metrics(p_from timestamptz, p_to timestamptz) returns json`:
- Una sola llamada pinta todo el dashboard (KPIs + desglose por modelo + serie diaria) — sin waterfall de red ni estados de carga parciales.
- La lógica de precios (join con `ai_model_prices` por `effective_from`) es SQL puro; replicarla en JS del cliente sería duplicar la regla de negocio y exigiría descargar precios y eventos.
- Vista materializada descartada: exigiría un refresh programado (no hay scheduler) y no soporta el período variable.
- Edge Function descartada: agrega un artefacto de deploy nuevo (Deno) para algo que Postgres resuelve en una función; el proyecto ya usa RPCs `SECURITY DEFINER` (`link_telegram_with_code`).

Índices que sostienen la consulta: `(occurred_at)`, `(event_type, occurred_at)`, `(user_id)`.

### D5 — `SECURITY DEFINER` con chequeo de rol adentro + RLS sin políticas de lectura

`usage_events` y `ai_model_prices` van con `ENABLE ROW LEVEL SECURITY` y **sin políticas** para `anon`/`authenticated`: nadie lee las tablas directo desde la web. n8n escribe con `service_role` (bypasea RLS, igual que en `telegram_link_codes`).

El RPC es `SECURITY DEFINER SET search_path = public` y **su primera instrucción valida el rol**:

```sql
if not exists (select 1 from public.profiles
               where id = auth.uid() and role = 'admin')
then raise exception 'forbidden' using errcode = '42501';
end if;
```

Alternativa descartada: política RLS `select` para admins sobre `usage_events`. Se descarta porque habilitaría al browser a descargar el log crudo completo (fuga de patrones de uso por cliente) y porque la agregación seguiría necesitando bajar filas. Con el RPC, la única superficie expuesta es un objeto JSON agregado.

Nota de gobernanza: esta función es la única pieza sensible del change. No modifica el esquema de auth ni de roles — solo **lee** `profiles.role`, que ya es la fuente de verdad que usa `ProtectedRoute`. Si en la revisión se decide cambiar cómo se determina "admin", eso pertenece a `admin-user-management`, no acá.

### D6 — Ruta nueva `/admin/dashboard`; no se reclama `/admin` ~~(SUPERSEDIDO — ver nota de apply)~~

> **Nota de apply (2026-08-18, OQ1 resuelto):** esta decisión se tomó defensivamente mientras `admin-user-management` estaba en progreso en paralelo. Ese change se archivó el 2026-08-18 habiendo movido la tabla de clientes a `/admin/users` y dejado `/admin` como redirect provisional explícitamente pensado para que este change lo reemplazara (su propio `design.md` D6: *"el change hermano es dueño del elemento de la ruta `/admin`"*). Con eso confirmado y con aprobación explícita del usuario, **se reclama `/admin` directamente**: `AdminDashboard.jsx` reemplaza el redirect provisional, no se crea `/admin/dashboard`, y no hace falta re-etiquetar ningún ítem del sidebar (no hay un segundo "Dashboard" que desambiguar). El razonamiento original de D6 queda abajo como registro histórico de por qué se eligió `/admin/dashboard` en su momento.

El dashboard vive en `/admin/dashboard` (`AdminDashboard.jsx`), envuelto en `<ProtectedRoute requiredRole="admin">` igual que las otras rutas admin. `/admin` y `AdminPanel.jsx` quedan intactos.

- Reclamar `/admin` unilateralmente chocaría de frente con `admin-user-management`, que se propone en paralelo sobre esa misma página, y rompería el redirect de `LoginPage` (`user ? <Navigate to="/admin">`).
- En el sidebar quedarían dos ítems llamados "Dashboard" (el viejo apuntando a la tabla, el nuevo al dashboard real), así que el ítem existente `/admin` se re-etiqueta a **"Clientes"** — que es literalmente el `<h2>` de esa página hoy. Es el cambio mínimo que elimina la ambigüedad sin invadir el scope del otro change.
- Si `admin-user-management` mueve la tabla a `/admin/users`, promover el dashboard a `/admin` es después un cambio de una línea. Ver OQ1.

### D7 — Identidad del evento: `user_id` cuando se conoce, `telegram_chat_id` siempre

`user_id` es **nullable** con `ON DELETE SET NULL`. Razón: hay eventos que ocurren antes o fuera de la vinculación (un chat no vinculado que dispara moderación), y borrar un perfil no debe borrar la historia de costo — el gasto ocurrió igual. `telegram_chat_id` se guarda siempre como identidad de respaldo y permite reconciliar a posteriori. Consecuencia: los KPIs globales (costo, publicaciones, imágenes) **no** filtran por `user_id`; solo el desglose por cliente (fuera de scope, OQ4) lo haría.

### D8 — La instrumentación de n8n va en un change separado (`n8n-usage-events-logging`)

Este change **define y versiona el contrato** (`docs/usage-events-contract.md` + la spec `usage-events-tracking`), pero no edita `codigo.json`. Razones:

1. `codigo.json` tiene 4 changes en progreso encima (`input-security-hardening` 50/61, `publish-video-platform-schedule` 73/101, `error-handling`, `pdf-virus-scan`); agregar nodos desde acá genera conflictos y obliga a re-verificar los recuentos de nodos de esos tests.
2. Son artefactos, herramientas y suites de verificación distintas (React/SQL vs. grafo n8n + `tests/*/verify-*.js`).
3. El dashboard es entregable y revisable **sin** la instrumentación: el KPI de clientes es real desde el primer deploy y el resto muestra el estado "sin datos" (que es información verdadera, no una falla).

El contrato que el change hermano debe implementar, en concreto — un nodo `httpRequest` clonado de `HTTP - Upsert producto imagen`:

```
POST https://<project>.supabase.co/rest/v1/usage_events
Auth: httpHeaderAuth "Supabase Service Role"
Headers: Prefer: resolution=ignore-duplicates      (idempotencia, D9)
Body: { event_key, event_type, user_id, telegram_chat_id,
        provider: 'google', model, quantity, input_tokens,
        output_tokens, metadata, occurred_at }
```

Puntos de inserción sugeridos: después de `Generate an image` (`image_generated`), después de `Edit an image` (`image_edited`), después de `HTTP - Crear post Postiz` (`post_published`, con `quantity` = cantidad de plataformas y `metadata.platforms`), y después de cada nodo Gemini de texto/moderación (`ai_call`). Todos con `alwaysOutputData` y **sin** que su fallo corte el flujo del usuario: **loguear no puede romper publicar** (Riesgo R5).

### D9 — Idempotencia por `event_key`, no por confianza en el productor

n8n reintenta (`retryOnFail`) y puede re-ejecutar ramas: sin protección, una imagen se contaría dos veces y el costo quedaría inflado. Cada evento lleva `event_key text UNIQUE` construido como `<execution_id>:<node_name>:<item_index>` y el POST usa `Prefer: resolution=ignore-duplicates`, de modo que un reintento es un no-op en vez de un duplicado. Es la razón por la que el contrato exige `event_key` obligatorio y por la que la constraint vive en la DB (única frontera confiable) y no en el workflow.

### D10 — "Imágenes rehechas" = `image_edited` + regeneraciones, contadas en el total y desglosadas

El pedido del usuario dice explícitamente "cuántas imágenes se han creado (incluyendo las rehechas)". Definición normativa: **imágenes totales = todos los eventos `image_generated` + `image_edited`** (una regeneración cuesta plata igual que la primera, y el objetivo del KPI es medir uso/costo real). El KPI muestra el total como cifra principal y "N nuevas · M rehechas" como sublínea, para que el ratio de rehacer (señal de calidad del prompt) quede visible.

### D11 — Sin librería de gráficos nueva

`package.json` no tiene ninguna dependencia de charting. La serie diaria se dibuja con barras CSS (`div` con `height: %`) o SVG inline sobre `GlassCard`, con los tokens de color del tema (`primary`, `secondary`, `surface-container-*`) ya definidos en Tailwind. Sumar Recharts/Chart.js sería ~200 KB de bundle para cuatro KPIs y una serie de barras. Si a futuro el dashboard crece a gráficos interactivos, esa dependencia se discute en su propio change.

### D12 — Verificación offline estática (no hay test runner en el frontend)

`aura-frontend/package.json` no declara ningún test runner (solo `vite` y `oxlint`); la convención de verificación del repo son scripts Node offline (`tests/link-code/verify-link-flow.js`, `tests/error-handling/verify-retries.js`). Se sigue esa convención con `tests/admin-dashboard-metrics/verify-dashboard.js`: parsea la migración y los archivos del frontend y verifica invariantes (tablas/RPC/índices/RLS presentes, chequeo de rol dentro del RPC, ruta registrada, nombre del RPC consumido, `package.json` sin dependencias nuevas). No sustituye un test de integración contra Supabase; ese queda como verificación manual del Migration Plan.

### D13 — Agrupación temporal de la serie diaria en `America/Argentina/Buenos_Aires`

`occurred_at` se guarda en `timestamptz` (UTC, sin ambigüedad). La serie diaria agrupa por `date_trunc('day', occurred_at AT TIME ZONE 'America/Argentina/Buenos_Aires')` para que "hoy" en el dashboard coincida con el día del negocio y no corte a las 21:00 hora local. La zona queda como constante del RPC, no como parámetro (OQ3).

### D14 — Chart de tendencia inline SVG, solo en las dos cards de serie temporal (decisión tomada en apply, 2026-08-18)

D11 dejaba abierto *cómo* se dibuja la serie diaria ("barras CSS o SVG inline"). Al implementar el Grupo 4 se concreta así, a pedido explícito del usuario:

- **Alcance selectivo**: de las 4 KPI cards, solo **Publicaciones realizadas** e **Imágenes generadas** son series temporales y llevan un mini chart embebido (usan `daily[].posts` / `daily[].images` del RPC). **Clientes** y **Costo estimado Google AI** son números planos — nunca reciben chart, aunque el costo sí varíe con el período (evita ruido visual en KPIs que el usuario lee como una cifra única, no como tendencia).
- **Forma**: chart de área/línea estilo "stock chart" — un `<path>` de línea más un área rellena con `<linearGradient>` por debajo, que se desvanece del color de la métrica (junto a la línea) a transparente (hacia abajo), en vez de las barras CSS que D11 dejaba como opción por defecto.
- **Sin librería nueva** (consistente con D11): implementado 100% en SVG inline, sin `viewBox` fijo por dato — `aura-frontend/src/components/TrendChart.jsx`, reutilizado por `aura-frontend/src/components/StatCard.jsx` vía una prop `trend` opcional.
- **Acento de color nuevo — "metrics accent"**: la paleta del proyecto hoy es violeta→azul (`#ddb7ff` → `#0566d9`, el gradiente de marca que usa `GradientButton`) y no tiene ningún verde/turquesa. Se introduce `METRICS_ACCENT = '#2dd4bf'` (Tailwind `teal-400`) como acento semántico **separado** de la marca, exportado desde `TrendChart.jsx` para que cualquier otro chart de métricas futuro lo reutilice en vez de inventar un tono nuevo. Elegido por ser un turquesa estándar, con contraste suficiente contra el fondo oscuro del panel (`bg-background`) para leerse como línea de 2px; es fácil de ajustar cambiando una sola constante si el usuario prefiere otro tono.
- **Alternativa descartada**: colorear el chart con `primary` (violeta) para no introducir un tono nuevo. Se descarta porque el objetivo explícito es que el chart de métricas se distinga visualmente de los acentos de marca/acción (botones, focus rings) que ya usan violeta — un tercer significado de color necesita su propio tono, no reciclar uno que el usuario ya asocia a "acción interactiva".

Ver `aura-frontend/src/components/TrendChart.jsx` (implementación) y `aura-frontend/src/components/StatCard.jsx` (prop `trend`, solo pasada por `AdminDashboard.jsx` en las dos cards de serie temporal).

## Risks / Trade-offs

- **R1 — El costo mostrado no es la factura real de Google.** → Se rotula como estimación en la UI (D3), se documenta el método y la tabla de precios es auditable/corregible con `effective_from`. Si el usuario necesita la cifra exacta, es un change nuevo con Cloud Billing API.
- **R2 — No hay historia previa: el dashboard arranca en cero.** → No es recuperable (nunca se registró nada). Mitigación: el dashboard muestra "datos desde `<fecha del primer evento>`" y el estado "sin datos" en lugar de "$0"; se comunica que la serie histórica empieza el día de la instrumentación.
- **R3 — Hasta que se aplique `n8n-usage-events-logging`, 3 de los 4 KPIs están vacíos.** → El estado degradado es un requisito explícito de la spec, no un bug; el KPI de clientes funciona desde el día 1. La dependencia queda declarada en el proposal y en `docs/usage-events-contract.md`.
- **R4 — `usage_events` crece sin límite.** → Volumen esperado bajo (miles de filas/mes); índices por `occurred_at` y `event_type`. Rollup/retención documentado como trabajo futuro; no se implementa para no diseñar contra un problema que aún no existe.
- **R5 — Un fallo al loguear podría romper el flujo del bot.** → El contrato exige que los nodos de logging no bloqueen el camino feliz (`onError: continueRegularOutput`, sin retry agresivo). Perder un evento degrada una métrica; romper la publicación degrada el producto.
- **R6 — Conflicto de merge en `Sidebar.jsx` con `admin-user-management`.** → Ambos changes tocan el array `navItems` de un solo archivo. Convención: este change agrega el ítem `/admin/dashboard` y re-etiqueta el ítem `/admin` a "Clientes"; el otro change cambia el destino/label del ítem de gestión de usuarios. Conflicto trivial de resolver; se coordina con OQ1.
- **R7 — `SECURITY DEFINER` mal escrito = fuga de métricas globales.** → El chequeo de rol es la primera instrucción del RPC, `search_path` fijo en `public`, `EXECUTE` otorgado solo a `authenticated`, y el test estático verifica que el chequeo de rol esté presente en la migración. Falla cerrada: sin fila admin en `profiles`, `raise exception`.
- **Trade-off aceptado — el dashboard depende de un productor externo que no controla.** Si n8n deja de loguear (workflow editado a mano en la UI de n8n), las métricas se congelan silenciosamente. Mitigación mínima: el dashboard muestra la fecha del último evento registrado, que hace visible el congelamiento sin monitoreo extra.

## Migration Plan

1. **Aplicar la migración** `20260817000001_usage_events.sql` en Supabase (idempotente: `create table if not exists`, `create index if not exists`, `create or replace function`). No toca tablas existentes → sin downtime.
2. **Cargar/ajustar precios** en `ai_model_prices` (seed incluido en la migración, marcado como estimación; confirmar valores con el usuario, OQ2).
3. **Verificar la frontera de seguridad a mano**: con un JWT de usuario común, `rpc('admin_dashboard_metrics')` debe fallar con `forbidden`; con un JWT admin debe devolver el JSON; con anon key sin sesión, `select` directo sobre `usage_events` debe devolver 0 filas.
4. **Desplegar el frontend** (`pnpm build`). El dashboard queda accesible en `/admin` (OQ1 resuelto, ver más abajo) mostrando clientes reales y el resto en estado "sin datos".
5. **Aplicar el change hermano** `n8n-usage-events-logging` sobre `codigo.json` según `docs/usage-events-contract.md`; validar con una corrida real del bot (generar imagen → rehacer → publicar) que aparecen 3 filas en `usage_events` y que los KPIs se mueven.
6. **Rollback**: quitar la ruta y el ítem del sidebar (cambio de frontend, reversible en un deploy). Las tablas pueden quedar: son aditivas, nadie más las lee y no afectan ningún flujo existente. Rollback destructivo (`drop table usage_events`) solo si se abandona la iniciativa, y con la advertencia de que borra datos no recuperables.

## Open Questions

- ~~**OQ1 — Ruteo final `/admin` vs `/admin/dashboard`.**~~ — **RESUELTO (2026-08-18):** `admin-user-management` se archivó habiendo movido la tabla de clientes a `/admin/users` y dejado `/admin` como redirect provisional. Confirmado por el usuario: el dashboard reclama `/admin` directamente (reemplaza el redirect), no se crea `/admin/dashboard`, y no hace falta relabel de sidebar. Implementado en `App.jsx` (Grupo 5, tasks.md 5.1); `Sidebar.jsx` no requirió cambios (5.2).
- **OQ2 — Precios reales por modelo.** ¿Qué precio de lista usar para `gemini-3-pro-image-preview` (por imagen) y `gemini-2.5-flash` (por millón de tokens in/out), y en qué moneda/tier (free tier vs. paid)? Los valores seed se cargan como placeholders marcados `is_estimate = true`; el número del KPI no es confiable hasta confirmarlos.
- **OQ3 — Alcance del "costo de Google AI".** ¿Incluye solo la generación/edición de imágenes (lo que el usuario percibe como "la IA que hace el trabajo"), o también moderación, clasificador de injection y análisis de documentos? El diseño asume **todo** (es lo que Google factura), con desglose por modelo para poder separarlo. Confirmar. Idem zona horaria de agrupación (D13) si el negocio no es de Argentina.
- **OQ4 — ¿Hace falta desglose por cliente?** ("qué cliente gasta más") El modelo de datos ya lo soporta (`user_id` en cada evento), pero la UI de este change solo muestra totales globales + desglose por modelo. Si se quiere ranking por cliente, es una iteración chica sobre el mismo RPC.
- **OQ5 — Definición de "cliente activo".** El KPI de clientes muestra total y activos usando `profiles.is_active` (lo que ya usa `AdminPanel.jsx`). ¿"Activo" debería ser en cambio "con actividad en el período" (tiene eventos)? Se implementa `is_active` por consistencia con lo existente y se deja la métrica de actividad real como candidata para la próxima iteración.
