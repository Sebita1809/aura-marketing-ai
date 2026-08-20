## ADDED Requirements

### Requirement: Un usuario tiene exactamente uno de tres estados
El sistema SHALL representar el estado de cada usuario en `profiles.status`, con exactamente tres valores posibles: `active`, `blocked` y `deactivated`, restringidos por un `CHECK` en la base de datos. `blocked` SHALL significar suspensión temporal reversible; `deactivated` SHALL significar baja definitiva (soft delete). El sistema NO SHALL permitir estados combinados ni valores fuera de ese conjunto.

#### Scenario: Estado por defecto de un usuario nuevo
- **WHEN** se crea un usuario desde el panel de administración
- **THEN** su perfil queda con `status = 'active'`

#### Scenario: Valor de estado inválido
- **WHEN** una escritura intenta dejar `status` con un valor distinto de `active`, `blocked` o `deactivated`
- **THEN** la base de datos rechaza la operación

### Requirement: `is_active` se mantiene sincronizado con `status`
El sistema SHALL conservar la columna `profiles.is_active` derivada de `status`, con valor verdadero si y solo si `status = 'active'`, de modo que los consumidores existentes sigan funcionando sin cambios. `is_active` NO SHALL poder quedar desincronizado de `status` por ninguna escritura.

#### Scenario: Bloquear un usuario actualiza el booleano derivado
- **WHEN** un usuario pasa a `status = 'blocked'`
- **THEN** su `is_active` queda en falso sin ninguna escritura adicional

#### Scenario: Reactivar un usuario actualiza el booleano derivado
- **WHEN** un usuario dado de baja vuelve a `status = 'active'`
- **THEN** su `is_active` queda en verdadero

### Requirement: Bloquear y dar de baja tienen efectos distintos sobre el vínculo de Telegram
El sistema SHALL conservar `profiles.telegram_chat_id` cuando un usuario pasa a `blocked`, y SHALL liberarlo (dejarlo en `NULL`) cuando un usuario pasa a `deactivated`. Reactivar un usuario dado de baja NO SHALL restaurar el vínculo previo: el usuario SHALL volver a vincular su Telegram.

#### Scenario: Bloqueo conserva la vinculación
- **WHEN** un admin bloquea a un usuario vinculado al bot
- **THEN** su `telegram_chat_id` se conserva, y al desbloquearlo vuelve a operar el bot sin volver a vincular

#### Scenario: Baja libera la vinculación
- **WHEN** un admin da de baja a un usuario vinculado al bot
- **THEN** su `telegram_chat_id` queda en `NULL` y ese chat puede vincularse a otro perfil

#### Scenario: Reactivar no restaura la vinculación
- **WHEN** un admin reactiva a un usuario que había sido dado de baja
- **THEN** el usuario queda `active` sin `telegram_chat_id`, y debe realizar el flujo de vinculación de nuevo

### Requirement: Las transiciones de estado permitidas son explícitas
El sistema SHALL permitir únicamente las transiciones `active → blocked`, `blocked → active`, `active → deactivated`, `blocked → deactivated` y `deactivated → active`. Cualquier otra transición SHALL ser rechazada. Toda transición SHALL ser idempotente: solicitar el estado que el usuario ya tiene SHALL responder éxito sin producir efectos ni registrar traza nueva.

#### Scenario: Baja desde bloqueado
- **WHEN** un admin da de baja a un usuario que ya estaba bloqueado
- **THEN** la operación se acepta y el usuario queda `deactivated`

#### Scenario: Transición inválida
- **WHEN** se solicita desbloquear a un usuario que está `active`
- **THEN** la operación es rechazada con un error y ningún dato del usuario cambia

#### Scenario: Acción repetida
- **WHEN** un admin bloquea dos veces seguidas al mismo usuario
- **THEN** la segunda operación responde éxito, el estado permanece `blocked` y no se registra una transición nueva

### Requirement: El panel ofrece alta, bloqueo, desbloqueo, baja y reactivación
La página de gestión de usuarios SHALL exponer una acción de alta ("Nuevo usuario") y, por cada fila, un menú de acciones con las transiciones válidas para el estado de ese usuario, más el acceso al detalle. El menú de acciones NO SHALL ofrecer transiciones inválidas para el estado actual de la fila. El botón de acciones NO SHALL quedar sin comportamiento asociado.

#### Scenario: Acciones de un usuario activo
- **WHEN** el admin abre el menú de acciones de un usuario `active`
- **THEN** ve "Bloquear", "Dar de baja" y "Ver detalle", y no ve "Desbloquear" ni "Reactivar"

#### Scenario: Acciones de un usuario bloqueado
- **WHEN** el admin abre el menú de acciones de un usuario `blocked`
- **THEN** ve "Desbloquear", "Dar de baja" y "Ver detalle"

#### Scenario: Acciones de un usuario dado de baja
- **WHEN** el admin abre el menú de acciones de un usuario `deactivated`
- **THEN** ve "Reactivar" y "Ver detalle", y no ve "Bloquear" ni "Dar de baja"

### Requirement: El alta ocurre dentro de la página de gestión de usuarios
El alta de usuarios SHALL presentarse como un modal sobre el listado, invocado desde la propia página, y SHALL seguir usando la Edge Function `create-user`. Al completarse un alta con éxito, el modal SHALL cerrarse y el listado SHALL reflejar al usuario nuevo sin recargar la página ni navegar fuera de la sección.

#### Scenario: Alta exitosa
- **WHEN** el admin completa el formulario de alta y la creación tiene éxito
- **THEN** el modal se cierra, el listado se actualiza y el usuario nuevo aparece con estado "Activo"

#### Scenario: Alta fallida
- **WHEN** la creación falla (email duplicado, error del servidor)
- **THEN** el modal permanece abierto, muestra el mensaje de error y conserva los datos ya cargados en el formulario

#### Scenario: Cancelar el alta
- **WHEN** el admin cierra el modal sin enviar
- **THEN** vuelve al listado en la misma página y sin cambios

### Requirement: Las acciones destructivas requieren confirmación explícita
El panel SHALL pedir confirmación antes de ejecutar cualquier transición de estado, identificando en el diálogo al usuario afectado por nombre y email, y SHALL permitir registrar un motivo opcional. Para la baja, la confirmación SHALL ser reforzada: el admin SHALL escribir el email del usuario para habilitarla, y el diálogo SHALL advertir explícitamente que el vínculo de Telegram se libera y que reactivar exigirá vincularlo de nuevo.

#### Scenario: Confirmación de bloqueo
- **WHEN** el admin elige "Bloquear" sobre una fila
- **THEN** se muestra un diálogo con el nombre y el email del usuario y un campo de motivo opcional, y nada cambia hasta confirmar

#### Scenario: Confirmación reforzada de baja
- **WHEN** el admin elige "Dar de baja" sobre una fila
- **THEN** el diálogo advierte que se libera el vínculo de Telegram y la confirmación solo se habilita después de escribir el email exacto del usuario

#### Scenario: Cancelar una confirmación
- **WHEN** el admin cierra el diálogo sin confirmar
- **THEN** no se envía ninguna solicitud y el estado del usuario no cambia

### Requirement: El resultado de una acción se refleja desde el servidor
Mientras una transición está en curso, la fila afectada SHALL quedar deshabilitada para nuevas acciones. Al finalizar, el panel SHALL reflejar el estado leído del servidor y NO SHALL asumir el resultado de forma optimista. Si la operación falla, el panel SHALL mostrar el error y dejar la fila en el estado real.

#### Scenario: Acción en curso
- **WHEN** el admin confirma una transición y la solicitud está en vuelo
- **THEN** la fila muestra un indicador de progreso y no acepta otra acción hasta que termine

#### Scenario: Acción fallida
- **WHEN** la solicitud de transición devuelve error
- **THEN** el panel muestra el mensaje de error y la fila queda mostrando el estado real leído del servidor

### Requirement: Un admin no puede dejarse afuera ni dejar el sistema sin administradores
El sistema SHALL rechazar que un admin se bloquee o se dé de baja a sí mismo, y SHALL rechazar bloquear o dar de baja al único usuario con `role = 'admin'` y `status = 'active'`. Estas restricciones SHALL verificarse del lado servidor; la interfaz SHALL además no ofrecer esas acciones.

#### Scenario: Auto-bloqueo
- **WHEN** un admin intenta bloquearse o darse de baja a sí mismo
- **THEN** la operación es rechazada y su estado no cambia

#### Scenario: Último admin activo
- **WHEN** se intenta bloquear o dar de baja al único admin con estado `active`
- **THEN** la operación es rechazada con un mensaje que explica el motivo y el sistema conserva al menos un admin activo

#### Scenario: La interfaz no ofrece la acción prohibida
- **WHEN** el admin abre el menú de acciones sobre su propia fila
- **THEN** las acciones de bloqueo y baja no están disponibles
