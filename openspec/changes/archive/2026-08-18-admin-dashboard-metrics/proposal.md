## Why

El panel de admin no tiene un dashboard: la ruta `/admin` (etiquetada "Dashboard" en el sidebar) es en realidad una tabla de clientes (`AdminPanel.jsx`, lee `profiles.*`, sin KPIs ni gráficos, botón "Acciones" muerto). El admin no tiene forma de responder las cuatro preguntas de negocio del producto — **cuántos clientes tenemos, cuánto se lleva gastado en Google AI, cuántas publicaciones se realizaron y cuántas imágenes se generaron (incluyendo las rehechas)** — porque tres de esas cuatro métricas **no existen en ningún lado**: el bot de Telegram genera imágenes (`Generate an image` / `Edit an image`, Gemini) y publica (`HTTP - Crear post Postiz`) sin dejar ningún registro en Supabase. Hoy el único dato disponible es `profiles` (clientes); el resto se pierde en cada ejecución de n8n.

Este cambio crea el sustrato de datos (tabla de eventos de uso + tabla de precios + RPC de agregación) y el dashboard real que lo consume, y define el **contrato de evento** que el workflow de n8n deberá emitir.

## What Changes

- **Supabase — migración nueva e idempotente** `aura-frontend/supabase/migrations/20260817000001_usage_events.sql`:
  - `public.usage_events`: log append-only de eventos de uso (`image_generated`, `image_edited`, `post_published`, `ai_call`) con `user_id`, `telegram_chat_id`, `model`, `input_tokens`/`output_tokens`, `quantity`, `metadata jsonb`, `occurred_at`. Es la fuente de las métricas 2, 3 y 4.
  - `public.ai_model_prices`: tabla de precios de lista por modelo/unidad con `effective_from`, para estimar el costo de Google AI **a tiempo de lectura** (no se congela un número mal calculado en el log).
  - `public.admin_dashboard_metrics(p_from timestamptz, p_to timestamptz)`: RPC `SECURITY DEFINER` que valida `profiles.role = 'admin'` y devuelve, en **una sola llamada**, los 4 KPIs, el desglose de costo por modelo y la serie diaria. La agregación corre en Postgres; el frontend nunca descarga filas crudas.
  - RLS habilitado en ambas tablas: sin política de lectura directa para `authenticated` (el único camino de lectura es el RPC; n8n escribe con `service_role`, que bypasea RLS — mismo patrón que `telegram_link_codes`).
- **Frontend — dashboard nuevo en `/admin`** (`aura-frontend/src/pages/AdminDashboard.jsx`; ruta actualizada tras resolver OQ1 el 2026-08-18, ver `design.md` D6 — originalmente se planeó `/admin/dashboard`):
  - 4 KPI cards: Clientes (total / activos), Costo estimado Google AI (USD, **marcado como estimación**), Publicaciones realizadas, Imágenes generadas (con desglose nuevas vs. rehechas/editadas).
  - Selector de período (7 / 30 / 90 días / todo), desglose de costo por modelo, serie diaria de publicaciones e imágenes.
  - Estados de carga, error, y **estado degradado explícito** ("aún no hay eventos registrados — la instrumentación del bot está pendiente") para que el dashboard sea útil desde el día 1 aunque `usage_events` esté vacía.
  - Componentes construidos sobre `GlassCard`, `MaterialIcon`, `GradientButton` ya existentes. **Sin librería de gráficos nueva**: las barras se dibujan con CSS/SVG inline.
- **Ruteo y sidebar (OQ1 resuelto 2026-08-18)**: el change hermano `admin-user-management` se archivó habiendo movido la tabla de clientes a `/admin/users` y dejando `/admin` como redirect provisional, explícitamente para que este change lo reemplazara. Este change reclama `/admin` directamente (protegida con `requiredRole="admin"`), reemplazando ese redirect. No se crea `/admin/dashboard`. El ítem de sidebar "Dashboard" (agregado por el change hermano, ya apuntando a `/admin`) no requirió ningún cambio.
- **Contrato de evento documentado** `docs/usage-events-contract.md`: qué evento, con qué payload exacto y en qué punto del workflow debe escribirlo n8n (POST `/rest/v1/usage_events` con la credencial "Supabase Service Role", mismo patrón que `HTTP - Upsert producto imagen`).
- **Verificación offline** `tests/admin-dashboard-metrics/verify-dashboard.js`: chequeos estáticos (objetos SQL presentes en la migración, ruta registrada en `App.jsx`, nombre del RPC consumido por la página, ausencia de dependencias nuevas en `package.json`), siguiendo el patrón de `tests/link-code/verify-link-flow.js`.

**Fuera de scope (change separado, ver `design.md` D8):** la instrumentación del workflow n8n (`codigo.json`) que **escribe** los eventos. Este cambio define y versiona el contrato; la escritura la implementa el change hermano propuesto `n8n-usage-events-logging`. Consecuencia asumida: hasta que ese change se aplique, los KPIs 2-4 muestran el estado degradado y solo "Clientes" tiene datos reales.

## Capabilities

### New Capabilities
- `usage-events-tracking`: modelo de datos de eventos de uso en Supabase — tabla `usage_events` append-only, tabla de precios `ai_model_prices`, RPC de agregación `admin_dashboard_metrics` con control de rol, y el contrato de evento que los productores (hoy el workflow n8n) deben cumplir.
- `admin-dashboard-metrics`: la página de dashboard del panel de admin — los 4 KPIs pedidos, período configurable, desglose por modelo, serie diaria, estados de carga/error/sin-datos, y su ruteo protegido por rol.

### Modified Capabilities
<!-- Ninguna: no cambian requisitos de ninguna spec existente (dashboard-social-connections, meta-oauth, token-manager, x-twitter-oauth). El re-etiquetado del ítem de sidebar y la ruta nueva no alteran requisitos especificados. -->

## Impact

- **Nuevo**: `aura-frontend/supabase/migrations/20260817000001_usage_events.sql` (tablas `usage_events`, `ai_model_prices`; RPC `admin_dashboard_metrics`; índices; RLS; seed de precios marcado como estimación).
- **Nuevo**: `aura-frontend/src/pages/AdminDashboard.jsx`, `aura-frontend/src/components/StatCard.jsx`, `aura-frontend/src/lib/metrics.js` (wrapper del RPC + formateo de moneda/número).
- **Modificado**: `aura-frontend/src/App.jsx` (una ruta nueva), `aura-frontend/src/components/Sidebar.jsx` (un ítem nuevo + re-etiquetado de uno existente). **`AdminPanel.jsx` no se toca** (territorio de `admin-user-management`).
- **Nuevo**: `docs/usage-events-contract.md` (contrato cross-repo), `tests/admin-dashboard-metrics/verify-dashboard.js`.
- **Dependencias**: ninguna nueva en `package.json` (se usan `@supabase/supabase-js`, `react-router-dom` y Tailwind ya presentes).
- **Dependencia de datos**: los KPIs 2-4 quedan en cero hasta que se aplique el change hermano `n8n-usage-events-logging` sobre `codigo.json`. No hay backfill posible: no existen registros históricos de imágenes ni publicaciones, por lo que las métricas cuentan **desde la fecha de instrumentación** y el dashboard lo declara en la UI.
- **Coordinación**: `admin-user-management` (change hermano) toca `Sidebar.jsx` y `AdminPanel.jsx`. El solapamiento se limita a `Sidebar.jsx` — conflicto de merge de bajo riesgo, resuelto con la convención de OQ1.
- **Seguridad/gobernanza**: MEDIUM. Solo lectura para el frontend, sin tocar Auth ni credenciales. El único punto sensible es que el RPC es `SECURITY DEFINER` y por lo tanto debe verificar `role = 'admin'` internamente (decisión D5) — es la frontera que impide que un usuario común lea métricas globales.
