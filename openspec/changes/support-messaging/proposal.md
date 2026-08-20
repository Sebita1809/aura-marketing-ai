## Why

Hoy no existe **ningún canal** dentro del panel web de Aura para que un usuario le comunique un problema o una duda a los administradores, ni para que el administrador le responda. El botón **"Soporte"** del `Sidebar.jsx` es un `<Link to="#">` sin handler: no navega, no abre nada, no manda nada — y además está declarado **fuera** del bloque `isAdmin`, por lo que aparece también en el sidebar de administrador, donde no tiene ningún sentido (el admin no se hace soporte a sí mismo). Es un bug de ubicación de código, no una feature a medias.

Del lado del administrador el hueco es simétrico: `AdminPanel.jsx` solo lista perfiles de clientes; no hay ninguna bandeja donde lleguen consultas. Y del lado del usuario, `ProfilePage.jsx` y `MetricsPage.jsx` ya tienen el ícono de campanita (`notifications`) maquetado en el header **sin `onClick` y sin lógica**: el lugar visual para las notificaciones ya existe, está vacío. El resultado es que el único canal real de soporte hoy es fuera del producto (Telegram/WhatsApp/mail personal), sin trazabilidad, sin estado y sin historial.

Los cuatro pedidos del usuario (bandeja admin, sacar "Soporte" del admin, notificaciones al usuario, botón "Soporte" funcional) son **un mismo flujo de comunicación bidireccional admin↔usuario** y se resuelven con un único modelo de datos; separarlos en changes distintos obligaría a diseñar la misma tabla tres veces.

## What Changes

- **Persistencia nueva en Supabase (no existe nada hoy)**: dos tablas — `support_tickets` (la solicitud: asunto, categoría, estado, dueño, marca de última actividad) y `support_messages` (los turnos del hilo: quién escribió, cuerpo, `read_at`) — con RLS estricta: un usuario común solo ve y escribe en **sus propios** tickets; un administrador ve **todos** y puede responder. Sin Edge Function nueva: el flujo completo es INSERT/SELECT/UPDATE directo desde el cliente, gobernado por RLS (ver `design.md`).
- **Botón "Soporte" funcional en el panel de usuario**: abre un modal/página desde donde el usuario crea un ticket (asunto + categoría + descripción) y, si ya tiene tickets, ve el historial de sus consultas y puede seguir respondiendo en el hilo.
- **"Soporte" desaparece del sidebar de administrador**: el bloque se mueve dentro de la rama no-admin de `Sidebar.jsx`. El admin conserva su acceso al mismo dominio, pero por la bandeja, no por el botón de pedir ayuda.
- **Sección nueva "Comunicados y Reportes" en el panel de admin** (`/admin/support`, entrada nueva en el sidebar admin): lista de tickets con estado, filtro por estado, contador de no leídos, apertura del hilo completo y respuesta desde ahí, más cambio de estado (abierto / respondido / cerrado).
- **Campanita del usuario funcional**: la campanita ya presente en `ProfilePage.jsx` y `MetricsPage.jsx` (hoy sin `onClick`) pasa a mostrar el badge de no leídos y a abrir un panel con las respuestas de los administradores; abrir/leer una respuesta la marca como leída. Se extrae a un componente compartido para que las dos páginas (y las que se sumen) usen la misma lógica.
- **Actualización inmediata vía Supabase Realtime** sobre `support_messages`, con carga inicial por fetch y degradación a polling si el canal no logra suscribirse (decisión justificada en `design.md`).
- Sin cambios en autenticación, roles, billing ni credenciales: el rol sigue leyéndose de `profiles.role` a través de `AuthContext`. **No hay breaking changes.**

Fuera de alcance (declarado): notificaciones por mail o por Telegram hacia el usuario; adjuntar archivos a un ticket; SLA, asignación de tickets a un admin específico o métricas de soporte; chat en vivo; buscador full-text sobre el historial.

## Capabilities

### New Capabilities

- `support-messaging-access`: Modelo de datos y control de acceso del soporte — tablas `support_tickets` / `support_messages`, propiedad del ticket, ciclo de estados, y las reglas RLS que garantizan que un usuario común solo alcance sus propios tickets y que solo un administrador pueda responder en nombre del soporte.
- `support-ticket-submission`: Envío de consultas desde el panel de usuario — el botón "Soporte" como punto de entrada (visible **solo** para roles no-admin), creación de ticket con asunto/categoría/descripción, validación, historial de tickets propios y respuesta del usuario dentro de un hilo abierto.
- `support-inbox-admin`: Bandeja "Comunicados y Reportes" del panel de admin — listado de todos los tickets con estado y actividad, filtros, apertura del hilo, respuesta del administrador y transiciones de estado.
- `support-notifications`: Notificaciones al usuario de las respuestas del administrador — badge de no leídos sobre la campanita ya existente, panel de notificaciones, marcado como leído, y la política de actualización (Realtime con fallback a polling).

### Modified Capabilities

*(Ninguna. Las capabilities ya especificadas en `openspec/specs/` — `dashboard-social-connections`, `meta-oauth`, `token-manager`, `x-twitter-oauth` — no cambian ninguno de sus requirements: este change agrega superficie nueva y corrige la ubicación de un elemento del sidebar que no está cubierto por ningún spec existente.)*

## Impact

- **Supabase — migración nueva** en `aura-frontend/supabase/migrations/`: tablas `support_tickets` y `support_messages`, índices, `ENABLE ROW LEVEL SECURITY` + políticas por rol, y una función auxiliar `SECURITY DEFINER` para resolver "¿es admin?" sin RLS recursiva sobre `profiles` (mismo patrón que `disconnect_telegram()` en `20260630000002_telegram_link_tokens.sql`). Alta de las tablas a la publicación `supabase_realtime`.
- **`aura-frontend/src/components/Sidebar.jsx`**: el ítem "Soporte" sale del bloque común y pasa a la rama no-admin; el sidebar admin suma "Comunicados y Reportes".
- **`aura-frontend/src/App.jsx`**: ruta nueva `/admin/support` bajo `<ProtectedRoute requiredRole="admin">`.
- **Componentes/páginas nuevos** en `aura-frontend/src/`: página de bandeja admin, modal/panel de soporte del usuario, componente de campanita con badge y panel de notificaciones, y un hook de acceso a datos de soporte (patrón `supabase` client + `useAuth`, como `AdminPanel.jsx` y `ConnectionsPage.jsx`).
- **`aura-frontend/src/pages/ProfilePage.jsx` y `MetricsPage.jsx`**: la campanita inerte se reemplaza por el componente compartido. Ambas siguen siendo placeholders en todo lo demás.
- **Sin Edge Functions nuevas**: `auth-meta-callback`, `auth-x-callback`, `create-user` y `token-manager` quedan intactas. Sin dependencias npm nuevas (Realtime viene en `@supabase/supabase-js` ^2.108, ya instalado).
- **Riesgos**: una política RLS mal escrita expondría consultas de un cliente a otro — es el punto de mayor cuidado del change y se cubre con escenarios de acceso denegado en los specs. La suscripción Realtime debe limpiarse al desmontar para no acumular canales entre navegaciones.
- **Gobernanza**: MEDIUM (lógica de negocio/mensajería; no toca auth, billing ni credenciales). Implementación con checkpoints normales, sin gate tarea-por-tarea.
