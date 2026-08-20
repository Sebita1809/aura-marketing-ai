## ADDED Requirements

### Requirement: Tabla append-only de eventos de uso

El sistema SHALL persistir cada hecho de uso como una fila nueva en `public.usage_events`, con `user_id`, `event_type`, `platform` (nullable), `status`, `source`, `event_uid`, `metadata` y `occurred_at`. Las filas SHALL ser inmutables: el sistema MUST NOT actualizar ni borrar eventos ya registrados como parte del flujo normal.

#### Scenario: Se registra un evento nuevo

- **WHEN** el workflow emite un evento de uso para un usuario existente
- **THEN** se inserta exactamente una fila nueva en `usage_events` con `occurred_at` seteado y sin modificar ninguna fila previa

#### Scenario: Usuario eliminado

- **WHEN** se elimina la fila de `profiles` de un usuario
- **THEN** sus filas de `usage_events` se eliminan en cascada

### Requirement: Contrato de tipos de evento

El sistema SHALL emitir únicamente los `event_type` del contrato: `image_generated`, `image_edited`, `post_published` y `post_scheduled`. Para `post_published` y `post_scheduled` el campo `platform` SHALL contener exactamente uno de los identificadores que ya usa el panel (`instagram`, `facebook`, `threads`, `twitter`, `linkedin`); para los eventos de imagen `platform` SHALL ser `null`. Los consumidores SHALL ignorar los `event_type` que no conozcan en vez de fallar.

#### Scenario: Generación de imagen exitosa

- **WHEN** el nodo `Generate an image` termina con éxito
- **THEN** se registra un evento `image_generated` con `platform = null` y `metadata` conteniendo el identificador del modelo

#### Scenario: Edición de imagen exitosa

- **WHEN** el nodo `Edit an image` termina con éxito
- **THEN** se registra un evento `image_edited` con `platform = null`

#### Scenario: Publicación a varias plataformas

- **WHEN** una publicación se crea con éxito en Postiz para tres plataformas seleccionadas
- **THEN** se registran tres filas `post_published`, una por plataforma, cada una con su `platform` correspondiente

#### Scenario: Publicación programada a futuro

- **WHEN** la publicación se crea con una fecha futura calculada por la rama de programación
- **THEN** se registra un evento `post_scheduled` por plataforma, con `scheduled_for` en ISO 8601 dentro de `metadata`

#### Scenario: Tipo de evento desconocido para un consumidor

- **WHEN** un consumidor lee un `event_type` que no está en su lista conocida
- **THEN** lo omite del cálculo y continúa sin error

### Requirement: Idempotencia de la emisión

Cada evento SHALL llevar un `event_uid` determinístico derivado de la ejecución que lo produjo, el nodo emisor y la plataforma. El sistema SHALL rechazar silenciosamente los duplicados mediante una restricción de unicidad sobre `event_uid`, de modo que un reintento de la misma emisión no incremente ninguna métrica.

#### Scenario: Reintento de la emisión

- **WHEN** el nodo de emisión se reintenta tras un timeout en el que la inserción ya se había aplicado
- **THEN** la segunda inserción no crea una fila nueva y el total contado por el usuario permanece igual

#### Scenario: Dos eventos legítimos del mismo tipo

- **WHEN** el usuario genera dos imágenes en dos ejecuciones distintas del workflow
- **THEN** se registran dos filas con `event_uid` distintos y el total contado es 2

### Requirement: Emisión no bloqueante

La emisión de eventos SHALL ser fire-and-forget: un fallo al registrar un evento MUST NOT interrumpir, abortar ni alterar el flujo del usuario en el bot. Los nodos de emisión SHALL continuar por su salida normal ante error.

#### Scenario: La base de eventos no responde

- **WHEN** la inserción del evento falla o expira
- **THEN** el usuario recibe igualmente su imagen o su confirmación de publicación, y el flujo continúa hasta su nodo terminal

#### Scenario: Distinción respecto de los controles de seguridad

- **WHEN** se compara el manejo de error de la emisión de eventos con el de un control de seguridad del proyecto
- **THEN** la emisión de eventos continúa ante error (fail-open) mientras los controles de seguridad siguen abortando ante error (fail-closed)

### Requirement: Ausencia de contenido del usuario en la telemetría

El sistema MUST NOT registrar en `usage_events` prompts, texto de publicaciones, nombres de archivo, URLs de medios ni ningún otro contenido generado o provisto por el usuario. `metadata` SHALL limitarse a datos técnicos (identificador de modelo, identificador de post externo, tipo de medio, fecha programada).

#### Scenario: Publicación con texto del usuario

- **WHEN** se registra un evento `post_published` de una publicación cuyo copy fue escrito por el usuario
- **THEN** la fila resultante no contiene ese texto en ninguno de sus campos

### Requirement: Aislamiento de lectura y escritura por RLS

`usage_events` SHALL exponer a los clientes autenticados únicamente sus propias filas (`user_id = auth.uid()`). El sistema MUST NOT otorgar a los roles cliente permisos de `insert`, `update` ni `delete` sobre la tabla; el único escritor SHALL ser el proceso del bot con service role.

#### Scenario: Un usuario intenta leer eventos ajenos

- **WHEN** un usuario autenticado consulta `usage_events` sin filtro
- **THEN** solo recibe las filas cuyo `user_id` coincide con el suyo

#### Scenario: Un cliente intenta insertar un evento

- **WHEN** una sesión autenticada del panel intenta insertar una fila en `usage_events`
- **THEN** la operación es rechazada por RLS

### Requirement: Reutilización por el dashboard de administración

`usage_events` SHALL ser la única fuente de verdad de métricas de uso del proyecto. Un consumidor administrativo SHALL poder derivar sus agregados de esta misma tabla y contrato, sin requerir columnas ni tipos de evento nuevos; el sistema MUST NOT introducir una segunda tabla de métricas paralela.

#### Scenario: Agregado por usuario y agregado global

- **WHEN** el panel de usuario cuenta publicaciones con `user_id = auth.uid()` y el dashboard de admin cuenta publicaciones sin ese filtro
- **THEN** ambos leen la misma tabla, los mismos `event_type` y los mismos identificadores de plataforma, y el total global es la suma de los totales por usuario
