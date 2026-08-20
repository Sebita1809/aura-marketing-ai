# Design: support-messaging

## Gobernanza — MEDIUM (lógica de negocio / mensajería)

Este change vive en el dominio de **lógica de negocio**, clasificado **MEDIUM** en la política de autonomía por dominio del proyecto: *"Implement with checkpoints; surface decisions to the user."*

Consecuencias operativas:

1. La fase `apply` **es autónoma por grupo**: no hace falta un OK tarea por tarea como en `input-security-hardening` (CRITICAL).
2. El agente **sí debe frenar y consultar** en los checkpoints marcados en `tasks.md`: (a) tras la migración SQL, antes de aplicarla contra el proyecto Supabase real; (b) ante cualquier decisión de UX no obvia (texto de los estados, categorías del formulario); (c) si aparece una necesidad de tocar `profiles`, autenticación o roles — eso escala a CRITICAL y sale del alcance de este change.
3. No se toca ningún dominio CRITICAL: sin cambios en Auth, en `profiles.role`, en billing ni en credenciales.

## Context

**Estado verificado del código** (`aura-frontend/`, Vite + React 19 + react-router-dom 7 + `@supabase/supabase-js` ^2.108, Tailwind 4):

| Pieza | Estado hoy | Archivo |
|---|---|---|
| Botón "Soporte" | `<Link to="#">` sin handler, **fuera** del bloque `isAdmin` → aparece en ambos sidebars | `src/components/Sidebar.jsx:68-74` |
| Nav admin | Solo `Dashboard` (`/admin`) y `Gestión de Usuarios` (`/admin/register-user`) | `src/components/Sidebar.jsx:25-29` |
| Nav usuario | `Conexiones`, `Métricas`, `Perfil` (`/app/*`) | `src/components/Sidebar.jsx:30-34` |
| Campanita `notifications` | Maquetada en el header, `<button>` **sin `onClick`** | `src/pages/ProfilePage.jsx:26-28`, `src/pages/MetricsPage.jsx` (mismo bloque) |
| Bandeja de soporte admin | **No existe** | — |
| Tabla de mensajería/tickets | **No existe** en `supabase/migrations/` (hoy: oauth, telegram link tokens, products, social_accounts) | — |
| Rol | `profiles.role === 'admin'`, cargado en `AuthContext` y expuesto como `profile` | `src/context/AuthContext.jsx:22-31` |
| Guard de rutas | `<ProtectedRoute requiredRole="admin">` | `src/App.jsx:26-33` |
| Acceso a datos | `supabase` client directo desde el componente + `useAuth()`; sin capa de repositorio ni React Query | `src/pages/AdminPanel.jsx:44-77` |
| Edge Functions | `auth-meta-callback`, `auth-x-callback`, `create-user`, `token-manager` (Deno + `serve` + CORS) | `supabase/functions/` |

**Restricciones:**
- El proyecto **no tiene test runner** (`package.json` solo expone `dev`/`build`/`lint`/`preview`, con `oxlint`). La verificación es lint + build + prueba manual con dos cuentas (admin y usuario), no TDD automatizado.
- No se agregan dependencias npm: Realtime ya viene dentro de `@supabase/supabase-js`.
- El patrón SQL del proyecto está fijado por `20260630000002_telegram_link_tokens.sql`: tabla con `uuid` + `gen_random_uuid()`, FK a `public.profiles(id) ON DELETE CASCADE`, índices explícitos, `ENABLE ROW LEVEL SECURITY` + políticas nombradas por acción, y funciones `SECURITY DEFINER` con `SET search_path = public` cuando hace falta saltear una restricción de RLS de forma controlada.
- Escala real: un puñado de clientes y un admin. Cualquier diseño que optimice para volumen alto (colas, índices exóticos, desnormalización) es sobreingeniería acá.

## Goals / Non-Goals

**Goals:**
- Un canal de ida y vuelta admin↔usuario dentro del producto, con historial y estado por consulta.
- Aislamiento estricto entre clientes: un usuario no puede leer, escribir ni enumerar consultas ajenas — garantizado en la base de datos (RLS), no en el cliente React.
- Que el usuario se entere de la respuesta del admin sin recargar la página.
- Reutilizar lo que ya está maquetado (campanita, botón "Soporte") en vez de agregar superficie visual nueva.
- Corregir el bug de ubicación del botón "Soporte" en el mismo change, porque es el mismo punto de entrada del flujo.

**Non-Goals:**
- Notificaciones fuera del panel (mail, push, Telegram al usuario).
- Adjuntos, imágenes o formato rico en los mensajes.
- Asignación de tickets a administradores concretos, SLA, prioridades, métricas de soporte.
- Chat en vivo con indicador de "escribiendo", acuses de entrega, edición o borrado de mensajes.
- Búsqueda full-text sobre el historial.
- Cualquier cambio en autenticación, alta de usuarios (`create-user`) o en `profiles`.

## Decisions

### D1 — Modelo de datos: dos tablas (`support_tickets` + `support_messages`), no una

Se separa **la solicitud** del **hilo de conversación**:

```
support_tickets                          support_messages
─────────────────────────────            ─────────────────────────────
id            uuid pk                    id          uuid pk
user_id       uuid → profiles(id)        ticket_id   uuid → support_tickets(id) ON DELETE CASCADE
subject       text                       sender_id   uuid → profiles(id)
category      text  (check)              sender_role text check ('user','admin')
status        text  (check)              body        text
created_at    timestamptz                read_at     timestamptz null   -- leído por el destinatario
updated_at    timestamptz                created_at  timestamptz
last_message_at timestamptz
```

- **El ticket es la unidad de trabajo del admin** (`subject`, `category`, `status`, `last_message_at`): la bandeja "Comunicados y Reportes" lista y filtra tickets. Con una sola tabla plana de mensajes, esa lista exigiría un `GROUP BY` + `DISTINCT ON` en cada carga, y el estado (`abierto` / `respondido` / `cerrado`) no tendría dónde vivir salvo duplicado en cada fila.
- **El primer mensaje del ticket NO se guarda en `support_tickets`**: la descripción inicial que escribe el usuario se inserta como la **primera fila de `support_messages`** con `sender_role='user'`. Así el hilo es homogéneo (render y ordenamiento uniformes, sin caso especial para "el mensaje 0") y el ticket queda como puro metadato. `subject` y `category` sí son del ticket: son propiedades de la consulta, no de un turno.
- `status` con `CHECK (status IN ('open','answered','closed'))`. Transiciones: `open` al crearse; `answered` cuando un admin responde; vuelve a `open` cuando el usuario contesta sobre un ticket `answered`; `closed` solo por acción explícita del admin. Un ticket `closed` no acepta mensajes nuevos (bloqueado por policy, ver D3).
- `last_message_at` se mantiene por **trigger** `AFTER INSERT ON support_messages` (junto con la transición de `status`), no desde el cliente: si lo calculara el frontend, un cliente malicioso o un bug dejaría la bandeja del admin ordenada mal, y hay dos escritores distintos (usuario y admin).

*Alternativa descartada — una sola tabla `support_messages` con `parent_id` autorreferencial:* menos DDL, pero mete el estado y el asunto en la fila raíz, obliga a un self-join para todo listado, y hace que las policies RLS tengan que recorrer la cadena de padres para decidir propiedad. El ahorro de una tabla no compensa.

*Alternativa descartada — una tabla `notifications` separada:* duplicaría el contenido de la respuesta del admin en dos lugares y exigiría mantenerlas sincronizadas. Con `read_at` en el propio mensaje, la notificación **es** el mensaje (ver D4).

### D2 — Sin Edge Function nueva

Todo el flujo es INSERT/SELECT/UPDATE sobre dos tablas, con la autorización expresable íntegramente en RLS. Las Edge Functions existentes existen porque necesitan **secretos de servidor** (`create-user` usa la service_role key; `token-manager` y los callbacks OAuth manejan client secrets) — nada de eso aparace acá. Agregar una función sería latencia extra, una superficie más para mantener y un lugar más donde equivocarse con la autorización.

*Reevaluar si en el futuro se quiere:* notificar por mail/Telegram al admin cuando entra un ticket (necesita secreto de servidor → ahí sí, Edge Function o webhook a n8n).

### D3 — Autorización 100 % en RLS, con `public.is_admin()` `SECURITY DEFINER`

El rol vive en `profiles.role`. Consultarlo desde una policy con un `SELECT ... FROM profiles` inline es problemático: si `profiles` tiene RLS, la subconsulta se evalúa bajo esas policies y puede recursar o devolver vacío. Se define entonces:

```sql
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') $$;
```

Mismo patrón que `disconnect_telegram()` (`20260630000002_telegram_link_tokens.sql`). Es `STABLE`, así que Postgres la evalúa una vez por statement y no una vez por fila.

Policies (a `TO authenticated`, nunca a `anon`):

| Tabla | Acción | Usuario común | Admin |
|---|---|---|---|
| `support_tickets` | SELECT | `user_id = auth.uid()` | `is_admin()` |
| `support_tickets` | INSERT | `WITH CHECK (user_id = auth.uid())` | igual (un admin también podría abrir uno; no es el flujo) |
| `support_tickets` | UPDATE | ninguna (el usuario no cambia estado) | `is_admin()` — cerrar/reabrir |
| `support_messages` | SELECT | ticket propio (`EXISTS` sobre `support_tickets`) | `is_admin()` |
| `support_messages` | INSERT | ticket propio **y** `sender_role='user'` **y** `sender_id=auth.uid()` **y** ticket no `closed` | `is_admin()` **y** `sender_role='admin'` **y** `sender_id=auth.uid()` |
| `support_messages` | UPDATE | solo `read_at` de mensajes `sender_role='admin'` de sus tickets | solo `read_at` de mensajes `sender_role='user'` |

Puntos finos:
- `sender_role` se valida **en la policy**, no se confía en el cliente: sin eso, un usuario podría insertar un mensaje con `sender_role='admin'` en su propio ticket y ver una "respuesta del soporte" falsa. Ese es el peor caso realista de este modelo y la policy lo cierra.
- El UPDATE restringido a `read_at` se implementa con una policy de UPDATE + un **trigger `BEFORE UPDATE`** que rechaza cambios en cualquier columna que no sea `read_at` (Postgres no tiene RLS a nivel de columna para UPDATE; los `GRANT UPDATE (read_at)` por columna cubren parte, y el trigger cierra el resto).
- Sin policy de DELETE: nadie borra mensajes ni tickets desde el cliente.
- Verificación de aislamiento como escenario explícito en los specs (`support-messaging-access`), probada manualmente con dos cuentas reales.

### D4 — "No leído" con `read_at` por mensaje, sin tabla de notificaciones

La campanita del usuario cuenta mensajes con `sender_role='admin' AND read_at IS NULL` dentro de sus tickets; el badge del admin cuenta el simétrico (`sender_role='user' AND read_at IS NULL`). La RLS ya acota el universo, así que el conteo es un `select('*', { count: 'exact', head: true })` sin filtros de propiedad en el cliente.

*Alternativa descartada — marca de agua por ticket (`user_last_read_at` / `admin_last_read_at`):* menos filas escritas al leer un hilo, pero pierde granularidad (no se puede marcar un mensaje suelto como no leído) y obliga a comparar timestamps para contar, con riesgo de desfasaje de reloj entre cliente y servidor. Con este volumen, un UPDATE por mensaje leído es irrelevante.

### D5 — Realtime como camino principal, polling como degradación

**Decisión: Supabase Realtime (`postgres_changes` sobre `support_messages`), con carga inicial por fetch y fallback a polling cada 60 s si el canal no logra suscribirse.**

Por qué Realtime:
- El pedido explícito del usuario es *recibir* la respuesta del admin; un badge que aparece 60 s tarde no es una notificación, es un refresco.
- Cero dependencias nuevas: viene en `@supabase/supabase-js` ya instalado, y respeta RLS en `postgres_changes` (cada cliente solo recibe eventos de filas que su policy le deja ver) — la misma barrera de seguridad, sin lógica adicional.
- Polling puro para conseguir la misma sensación exigiría intervalos de ~5 s por sesión abierta, sostenidos todo el día contra la API de Supabase, para un evento que ocurre unas pocas veces por día. Es más carga y peor latencia a la vez.

Por qué igual hay fallback: la suscripción puede fallar (WebSocket bloqueado por una red corporativa, tab suspendida, `CHANNEL_ERROR` / `TIMED_OUT`). En ese caso el hook pasa a `setInterval` de 60 s y la funcionalidad se degrada, no se rompe. La carga inicial es siempre un fetch: Realtime entrega deltas, nunca el estado inicial.

Requiere alta explícita de la tabla en la publicación: `ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;` (y `support_tickets` para que la bandeja del admin se reordene sola). El canal se cierra con `supabase.removeChannel(ch)` en el cleanup del `useEffect` — el `Sidebar` ya usa ese patrón de suscripción/limpieza con listeners del DOM.

*Alternativa descartada — solo polling al montar la página:* el usuario tendría que navegar para enterarse; con `ProfilePage`/`MetricsPage` siendo placeholders, podría no volver a entrar nunca.

### D6 — Un hook `useSupport` como única capa de acceso a datos

El proyecto no tiene capa de datos: cada página llama a `supabase` en su propio `useEffect` (`AdminPanel.jsx`). Replicar eso en cuatro superficies (modal de usuario, bandeja admin, campanita en dos páginas) duplicaría las mismas queries y la misma suscripción Realtime. Se centraliza en `src/hooks/useSupport.js` (tickets, mensajes, conteo de no leídos, suscripción y limpieza), consumido por todos los componentes nuevos. Es la mínima abstracción que evita la duplicación, sin traer React Query ni un store global (que sí serían un cambio de arquitectura no justificado).

### D7 — El punto de entrada "Soporte" es exclusivo del rol usuario

El ítem "Soporte" se mueve **dentro** de la rama no-admin de `navItems` (o del bloque condicional del pie del sidebar), y el sidebar admin suma `{ path: '/admin/support', icon: 'forum', label: 'Comunicados y Reportes' }`. No se hace "ocultar con CSS" ni un `to` distinto según rol: el elemento directamente no se renderiza para admin. La barrera real igual está en la ruta (`<ProtectedRoute requiredRole="admin">`) y en RLS; el sidebar es solo coherencia de UX.

### D8 — Superficies de UI

- **Usuario**: el botón "Soporte" abre un **modal** (patrón ya presente: `src/components/ContactModal.jsx`), no una ruta nueva. Motivo: se accede desde cualquier página del panel y no debe perder el contexto de navegación. Dentro: lista de tickets propios + formulario de consulta nueva + hilo del ticket seleccionado con caja de respuesta.
- **Admin**: **ruta** `/admin/support` con página completa (`SupportInboxPage`), porque es una superficie de trabajo con lista, filtros y hilo — no cabe en un modal y debe ser enlazable.
- **Campanita**: componente `NotificationsBell` con badge de conteo y popover con las respuestas no leídas; al abrir una respuesta, se marca `read_at` y se navega al hilo correspondiente. Reemplaza el `<button>` inerte en `ProfilePage.jsx` y `MetricsPage.jsx`.

## Risks / Trade-offs

- **Policy RLS mal escrita expone consultas entre clientes** → es el riesgo #1 del change. Mitigación: policies explícitas por acción y por rol (nunca `USING (true)`), `sender_role` validado en la policy, escenarios de acceso denegado como requirements de `support-messaging-access`, y verificación manual obligatoria con dos cuentas reales antes de dar el change por hecho (checkpoint en `tasks.md`).
- **Fuga por Realtime**: si la tabla se agrega a la publicación pero RLS no está habilitada o la policy es laxa, los eventos de `postgres_changes` llegan a todos los suscriptos. Mitigación: RLS se habilita **en la misma migración** y antes del `ALTER PUBLICATION`; se verifica con la cuenta de usuario común escuchando mientras el admin escribe en un ticket ajeno.
- **Canales Realtime acumulados** entre navegaciones (memory leak, eventos duplicados) → `removeChannel` en el cleanup de cada `useEffect`, canal único creado dentro de `useSupport`.
- **Sin test runner en el repo** → no hay red de seguridad automatizada. Mitigación: `pnpm lint` + `pnpm build` como gates mínimos, y un guion de verificación manual paso a paso en `tasks.md` (crear ticket como usuario, responder como admin, ver el badge, marcar leído, intentar acceso cruzado).
- **El admin no recibe notificación fuera del panel**: si no entra a `/admin/support`, un ticket puede quedar sin respuesta. Aceptado en esta iteración (fuera de alcance); el gancho natural para resolverlo después es un webhook a n8n que avise al admin por Telegram.
- **`ProfilePage`/`MetricsPage` siguen siendo placeholders**: la campanita quedará funcional en páginas que por lo demás dicen "próximamente". Es coherente con el pedido, pero conviene que el componente también se monte en `ConnectionsPage` (página real) para que el usuario tenga la notificación donde efectivamente trabaja.

## Migration Plan

1. Migración SQL nueva en `aura-frontend/supabase/migrations/` (timestamp posterior a `20260814000001`), en un solo archivo y en este orden: tablas → índices → `is_admin()` → `ENABLE ROW LEVEL SECURITY` → policies → triggers → `ALTER PUBLICATION supabase_realtime`.
2. **Checkpoint con el usuario** antes de aplicarla contra el proyecto Supabase real (`supabase db push` / editor SQL). La migración es aditiva: no altera tablas existentes, no borra datos.
3. Frontend en orden de dependencia: `useSupport` → `Sidebar` (fix + entrada admin) → modal de usuario → bandeja admin → campanita.
4. **Rollback**: `DROP TABLE public.support_messages, public.support_tickets CASCADE; DROP FUNCTION public.is_admin();` más revertir los archivos del frontend. Nada de lo existente depende de las tablas nuevas, así que el rollback es aislado y total.

## Open Questions

1. **Categorías del ticket**: ¿alcanza con `problema` / `duda` / `sugerencia`, o el usuario quiere otro set? (Valor por defecto propuesto: esas tres, en el `CHECK`.)
2. **¿La campanita va también en `ConnectionsPage`** (la única página de usuario con contenido real)? Recomendado que sí; queda a confirmar en el checkpoint de UX.
3. **¿El admin puede iniciar un "comunicado"** hacia un usuario (broadcast/aviso), o el hilo siempre lo abre el usuario? El modelo lo soporta (un ticket con `sender_role='admin'` en el primer mensaje), pero la UI no se construye en esta iteración salvo pedido explícito.
4. **Retención**: ¿los tickets `closed` se archivan/ocultan de la bandeja pasado un tiempo? Por ahora quedan visibles con filtro de estado.
