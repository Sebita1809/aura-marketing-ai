## ADDED Requirements

### Requirement: El usuario elige cuándo se publica
El sistema SHALL presentar, después de la selección de plataformas y antes de crear el post en Postiz, un mensaje de Telegram con un inline keyboard de opciones de momento de publicación: publicar ahora, opciones rápidas relativas (por ejemplo en 1 hora, hoy a las 20:00, mañana a las 09:00) y una opción de fecha personalizada. El estado de chat SHALL pasar a `ESPERANDO PROGRAMACION`.

#### Scenario: Se ofrece el selector de momento
- **WHEN** el usuario confirma al menos una plataforma
- **THEN** el bot envía el mensaje con las opciones de publicación y guarda `estado_de_chat: "ESPERANDO PROGRAMACION"` en `chat_{chat_id}` con TTL 86400

#### Scenario: Publicar ahora
- **WHEN** el usuario elige la opción de publicar ahora
- **THEN** el sistema guarda `{ tipo: "now" }` en `programacion_{chat_id}` y el flujo continúa directamente a la subida del media y la creación del post

#### Scenario: Opción rápida relativa
- **WHEN** el usuario elige una opción rápida (por ejemplo "en 1 hora")
- **THEN** el sistema calcula la fecha resultante en el servidor, la guarda como `{ tipo: "schedule", fechaISO: <UTC ISO 8601> }` y continúa sin pedir más datos

### Requirement: Fecha y hora personalizada en horario local
El sistema SHALL permitir ingresar una fecha y hora personalizada como texto en formato `DD/MM/AAAA HH:MM`, interpretado en la zona horaria `America/Argentina/Buenos_Aires` (la misma del stack, `GENERIC_TIMEZONE` en `docker-compose.yml`), y SHALL convertirla a UTC ISO 8601 (sufijo `Z`) antes de enviarla a Postiz. El estado de chat durante este paso SHALL ser `ESPERANDO FECHA PERSONALIZADA`.

#### Scenario: Fecha válida aceptada
- **WHEN** el usuario escribe `25/12/2026 20:30` estando en `ESPERANDO FECHA PERSONALIZADA`
- **THEN** el sistema guarda `{ tipo: "schedule", fechaISO: "2026-12-25T23:30:00.000Z" }` en `programacion_{chat_id}` (UTC-3) y continúa a la publicación

#### Scenario: Formato inválido
- **WHEN** el usuario escribe un texto que no cumple el formato `DD/MM/AAAA HH:MM`
- **THEN** el bot responde con un mensaje de error que incluye un ejemplo válido, el estado se mantiene en `ESPERANDO FECHA PERSONALIZADA` y el usuario puede reintentar sin reiniciar el flujo

#### Scenario: Fecha en el pasado
- **WHEN** el usuario ingresa una fecha anterior al momento actual o a menos de 5 minutos en el futuro
- **THEN** el bot avisa que la fecha debe ser futura, el estado se mantiene y no se crea ningún post

### Requirement: La programación se delega a la API de Postiz
El sistema SHALL enviar el momento elegido en el body de `POST http://postiz:5000/api/public/v1/posts` mediante los campos `type` (`"now"` o `"schedule"`) y `date` (ISO 8601 en UTC), reemplazando los valores hoy hardcodeados `type: 'now'` y `date: new Date().toISOString()`. El sistema NO SHALL implementar un mecanismo de scheduling propio (sin nodos Cron/Schedule Trigger ni colas de espera nuevas en n8n).

#### Scenario: Publicación programada
- **WHEN** el usuario eligió una fecha futura
- **THEN** el body enviado a Postiz contiene `type: "schedule"` y `date` con la fecha en UTC, y Postiz se encarga de publicar a ese horario

#### Scenario: Publicación inmediata
- **WHEN** el usuario eligió publicar ahora
- **THEN** el body contiene `type: "now"` con la fecha actual, conservando el comportamiento anterior

#### Scenario: Sin scheduler propio
- **WHEN** se revisa el workflow después del cambio
- **THEN** no existen nodos Cron, Schedule Trigger ni Wait nuevos destinados a diferir la publicación

### Requirement: La programación persiste en Redis
El sistema SHALL guardar el resultado de la etapa de programación en la clave Redis `programacion_{chat_id}` como JSON `{ tipo, fechaISO }` con TTL 86400 s, y el nodo que arma el body SHALL leer de ahí en lugar de calcular la fecha inline.

#### Scenario: La elección sobrevive a la ejecución siguiente
- **WHEN** el usuario elige el momento en una ejecución y el post se crea en la ejecución siguiente
- **THEN** el valor de `programacion_{chat_id}` es el que se usa para `type` y `date`

#### Scenario: Clave expirada
- **WHEN** la clave `programacion_{chat_id}` no existe al momento de crear el post
- **THEN** el sistema usa `type: "now"` como fallback seguro y la publicación no queda bloqueada

### Requirement: Confirmación informativa al usuario
El mensaje de confirmación posterior a la creación del post SHALL indicar el tipo de media publicado, la lista de plataformas elegidas y, cuando la publicación sea programada, la fecha y hora **en horario local argentino**, reemplazando el texto fijo actual que asume publicación inmediata en Instagram.

#### Scenario: Confirmación de publicación programada
- **WHEN** el post se crea con `type: "schedule"` para dos plataformas
- **THEN** el usuario recibe un mensaje que nombra las dos plataformas y la fecha/hora local de publicación

#### Scenario: Confirmación de publicación inmediata
- **WHEN** el post se crea con `type: "now"`
- **THEN** el usuario recibe un mensaje que nombra las plataformas elegidas e indica que la publicación se está enviando en este momento

### Requirement: Errores de la API de Postiz visibles para el usuario
El sistema SHALL traducir los errores de creación de post de Postiz (por ejemplo HTTP 400 por body inválido, 413 por exceso de tamaño y 429 por límite de 30 requests por hora) en un mensaje de Telegram entendible, sin dejar al usuario esperando una confirmación que nunca llega.

#### Scenario: Rate limit alcanzado
- **WHEN** Postiz responde HTTP 429
- **THEN** el bot informa que se alcanzó el límite de publicaciones por hora y que reintente más tarde

#### Scenario: Body rechazado
- **WHEN** Postiz responde HTTP 400 al crear el post
- **THEN** el bot informa que la publicación no pudo crearse y el flujo vuelve al menú principal
