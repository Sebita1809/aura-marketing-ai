## ADDED Requirements

### Requirement: El estado del usuario es un control de acceso efectivo, no una etiqueta
Un usuario con `status` distinto de `active` SHALL perder el acceso a todas las superficies del producto: sesión de Supabase Auth, panel web y bot de Telegram. El estado NO SHALL quedar como un indicador visual sin efecto, como ocurría con `is_active` antes de este change.

#### Scenario: Usuario bloqueado pierde acceso en las tres superficies
- **WHEN** un usuario activo, con sesión abierta y vinculado al bot, es bloqueado
- **THEN** deja de poder iniciar sesión, deja de poder usar el panel y deja de ser atendido por el bot

#### Scenario: Usuario dado de baja pierde acceso en las tres superficies
- **WHEN** un usuario es dado de baja
- **THEN** deja de poder iniciar sesión, deja de poder usar el panel y deja de ser atendido por el bot

### Requirement: El panel expulsa al usuario cuyo estado no es activo
El contexto de autenticación del frontend SHALL incluir el estado del propio usuario entre los campos que lee de su perfil, y la protección de rutas SHALL impedir el acceso a cualquier ruta protegida cuando ese estado no sea `active`, redirigiendo al inicio de sesión con un mensaje que indique que la cuenta no está activa. Esta verificación SHALL existir aunque la revocación de sesión en Auth ya haya sido aplicada.

#### Scenario: Sesión viva de un usuario bloqueado
- **WHEN** un usuario con la aplicación abierta es bloqueado y navega a otra ruta protegida
- **THEN** es redirigido al inicio de sesión y se le informa que su cuenta no está activa

#### Scenario: Usuario activo no se ve afectado
- **WHEN** un usuario con `status = 'active'` navega por el panel
- **THEN** su experiencia no cambia respecto del comportamiento anterior a este change

### Requirement: Las políticas de acceso a `profiles` están declaradas y versionadas
El acceso a `profiles` SHALL estar gobernado por políticas de seguridad a nivel de fila declaradas en una migración versionada del repositorio: un administrador activo SHALL poder leer todos los perfiles; un usuario común SHALL poder leer únicamente el propio; ningún usuario SHALL poder modificar su propio `status`, `role` ni las columnas de traza desde el cliente.

#### Scenario: Admin lee el listado completo
- **WHEN** un admin activo consulta `profiles` desde el panel
- **THEN** obtiene todos los perfiles

#### Scenario: Usuario común no puede leer perfiles ajenos
- **WHEN** un usuario con `role = 'user'` consulta `profiles`
- **THEN** obtiene únicamente su propio perfil

#### Scenario: Un usuario no puede auto-promoverse ni auto-activarse
- **WHEN** un usuario intenta modificar su propio `status` o su propio `role` desde el cliente
- **THEN** la operación es rechazada por la política de acceso

### Requirement: El bot de Telegram solo atiende a usuarios activos
Los nodos del workflow n8n que resuelven el perfil a partir del chat de Telegram (`HTTP - Chequear vinculacion` y `HTTP - Perfil publicacion`) SHALL filtrar por estado activo en su consulta a `profiles`, de modo que un chat asociado a un usuario bloqueado o dado de baja no resuelva ningún perfil. El resto del workflow NO SHALL modificarse: el caso "sin perfil" ya está contemplado aguas abajo y SHALL reutilizarse.

#### Scenario: Usuario activo sigue operando el bot
- **WHEN** un usuario con `status = 'active'` y vinculado escribe al bot
- **THEN** el flujo resuelve su perfil y el bot responde igual que antes de este change

#### Scenario: Usuario bloqueado escribe al bot
- **WHEN** un usuario con `status = 'blocked'` escribe al bot desde su chat vinculado
- **THEN** la consulta no devuelve perfil y el flujo toma el camino ya existente de chat no vinculado, sin publicar ni procesar contenido

#### Scenario: Usuario dado de baja escribe al bot
- **WHEN** un usuario con `status = 'deactivated'` escribe al bot
- **THEN** la consulta no devuelve perfil, tanto por el filtro de estado como porque su vínculo fue liberado

#### Scenario: El desbloqueo restituye la atención del bot
- **WHEN** un usuario bloqueado es desbloqueado y vuelve a escribir al bot
- **THEN** su perfil vuelve a resolverse y el bot lo atiende sin necesidad de volver a vincular

### Requirement: El bot no revela el estado de una cuenta a un chat no autenticado
El mensaje que recibe un usuario bloqueado o dado de baja SHALL ser el mismo que recibe un chat no vinculado, y NO SHALL informar que la cuenta está bloqueada, dada de baja o que existe. El detalle del estado SHALL estar disponible únicamente para los administradores en el panel.

#### Scenario: Mensaje recibido por un usuario bloqueado
- **WHEN** un usuario bloqueado escribe al bot
- **THEN** recibe el mismo mensaje que un chat sin vincular, sin mención del estado de su cuenta

#### Scenario: El admin sí ve el estado real
- **WHEN** el admin consulta al usuario en el panel
- **THEN** ve el estado real, la fecha del cambio, quién lo hizo y el motivo registrado
