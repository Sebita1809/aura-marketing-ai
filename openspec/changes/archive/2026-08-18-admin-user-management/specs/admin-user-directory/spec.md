## ADDED Requirements

### Requirement: La sección "Gestión de Usuarios" muestra el listado de usuarios
El panel de administración SHALL exponer en `/admin/users` un listado de todos los usuarios registrados en `profiles`, accesible desde el ítem "Gestión de Usuarios" del sidebar. Esa página SHALL ser el contenido real de la sección: el listado, no un formulario de alta aislado. El acceso SHALL estar restringido a usuarios con `role = 'admin'` mediante `ProtectedRoute requiredRole="admin"`.

#### Scenario: Un admin abre la sección de usuarios
- **WHEN** un usuario con `role = 'admin'` hace click en "Gestión de Usuarios" en el sidebar
- **THEN** el navegador queda en `/admin/users` y se muestra la tabla de usuarios con una fila por perfil

#### Scenario: Un usuario común intenta entrar a la sección
- **WHEN** un usuario con `role = 'user'` navega a `/admin/users`
- **THEN** es redirigido a `/app/connections` y no ve ningún dato de otros usuarios

#### Scenario: La ruta vieja del alta sigue funcionando
- **WHEN** alguien abre `/admin/register-user` (link viejo o bookmark)
- **THEN** es redirigido a `/admin/users` sin error

### Requirement: Cada fila muestra la información identificatoria del usuario
El listado SHALL mostrar, por cada usuario: identificador, nombre completo, empresa, correo electrónico, rol (`admin` / `user`), estado (`active` / `blocked` / `deactivated`), vinculación de Telegram y fecha de alta (`created_at`). Los campos ausentes SHALL renderizarse con un marcador explícito (`—`) y nunca como cadena vacía o `undefined`.

#### Scenario: Usuario con todos los datos cargados
- **WHEN** un perfil tiene `full_name`, `company`, `email`, `role`, `status`, `telegram_chat_id` y `created_at`
- **THEN** la fila muestra los ocho valores, con el estado y el rol como etiquetas legibles

#### Scenario: Usuario con datos incompletos
- **WHEN** un perfil no tiene `company` ni vinculación de Telegram
- **THEN** esas celdas muestran `—` y la fila se renderiza sin errores

### Requirement: La columna de Telegram muestra el vínculo real que usa el bot
El listado SHALL tomar el dato de vinculación de Telegram de `profiles.telegram_chat_id` — el campo que consultan los nodos `HTTP - Chequear vinculacion` y `HTTP - Perfil publicacion` del workflow n8n. El campo `profiles.telegram_id` (texto libre cargado en el formulario de alta) NO SHALL presentarse como si fuera el chat vinculado; SHALL mostrarse únicamente en el detalle del usuario, rotulado como dato declarado en el alta.

#### Scenario: Usuario vinculado al bot
- **WHEN** un perfil tiene `telegram_chat_id` con valor
- **THEN** la columna de Telegram muestra ese valor y la fila se presenta como vinculada

#### Scenario: Usuario con telegram_id cargado pero sin vincular
- **WHEN** un perfil tiene `telegram_id` cargado en el alta pero `telegram_chat_id` en `NULL`
- **THEN** la columna de Telegram indica que el usuario no está vinculado, y el valor de `telegram_id` solo aparece en el detalle rotulado como declarado en el alta

### Requirement: El estado se muestra con tres valores distinguibles
El indicador de estado SHALL distinguir visualmente los tres estados del modelo (`active`, `blocked`, `deactivated`) con etiqueta y color propios. NO SHALL colapsar `blocked` y `deactivated` en una única etiqueta genérica ("Inactivo").

#### Scenario: Estados distintos se ven distintos
- **WHEN** el listado contiene un usuario activo, uno bloqueado y uno dado de baja
- **THEN** cada fila muestra una etiqueta distinta ("Activo", "Bloqueado", "Dado de baja") y son distinguibles entre sí sin abrir el detalle

### Requirement: Búsqueda, filtros y paginación se resuelven en el servidor
El listado SHALL consultar `profiles` con paginación por rango (`range`) y conteo total, y SHALL aplicar la búsqueda por texto (empresa, email, nombre) y los filtros por estado y por rol en la consulta al servidor, no sobre un conjunto ya descargado. El tamaño de página SHALL ser fijo y explícito. Por defecto el listado SHALL ocultar los usuarios `deactivated`, que SHALL ser visibles activando el filtro correspondiente.

#### Scenario: Paginación
- **WHEN** existen más usuarios que el tamaño de página
- **THEN** se muestra solo la página actual, junto con el total de usuarios y los controles para avanzar y retroceder

#### Scenario: Búsqueda por texto
- **WHEN** el admin escribe un término en el buscador
- **THEN** la consulta al servidor devuelve solo los usuarios cuyo nombre, empresa o email coinciden, incluidos los que no estaban en la página visible

#### Scenario: Filtro por estado
- **WHEN** el admin selecciona el filtro "Bloqueados"
- **THEN** el listado muestra únicamente usuarios con `status = 'blocked'`

#### Scenario: Los dados de baja no aparecen por defecto
- **WHEN** el admin abre la sección sin tocar los filtros
- **THEN** los usuarios con `status = 'deactivated'` no aparecen en el listado, y sí aparecen al activar el filtro "Dados de baja"

### Requirement: El listado comunica carga, error y vacío
La página SHALL mostrar un estado de carga mientras la consulta está en vuelo, un estado de error con posibilidad de reintentar cuando la consulta falla, y un estado vacío explícito cuando la consulta es exitosa pero no devuelve filas. Un fallo de consulta NO SHALL renderizarse como un listado vacío.

#### Scenario: La consulta falla
- **WHEN** la consulta a `profiles` devuelve error
- **THEN** se muestra un mensaje de error con una acción para reintentar, distinto del estado vacío

#### Scenario: Búsqueda sin resultados
- **WHEN** la búsqueda o los filtros no devuelven ningún usuario
- **THEN** se muestra un estado vacío que indica que no hay resultados para ese criterio

### Requirement: El detalle de un usuario muestra la información completa
El listado SHALL permitir abrir el detalle de un usuario, que SHALL mostrar además de las columnas de la tabla: el identificador completo, `telegram_id` rotulado como declarado en el alta, y la traza de la última transición de estado (cuándo, quién la hizo y el motivo registrado) cuando exista.

#### Scenario: Detalle de un usuario bloqueado con motivo
- **WHEN** el admin abre el detalle de un usuario cuyo estado fue cambiado con un motivo registrado
- **THEN** el detalle muestra el estado actual, la fecha del cambio, el admin que lo hizo y el motivo

#### Scenario: Detalle de un usuario sin transiciones
- **WHEN** el admin abre el detalle de un usuario que nunca cambió de estado
- **THEN** el detalle muestra la información del perfil y omite la sección de traza sin mostrar campos vacíos
