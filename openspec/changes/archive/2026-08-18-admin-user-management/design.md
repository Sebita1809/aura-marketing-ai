## Gobernanza — CRITICAL (Auth / gestión de acceso): apply con aprobación humana explícita

> **Esta sección es vinculante y precede a cualquier otra consideración técnica de este documento.**

Este change pertenece al dominio **Auth / gestión de acceso**, clasificado **CRITICAL** en la política de autonomía por dominio del proyecto. En ese nivel:

> *"Analysis only; no code written without explicit human approval."*

Consecuencias operativas, iguales a las que rigieron el change `input-security-hardening` (dominio Seguridad) en este mismo repo:

1. **La fase `apply` NO es autónoma.** El agente que ejecute `/opsx:apply` sobre este change debe **detenerse antes de escribir código** y pedir confirmación explícita del usuario **grupo por grupo** (los grupos de `tasks.md` están numerados para eso).
2. **Ningún archivo del repo se modifica sin ese OK**: ni `aura-frontend/src/`, ni `aura-frontend/supabase/migrations/`, ni `aura-frontend/supabase/functions/`, ni `codigo.json`. Escribir los artefactos de planificación (este documento incluido) **no** es autorización para implementar.
3. **Cada grupo se propone antes de ejecutarse**: el agente describe el cambio concreto (columnas y constraints de la migración, política RLS exacta, contrato de la Edge Function, archivos y rutas a tocar, nodos de n8n a modificar), espera aprobación, recién entonces escribe, y reporta lo hecho.
4. **Las decisiones que cambian el acceso de usuarios reales** — el modelo de estados, la migración de los `is_active = false` existentes, la revocación de sesiones, el endurecimiento de `create-user` (que es **BREAKING** para llamadores no-admin) — requieren validación explícita del usuario **antes** de quedar fijadas. Ver §Open Questions 1–5.
5. **Un grupo aprobado no habilita los siguientes. La aprobación no es transitiva.** En particular, aprobar el grupo de UI **no** aprueba el grupo que toca `codigo.json` ni el que toca Auth.
6. **Rollback disponible en todo momento**: cada grupo debe ser reversible de forma aislada (ver §Migration Plan).
7. Si el agente de apply no puede obtener confirmación interactiva (ejecución no interactiva, batch), **debe detenerse y reportar**, nunca asumir aprobación.

**Advertencia adicional específica de este dominio**: este change puede dejar usuarios **sin acceso** (bloqueo, baja, revocación de sesión) o, si se implementa mal, dejar el sistema **sin ningún admin**. La salvaguarda de "último admin" (D9) y la prueba de rollback de la migración (§Migration Plan) no son opcionales.

## Context

**Estado actual verificado** contra `aura-frontend/src/`, `aura-frontend/supabase/` y `codigo.json`:

| Pieza | Qué es hoy | Qué falta |
|---|---|---|
| `pages/AdminPanel.jsx` (ruta `/admin`, sidebar dice "Dashboard") | Tabla de clientes: `select('*')` sobre `profiles` ordenado por `created_at desc`, sin `range()`; columnas ID/Empresa/Email/Telegram/Estado/Acciones; búsqueda en cliente por empresa/email/id | Es una lista de usuarios rotulada como dashboard; el botón `⋮` de "Acciones" **no tiene `onClick`**; sin paginación, sin filtros, sin detalle |
| `pages/RegisterUser.jsx` (ruta `/admin/register-user`, sidebar dice "Gestión de Usuarios") | Modal de alta: formulario → `supabase.functions.invoke('create-user')` → `navigate('/admin')` | No lista nada, no muestra información de usuarios, no tiene ninguna acción sobre usuarios existentes |
| `supabase/functions/create-user/index.ts` | `serve` + CORS; crea el usuario con `service_role` (`auth.admin.createUser`) e inserta el perfil con `role` y `is_active: true`; rollback con `deleteUser` si falla el insert | **No verifica que el llamador sea admin** ni valida el `role` del body → cualquier usuario autenticado puede crearse un admin (escalada de privilegios) |
| `profiles` | `id`, `email`, `full_name`, `company`, `role ∈ {admin,user}`, `is_active` boolean, `telegram_id` (texto que escribe el formulario), `telegram_chat_id` (lo escriben las migraciones de vinculación), `created_at` | No hay estado más granular que `is_active`; no hay traza de quién cambió qué ni cuándo; no hay política RLS de admin versionada en `supabase/migrations/` |
| `codigo.json` (217 nodos) | `HTTP - Chequear vinculacion` y `HTTP - Perfil publicacion` consultan `profiles?telegram_chat_id=eq.<chat>&select=id` | **Ningún filtro por estado**. `is_active` aparece **0 veces** en `codigo.json`: hoy "Inactivo" no impide nada en el bot |
| `context/AuthContext.jsx` | `select('role, company, full_name')` del propio perfil; `ProtectedRoute` compara `profile.role !== requiredRole` | No lee el estado del propio usuario: un usuario bloqueado con sesión viva sigue navegando el panel |

Hechos que este diseño respeta:

- El bot es el canal principal del producto: la resolución del perfil por `telegram_chat_id` es el punto donde un bloqueo se hace o no se hace efectivo.
- El vínculo real de Telegram vive en `telegram_chat_id` (migraciones `20260630000002_telegram_link_tokens.sql` y `20260814000001_telegram_link_codes_reproducible.sql`, que además ya usan funciones `SECURITY DEFINER` para no dar `UPDATE` amplio sobre `profiles`). `telegram_id` es un campo de texto libre del formulario de alta y **no** es lo que consulta el bot.
- Las Edge Functions del proyecto siguen un patrón uniforme (`serve` de `deno.land/std@0.168.0`, `corsHeaders` con `OPTIONS`, cliente creado con `SUPABASE_SECRET_KEYS['default']`, respuesta `{ success, ... }`). Se reutiliza tal cual.
- No existe `AGENTS.md`/`CLAUDE.md` ni knowledge base en la raíz del repo; la referencia de estilo para un change CRITICAL es `openspec/changes/input-security-hardening/`.
- Repo público: cualquier credencial nueva sigue `docs/secret-sanitization-procedure.md`. Este change **no** introduce credenciales nuevas (reutiliza las variables de entorno que ya usan las Edge Functions existentes).

**Change hermano en paralelo**: `admin-dashboard-metrics` construye un dashboard de métricas nuevo y necesita una ruta. Ambos changes tocan `App.jsx` y `Sidebar.jsx`. La coordinación está resuelta en D6 y anotada en `tasks.md`.

## Goals / Non-Goals

**Goals:**

- G1. Que la sección "Gestión de Usuarios" **muestre información real de los usuarios** (lista completa, campos correctos, estado real, vinculación de Telegram correcta), no solo un formulario de alta.
- G2. Que el admin pueda **dar de alta, bloquear y dar de baja** usuarios desde esa página, con las transiciones inversas (desbloquear, reactivar) para que ninguna acción sea una calle sin salida.
- G3. Que "bloqueado" y "dado de baja" sean **estados distintos y distinguibles**, con efectos distintos, y no dos etiquetas del mismo booleano.
- G4. Que el bloqueo sea un **control de acceso efectivo** en las tres superficies donde el usuario existe: sesión de Supabase Auth, panel web y bot de Telegram.
- G5. Que las operaciones privilegiadas del panel **verifiquen que el llamador es admin del lado servidor**, cerrando la escalada de privilegios que hoy permite `create-user`.
- G6. Que `/admin` quede libre para el dashboard del change hermano, sin ambigüedad de rutas ni conflicto entre ambos pases de implementación.

**Non-Goals:**

- NG1. Construir el dashboard de métricas. Es el change hermano `admin-dashboard-metrics`; acá solo se libera la ruta.
- NG2. Un sistema de permisos granular (roles por capability, permisos por recurso). El modelo sigue siendo `role ∈ {admin, user}` leído de `profiles.role`.
- NG3. Edición del perfil ajeno (cambiar email, empresa, nombre o rol de otro usuario). Solo alta y transiciones de estado. Cambiar el rol de alguien es una operación de privilegios que merece su propio análisis.
- NG4. Borrado físico (`hard delete`) de usuarios ni de sus datos. "Dar de baja" es soft delete; el borrado real (y su relación con derechos de eliminación de datos) queda fuera.
- NG5. Auditoría completa del panel (todas las acciones de todos los admins en una tabla de eventos). Se registra la traza mínima de la última transición de estado (D5); el historial completo es una Open Question.
- NG6. Reescribir el flujo de vinculación de Telegram. Se lee `telegram_chat_id` y, en la baja, se lo libera; el mecanismo de vinculación no cambia.
- NG7. Invitaciones por email / self-service signup. El alta sigue siendo "el admin crea la cuenta con contraseña temporal", como hoy.

## Decisions

### D1. Tres estados explícitos (`active` / `blocked` / `deactivated`), no un booleano con dos lecturas

Se agrega a `profiles` una columna `status text NOT NULL DEFAULT 'active'` con `CHECK (status IN ('active','blocked','deactivated'))`.

| Estado | Semántica | Efectos | Reversible por |
|---|---|---|---|
| `active` | Operativo | Accede al panel y es atendido por el bot | — |
| `blocked` | **Suspensión temporal** (impago, incidente, investigación en curso) | Pierde acceso al panel y al bot **conservando** su vínculo de Telegram, su empresa y sus datos | "Desbloquear" → `active`, sin pasos adicionales |
| `deactivated` | **Baja definitiva** (offboarding) | Pierde acceso, **se libera** `telegram_chat_id` (queda `NULL`) y desaparece del listado por defecto (visible con el filtro "Dados de baja") | "Reactivar" → `active`, pero el usuario **debe volver a vincular Telegram** |

La pregunta original del usuario menciona "bloquear **o** dar de baja" como dos acciones separadas, y la diferencia se sostiene técnicamente: la que define el modelo es **qué pasa con el vínculo de Telegram**. Un `chat_id` que quedó atado a una cuenta dada de baja es un vínculo muerto que impide que esa persona (o ese chat) se vincule limpiamente después; en cambio una suspensión temporal debe conservar el vínculo para que "desbloquear" sea un solo click y el usuario siga como estaba. Sin esa diferencia, dos botones que hacen exactamente lo mismo son ruido en la UI.

Alternativas descartadas: **(a) solo `is_active`, con la distinción viviendo en la cabeza del admin** — no permite listar "quién está suspendido vs. quién se fue", no permite tratar el vínculo de Telegram distinto y hace imposible reportar el estado real; **(b) dos booleanos (`is_blocked`, `is_deleted`)** — admite estados imposibles (bloqueado y dado de baja a la vez) que después hay que defender con constraints, mientras que un enum los hace inexpresables; **(c) `deleted_at timestamptz NULL` como soft delete separado del bloqueo** — es el patrón clásico, pero deja el estado repartido en dos lugares y obliga a leer dos columnas para saber si alguien puede entrar; con tres valores hay **una sola** pregunta que responder.

### D2. `is_active` se conserva sincronizado como columna derivada, no se elimina

`is_active` pasa a ser `GENERATED ALWAYS AS (status = 'active') STORED`. Así es **imposible** que status y `is_active` se desincronicen, y todo consumidor que hoy lee `is_active` sigue funcionando sin cambios.

Precondición verificada: **no hay ningún escritor de `is_active` fuera de `create-user`** (`grep` en `aura-frontend/src`, `aura-frontend/supabase` y `codigo.json`: 0 ocurrencias en el workflow; en el frontend solo lecturas en `AdminPanel.jsx`). Postgres rechaza un `INSERT` que asigne valor a una columna generada, así que el `is_active: true` del insert de `create-user` **debe** quitarse en el mismo grupo que aplica la migración — está anotado como tarea explícita y como riesgo de orden de despliegue (§Migration Plan).

Alternativa descartada: **trigger de sincronización bidireccional** (`is_active` escribible, que derive `status`). Es más tolerante con escritores desconocidos, pero introduce una segunda fuente de verdad y la pregunta "¿quién ganó?" cuando ambos vienen en el mismo `UPDATE`. Dado que los escritores están verificados y son uno solo, la columna generada es más simple y más difícil de romper. Si aparece un escritor externo no previsto (§Open Questions 3), esta decisión se revisa antes de aplicar.

**No se elimina `is_active`** en este change aunque quede redundante: eliminarlo es un cambio breaking para consumidores que no controlamos (queries manuales, dashboards de Supabase, scripts). Deprecación explícita, borrado en otro change.

### D3. Las acciones privilegiadas van por una Edge Function nueva (`admin-user-status`), no por un `UPDATE` desde el cliente

Un `UPDATE profiles SET status = 'blocked'` hecho desde el navegador con RLS adecuada **no alcanza**, y el motivo es concreto: **no revoca la sesión de Supabase Auth del usuario afectado**. El JWT ya emitido sigue siendo válido hasta que expira (una hora por defecto, y el refresh token lo renueva). Un usuario "bloqueado" que ya tenía la pestaña abierta seguiría usando el panel. Revocar sesión y prohibir el login futuro requieren la API admin de Auth, que exige `service_role` y por lo tanto **no puede vivir en el cliente**.

Contrato propuesto (mismo patrón `serve` + CORS que las funciones existentes):

```
POST /functions/v1/admin-user-status
Authorization: Bearer <JWT del admin que hace la acción>
{ "user_id": "<uuid>", "action": "block" | "unblock" | "deactivate" | "reactivate", "reason": "<texto opcional>" }
→ 200 { "success": true, "user_id": "...", "status": "blocked" }
→ 4xx { "success": false, "error": "<mensaje no diagnóstico>" }
```

Pasos del lado servidor, en este orden:

1. **Autenticar al llamador**: leer el JWT del header `Authorization`, resolver el usuario con un cliente anon (`auth.getUser(jwt)`), y **consultar `profiles.role` con el cliente `service_role`**. Fuente de verdad = `profiles.role`, igual que `AuthContext`/`ProtectedRoute`. Nunca el `role` que venga en el body ni el de `app_metadata` sin contrastar.
2. **Validar la acción**: `user_id` existe; la transición es válida (D8); el llamador no es el objetivo (D9); no se está bajando al último admin activo (D9).
3. **Aplicar el estado en `profiles`** (`status`, `status_changed_at`, `status_changed_by`, `status_reason`; y `telegram_chat_id = NULL` si la acción es `deactivate`).
4. **Aplicar el efecto en Auth**: `auth.admin.updateUserById(user_id, { ban_duration: ... })` para impedir nuevos logins, y cierre de la sesión vigente. `unblock`/`reactivate` levantan el ban (`ban_duration: 'none'`).
5. Responder. **Si el paso 4 falla, el paso 3 se revierte** (o la función responde error y deja el estado consistente): un usuario marcado como bloqueado en `profiles` que sigue pudiendo entrar es exactamente el fallo que este change viene a arreglar. Mismo criterio de rollback que ya usa `create-user` cuando falla el insert del perfil (`deleteUser`).

La API exacta de ban/signOut de `@supabase/supabase-js@2` debe **verificarse contra la versión desplegada** durante el apply, no asumirse (§Open Questions 5).

Alternativas descartadas: **(a) `UPDATE` de cliente con RLS** — no revoca sesión, ya explicado; además obliga a dar `UPDATE` sobre `profiles` a los admins, superficie que hoy el proyecto deliberadamente evita (las migraciones de vinculación usan `SECURITY DEFINER` justamente para no darlo); **(b) una función `SECURITY DEFINER` en Postgres** — resuelve el estado pero tampoco toca Auth, con lo cual queda a mitad de camino; **(c) extender `create-user` con un parámetro `action`** — mezcla dos operaciones distintas (crear vs. cambiar estado) en una superficie que además hay que endurecer, y complica el análisis de permisos de ambas.

### D4. El bloqueo se hace efectivo en tres capas, y las tres son necesarias

| Capa | Mecanismo | Qué pasa si falta |
|---|---|---|
| **Auth** (Supabase) | Ban + cierre de sesión desde `admin-user-status` (D3) | El usuario bloqueado sigue entrando con su JWT vigente y puede volver a loguearse |
| **Panel** (frontend + RLS) | `AuthContext` incorpora `status` al select del propio perfil; `ProtectedRoute` expulsa a `/login` con un mensaje si el estado no es `active`; la política RLS de `profiles` impide que un no-`active` lea/escriba | Defensa en profundidad ante un ban que no se aplicó; sin esto, cualquier fallo de la capa Auth deja el panel abierto |
| **Bot** (`codigo.json`) | `HTTP - Chequear vinculacion` y `HTTP - Perfil publicacion` agregan el filtro de estado a su query: `profiles?telegram_chat_id=eq.<chat>&status=eq.active&select=id` | **El bloqueo no bloquea nada donde el producto realmente se usa.** Hoy `is_active` no aparece en el workflow: un usuario "Inactivo" sigue operando el bot con normalidad |

El filtro del bot se resuelve **en la URL de los nodos HTTP existentes**, sin agregar nodos: la respuesta vacía ya está contemplada aguas abajo (es el mismo caso que "este chat no está vinculado"), así que el usuario bloqueado recibe el flujo de "no vinculado" en vez de una rama nueva. Se prefiere `status=eq.active` sobre `is_active=is.true` porque nombra la fuente de verdad (D1/D2), aunque ambos son equivalentes mientras `is_active` sea generada.

**Trade-off aceptado y explícito**: el usuario bloqueado ve el mensaje de "no vinculado", no uno que diga "tu cuenta está bloqueada". Es menos claro para el usuario legítimo confundido, y es deliberado: no se le informa a un chat no autenticado el estado de una cuenta ajena. Si el usuario pregunta, el admin (que sí ve el estado real en el panel) responde.

### D5. Traza mínima en `profiles`, no una tabla de auditoría

Se agregan `status_changed_at timestamptz`, `status_changed_by uuid REFERENCES profiles(id)` y `status_reason text`. Responden "¿quién lo bloqueó, cuándo y por qué?" — que es lo que un admin necesita al mirar la fila — con costo cero de infraestructura y sin decisiones nuevas de retención.

Lo que **no** responden: el historial (si alguien fue bloqueado y desbloqueado tres veces, solo queda la última transición). Si hace falta historial, es una tabla `user_status_events` append-only y un cambio de diseño, no un agregado incremental → §Open Questions 4. Se elige la versión mínima porque el caso de uso declarado es operativo ("ver y gestionar usuarios"), no de cumplimiento.

### D6. Ruteo: la tabla se muda a `/admin/users` y `/admin` queda libre para el dashboard hermano

| Ruta | Hoy | Después de este change | Dueño |
|---|---|---|---|
| `/admin` | `AdminPanel.jsx` (tabla de clientes, rotulada "Dashboard") | **Libre para `admin-dashboard-metrics`.** Mientras ese change no aterrice: `<Navigate to="/admin/users" replace />` | change hermano |
| `/admin/users` | no existe | Página de gestión de usuarios (la tabla, ahora con acciones y modal de alta) | **este change** |
| `/admin/register-user` | `RegisterUser.jsx` como página completa | `<Navigate to="/admin/users" replace />` (no se rompen bookmarks ni el link viejo) | **este change** |

Justificación de elegir `/admin/users` y no dejar la tabla en `/admin`: el sidebar **ya** rotula esa sección "Gestión de Usuarios", así que la URL pasa a coincidir con el nombre que el usuario ya ve; `/admin` como índice del área de administración es el lugar natural de un dashboard (que es lo que el sidebar prometía y no había); y separar las rutas evita que dos changes en paralelo se peleen el mismo componente y el mismo path. Alternativa descartada: dejar la tabla en `/admin` y darle `/admin/dashboard` al change hermano — conserva la ruta vieja pero perpetúa la incoherencia sidebar-vs-contenido y deja el índice del área ocupado por una tabla.

**Contrato de coordinación con `admin-dashboard-metrics`** (repetido en `tasks.md` para quien implemente):

- Este change es dueño de: la ruta `/admin/users` y su elemento, el redirect de `/admin/register-user`, el ítem de sidebar "Gestión de Usuarios" (`path: '/admin/users'`), y el redirect **provisional** de `/admin`.
- El change hermano es dueño de: el elemento de la ruta `/admin` (que reemplaza al redirect provisional) y el ítem de sidebar "Dashboard".
- **Quien aplique segundo integra, no revierte**: si `admin-dashboard-metrics` ya montó su dashboard en `/admin`, este change **no** agrega el redirect provisional; si este change ya corrió, el hermano **reemplaza** el redirect por su componente y **no** toca `/admin/users` ni el ítem "Gestión de Usuarios".
- Ninguno de los dos borra el ítem de sidebar del otro. Ambos archivos en conflicto potencial: `aura-frontend/src/App.jsx` y `aura-frontend/src/components/Sidebar.jsx`.

**El alta pasa a ser un modal dentro de `/admin/users`**, no una página. `RegisterUser.jsx` hoy dibuja un fondo falso (una maqueta blureada de sidebar y tarjetas) para simular estar sobre el panel; montado como modal real sobre la lista, ese fondo simulado se elimina y el efecto es genuino. Al crear un usuario, el modal cierra y la lista se refresca (hoy hace `navigate('/admin')`, que además dejaría al usuario en el dashboard del change hermano — otra razón para el cambio).

### D7. Verificación de admin del lado servidor, compartida por las dos Edge Functions

`create-user` hoy no verifica nada. La misma rutina de D3 paso 1 (JWT → `auth.getUser` → `profiles.role === 'admin'`) se aplica **al inicio de ambas funciones**, antes de cualquier efecto. Un llamador no autenticado o no admin recibe `401`/`403` y la función no crea ni modifica nada.

Consecuencias declaradas:

- **BREAKING** para cualquier consumidor no-admin de `create-user`. No debería existir ninguno legítimo (la única llamada en el repo es desde `RegisterUser.jsx`, que solo se alcanza tras `ProtectedRoute requiredRole="admin"`), pero **debe verificarse antes de desplegar** que no haya scripts o entornos llamándola con otra clave (§Open Questions 3).
- El `role` del body de `create-user` deja de ser confiable por sí solo: se sigue aceptando `admin`/`user` (un admin puede crear otro admin, es una operación legítima), pero **solo** después de haber verificado que el llamador es admin, y rechazando cualquier valor fuera del enum.
- Las respuestas de error son informativas para el admin pero **no diagnósticas** hacia afuera: no revelan si un `user_id` existe o no ante un llamador no autorizado.

Se evalúa extraer la rutina a un módulo compartido (`supabase/functions/_shared/`) en vez de duplicarla; con dos funciones la duplicación es tolerable, pero la verificación de admin es exactamente el tipo de código que no debe divergir entre copias → se decide durante el apply, con el criterio de que **ambas queden idénticas**.

### D8. Transiciones de estado válidas y explícitas

```
active ──block──────> blocked ──unblock────> active
active ──deactivate─> deactivated ──reactivate─> active
blocked ──deactivate─> deactivated
```

- `deactivate` es válido tanto desde `active` como desde `blocked` (bajar a alguien ya suspendido es el camino natural del offboarding).
- **No** existe `blocked ← deactivated` directo: se reactiva y, si hace falta, se bloquea. Menos combinaciones que testear y ninguna pierde capacidad.
- Toda transición es **idempotente**: pedir `block` sobre alguien ya `blocked` responde éxito sin efectos ni traza nueva, en vez de error. Evita que un doble click deje registro espurio.
- Transición inválida (p. ej. `unblock` sobre `active`) → `400` con mensaje claro, sin tocar nada.
- La UI **solo ofrece las acciones válidas** para el estado de la fila; el servidor las valida igual (la UI no es un control de acceso).

### D9. Salvaguardas: no auto-bloqueo y no dejar el sistema sin admins

Dos verificaciones, **ambas del lado servidor** en `admin-user-status`, y reflejadas en la UI para que la acción ni siquiera se ofrezca:

1. **Un admin no puede bloquearse ni darse de baja a sí mismo** (`user_id === caller.id` → `400`). No es paternalismo: es evitar que alguien se quede afuera con la sesión revocada y sin nadie que lo reactive.
2. **No se puede bloquear ni dar de baja al último admin `active`**. Si el objetivo tiene `role = 'admin'` y es el único con `status = 'active'`, la operación se rechaza. Sin esto, el sistema puede quedar sin ningún administrador y la única salida sería el dashboard de Supabase.

Ambas se prueban explícitamente; son el modo de falla más caro de este change (recuperación manual fuera de la aplicación).

### D10. El listado lee `profiles` desde el cliente con RLS de admin; la paginación se hace en el servidor

La lista **no** se sirve desde una Edge Function nueva: se sigue leyendo `profiles` con el cliente de Supabase (como hoy), amparada por una política RLS explícita de "admin puede leer todos los perfiles" versionada en `migrations/` (hoy esa política, si existe, no está en el repo — es en sí un hallazgo: el acceso del panel a todos los perfiles no está documentado en ninguna migración).

Cambios concretos respecto de hoy:

- **Paginación server-side** con `.range(from, to)` y `count: 'exact'`, 25 filas por página. Hoy se traen **todos** los perfiles sin límite y se filtran en el navegador; con pocos usuarios funciona y con muchos deja de funcionar sin aviso.
- **Búsqueda y filtros aplicados en la query** (`ilike` sobre empresa/email/nombre, `eq` sobre estado y rol), no sobre un array ya cargado.
- **Columna de Telegram tomada de `telegram_chat_id`** (el campo que usa el bot), con `telegram_id` mostrado solo como dato secundario en el detalle y rotulado como "declarado en el alta". Hoy la columna dice "Telegram Chat ID" y muestra `telegram_id`: el admin cree estar viendo la vinculación real y no lo está.
- **`created_at`** (fecha de alta) se muestra; ya se ordena por ese campo.
- **Última actividad / último login no se incluye en este alcance**: `last_sign_in_at` vive en `auth.users`, que no es legible desde el cliente, y traerlo obligaría a una función de listado con `service_role` — un cambio de arquitectura del listado por un dato accesorio. Queda como §Open Questions 6.

Alternativa descartada: **listar vía Edge Function con `service_role`** — centraliza permisos y habilitaría `last_sign_in_at`, pero reimplementa paginación, búsqueda y filtros a mano sobre HTTP y aleja el listado del patrón que ya usa todo el frontend (`supabase.from(...)`). Se prefiere RLS explícita: el permiso queda declarado en la base, versionado y auditable.

### D11. La UI confirma las acciones destructivas y no promete lo que el servidor no garantiza

- **Bloquear / desbloquear / reactivar**: diálogo de confirmación con el nombre y el email del usuario objetivo, y campo de motivo opcional (que va a `status_reason`).
- **Dar de baja**: confirmación reforzada — el admin debe **escribir el email del usuario** para confirmar, porque la acción libera el vínculo de Telegram y es la única que pierde información (D1).
- El diálogo de baja **dice explícitamente** que el vínculo de Telegram se libera y que reactivar exigirá volver a vincular. Nada de sorpresas después.
- Mientras la acción está en vuelo, la fila queda deshabilitada; el resultado se refleja recargando la fila desde el servidor, **no** parcheando el estado local a lo optimista: si la Edge Function falló a mitad de camino (D3 paso 5), la UI debe mostrar lo que hay en la base, no lo que se esperaba.
- Errores del servidor se muestran tal como llegan al admin (es un usuario de confianza, y necesita saber por qué falló), pero la función no filtra hacia afuera información sobre usuarios ante llamadores no autorizados (D7).

## Risks / Trade-offs

- **[Migrar mal los `is_active = false` existentes deja gente afuera o adentro por error]** → La migración es lo primero que se propone y necesita OK explícito (§Open Questions 2). Se lista **antes de aplicar** quiénes son y a qué estado irían; el backfill es un `UPDATE` reversible y `is_active` sigue derivándose igual, así que revertir la columna restaura el comportamiento anterior.
- **[`is_active` generada rompe el `INSERT` de `create-user`]** → Riesgo real de orden de despliegue: si la migración se aplica y la función no se actualiza, **el alta de usuarios deja de funcionar**. Van en el mismo grupo, la función se despliega junto con la migración, y el smoke test de alta es obligatorio inmediatamente después (§Migration Plan paso 1).
- **[Endurecer `create-user` rompe un consumidor no previsto]** → **BREAKING** declarado. Antes de desplegar se verifica que la única llamada es la del panel (§Open Questions 3). Rollback: revertir la función (la verificación es aditiva y se quita sin tocar el resto).
- **[Bloquear al último admin, o que un admin se bloquee a sí mismo]** → D9, verificado en el servidor y probado explícitamente. Es el modo de falla más caro porque la recuperación es manual desde el dashboard de Supabase.
- **[La revocación de sesión falla y el estado queda inconsistente]** → D3 paso 5: la función revierte o responde error; la UI relee del servidor (D11). Peor caso conocido y acotado: usuario marcado bloqueado que conserva sesión hasta que expira — mitigado además por la capa del panel (D4) y por la del bot (D4), que no dependen del ban de Auth.
- **[El filtro de estado en `codigo.json` rompe el flujo del bot]** → El grupo que toca el workflow es el último, se aprueba aparte, modifica **solo** la URL de dos nodos existentes (sin agregar ni reconectar nodos) y se verifica que el camino de "perfil no encontrado" ya existente sigue funcionando. Rollback: quitar el parámetro de la query. Mismo riesgo conocido de todos los changes de este repo: `codigo.json` debe re-exportarse/sincronizarse con el editor de n8n vivo.
- **[Cambiar la ruta `/admin` rompe links, bookmarks o pruebas]** → Se conservan redirects para `/admin` (provisional) y `/admin/register-user`. `LoginPage`/`App.jsx` redirigen a `/admin` tras el login: con el redirect provisional el admin cae en `/admin/users`, y cuando el dashboard aterrice caerá en el dashboard — comportamiento deseado en ambos casos.
- **[Conflicto de merge con `admin-dashboard-metrics` en `App.jsx`/`Sidebar.jsx`]** → Contrato de propiedad explícito en D6, repetido en `tasks.md`. Ambos changes tocan pocas líneas y bien delimitadas.
- **[La política RLS nueva es demasiado amplia o demasiado estrecha]** → Se escribe explícita y versionada (D10), se prueba con las dos cuentas (admin y usuario común) antes de dar el grupo por cerrado, y se verifica que un usuario común **no** puede leer perfiles ajenos ni cambiar su propio `status`.
- **[Paginación server-side cambia el comportamiento de búsqueda que el admin ya conocía]** → Con pocos usuarios la diferencia es imperceptible; el trade-off (buscar sobre el total en el servidor en vez de sobre lo cargado) es a favor del comportamiento correcto.
- **[Alcance: este change toca frontend, base, Edge Functions y el workflow n8n]** → Es amplio a propósito, porque un botón de bloqueo que no bloquea no es una funcionalidad. Se mitiga con grupos independientes, aprobables y reversibles por separado; el grupo del bot puede quedar fuera si el usuario lo prefiere (§Open Questions 1), a costa de declarar explícitamente que el bloqueo no alcanza al bot.

## Migration Plan

Despliegue **incremental, un grupo a la vez, cada uno con aprobación humana previa** (§Gobernanza):

1. **Grupo 1 — Datos (migración + `create-user`)**: `status` + `CHECK` + columnas de traza + backfill + `is_active` generada + política RLS, **junto con** el `create-user` sin `is_active` en el insert y con verificación de admin. Se despliegan juntos por la dependencia del §Risks. Smoke test obligatorio inmediatamente después: alta de un usuario de prueba y lectura del listado con cuenta admin y con cuenta común. Rollback: `ALTER TABLE profiles DROP COLUMN status` (y las de traza), restaurar `is_active` como columna normal con los valores derivados, revertir la función.
2. **Grupo 2 — Edge Function `admin-user-status`**: se despliega y se prueba **por API** (curl/invoke) antes de que exista cualquier botón que la llame: transiciones válidas, transiciones inválidas, llamador no admin, auto-bloqueo, último admin. Rollback: borrar la función; nada la llama todavía.
3. **Grupo 3 — UI del listado** (`/admin/users`, columnas correctas, filtros, paginación, modal de alta, redirects): sin acciones destructivas todavía. Rollback: revertir las rutas y el componente; `/admin` vuelve a servir la tabla.
4. **Grupo 4 — Acciones en la UI** (menú `⋮`, confirmaciones, detalle): conecta la UI con la función del grupo 2. Rollback: quitar el menú; el estado se sigue pudiendo cambiar por API.
5. **Grupo 5 — Enforcement en el panel** (`AuthContext` + `ProtectedRoute` leen `status`). Rollback: revertir dos archivos.
6. **Grupo 6 — Enforcement en el bot** (`codigo.json`, dos URLs). **Último a propósito**: es el que puede dejar a un usuario legítimo sin bot si algo está mal. Se prueba con una cuenta de prueba bloqueada antes de dar por cerrado. Rollback: quitar el parámetro de las dos queries y re-importar.
   **Nota de apply (2026-08-18)**: la sincronización con el n8n vivo se hizo por acceso directo al SQLite del contenedor (no por re-importar en la UI; ver engram `technique/n8n-db-direct-access`) — hay que tocar **dos** tablas (`workflow_entity.nodes` para el draft/editor Y `workflow_history.nodes` de la fila `activeVersionId`, que es la que realmente ejecuta el workflow activo). Durante la prueba en vivo aparecieron y se corrigieron dos bugs preexistentes **no relacionados** con este change, que estaban colgando el bot 300s en cualquier mensaje: (a) tipo de nodo obsoleto `n8n-nodes-base.googleSheetsTool` → `n8n-nodes-base.googleSheets` en la tool de `AI Agent1`, y (b) `$(nodeName)` con variable + `.isExecuted` (propiedad inexistente) en el nodo `Evaluar cuota rate limit` de `bot-rate-limiting`. Verificado end-to-end: bloquear/desbloquear y dar de baja/reactivar una cuenta de prueba por Telegram, ambos ciclos completos.

Regla transversal: **ningún grupo se da por cerrado con verificación "a ojo"**. Las verificaciones de conexiones y contenido de `codigo.json` se hacen por script, igual que en `input-security-hardening`.

## Open Questions

1. ~~**¿El enforcement en el bot (`codigo.json`, grupo 6) entra en este change o va aparte?**~~ — **RESUELTO (2026-08-17)**: entra, como grupo final con aprobación propia.
2. ~~**¿A qué estado migran los usuarios que hoy tienen `is_active = false`?**~~ — **RESUELTO (2026-08-17)**: todos a `blocked`, opción (a).
3. ~~**¿Hay algún consumidor de `create-user` o escritor de `is_active` fuera del panel?**~~ — **RESUELTO (2026-08-17)**: confirmado por el usuario que no hay ninguno, solo el panel web.
4. **¿Hace falta historial de cambios de estado** (tabla `user_status_events`) o alcanza con la última transición (D5)? Depende de si esto tiene que servir de evidencia para el informe de tesis o solo de herramienta operativa. **No bloquea**: la tabla se puede agregar después sin tocar lo ya hecho.
5. ~~**API exacta de ban/revocación de sesión en la versión desplegada de `@supabase/supabase-js` / GoTrue** (`ban_duration` en `updateUserById`, forma de invalidar la sesión vigente).~~ — **RESUELTO (grupo 2)**: `ban_duration: '876000h'` (~100 años) para block/deactivate, `'none'` para unblock/reactivate; confirmado en vivo que invalida el access token vigente en cada request de GoTrue, no solo al refrescar (no hace falta un `signOut` separado). Re-confirmado end-to-end el 2026-08-18 (grupo 7): bloquear/dar de baja una cuenta de prueba con sesión abierta le impide loguearse de nuevo ("usuario baneado"), igual para `block` que para `deactivate` (mismo `banDuration`, ver `admin-user-status/index.ts`).
6. **¿El listado necesita "última actividad" / último login?** Traería `last_sign_in_at` de `auth.users` y obligaría a servir el listado desde una Edge Function con `service_role` (D10). **No bloquea**: se resuelve después y, si la respuesta es sí, es un cambio acotado al origen de datos del listado.
7. **¿"Dar de baja" debe además desconectar las cuentas sociales del usuario** (tokens de Postiz/Meta/X en `social_accounts`)? Hoy la baja solo corta acceso y libera Telegram; los tokens siguen guardados. Toca el dominio de `token-manager`, que tiene su propia spec. **No bloquea el grupo 1**; si la respuesta es sí, es trabajo adicional del grupo 2 o un change aparte.
