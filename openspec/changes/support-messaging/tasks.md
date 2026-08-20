# Tasks: support-messaging

> **Gobernanza — MEDIUM.** Implementación autónoma por grupo, con **checkpoints** explícitos marcados abajo (tareas `⏸ CHECKPOINT`). El agente de apply se detiene ahí, presenta lo hecho y espera OK antes de seguir. No hay gate tarea por tarea.
>
> **Sin test runner en el repo** (`package.json` expone `dev`/`build`/`lint`/`preview`, linter `oxlint`). La verificación es `pnpm lint` + `pnpm build` + el guion manual del grupo 7, ejecutado con **dos cuentas reales** (una admin, una usuario común).
>
> Todos los paths son relativos a `aura-frontend/`.

## 1. Esquema y control de acceso en Supabase (capability `support-messaging-access`)

- [x] 1.1 Crear la migración `supabase/migrations/<timestamp>_support_messaging.sql` (timestamp posterior a `20260814000001`), con encabezado de comentario explicando el propósito, siguiendo el estilo de `20260630000002_telegram_link_tokens.sql`
- [x] 1.2 Definir `public.support_tickets`: `id uuid pk default gen_random_uuid()`, `user_id uuid not null` FK → `public.profiles(id) on delete cascade`, `subject text not null`, `category text not null check (category in ('problema','duda','sugerencia'))`, `status text not null default 'open' check (status in ('open','answered','closed'))`, `created_at`/`updated_at`/`last_message_at timestamptz not null default now()`
- [x] 1.3 Definir `public.support_messages`: `id uuid pk`, `ticket_id uuid not null` FK → `support_tickets(id) on delete cascade`, `sender_id uuid not null` FK → `profiles(id)`, `sender_role text not null check (sender_role in ('user','admin'))`, `body text not null`, `read_at timestamptz null`, `created_at timestamptz not null default now()`
- [x] 1.4 Crear índices: `support_tickets(user_id)`, `support_tickets(last_message_at desc)`, `support_tickets(status)`, `support_messages(ticket_id, created_at)` y un índice parcial para no leídos (`where read_at is null`)
- [x] 1.5 Crear `public.is_admin()` — `returns boolean`, `language sql`, `STABLE`, `SECURITY DEFINER`, `SET search_path = public` — que resuelve `profiles.role = 'admin'` para `auth.uid()`; `GRANT EXECUTE ... TO authenticated`
- [x] 1.6 `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` en ambas tablas (antes de cualquier policy y antes de la publicación realtime)
- [x] 1.7 Policies de `support_tickets` `TO authenticated`: SELECT (`user_id = auth.uid()` OR `is_admin()`), INSERT (`WITH CHECK (user_id = auth.uid())`), UPDATE solo `is_admin()`. Sin policy de DELETE, sin policies para `anon`
- [x] 1.8 Policies de `support_messages` `TO authenticated`: SELECT (ticket propio vía `EXISTS` OR `is_admin()`); INSERT usuario (`sender_role='user'` AND `sender_id=auth.uid()` AND ticket propio AND ticket no `closed`); INSERT admin (`is_admin()` AND `sender_role='admin'` AND `sender_id=auth.uid()` AND ticket no `closed`); UPDATE de lectura para cada rol sobre los mensajes del otro. Sin DELETE
- [x] 1.9 Trigger `AFTER INSERT ON support_messages`: actualiza `last_message_at`/`updated_at` del ticket y aplica las transiciones de estado (`open`→`answered` con mensaje admin; `answered`→`open` con mensaje del usuario)
- [x] 1.10 Trigger `BEFORE UPDATE ON support_messages` que rechaza cualquier cambio en columnas distintas de `read_at` (más `GRANT UPDATE (read_at)` por columna a `authenticated`)
- [x] 1.11 `ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages, public.support_tickets;` como último bloque del archivo
- [x] 1.12 ⏸ **CHECKPOINT**: presentar la migración completa al usuario y obtener OK antes de aplicarla contra el proyecto Supabase real
- [x] 1.13 Aplicar la migración (`supabase db push` o editor SQL) y verificar en el dashboard que ambas tablas figuran con RLS habilitada y con las policies esperadas

## 2. Capa de acceso a datos en el frontend (`useSupport`)

- [x] 2.1 Crear `src/hooks/useSupport.js` con el cliente `supabase` y `useAuth()`, exponiendo estado de carga y error como hacen `AdminPanel.jsx` / `ConnectionsPage.jsx`
- [x] 2.2 Implementar `listMyTickets()` (tickets propios, orden `last_message_at desc`) y `listAllTickets({ status })` para admin
- [x] 2.3 Implementar `createTicket({ subject, category, body })`: inserta el ticket y a continuación su primer mensaje con `sender_role='user'`; si el segundo insert falla, reportar el error y no dejar el ticket huérfano visible en la UI
- [x] 2.4 Implementar `listMessages(ticketId)` y `sendMessage(ticketId, body)` — `sender_role` derivado del rol real del perfil, nunca de un parámetro del componente
- [x] 2.5 Implementar `markAsRead(messageIds)` (update de `read_at`) y `getUnreadCount()` con `select('*', { count: 'exact', head: true })`
- [x] 2.6 Implementar `setTicketStatus(ticketId, status)` — solo se invoca desde la bandeja admin
- [x] 2.7 Implementar la suscripción realtime: canal único sobre `support_messages` (+ `support_tickets` para la bandeja), `removeChannel` en el cleanup del `useEffect`, y fallback a `setInterval` de 60 s si el estado de suscripción es `CHANNEL_ERROR` o `TIMED_OUT`
- [x] 2.8 Normalizar errores de Supabase a mensajes en español para la UI, sin filtrar detalles internos de la policy

## 3. Sidebar: corregir ubicación de "Soporte" y agregar la entrada admin (`support-ticket-submission`, `support-inbox-admin`)

- [x] 3.1 En `src/components/Sidebar.jsx`, mover el bloque "Soporte" (hoy `<Link to="#">` en el pie, líneas ~68-74, fuera del condicional) dentro de la rama no-admin, de modo que **no se renderice** para `isAdmin`
- [x] 3.2 Convertir "Soporte" en un `<button>` que abre el panel de soporte (dispara el evento/estado del grupo 4), eliminando el `to="#"`
- [x] 3.3 Agregar a `navItems` de admin la entrada `{ path: '/admin/support', icon: 'forum', label: 'Comunicados y Reportes' }`
- [x] 3.4 Verificar que el arreglo aplica igual al sidebar desktop y al drawer mobile (ambos renderizan el mismo `sidebarContent`) y que al tocar "Soporte" en mobile el drawer se cierra

## 4. Superficie de soporte del usuario (`support-ticket-submission`)

- [x] 4.1 Crear `src/components/SupportModal.jsx` siguiendo el patrón visual de `ContactModal.jsx` y las clases del design system (`glass-card`, tokens `surface-*`/`primary`)
- [x] 4.2 Implementar el formulario de consulta nueva: asunto, categoría (`problema` / `duda` / `sugerencia`) y descripción
- [x] 4.3 Implementar la validación: asunto y descripción no vacíos ni solo espacios, límites máximos de longitud, categoría dentro del set permitido, y botón de envío deshabilitado mientras el envío está en vuelo (evitar ticket duplicado por doble clic)
- [x] 4.4 Implementar el listado del historial propio (asunto, estado, última actividad, orden por actividad reciente) y el estado vacío con el formulario de primera consulta
- [x] 4.5 Implementar la vista de hilo: mensajes en orden cronológico, distinguiendo visualmente los del usuario de los de soporte
- [x] 4.6 Implementar la caja de respuesta del usuario, deshabilitada con motivo visible cuando el ticket está `closed`
- [x] 4.7 Manejar el error de envío conservando el texto escrito y mostrando el mensaje de fallo; el éxito limpia el formulario, confirma y agrega la consulta al tope del historial sin recargar
- [x] 4.8 Montar el modal en las páginas del área de usuario, cableado al botón "Soporte" del sidebar (mounted once inside `Sidebar.jsx`, que ya se renderiza en todas las páginas de usuario — evita duplicar el mount en cada página)

## 5. Bandeja "Comunicados y Reportes" del admin (`support-inbox-admin`)

- [x] 5.1 Crear `src/pages/SupportInboxPage.jsx` con el layout de página admin (`Sidebar` + header sticky + `GlassCard`), tomando `AdminPanel.jsx` como referencia (renombrada/dividida desde entonces a `UsersPage.jsx`/`AdminDashboard.jsx` por los changes hermanos — se usó `UsersPage.jsx` como referencia real)
- [x] 5.2 Registrar la ruta `/admin/support` en `src/App.jsx` dentro de `<ProtectedRoute requiredRole="admin">`
- [x] 5.3 Implementar el listado de todos los tickets: usuario solicitante (company / full_name con fallback a identificador), asunto, categoría, estado y última actividad, ordenado por actividad reciente
- [x] 5.4 Marcar visualmente las conversaciones con mensajes de usuario no leídos y mostrar el total de no leídos en la sección
- [x] 5.5 Implementar el filtro por estado (`open` / `answered` / `closed` / todos) preservando el orden por actividad reciente
- [x] 5.6 Implementar la vista de hilo con la caja de respuesta del admin: envía con `sender_role='admin'`, aparece de inmediato, pasa el ticket a `answered` y lo reordena al tope; rechaza respuesta vacía con validación inline
- [x] 5.7 Al abrir una conversación, marcar como leídos sus mensajes de usuario y limpiar el indicador de no leído
- [x] 5.8 Implementar los controles de cerrar y reabrir conversación, reflejando el estado en lista y en hilo sin recargar
- [x] 5.9 Implementar estados de carga, de error de fetch y los dos estados vacíos distintos (sin conversaciones vs. sin resultados para el filtro)
- [x] 5.10 Conectar la suscripción realtime para que un ticket o una respuesta nueva del usuario aparezca/reordene y marque no leído sin recargar

## 6. Campanita y notificaciones del usuario (`support-notifications`)

- [x] 6.1 Crear `src/components/NotificationsBell.jsx` con el mismo marcado del botón `notifications` que hoy está inerte en el header, más el badge de no leídos (nota: `ProfilePage.jsx`/`MetricsPage.jsx` ya no tenían ese botón maqueteado — lo removieron los changes hermanos desde que se escribió design.md; se usó el marcado del badge de `ConnectionsPage.jsx` como referencia visual en su lugar)
- [x] 6.2 Implementar el conteo: mensajes con `sender_role='admin'` y `read_at is null` dentro de los tickets propios; sin badge cuando el conteo es cero; nunca cuenta mensajes propios
- [x] 6.3 Implementar el panel: respuestas del admin más recientes primero, con asunto, extracto y hora, distinguiendo leídas de no leídas, y estado vacío explícito
- [x] 6.4 Al seleccionar una notificación, abrir el hilo correspondiente en el `SupportModal`
- [x] 6.5 Marcar como leído al abrir la respuesta (desde el panel o desde el hilo) y bajar el badge sin recargar; no re-marcar lo ya leído
- [x] 6.6 Reemplazar el `<button>` sin `onClick` por el componente compartido en `src/pages/ProfilePage.jsx` y `src/pages/MetricsPage.jsx`
- [x] 6.7 ⏸ **CHECKPOINT de UX**: resuelto directamente con el usuario (no vía pregunta del agente) — la campanita es el atajo de "respuestas sin leer" al mismo sistema de tickets; NO se monta ni se fusiona con la campanita de `ConnectionsPage.jsx` (ya es de otra feature: aviso de token de red social vencido); se montó en `ProfilePage.jsx`/`MetricsPage.jsx`, único lugar sensato dado que ninguna de las dos tenía campanita propia; categorías confirmadas: exactamente `problema`/`duda`/`sugerencia` (ya usadas en la migración aplicada)
- [x] 6.8 Verificar carga inicial por fetch + actualización por realtime, degradación a refresco periódico ante fallo de suscripción (sin error bloqueante), y `removeChannel` en el unmount para no acumular canales ni duplicar notificaciones

## 7. Verificación

- [x] 7.1 `pnpm lint` sin errores nuevos (único warning es preexistente en `AuthContext.jsx`, no relacionado a este change)
- [x] 7.2 `pnpm build` exitoso
- [ ] 7.3 Manual — flujo feliz: como usuario común, abrir "Soporte", crear una consulta, verla en el historial; como admin, verla en "Comunicados y Reportes", responder; como usuario, ver el badge subir y leer la respuesta
- [ ] 7.4 Manual — ida y vuelta: el usuario responde sobre el ticket `answered` → vuelve a `open` y reaparece marcado como no leído en la bandeja admin; el admin cierra el ticket → la caja de respuesta del usuario queda deshabilitada
- [ ] 7.5 Manual — aislamiento (crítico): con dos cuentas de usuario distintas, verificar que ninguna ve tickets ni mensajes de la otra, ni consultando por `ticket_id` ajeno directamente desde el cliente
- [ ] 7.6 Manual — no falsificación: verificar desde la consola del navegador que un usuario común no puede insertar un mensaje con `sender_role='admin'`, ni cambiar el `status` de su ticket, ni editar el `body` de un mensaje existente, ni borrar filas
- [ ] 7.7 Manual — realtime no filtra: con un usuario común suscripto, el admin responde un ticket **ajeno** y se confirma que a ese cliente no le llega ningún evento ni contenido
- [ ] 7.8 Manual — sidebar: confirmar que "Soporte" no aparece en ninguna vista de admin (desktop y mobile) y que sí aparece y funciona para el usuario común
- [x] 7.9 Verificar que no se agregaron dependencias a `package.json` ni Edge Functions nuevas en `supabase/functions/` (confirmado: `package.json` no fue tocado; `supabase/functions/` solo tiene las funciones preexistentes)
- [ ] 7.10 Registrar en engram lo aprendido durante el apply (decisiones de RLS, comportamiento real de realtime, ajustes de UX) con `topic_key: "opsx/support-messaging/apply"`
