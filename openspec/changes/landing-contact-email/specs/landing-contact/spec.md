## ADDED Requirements

### Requirement: El formulario de contacto envía el mensaje al backend
El formulario del `ContactModal` SHALL enviar los datos ingresados a la Edge Function `send-contact-email` mediante `supabase.functions.invoke`. El submit NO SHALL limitarse a cerrar el modal ni descartar el contenido.

#### Scenario: Envío exitoso desde el modal de contacto
- **WHEN** el visitante completa nombre, correo y mensaje con datos válidos y hace click en "Enviar mensaje"
- **THEN** el frontend invoca `send-contact-email` con `{ name, email, message }`, y al recibir `success: true` muestra un mensaje de confirmación visible ("Mensaje enviado, te respondemos a la brevedad") dentro del modal

#### Scenario: El modal no se cierra descartando el mensaje
- **WHEN** el visitante hace submit del formulario
- **THEN** el modal permanece abierto hasta que la respuesta del backend llegue, y solo se cierra por acción explícita del usuario (botón cerrar, click en el backdrop o tecla Escape) o tras mostrar la confirmación de éxito

### Requirement: Validación client-side antes de enviar
El formulario SHALL validar los campos antes de invocar el backend y SHALL bloquear el envío si algún campo no cumple: nombre entre 2 y 100 caracteres, correo con formato válido y de hasta 254 caracteres, mensaje entre 10 y 2000 caracteres.

#### Scenario: Campo obligatorio vacío
- **WHEN** el visitante hace submit con el nombre, el correo o el mensaje vacío
- **THEN** no se invoca la Edge Function y se muestra un error de validación junto al campo afectado

#### Scenario: Correo con formato inválido
- **WHEN** el visitante ingresa `noesunmail` en el campo de correo y hace submit
- **THEN** no se invoca la Edge Function y se muestra "Ingresá un correo válido"

#### Scenario: Mensaje demasiado corto
- **WHEN** el visitante escribe un mensaje de menos de 10 caracteres y hace submit
- **THEN** no se invoca la Edge Function y se muestra un error indicando el largo mínimo

### Requirement: Estados de envío visibles y sin doble submit
El formulario SHALL exponer los estados `idle`, `enviando`, `éxito` y `error`. Durante `enviando`, el botón de submit SHALL estar deshabilitado y mostrar un texto de progreso.

#### Scenario: Botón deshabilitado durante el envío
- **WHEN** el envío está en curso
- **THEN** el botón muestra "Enviando..." y queda deshabilitado, de modo que un segundo click no dispara una segunda invocación

#### Scenario: Reintento tras un error
- **WHEN** el envío falla y el visitante corrige el problema o vuelve a intentar
- **THEN** el botón vuelve al estado habilitado con el texto "Enviar mensaje" y un nuevo submit dispara una nueva invocación

#### Scenario: Formulario limpio tras el éxito
- **WHEN** el envío resulta exitoso
- **THEN** los campos del formulario se vacían y se muestra el estado de éxito, evitando reenvíos accidentales del mismo mensaje

### Requirement: Error de envío con canales alternativos
Cuando la invocación falla o el backend responde error, el formulario SHALL mostrar un mensaje comprensible en español y SHALL ofrecer los canales alternativos existentes (WhatsApp y el correo directo). El error técnico crudo del proveedor NO SHALL mostrarse al visitante.

#### Scenario: Backend caído o error del proveedor de email
- **WHEN** la invocación devuelve error o `success: false` con un `500`
- **THEN** se muestra "No pudimos enviar tu mensaje. Escribinos por WhatsApp o a botprueba418@gmail.com" con los enlaces correspondientes, y el contenido escrito por el visitante se conserva en los campos

#### Scenario: Límite de envíos alcanzado
- **WHEN** el backend responde `429`
- **THEN** se muestra un mensaje indicando que se alcanzó el límite de envíos y que reintente en unos minutos, junto con los canales alternativos

### Requirement: Todos los puntos de contacto por correo de la landing son funcionales
Ningún punto de contacto por correo de la landing SHALL quedar como link muerto (`href="#"` / `to="#"`) ni como elemento no accionable. Los siguientes cinco puntos SHALL quedar funcionales.

#### Scenario: Botón "Contactar" del Navbar
- **WHEN** el visitante hace click en "Contactar" en el Navbar
- **THEN** se abre el `ContactModal` con el formulario funcional

#### Scenario: Link "Contacto" del Footer
- **WHEN** el visitante hace click en "Contacto" en el Footer
- **THEN** se abre el mismo `ContactModal` (no navega a `#` ni recarga la página)

#### Scenario: Link "Email" dentro del modal
- **WHEN** el visitante hace click en "Email" en el bloque inferior del `ContactModal`
- **THEN** se abre su cliente de correo con destinatario `botprueba418@gmail.com` (ya no `hola@aura.ai`)

#### Scenario: Icono de email del Footer
- **WHEN** el visitante hace click en el icono `alternate_email` del Footer
- **THEN** se abre su cliente de correo con destinatario `botprueba418@gmail.com`

#### Scenario: "Contacta a un asesor" en el Login
- **WHEN** el visitante hace click en "Contacta a un asesor" en `LoginPage`
- **THEN** el elemento es accionable (botón o link con foco por teclado) y abre el formulario de contacto

### Requirement: Los canales de WhatsApp existentes no se modifican
Los CTAs de WhatsApp de la landing (hero, sección CTA y bloque verde del `ContactModal`) SHALL seguir apuntando a `https://wa.me/5492616177756` sin cambios de comportamiento.

#### Scenario: CTA de WhatsApp del hero
- **WHEN** el visitante hace click en "Hablar con un asesor"
- **THEN** se abre `https://wa.me/5492616177756` en una pestaña nueva, igual que antes del cambio

### Requirement: Accesibilidad básica del formulario
Los campos del formulario SHALL estar asociados a sus etiquetas y los mensajes de estado SHALL ser anunciables por lectores de pantalla.

#### Scenario: Etiquetas asociadas a los inputs
- **WHEN** se renderiza el formulario de contacto
- **THEN** cada `label` está asociada a su input mediante `htmlFor`/`id`, y el campo honeypot está oculto visualmente pero excluido del foco por teclado (`tabIndex={-1}`, `autoComplete="off"`)

#### Scenario: Mensaje de estado anunciado
- **WHEN** aparece el mensaje de éxito o de error tras el envío
- **THEN** el contenedor del mensaje tiene `role="status"` o `aria-live="polite"` para que sea anunciado
