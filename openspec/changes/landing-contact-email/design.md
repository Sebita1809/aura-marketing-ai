## Context

La landing pública de Aura (`LandingPage.jsx` = `Navbar` + secciones + `Footer`) tiene hoy **un solo canal de contacto que funciona**: los links a WhatsApp (`https://wa.me/5492616177756`) en el hero, en la sección CTA y dentro del `ContactModal`. Todo lo demás relacionado con correo está roto:

| # | Punto de contacto | Archivo | Estado actual |
|---|---|---|---|
| 1 | Formulario "Enviar mensaje" del modal | `src/components/ContactModal.jsx:62` | `onSubmit={(e) => { e.preventDefault(); onClose(); }}` — descarta el mensaje |
| 2 | Link "Email" del modal | `src/components/ContactModal.jsx:104` | `mailto:hola@aura.ai` — dirección incorrecta |
| 3 | Link "Contacto" del footer | `src/components/Footer.jsx:21` | `<Link to="#">` — no hace nada |
| 4 | "Contacta a un asesor" del login | `src/pages/LoginPage.jsx:146` | `<span>` sin handler — ni siquiera es clickeable |
| 5 | Icono `alternate_email` del footer | `src/components/Footer.jsx:26` | `<a href="#">` — no hace nada |

El `ContactModal` se monta desde `Navbar.jsx:65`, con el estado `isContactOpen` local al Navbar; el Footer no tiene forma de abrirlo hoy. `Navbar` y `Footer` se usan **solo** en `LandingPage.jsx`, así que el blast radius es acotado.

**Estado del stack relevante:**
- Frontend: Vite 8 + React 19 + Tailwind 4, sin librería de forms ni de estado de servidor. Los forms existentes (`LoginPage`, `RegisterUser`) usan `useState` + `async handleSubmit` a mano.
- Serverless: Supabase Edge Functions en Deno, ya hay 4 (`auth-meta-callback`, `auth-x-callback`, `create-user`, `token-manager`), todas con el mismo esqueleto `serve()` + `corsHeaders` + `try/catch` + `Response` JSON.
- Invocación desde el front: `supabase.functions.invoke('<fn>', { body })` (patrón de `RegisterUser.jsx:33`).
- **No existe ninguna integración de envío de email en el repo** (grep de `resend|sendgrid|nodemailer|smtp` sin resultados fuera de `node_modules`). Hay que construirla desde cero.

**Constraints:**
- El destino de los mensajes es fijo: `botprueba418@gmail.com`.
- El visitante es anónimo: no hay sesión, así que el endpoint es público (solo protegido por la anon key del proyecto) y necesita defensas anti-abuso propias.
- La credencial del proveedor de email **no puede tocar el bundle del frontend** (todo `VITE_*` termina en el JS público) ni el repo.
- El usuario tiene que dar de alta la cuenta del proveedor y cargar la key él mismo — no se pide por chat.

## Goals / Non-Goals

**Goals:**
- Que el formulario del `ContactModal` entregue el mensaje **de verdad** a `botprueba418@gmail.com`, sin depender del cliente de correo del visitante.
- Un único endpoint server-side (`send-contact-email`) como camino de entrega, con la credencial del proveedor viviendo solo como secret de Supabase.
- Que los 5 puntos de contacto de la tabla anterior queden funcionales y converjan en el mismo formulario (o, para los links directos, en el mail correcto).
- Feedback claro al visitante: éxito, error, y estado "enviando" que impide el doble submit.
- Defensas mínimas para un endpoint público: validación, límites de longitud, honeypot, rate limit por IP y escapado del contenido en el mail.
- Que la key del proveedor se cargue como secret y que la implementación falle de forma explícita y ruidosa si falta, en vez de "enviar" en silencio.

**Non-Goals:**
- Persistir los leads en base de datos (CRM, tabla `contact_messages`, etc.). Fuera de alcance en este change; se evalúa después si hace falta trazabilidad.
- Autorespuesta / email de confirmación al visitante.
- Cambiar los CTAs de WhatsApp o la copy comercial de la landing.
- Verificación de dominio propio (`aura.ai` o similar) y DKIM/SPF — se documenta como paso posterior cuando exista dominio real.
- CAPTCHA (reCAPTCHA / hCaptcha / Turnstile): se deja como escalada si el honeypot + rate limit no alcanzan.
- Tocar el flujo de auth, los tokens de redes sociales o el workflow n8n.

## Decisions

### Decisión 1 — Proveedor de email: Resend (vía HTTP API, sin SDK)

**Elegido:** [Resend](https://resend.com), llamado con `fetch` plano a `POST https://api.resend.com/emails` desde la Edge Function.

**Por qué:**
- Es una **HTTP API con auth por Bearer token** — no necesita SDK, ni npm, ni conexiones TCP crudas. Encaja perfecto con Deno Edge Functions, donde el runtime está sandboxeado y las conexiones SMTP salientes son un dolor.
- Free tier suficiente para el volumen de una landing (orden de 100 mails/día, 3.000/mes) y **sin tarjeta de crédito** para arrancar.
- Permite enviar desde `onboarding@resend.dev` sin dominio verificado, así que el usuario puede tener esto andando el mismo día sin comprar ni configurar DNS.
- Payload trivial (`from`, `to`, `subject`, `html`, `reply_to`), lo que mantiene la Edge Function chica y auditable.

**Alternativas descartadas:**
- **Nodemailer / SMTP directo a Gmail** — descartado: requiere App Password de la cuenta de Google (credencial más sensible que una API key revocable y de alcance acotado), Deno Deploy restringe/complica el SMTP saliente, Gmail rate-limitea y marca este patrón como sospechoso, y no hay dashboard de entregabilidad.
- **SendGrid** — API HTTP igual de válida, pero el onboarding es más pesado (verificación de sender obligatoria antes del primer envío, cuentas free suspendidas con frecuencia por antifraude). Más fricción para el usuario sin ganancia acá.
- **SMTP integrado de Supabase** — descartado por diseño: solo cubre los mails transaccionales de **Auth** (confirmación, recuperación de contraseña). No es un canal de envío arbitrario.
- **EmailJS / Formspree / Web3Forms** (servicios client-side) — descartado: la key vive en el bundle del navegador y queda expuesta a cualquiera que abra devtools, y el mensaje pasa por el almacenamiento de un tercero. Contradice el requisito de "envío real desde el backend".
- **Webhook a n8n** (ya hay una instancia n8n en este repo) — tentador por reutilización, pero acoplaría la landing pública al runtime del bot de Telegram: si n8n está caído o en mantenimiento, se caen los leads. Además habría que exponer un webhook público más. Se descarta por aislamiento de fallos.

### Decisión 2 — Punto de entrega: Edge Function nueva `send-contact-email`

Una función nueva en `aura-frontend/supabase/functions/send-contact-email/index.ts`, siguiendo exactamente el esqueleto de `create-user/index.ts`:

```
serve() → manejo de OPTIONS con corsHeaders → parse del body → validación
        → llamada a Resend → Response JSON { success, error? }
```

- Se **descarta** meter el envío dentro de una función existente: `create-user` y `token-manager` tienen responsabilidades y niveles de privilegio distintos (usan la service key); mezclar un endpoint público anónimo ahí ampliaría su superficie de ataque.
- El frontend la invoca con `supabase.functions.invoke('send-contact-email', { body })`, igual que `RegisterUser.jsx`. La anon key ya presente en el cliente satisface el `verify_jwt` por defecto de Supabase; no hace falta desplegar con `--no-verify-jwt`.
- Contrato de request: `{ name: string, email: string, message: string, company?: string }` (`company` es el honeypot, ver Decisión 5).
- Contrato de response: `200 { success: true }` | `400 { success: false, error }` (validación) | `429 { success: false, error }` (rate limit) | `500 { success: false, error }` (proveedor caído / key ausente). El front nunca muestra el error crudo del proveedor: mapea a un mensaje humano y sugiere el fallback de WhatsApp.

### Decisión 3 — Configuración por secrets, cero hardcodeo

| Variable | Dónde vive | Valor |
|---|---|---|
| `RESEND_API_KEY` | Secret de Supabase (`supabase secrets set`) | la key del usuario (`re_...`) |
| `CONTACT_TO_EMAIL` | Secret de Supabase | `botprueba418@gmail.com` |
| `CONTACT_FROM_EMAIL` | Secret de Supabase | `onboarding@resend.dev` hasta que haya dominio propio |

- El destino sale a variable de entorno (con `botprueba418@gmail.com` como default en código) para poder cambiarlo sin redeploy de código y sin tocar el frontend.
- **Ninguna** de estas variables lleva prefijo `VITE_` ni entra al `.env` del frontend: Vite inlinea todo `VITE_*` en el bundle público. La key **solo** existe en el entorno de la Edge Function.
- La función valida `RESEND_API_KEY` al arrancar el handler y devuelve `500` con un mensaje explícito si falta. Nunca responde `success: true` sin haber enviado.
- Esto es **tarea bloqueante del usuario**: hasta que la key exista como secret, la implementación se puede escribir y testear con mocks, pero no se puede verificar end-to-end. Se pide **siempre** por `supabase secrets set`, nunca por chat, mismo criterio que se usó con `TELEGRAM_BOT_TOKEN` / `GOOGLE_API_KEY` en el otro proyecto del repo.

### Decisión 4 — Gotcha de deliverability: la cuenta de Resend debe crearse con `botprueba418@gmail.com`

En el free tier **sin dominio verificado**, Resend permite enviar desde `onboarding@resend.dev` pero **solo hacia la dirección de email con la que se registró la cuenta**. Cualquier otro destinatario devuelve `403`.

Como el destino es justamente `botprueba418@gmail.com`, esto se resuelve solo **si la cuenta de Resend se da de alta con esa misma dirección**. Es la instrucción explícita nº1 de la tarea bloqueante; si el usuario se registra con otro mail, los envíos van a fallar con un 403 que a simple vista parece un problema de la key. Cuando exista un dominio propio verificado, la restricción desaparece y `CONTACT_FROM_EMAIL` pasa a `contacto@<dominio>`.

### Decisión 5 — Anti-abuso proporcional al riesgo (sin CAPTCHA por ahora)

Endpoint público = relay de spam potencial. Capas, de la más barata a la más cara:

1. **Honeypot**: campo `company` oculto por CSS (no `type="hidden"`, para que los bots lo llenen). Si viene con contenido, la función responde `200 { success: true }` **sin enviar nada** — el bot no aprende que fue detectado.
2. **Validación y límites**: `name` 2–100 chars, `email` con regex de formato razonable y ≤ 254 chars, `message` 10–2000 chars. Body total limitado. Todo campo faltante o fuera de rango → `400`.
3. **Rate limit por IP**: máximo 3 envíos por IP cada 10 minutos, leyendo `x-forwarded-for`. Implementación en un `Map` en memoria del isolate de la Edge Function — es best-effort (los isolates se reciclan y se escalan horizontalmente) pero corta el flood trivial sin agregar tabla ni migración. Si aparece abuso real, la escalada es una tabla en Postgres o Turnstile de Cloudflare.
4. **Escapado**: `name`, `email` y `message` se escapan (`& < > " '`) antes de interpolarse en el HTML del mail, para que nadie inyecte markup ni links en el correo que le llega al usuario. Los headers del mail (`subject`, `reply_to`) se construyen con valores ya validados; **nunca** se concatena input crudo en un header.
5. **`reply_to` = email del visitante**: responder desde Gmail contesta directo al lead, sin exponer la infraestructura ni requerir copiar la dirección a mano.

Se **descarta CAPTCHA** en esta iteración: agrega una segunda credencial de terceros y fricción de conversión para un formulario de bajo volumen que todavía no tiene un problema de spam demostrado.

### Decisión 6 — Estado del modal elevado a `LandingPage`

Hoy `isContactOpen` vive en `Navbar.jsx` y el `ContactModal` se monta ahí. Para que el link "Contacto" del Footer abra el mismo modal, el estado sube a `LandingPage.jsx`, que pasa `onContactClick` a `Navbar` y a `Footer` y monta el `ContactModal` una sola vez.

- Se descarta un React Context de contacto: un solo consumidor de nivel página, dos props, sin ceremonia.
- `LoginPage` no renderiza `Navbar` ni `Footer`, así que maneja su propia instancia del `ContactModal` con su propio `useState` (el componente ya es autocontenido y acepta `isOpen`/`onClose`).

### Decisión 7 — Los mailto siguen existiendo, como fallback secundario

El formulario es el camino primario. Los links directos (`mailto:` del modal y el icono del footer) se mantienen pero apuntando a `botprueba418@gmail.com`, para el visitante que prefiere escribir desde su propio cliente. También son la red de seguridad que se le ofrece en pantalla si el envío falla, junto con el WhatsApp que ya funciona.

## Risks / Trade-offs

- **La cuenta de Resend se crea con otro email** → los envíos fallan con `403` y el síntoma parece "key inválida". Mitigación: la tarea bloqueante lo dice como primer paso literal, y la Edge Function loguea el status y el cuerpo de error de Resend para que el diagnóstico sea inmediato.
- **`RESEND_API_KEY` no cargada al momento de probar** → la función devuelve `500`. Mitigación: chequeo explícito de la variable con mensaje inequívoco ("RESEND_API_KEY no está configurada"); el front muestra "no pudimos enviar tu mensaje" + fallback WhatsApp/mailto. Nunca se responde éxito sin envío.
- **Mails a Gmail cayendo en Spam** por enviar desde el dominio compartido `resend.dev`. Mitigación: avisarle al usuario que revise Spam en la primera prueba y marque "No es spam"; a mediano plazo, dominio propio verificado con SPF/DKIM.
- **Rate limit en memoria es best-effort** — un atacante distribuido o el reciclado de isolates lo evaden. Trade-off aceptado: corta el 90% del abuso trivial a costo cero. Escalada documentada (tabla en Postgres / Turnstile) si aparece spam real.
- **Sin persistencia de leads**: si Resend falla o el mail se pierde, el mensaje se perdió y no queda rastro. Trade-off aceptado en esta iteración (Non-Goal); si el volumen justifica trazabilidad, se agrega una tabla `contact_messages` en un change siguiente.
- **La key es una credencial nueva de un servicio externo** (gobernanza MEDIUM-HIGH). Mitigación: alcance mínimo (solo enviar mail), revocable desde el dashboard de Resend en un click, nunca en el repo ni en el bundle, `.env`/`.env.example` del frontend sin mención de ella salvo un comentario que aclare que es un secret server-side.
- **Elevar el estado del modal toca `Navbar`, `Footer` y `LandingPage`** — refactor pequeño pero transversal a la landing. Mitigación: el contrato de `ContactModal` (`isOpen`/`onClose`) no cambia, así que la regresión posible se limita a "el botón Contactar del navbar dejó de abrir el modal", cubierto por verificación manual explícita en tasks.

## Migration Plan

1. El usuario crea la cuenta de Resend **con `botprueba418@gmail.com`**, genera la API key y la carga: `supabase secrets set RESEND_API_KEY=re_xxx CONTACT_TO_EMAIL=botprueba418@gmail.com CONTACT_FROM_EMAIL=onboarding@resend.dev` (bloqueante).
2. Deploy de la Edge Function: `supabase functions deploy send-contact-email`.
3. Smoke test del endpoint aislado (curl con la anon key) antes de tocar la UI: verificar que llega el mail (revisar Spam).
4. Deploy del frontend con el formulario conectado y los 5 puntos de contacto arreglados.
5. Verificación manual en producción: enviar desde el modal, confirmar recepción, confirmar que "Responder" en Gmail contesta al email del visitante.

**Rollback**: el cambio es aditivo. Revertir el frontend deja los botones como estaban (rotos, pero sin regresión funcional real, ya que hoy no entregan nada); la Edge Function puede quedar desplegada sin consumidores, o borrarse con `supabase functions delete send-contact-email`. La key se revoca desde el dashboard de Resend.

## Open Questions

- ¿Se quiere el mismo formulario también en el login (`LoginPage`), o alcanza con que "Contacta a un asesor" lleve al WhatsApp que ya funciona? El diseño asume el modal; es un cambio de una línea si se prefiere WhatsApp.
- ¿Existe o va a existir un dominio propio para Aura? Define cuándo se puede pasar de `onboarding@resend.dev` a un `from` con marca y levantar la restricción de destinatario único.
- ¿Hace falta persistir los leads para no depender solo del inbox de Gmail? Hoy es Non-Goal; conviene revisarlo si el formulario empieza a traer volumen real.
