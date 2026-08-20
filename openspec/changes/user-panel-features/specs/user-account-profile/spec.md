## ADDED Requirements

### Requirement: Página de perfil con los datos de la cuenta

La ruta protegida `/app/profile` SHALL mostrar los datos de la cuenta de Aura del usuario autenticado, reemplazando el placeholder actual. SHALL mostrar como mínimo: email actual, nombre, empresa, rol, estado de la cuenta, fecha de alta y estado de vinculación con Telegram.

#### Scenario: Usuario abre su perfil

- **WHEN** un usuario autenticado abre `/app/profile`
- **THEN** ve sus datos de cuenta cargados desde su propia fila de `profiles`

#### Scenario: Aislamiento entre usuarios

- **WHEN** un usuario autenticado consulta `profiles` desde el panel
- **THEN** solo obtiene su propia fila

### Requirement: Edición de los campos simples del perfil

El usuario SHALL poder editar su nombre y su empresa y guardarlos en su fila de `profiles`. El guardado SHALL confirmarse visualmente y el estado mostrado en el panel SHALL reflejar el valor nuevo sin requerir recargar la página.

#### Scenario: Guardado exitoso

- **WHEN** el usuario cambia su nombre y su empresa y guarda
- **THEN** los valores quedan persistidos en su fila y la interfaz muestra la confirmación con los valores nuevos

#### Scenario: Validación de entrada

- **WHEN** el usuario intenta guardar un nombre vacío o que excede el largo permitido
- **THEN** se le indica el problema y no se ejecuta la escritura

#### Scenario: Fallo de guardado

- **WHEN** la escritura falla
- **THEN** se muestra un error comprensible, el formulario conserva lo ingresado y no se afirma que el cambio se guardó

### Requirement: Restricción de las columnas editables por el usuario

La política de actualización de `profiles` SHALL permitir al usuario modificar únicamente su nombre y su empresa. El sistema MUST NOT permitir que el usuario modifique desde el panel su rol, su estado de actividad ni su identificador de chat de Telegram.

#### Scenario: Intento de cambiar el rol

- **WHEN** una sesión del panel intenta actualizar su propio `role` a administrador
- **THEN** la operación es rechazada y el rol permanece sin cambios

#### Scenario: Intento de cambiar la vinculación de Telegram

- **WHEN** una sesión del panel intenta escribir un `telegram_chat_id` arbitrario en su fila
- **THEN** la operación es rechazada

### Requirement: Vinculación de Telegram de solo lectura

El perfil SHALL mostrar el estado de vinculación con Telegram como información de solo lectura y SHALL derivar al flujo de vinculación por código existente para modificarlo. La página MUST NOT ofrecer un campo editable de identificador de chat.

#### Scenario: Cuenta vinculada

- **WHEN** el usuario tiene vinculación activa
- **THEN** el perfil lo indica como vinculado, sin campo editable

#### Scenario: Cuenta no vinculada

- **WHEN** el usuario no tiene vinculación
- **THEN** el perfil lo indica y ofrece la vía existente de vinculación por código en lugar de un campo de edición

### Requirement: Cambio de contraseña con reautenticación

El usuario SHALL poder cambiar su contraseña desde una sección separada de "acceso y seguridad". El sistema SHALL exigir la contraseña actual antes de aplicar el cambio, y SHALL exigir confirmación de la contraseña nueva. Esta funcionalidad SHALL implementarse únicamente después de la aprobación explícita del usuario responsable, según la gobernanza HIGH declarada para el bloque de credenciales.

#### Scenario: Cambio exitoso

- **WHEN** el usuario ingresa correctamente su contraseña actual y una contraseña nueva confirmada
- **THEN** la contraseña queda cambiada y se le informa el resultado

#### Scenario: Contraseña actual incorrecta

- **WHEN** el usuario ingresa mal su contraseña actual
- **THEN** el cambio no se aplica y se le informa el motivo

#### Scenario: Confirmación no coincide

- **WHEN** la contraseña nueva y su confirmación difieren
- **THEN** no se envía ninguna solicitud de cambio

#### Scenario: Sesión abierta desatendida

- **WHEN** alguien con acceso a una sesión ya iniciada intenta cambiar la contraseña sin conocer la actual
- **THEN** no puede completar el cambio

### Requirement: Cambio de email con confirmación pendiente

El usuario SHALL poder solicitar el cambio de su email desde la sección de "acceso y seguridad". El sistema SHALL reflejar que el cambio queda **pendiente de confirmación** hasta que el flujo de confirmación de Supabase se complete, y MUST NOT presentar el email nuevo como vigente antes de esa confirmación. Esta funcionalidad SHALL implementarse únicamente después de la aprobación explícita del usuario responsable, según la gobernanza HIGH declarada.

#### Scenario: Solicitud de cambio de email

- **WHEN** el usuario solicita cambiar su email a uno nuevo válido
- **THEN** la interfaz indica que el cambio está pendiente de confirmación y sigue mostrando el email vigente como actual

#### Scenario: Abandono del flujo

- **WHEN** el usuario nunca confirma el cambio solicitado
- **THEN** su email de acceso sigue siendo el anterior y la interfaz no afirma lo contrario

#### Scenario: Consistencia con la vista de administración

- **WHEN** un cambio de email se confirma
- **THEN** el email mostrado en la administración de usuarios coincide con el email de acceso vigente

### Requirement: Separación visible entre datos de perfil y credenciales

La página SHALL separar de forma explícita el bloque de datos de perfil del bloque de acceso y seguridad, con acciones de guardado independientes. Un guardado de datos de perfil MUST NOT disparar ningún cambio de credenciales.

#### Scenario: Guardado de datos de perfil

- **WHEN** el usuario guarda su nombre y empresa
- **THEN** no se envía ninguna solicitud de cambio de email ni de contraseña

#### Scenario: Bloque de credenciales no habilitado

- **WHEN** el bloque de credenciales todavía no fue aprobado ni implementado
- **THEN** la página funciona igual para ver el perfil y editar los campos simples
