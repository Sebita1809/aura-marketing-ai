## 1. Credencial del proveedor de email — BLOQUEANTE (acción del usuario)

> **Esta sección la ejecuta el usuario, no el agente.** El agente NUNCA pide la API key por chat, NUNCA la escribe en el repo y NUNCA la pega en un archivo versionado. Se carga directo como secret de Supabase.
>
> El resto del change (secciones 2 a 6) se puede escribir y testear con mocks, pero **la verificación end-to-end de la sección 7 está bloqueada hasta completar esta sección**.

- [x] 1.1 **(Usuario)** Crear una cuenta en https://resend.com **registrándose con `botprueba418@gmail.com`**. Es obligatorio usar esa dirección: en el free tier sin dominio verificado, Resend solo permite enviar hacia el email con el que se creó la cuenta; registrarse con otro mail hace que todos los envíos fallen con `403`. — hecho 2026-08-18.
- [x] 1.2 **(Usuario)** Generar una API key en el dashboard de Resend (Settings → API Keys), con permiso de envío (`Sending access`). Copiarla una sola vez (empieza con `re_`); Resend no la vuelve a mostrar. — hecho 2026-08-18.
- [x] 1.3 **(Usuario)** Cargar los secrets en Supabase desde la terminal, sin pegar la key en el chat ni en ningún archivo del repo:
      ```
      supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx
      supabase secrets set CONTACT_TO_EMAIL=botprueba418@gmail.com
      supabase secrets set CONTACT_FROM_EMAIL=onboarding@resend.dev
      ```
      — hecho 2026-08-18, con `--project-ref legffrhakunfignlaftl` en vez de `--linked` (esa versión del CLI no soporta `--linked` en `secrets set`).
- [x] 1.4 **(Usuario)** Confirmar que los secrets quedaron cargados con `supabase secrets list` (muestra los nombres y un digest, nunca el valor) y avisar al agente **solo con un "listo"** — sin transcribir el valor de la key. — confirmado por el usuario ("listorti") y verificado por el agente vía `secrets list` (solo digests, nunca el valor).
- [x] 1.5 Verificar que `.gitignore` cubre `.env` y que ni `.env.example` ni ningún archivo versionado contiene la key. Si se documenta la variable en `.env.example`, dejar solo un comentario aclarando que es un secret server-side de la Edge Function y que **no** lleva prefijo `VITE_`.

## 2. Edge Function `send-contact-email` — esqueleto y contrato

- [x] 2.1 Crear `aura-frontend/supabase/functions/send-contact-email/index.ts` siguiendo el patrón de `create-user/index.ts`: import de `serve` desde `https://deno.land/std@0.168.0/http/server.ts`, constante `corsHeaders` con el mismo set de headers, y `serve(async (req) => { ... })` envuelto en `try/catch`.
- [x] 2.2 Manejar el preflight: si `req.method === 'OPTIONS'`, responder `new Response('ok', { headers: corsHeaders })` antes de cualquier otra lógica.
- [x] 2.3 Parsear el body con `try/catch` propio y responder `400 { success: false, error }` ante JSON malformado, sin excepciones no controladas.
- [x] 2.4 Definir el contrato de request `{ name, email, message, company? }` y el de response: `200 { success: true }` / `400` validación / `429` rate limit / `500` configuración o proveedor. Todas las respuestas con `Content-Type: application/json` + `corsHeaders`.
- [x] 2.5 Leer la configuración con `Deno.env.get`: `RESEND_API_KEY` (sin default), `CONTACT_TO_EMAIL` (default `botprueba418@gmail.com`), `CONTACT_FROM_EMAIL` (default `onboarding@resend.dev`).
- [x] 2.6 Si `RESEND_API_KEY` no está definida, responder `500` con mensaje explícito de configuración faltante. Nunca responder `success: true` sin haber enviado.

## 3. Edge Function — validación, anti-abuso y sanitización

- [x] 3.1 Implementar la validación server-side: `name` 2–100 chars, `email` con regex de formato y ≤ 254 chars, `message` 10–2000 chars. Cualquier violación → `400` sin llamar al proveedor.
- [x] 3.2 Implementar el honeypot: si `company` viene con contenido no vacío, responder `200 { success: true }` **sin enviar correo** (el bot no debe distinguir el rechazo del éxito).
- [x] 3.3 Implementar el rate limit por IP: `Map` en memoria del isolate, clave = `x-forwarded-for`, máximo 3 envíos por ventana de 10 minutos; al superarlo responder `429`. Limpiar entradas vencidas para que el `Map` no crezca sin límite.
- [x] 3.4 Implementar el helper de escapado HTML (`& < > " '`) y aplicarlo a `name`, `email` y `message` antes de interpolarlos en el cuerpo del correo.
- [x] 3.5 Neutralizar saltos de línea y caracteres de control en los valores que se usan en headers (`subject`, `reply_to`) para evitar inyección de cabeceras.

## 4. Edge Function — envío vía Resend

- [x] 4.1 Implementar la llamada `POST https://api.resend.com/emails` con `Authorization: Bearer ${RESEND_API_KEY}` y `Content-Type: application/json`.
- [x] 4.2 Construir el payload: `from: CONTACT_FROM_EMAIL`, `to: [CONTACT_TO_EMAIL]`, `subject: "Nuevo contacto desde la landing — <nombre>"`, `reply_to: <email del visitante>`, `html` con nombre, correo y mensaje ya escapados.
- [x] 4.3 Manejar la respuesta del proveedor: `2xx` → `200 { success: true }`; cualquier otro status → `500 { success: false, error }` genérico para el cliente, con `console.error` del status y del cuerpo de error de Resend para diagnóstico (sin loguear nunca la API key).
- [x] 4.4 Desplegar con `supabase functions deploy send-contact-email` y verificar que queda listada en el dashboard de Supabase.

## 5. Frontend — `ContactModal` funcional

- [x] 5.1 Convertir el formulario de `src/components/ContactModal.jsx` en controlado: `useState` para `name`, `email`, `message`, más `status` (`idle` | `sending` | `success` | `error`) y `errorMsg`.
- [x] 5.2 Reemplazar `onSubmit={(e) => { e.preventDefault(); onClose(); }}` por un `handleSubmit` async que valide client-side (mismos límites que la sección 3.1) y, si pasa, invoque `supabase.functions.invoke('send-contact-email', { body: { name, email, message, company } })` — mismo patrón que `RegisterUser.jsx:33`.
- [x] 5.3 Agregar el campo honeypot `company`: oculto por CSS (no `type="hidden"`), con `tabIndex={-1}`, `autoComplete="off"` y `aria-hidden="true"`.
- [x] 5.4 Implementar los estados de UI: botón deshabilitado con texto "Enviando..." durante `sending`; mensaje de éxito con `role="status"` y limpieza de los campos tras `success`; mensaje de error que **conserva** lo escrito por el visitante.
- [x] 5.5 En el estado de error, ofrecer los canales alternativos: link al WhatsApp existente y a `mailto:botprueba418@gmail.com`. Diferenciar el mensaje del caso `429` ("alcanzaste el límite de envíos, reintentá en unos minutos"). Nunca mostrar el error crudo del proveedor.
- [x] 5.6 Corregir el link "Email" del bloque inferior: `mailto:hola@aura.ai` → `mailto:botprueba418@gmail.com` (`ContactModal.jsx:104`).
- [x] 5.7 Asociar cada `label` a su input con `htmlFor`/`id` y marcar los campos requeridos.

## 6. Frontend — resto de los puntos de contacto

- [x] 6.1 Elevar el estado `isContactOpen` de `src/components/Navbar.jsx` a `src/pages/LandingPage.jsx`: `LandingPage` mantiene el estado, monta el `ContactModal` una sola vez y pasa `onContactClick` a `Navbar` y a `Footer`.
- [x] 6.2 En `src/components/Navbar.jsx`: reemplazar el estado local por la prop `onContactClick` en el botón "Contactar" y quitar el `ContactModal` montado ahí.
- [x] 6.3 En `src/components/Footer.jsx`: convertir el `<Link to="#">Contacto</Link>` en un botón que dispare `onContactClick`, y apuntar el icono `alternate_email` (`href="#"`) a `mailto:botprueba418@gmail.com`.
- [x] 6.4 En `src/pages/LoginPage.jsx`: convertir el `<span>Contacta a un asesor</span>` (línea ~146) en un elemento accionable y enfocable por teclado que abra su propia instancia del `ContactModal` (`LoginPage` no usa `Navbar` ni `Footer`, así que maneja su propio `useState`).
- [x] 6.5 Verificar que los CTAs de WhatsApp (hero de `LandingPage`, sección CTA y bloque verde del modal) siguen apuntando a `https://wa.me/5492616177756` sin cambios.
- [x] 6.6 Correr `pnpm lint` (oxlint) y `pnpm build` y confirmar que pasan sin nuevos warnings.

## 7. Verificación end-to-end — requiere la sección 1 completa

- [x] 7.1 Smoke test del endpoint aislado con `curl` (POST a `${SUPABASE_URL}/functions/v1/send-contact-email` con la anon key y un body válido) y confirmar `200 { success: true }`.
- [x] 7.2 Confirmar que el correo llega a `botprueba418@gmail.com`. **Revisar la carpeta de Spam** en la primera prueba (el envío sale del dominio compartido `resend.dev`); si cayó ahí, marcar "No es spam". — confirmado por el usuario 2026-08-18.
- [x] 7.3 Verificar que "Responder" en el correo recibido contesta al email cargado en el formulario (`reply_to` correcto). — confirmado por el usuario 2026-08-18.
- [x] 7.4 Probar los casos de error contra el endpoint desplegado: campo faltante → `400`; email inválido → `400`; mensaje > 2000 chars → `400`; honeypot con contenido → `200` sin correo recibido; 4 envíos seguidos desde la misma IP → `429` en el cuarto.
- [x] 7.5 Verificar el flujo completo en el navegador: abrir el modal desde "Contactar" del Navbar y desde "Contacto" del Footer, enviar un mensaje real y ver el estado de éxito. — confirmado por el usuario 2026-08-18.
- [x] 7.6 Verificar que "Contacta a un asesor" del login abre el modal, y que los dos `mailto:` (modal y icono del footer) abren el cliente de correo con `botprueba418@gmail.com`. — confirmado por el usuario 2026-08-18.
- [x] 7.7 Verificar en el bundle compilado (`dist/`) que la API key de Resend no aparece: `grep -r "re_" dist/` no debe arrojar la credencial.
