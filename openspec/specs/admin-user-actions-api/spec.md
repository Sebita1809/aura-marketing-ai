## ADDED Requirements

### Requirement: Las transiciones de estado se ejecutan en una Edge Function privilegiada
El sistema SHALL exponer una Edge Function `admin-user-status` que reciba `user_id`, `action` (`block` | `unblock` | `deactivate` | `reactivate`) y un `reason` opcional, y que sea el **único** camino por el que el panel cambia el estado de un usuario. El panel NO SHALL cambiar el estado con un `UPDATE` directo sobre `profiles` desde el cliente, porque un `UPDATE` de cliente no puede revocar la sesión de Supabase Auth del usuario afectado. La función SHALL seguir el patrón de las Edge Functions existentes del proyecto (manejo de `OPTIONS` con cabeceras CORS y respuesta JSON con `success`).

#### Scenario: Transición válida solicitada por un admin
- **WHEN** un admin autenticado invoca la función con un `user_id` existente y una acción válida para el estado actual de ese usuario
- **THEN** la función responde éxito con el estado resultante y el perfil queda con ese estado

#### Scenario: Petición malformada
- **WHEN** la solicitud no incluye `user_id` o incluye una `action` fuera del conjunto permitido
- **THEN** la función responde error sin modificar ningún dato

#### Scenario: Preflight CORS
- **WHEN** el navegador envía la petición `OPTIONS` previa
- **THEN** la función responde con las cabeceras CORS y sin ejecutar ninguna acción

### Requirement: Toda operación privilegiada verifica que el llamador es admin
Tanto `admin-user-status` como `create-user` SHALL verificar, antes de producir cualquier efecto, que quien las invoca está autenticado y tiene `role = 'admin'` en `profiles`. La verificación SHALL resolver la identidad del llamador a partir del JWT recibido en la cabecera `Authorization` y SHALL leer el rol desde `profiles` con credenciales de servicio. El rol declarado en el cuerpo de la petición o en los metadatos del token NO SHALL usarse como base para autorizar. Ambas funciones SHALL implementar exactamente la misma verificación.

#### Scenario: Llamador no autenticado
- **WHEN** se invoca cualquiera de las dos funciones sin un JWT válido
- **THEN** la función responde error de autorización y no crea ni modifica nada

#### Scenario: Llamador autenticado sin rol admin
- **WHEN** un usuario con `role = 'user'` invoca `create-user` pidiendo crear una cuenta con `role: "admin"`
- **THEN** la función rechaza la petición, no crea ningún usuario en Auth ni ningún perfil, y no revela información sobre otros usuarios

#### Scenario: Llamador admin
- **WHEN** un usuario con `role = 'admin'` invoca cualquiera de las dos funciones
- **THEN** la operación procede según su contrato

#### Scenario: Rol inválido en el cuerpo del alta
- **WHEN** un admin invoca `create-user` con un `role` fuera de `admin` / `user`
- **THEN** la función rechaza la petición sin crear nada

### Requirement: Bloquear y dar de baja revocan el acceso en Supabase Auth
Al aplicar `block` o `deactivate`, la función SHALL impedir nuevos inicios de sesión del usuario afectado y SHALL invalidar su sesión vigente usando la API administrativa de Auth con credenciales de servicio. Al aplicar `unblock` o `reactivate`, SHALL levantar esa restricción. La API concreta de la versión desplegada SHALL verificarse contra el entorno real antes de darla por implementada.

#### Scenario: Usuario bloqueado no puede volver a entrar
- **WHEN** un usuario es bloqueado y luego intenta iniciar sesión con sus credenciales
- **THEN** el inicio de sesión es rechazado

#### Scenario: Sesión vigente deja de servir
- **WHEN** un usuario con sesión abierta es bloqueado
- **THEN** su sesión deja de ser válida sin esperar a que expire el token

#### Scenario: Desbloqueo restituye el acceso
- **WHEN** un usuario bloqueado es desbloqueado
- **THEN** puede volver a iniciar sesión con sus credenciales

### Requirement: El estado del perfil y el acceso en Auth no quedan inconsistentes
Si la aplicación del efecto en Supabase Auth falla, la función SHALL revertir el cambio de estado en `profiles` o responder error dejando el sistema en un estado consistente. La función NO SHALL responder éxito cuando el usuario figura bloqueado en `profiles` pero conserva la capacidad de iniciar sesión.

#### Scenario: Falla la revocación de acceso
- **WHEN** el estado se escribió en `profiles` pero la operación sobre Auth falla
- **THEN** la función responde error y el estado del perfil no queda marcado como bloqueado sin que el acceso esté efectivamente revocado

### Requirement: Cada transición registra su traza mínima
Al aplicar una transición efectiva, la función SHALL registrar en el perfil afectado el momento del cambio, el identificador del admin que lo ejecutó y el motivo recibido cuando exista. Esa traza SHALL quedar disponible para mostrarse en el detalle del usuario.

#### Scenario: Bloqueo con motivo
- **WHEN** un admin bloquea a un usuario indicando un motivo
- **THEN** el perfil queda con la fecha del cambio, el identificador del admin y el motivo registrados

#### Scenario: Bloqueo sin motivo
- **WHEN** un admin ejecuta una transición sin indicar motivo
- **THEN** se registran la fecha y el admin, y el motivo queda vacío sin bloquear la operación

### Requirement: Las salvaguardas de administración se aplican en el servidor
La función SHALL rechazar la petición cuando el `user_id` objetivo sea el del propio llamador y la acción sea `block` o `deactivate`, y cuando el objetivo sea el único usuario con `role = 'admin'` y `status = 'active'`. Estas verificaciones SHALL ejecutarse aunque la interfaz ya no ofrezca esas acciones.

#### Scenario: Auto-bloqueo por API
- **WHEN** un admin invoca la función con su propio `user_id` y acción `block` o `deactivate`
- **THEN** la función responde error y no modifica nada

#### Scenario: Último admin por API
- **WHEN** se invoca la función para bloquear o dar de baja al único admin activo
- **THEN** la función responde error y el sistema conserva al menos un admin activo

### Requirement: Los errores no filtran información hacia llamadores no autorizados
Las respuestas de error SHALL ser suficientes para que un admin entienda qué falló, y NO SHALL revelar a un llamador no autorizado la existencia, el estado o los datos de otros usuarios.

#### Scenario: Usuario inexistente consultado por un no admin
- **WHEN** un llamador sin rol admin invoca la función con un `user_id` cualquiera
- **THEN** la respuesta es de autorización y no distingue si ese usuario existe o no

#### Scenario: Usuario inexistente consultado por un admin
- **WHEN** un admin invoca la función con un `user_id` que no existe
- **THEN** la respuesta indica que el usuario no fue encontrado
