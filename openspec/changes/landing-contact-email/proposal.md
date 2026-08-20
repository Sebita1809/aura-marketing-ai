## Why

Los puntos de contacto por correo de la landing de Aura están rotos: el formulario del `ContactModal` tiene `onSubmit={(e) => { e.preventDefault(); onClose(); }}` — parece funcional pero **descarta el mensaje y solo cierra el modal**, así que todo lead que escribe por ahí se pierde en silencio. Los demás accesos de contacto por mail son un `mailto:hola@aura.ai` a una dirección vieja (y que además depende de que el visitante tenga un cliente de correo configurado), un link "Contacto" en el footer que apunta a `#`, y un "Contacta a un asesor" en el login que ni siquiera es clickeable.

Hoy el único canal de contacto que realmente funciona es WhatsApp. Se necesita que los botones/formularios de correo entreguen el mensaje de verdad, desde el backend, a **botprueba418@gmail.com**, sin depender del cliente de mail del visitante.

## What Changes

- **Formulario del `ContactModal` funcional**: el submit deja de ser un no-op y pasa a llamar a una Supabase Edge Function nueva que envía el mensaje por correo a `botprueba418@gmail.com`. Se agregan validación client-side, estados de envío (idle / enviando / éxito / error), deshabilitado del botón durante el envío y feedback visible al usuario.
- **Nueva Edge Function `send-contact-email`** (Deno, mismo patrón que `create-user` / `token-manager`): recibe `{ nombre, email, mensaje }`, valida, sanitiza y envía el correo vía un proveedor transaccional (Resend), con `Reply-To` apuntando al email del visitante para poder responderle directo.
- **Corrección de todos los puntos de contacto por email de la landing** (4 entradas rotas encontradas):
  1. `ContactModal` → formulario "Enviar mensaje" (dead submit) — pasa a enviar de verdad.
  2. `ContactModal` → link "Email" `mailto:hola@aura.ai` — pasa a `mailto:botprueba418@gmail.com` como fallback secundario.
  3. `Footer` → link "Contacto" (`<Link to="#">`, muerto) — pasa a abrir el `ContactModal`.
  4. `LoginPage` → "¿Aún no tienes cuenta? Contacta a un asesor" (un `<span>` sin handler) — pasa a ser un elemento accionable que abre el mismo modal de contacto.
  - (El icono `alternate_email` del footer, hoy `href="#"`, se apunta también al mailto correcto.)
- **Anti-abuso en el endpoint público**: honeypot invisible en el form, límites de longitud por campo, validación de formato de email, escapado del contenido en el cuerpo HTML del mail y rate limiting por IP para que el formulario no se use como relay de spam.
- **Nueva credencial externa**: `RESEND_API_KEY` como secret de Supabase (`supabase secrets set`). **Nunca se hardcodea, nunca se pide por chat, nunca se expone al bundle del frontend** — el frontend solo invoca la Edge Function con la anon key ya existente. Conseguir y cargar esta key es una **tarea bloqueante del usuario**.
- Los CTAs de WhatsApp existentes (hero, sección CTA y el bloque verde del modal) **no cambian**: ya funcionan y siguen siendo el canal primario.

## Capabilities

### New Capabilities
- `landing-contact`: Puntos de contacto de la landing pública — qué entradas existen, cuáles abren el formulario, qué valida el formulario y qué feedback recibe el visitante en cada estado del envío.
- `contact-email-delivery`: Entrega server-side del mensaje de contacto — contrato del endpoint `send-contact-email`, destino fijo `botprueba418@gmail.com`, manejo de la credencial del proveedor, sanitización y protecciones anti-abuso del endpoint público.

### Modified Capabilities
<!-- Ninguna. Los specs existentes (dashboard-social-connections, meta-oauth, token-manager, x-twitter-oauth) no cambian de comportamiento. -->

## Impact

**Código afectado (aura-frontend):**
- `src/components/ContactModal.jsx` — form con estado, submit real, honeypot, mensajes de éxito/error, mailto corregido.
- `src/components/Footer.jsx` — "Contacto" e icono de email dejan de ser links muertos.
- `src/components/Navbar.jsx` — el estado `isContactOpen` hoy vive acá; hay que poder abrir el modal desde el Footer (elevar el estado a `LandingPage` o exponer un contexto/callback compartido).
- `src/pages/LandingPage.jsx` — orquesta la apertura del modal desde Navbar y Footer.
- `src/pages/LoginPage.jsx` — "Contacta a un asesor" accionable.
- `src/lib/` — helper de invocación (`supabase.functions.invoke('send-contact-email', ...)`, mismo patrón que `RegisterUser.jsx`).

**Backend / infra:**
- Nueva carpeta `aura-frontend/supabase/functions/send-contact-email/index.ts`.
- Nuevo secret de Supabase `RESEND_API_KEY` (+ opcional `CONTACT_TO_EMAIL` y `CONTACT_FROM_EMAIL` para no hardcodear direcciones).
- Nueva dependencia externa: cuenta en Resend (free tier). **Gotcha de deliverability**: sin dominio verificado, Resend solo permite enviar desde `onboarding@resend.dev` y **únicamente hacia el email con el que se registró la cuenta** — por eso la cuenta de Resend debe crearse con `botprueba418@gmail.com`.

**No afectado:**
- Auth, perfiles, tokens de redes sociales, workflow n8n y la app autenticada (dashboard/métricas) quedan intactos. No hay migraciones de base de datos salvo la tabla opcional de rate limiting evaluada en design.

**Gobernanza:** MEDIUM-HIGH. No toca Auth ni datos de usuarios existentes, pero introduce una credencial nueva de un servicio externo y expone un endpoint público sin autenticación de usuario final.
