## ADDED Requirements

### Requirement: Edge Function `send-contact-email` entrega el mensaje por correo
El sistema SHALL exponer una Supabase Edge Function `send-contact-email` que recibe un mensaje de contacto por `POST` y lo entrega por correo al buzón configurado, usando el proveedor transaccional Resend vía su HTTP API. La función SHALL seguir el patrón de las Edge Functions existentes: `serve()`, manejo de `OPTIONS` con `corsHeaders`, `try/catch` y respuesta JSON.

#### Scenario: Mensaje válido entregado correctamente
- **WHEN** llega un `POST` con `{ name: "Ana", email: "ana@empresa.com", message: "Quiero información sobre Aura" }`
- **THEN** la función llama a `POST https://api.resend.com/emails` con el `Authorization: Bearer <RESEND_API_KEY>`, y al recibir un `2xx` responde `200 { success: true }`

#### Scenario: Preflight CORS
- **WHEN** llega un request `OPTIONS`
- **THEN** la función responde `ok` con los `corsHeaders` estándar del proyecto (mismo set que `create-user`), sin intentar enviar correo

#### Scenario: El proveedor devuelve error
- **WHEN** Resend responde un status distinto de `2xx`
- **THEN** la función responde `500 { success: false, error }` con un mensaje genérico para el cliente, y registra en el log el status y el cuerpo de error del proveedor para diagnóstico

### Requirement: Destino y remitente configurados por variables de entorno
El destinatario SHALL ser `botprueba418@gmail.com`, leído de la variable de entorno `CONTACT_TO_EMAIL` con ese mismo valor como default en código. El remitente SHALL leerse de `CONTACT_FROM_EMAIL`. Ninguna dirección de correo NI credencial SHALL quedar hardcodeada de forma no configurable.

#### Scenario: Destino por defecto
- **WHEN** `CONTACT_TO_EMAIL` no está definida
- **THEN** el correo se envía a `botprueba418@gmail.com`

#### Scenario: Destino sobrescrito por configuración
- **WHEN** `CONTACT_TO_EMAIL` está definida con otra dirección
- **THEN** el correo se envía a esa dirección, sin necesidad de modificar el código ni redesplegar el frontend

### Requirement: La credencial del proveedor vive solo como secret server-side
`RESEND_API_KEY` SHALL almacenarse exclusivamente como secret de Supabase (`supabase secrets set`) y SHALL ser accesible únicamente desde el runtime de la Edge Function. La credencial NO SHALL aparecer en el repositorio, en archivos versionados, en el bundle del frontend, ni con prefijo `VITE_`.

#### Scenario: Key ausente
- **WHEN** la función se ejecuta y `RESEND_API_KEY` no está definida
- **THEN** responde `500 { success: false, error }` con un mensaje explícito de configuración faltante, y NO responde `success: true` en ningún caso

#### Scenario: La key no se filtra al cliente
- **WHEN** se construye el bundle del frontend
- **THEN** ninguna variable con la API key del proveedor está presente en el código servido al navegador; el frontend solo usa `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` para invocar la función

#### Scenario: La key nunca se expone en las respuestas ni en los logs
- **WHEN** ocurre un error de autenticación contra el proveedor
- **THEN** el valor de `RESEND_API_KEY` no aparece en el cuerpo de la respuesta ni en los logs de la función

### Requirement: Validación y límites de entrada en el endpoint
La función SHALL validar server-side todos los campos, independientemente de la validación del frontend: `name` entre 2 y 100 caracteres, `email` con formato válido y hasta 254 caracteres, `message` entre 10 y 2000 caracteres. Toda entrada inválida SHALL responder `400`.

#### Scenario: Campo requerido faltante
- **WHEN** el body no incluye `message`
- **THEN** la función responde `400 { success: false, error }` y no llama al proveedor de email

#### Scenario: Email con formato inválido
- **WHEN** el body trae `email: "no-es-un-mail"`
- **THEN** la función responde `400` y no llama al proveedor de email

#### Scenario: Mensaje excede el límite
- **WHEN** el body trae un `message` de más de 2000 caracteres
- **THEN** la función responde `400` y no llama al proveedor de email

#### Scenario: Body malformado
- **WHEN** el request no trae un JSON parseable
- **THEN** la función responde `400` sin lanzar una excepción no controlada

### Requirement: Protección anti-abuso del endpoint público
Al ser un endpoint accesible sin sesión de usuario, la función SHALL implementar honeypot y rate limiting por IP.

#### Scenario: Honeypot completado por un bot
- **WHEN** el body incluye el campo honeypot `company` con contenido no vacío
- **THEN** la función responde `200 { success: true }` sin enviar ningún correo, de modo que el bot no distingue el rechazo de un envío exitoso

#### Scenario: Rate limit por IP superado
- **WHEN** una misma IP (según `x-forwarded-for`) supera 3 envíos en 10 minutos
- **THEN** la función responde `429 { success: false, error }` sin llamar al proveedor de email

#### Scenario: Envíos dentro del límite
- **WHEN** una IP realiza su primer envío en la ventana de tiempo
- **THEN** la función procesa el envío normalmente

### Requirement: Sanitización del contenido del correo
El contenido provisto por el visitante SHALL escaparse antes de interpolarse en el cuerpo HTML del correo, y NO SHALL concatenarse crudo en ningún header del mensaje (`subject`, `from`, `reply_to`).

#### Scenario: Mensaje con HTML embebido
- **WHEN** el visitante envía `message` con `<script>alert(1)</script>` o etiquetas HTML
- **THEN** el correo recibido muestra ese texto escapado como texto plano, sin ejecutar ni renderizar markup

#### Scenario: Intento de inyección en headers
- **WHEN** el campo `name` contiene saltos de línea o secuencias tipo cabecera de correo
- **THEN** esos caracteres se neutralizan y no producen headers adicionales en el mensaje enviado

### Requirement: El correo recibido permite responder al visitante
El correo entregado SHALL incluir el nombre, el correo y el mensaje del visitante, y SHALL definir `reply_to` con el correo del visitante.

#### Scenario: Responder desde el buzón de destino
- **WHEN** el destinatario abre el correo recibido y presiona "Responder"
- **THEN** el destinatario de la respuesta es el correo que cargó el visitante en el formulario

#### Scenario: Asunto identificable
- **WHEN** llega un mensaje del formulario
- **THEN** el asunto identifica el origen y al remitente (por ejemplo "Nuevo contacto desde la landing — Ana"), permitiendo filtrarlo en la bandeja de entrada
