## Why

El panel de admin de `aura-frontend` promete "Gestión de Usuarios" en el sidebar y no la tiene. Verificado contra el código:

- **`RegisterUser.jsx`** (ruta `/admin/register-user`, el ítem que el sidebar rotula "Gestión de Usuarios") es **solo un modal de alta**: un formulario que invoca la Edge Function `create-user` y vuelve a `/admin`. No lista usuarios, no muestra información de nadie, no tiene ninguna acción sobre usuarios existentes.
- **`AdminPanel.jsx`** (ruta `/admin`, rotulada "Dashboard" en el sidebar) **no es un dashboard**: es una tabla de clientes (ID / Empresa / Email / Telegram / Estado / Acciones) que lee `profiles.*`. Su columna "Acciones" tiene un botón `⋮` **sin `onClick`** — está muerto desde que se escribió. Sin paginación, sin filtros, sin detalle por usuario.
- **Bloquear o dar de baja un usuario no existe en ninguna parte del código.** No hay UI, no hay Edge Function, no hay columna de estado más allá de `is_active` booleano.

Y hay tres hallazgos que convierten esto en algo más que un problema de UI:

1. **`create-user` no verifica que quien la llama sea admin** (`aura-frontend/supabase/functions/create-user/index.ts`): recibe el body, crea el usuario con `service_role` y le asigna el `role` que venga en el JSON — incluido `"admin"`. Cualquier usuario autenticado con el JWT de una cuenta común puede invocarla y crearse un admin. Es **escalada de privilegios**, y este change agrega más operaciones privilegiadas sobre la misma superficie, así que no puede ignorarse.
2. **`is_active` hoy no bloquea nada.** No aparece en `codigo.json` (0 ocurrencias) y en el frontend solo se usa para pintar el badge de la tabla. Los dos nodos que resuelven el perfil del bot (`HTTP - Chequear vinculacion`, `HTTP - Perfil publicacion`) consultan `profiles?telegram_chat_id=eq.<chat>&select=id` **sin filtrar por estado**. Marcar a alguien "Inactivo" es puramente cosmético: sigue usando el bot. Un botón "Bloquear" que no bloquea es peor que no tenerlo.
3. **La columna "Telegram Chat ID" muestra el campo equivocado.** `AdminPanel.jsx` lee `profile.telegram_id` (el que escribe `create-user` a mano desde el formulario), mientras que el vínculo real que usa el bot vive en `profiles.telegram_chat_id` (lo escriben las migraciones `20260630000002_telegram_link_tokens.sql` y `20260814000001_telegram_link_codes_reproducible.sql`). El admin está mirando un dato que no corresponde al estado real de vinculación.

## What Changes

> **Gobernanza — CRITICAL (Auth / gestión de acceso).** Este change vive en el dominio de autenticación y control de acceso, clasificado **CRITICAL** en la política de autonomía por dominio del proyecto: *"Analysis only; no code written without explicit human approval."* Los artefactos de este change (proposal, design, specs, tasks) son **planificación**. La fase `apply` **requiere confirmación explícita del usuario, grupo por grupo**, antes de tocar `aura-frontend/src/`, `aura-frontend/supabase/`, `codigo.json` o cualquier archivo del repo. Ver `design.md` §Gobernanza y el banner de `tasks.md`.

- **La tabla de usuarios se convierte en la página real de "Gestión de Usuarios"**, en su propia ruta `/admin/users`, con la información que hoy falta: nombre, empresa, email, rol, **estado real** (activo / bloqueado / dado de baja), vinculación de Telegram tomada del campo correcto (`telegram_chat_id`, con `telegram_id` como fallback declarado), fecha de alta y última actividad disponible. Búsqueda existente conservada, más filtro por estado y por rol, y paginación (hoy trae la tabla entera sin límite).
- **El alta deja de ser una página separada y pasa a ser un modal dentro de esa página** (botón "+ Nuevo usuario"). `RegisterUser.jsx` se reusa como componente de modal; `/admin/register-user` queda como redirect a `/admin/users` para no romper links ni bookmarks. Al crear un usuario, la lista se refresca sin recargar la página.
- **El menú "Acciones" (`⋮`) deja de estar muerto** y expone, con confirmación explícita y motivo opcional: **Bloquear**, **Desbloquear**, **Dar de baja**, **Reactivar** y **Ver detalle**. Un admin no puede bloquearse ni darse de baja a sí mismo.
- **Modelo de estados explícito de tres valores** (`active` / `blocked` / `deactivated`) en `profiles`, reemplazando la semántica binaria de `is_active`, que se conserva sincronizada para no romper a ningún consumidor existente. "Bloquear" es una suspensión reversible; "dar de baja" es una baja definitiva (soft delete) que además libera el vínculo de Telegram. Ver `design.md` D1.
- **Las acciones privilegiadas se ejecutan en una Edge Function nueva (`admin-user-status`), no con un `UPDATE` desde el cliente.** Un `UPDATE` de cliente no puede revocar la sesión de Supabase Auth del usuario afectado: un usuario bloqueado seguiría operando con su JWT vigente hasta que expire. La Edge Function verifica que el llamador sea admin, cambia el estado y aplica la revocación de acceso del lado de Auth (ban + cierre de sesiones). Ver `design.md` D3.
- **`create-user` se endurece**: verificación del JWT del llamador contra `profiles.role = 'admin'` antes de crear nada, y rechazo de la escalada de privilegios que hoy permite. **BREAKING** para cualquier consumidor no-admin de esa función (hoy no debería haber ninguno legítimo).
- **El bloqueo se hace efectivo donde importa**: RLS/consultas del panel y, sobre todo, en el bot — los dos nodos de `codigo.json` que resuelven el perfil por `telegram_chat_id` pasan a filtrar por estado activo, de modo que un usuario bloqueado o dado de baja deja de ser atendido por el bot. Este bloque toca el workflow n8n y tiene su propio grupo de aprobación.
- **Ruteo coordinado con el change hermano `admin-dashboard-metrics`**: `/admin` queda **libre** para el dashboard de métricas nuevo. Hasta que ese change aterrice, `/admin` redirige a `/admin/users`. Ver `design.md` D6 y la nota de coordinación en `tasks.md`.

Fuera de alcance (declarado): construir el dashboard de métricas (es el change hermano); un sistema de permisos granular más allá de `role ∈ {admin, user}`; edición del perfil de otro usuario (cambiar email, empresa, rol) — solo alta y transiciones de estado; borrado físico (`hard delete`) de usuarios; auditoría completa de todas las acciones del panel (se registra solo la traza mínima de las transiciones de estado, ver `design.md` D5).

## Capabilities

### New Capabilities

- `admin-user-directory`: Listado de usuarios del panel de admin en `/admin/users` — qué información se muestra de cada usuario, de qué campos sale, búsqueda, filtros por estado y rol, paginación y estados de carga/error/vacío.
- `admin-user-lifecycle`: Modelo de estados de un usuario (`active` / `blocked` / `deactivated`), transiciones permitidas, acciones de la UI (alta, bloquear, desbloquear, dar de baja, reactivar), confirmaciones y salvaguardas (no auto-bloqueo, no dejar el sistema sin admins).
- `admin-user-actions-api`: Superficie privilegiada del lado servidor — Edge Function `admin-user-status` y endurecimiento de `create-user`: verificación de que el llamador es admin, contrato de request/response, y aplicación de la revocación de acceso en Supabase Auth.
- `blocked-user-enforcement`: Que el estado no sea cosmético — dónde y cómo se hace efectivo el bloqueo/baja: sesión de Supabase Auth, acceso al panel y atención del bot de Telegram en `codigo.json`.

### Modified Capabilities

*(Ninguna. `openspec/specs/` contiene hoy `dashboard-social-connections`, `meta-oauth`, `token-manager` y `x-twitter-oauth`. Ninguna cambia sus requirements: este change no altera el flujo de conexión de redes ni el manejo de tokens. La ruta `/admin` que hoy sirve `AdminPanel.jsx` se libera para el change hermano `admin-dashboard-metrics`, coordinación que se documenta en `design.md` D6 y en `tasks.md`, no como delta de spec.)*

## Impact

- **Frontend (`aura-frontend/src/`)**:
  - `pages/AdminPanel.jsx` → se convierte en la página de gestión de usuarios y se muda a `/admin/users` (renombre a `pages/UsersPage.jsx` propuesto en `design.md` D6). Deja de ser el ocupante de `/admin`.
  - `pages/RegisterUser.jsx` → se reusa como modal dentro de esa página; su ruta pasa a redirect.
  - `components/Sidebar.jsx` → "Gestión de Usuarios" apunta a `/admin/users`. El ítem "Dashboard" queda para el change hermano.
  - `App.jsx` → rutas `/admin/users`, redirects de `/admin/register-user` y de `/admin` (provisional).
  - Componentes nuevos: menú de acciones, diálogo de confirmación, panel/modal de detalle de usuario, badge de estado de tres valores (hoy `StatusBadge` solo entiende Activo/Inactivo).
  - `context/AuthContext.jsx` → hoy selecciona `role, company, full_name`; necesita también el estado del propio usuario para el enforcement en el panel (`design.md` D4).
- **Supabase (`aura-frontend/supabase/`)**:
  - Migración nueva: columna `status` en `profiles` con `CHECK` de tres valores, backfill desde `is_active`, sincronización de `is_active`, y columnas de traza (`status_changed_at`, `status_changed_by`, `status_reason`). Política RLS de lectura/escritura sobre `profiles` para admins.
  - Edge Function nueva `admin-user-status/index.ts` (patrón Deno `serve` + CORS ya usado por `create-user`, `token-manager`, `auth-*-callback`).
  - `functions/create-user/index.ts` modificada: verificación de admin del llamador. **BREAKING** para llamadores no-admin.
- **Workflow n8n (`codigo.json`, 217 nodos)**: los nodos `HTTP - Chequear vinculacion` y `HTTP - Perfil publicacion` agregan el filtro de estado activo a su query sobre `profiles`. Sin nodos nuevos si el filtro se resuelve en la URL; el manejo del caso "perfil no encontrado" ya existe aguas abajo y se reutiliza.
- **Datos**: los usuarios existentes con `is_active = false` se migran a un estado concreto — decisión abierta entre `blocked` y `deactivated` (`design.md` §Open Questions 2), porque la información para distinguirlos no existe hoy.
- **Seguridad**: cierra una escalada de privilegios activa (`create-user` sin verificación de admin) y convierte el estado del usuario en un control de acceso real en tres superficies (Auth, panel, bot).
- **Coordinación**: `admin-dashboard-metrics` toma `/admin` y el ítem "Dashboard" del sidebar; este change toma `/admin/users` y el ítem "Gestión de Usuarios". Ambos tocan `App.jsx` y `Sidebar.jsx` — quien aplique segundo debe integrarse, no revertir.
