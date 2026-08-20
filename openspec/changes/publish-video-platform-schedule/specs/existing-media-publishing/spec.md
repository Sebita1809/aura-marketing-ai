## ADDED Requirements

### Requirement: El menú ofrece dos caminos para publicar

El sistema SHALL presentar en el menú principal (`Mensaje predeterminado`) dos opciones de publicación mutuamente excluyentes: **`Generar publicidad`** (flujo actual, la IA genera la imagen a partir del catálogo — sin cambios de comportamiento) y **`Subir publicidad existente`** (nuevo, el usuario envía contenido que ya tiene producido). La opción nueva SHALL poner el chat en estado `ESPERANDO PUBLICIDAD EXISTENTE` y SHALL pedirle al usuario una **imagen o un video**, informando los límites vigentes de tamaño y duración.

#### Scenario: El usuario elige subir contenido propio

- **WHEN** el usuario presiona `Subir publicidad existente` estando en estado `ESPERANDO RESPUESTA`
- **THEN** el bot pide una imagen o un video, informa los límites (hasta 20 MB, y hasta la duración máxima configurada en el caso de video) y guarda `estado_de_chat: "ESPERANDO PUBLICIDAD EXISTENTE"` en `chat_{chat_id}` con TTL 86400

#### Scenario: El camino de generación por IA no cambia

- **WHEN** el usuario presiona `Generar publicidad`
- **THEN** el flujo actual de carga de especificaciones y generación de imagen por IA se ejecuta exactamente como hoy, sin pasar por la rama de contenido existente

### Requirement: El bot acepta imagen o video como publicidad existente

El sistema SHALL reconocer, en el nodo de clasificación `Code in JavaScript5`, tanto `message.photo` como `message.video` (y `message.document` con `mime_type` de video o de imagen) recibidos en el estado `ESPERANDO PUBLICIDAD EXISTENTE` como el evento `resultado: "Publicidad existente"`, exponiendo el tipo de media (`tipo: "Imagen" | "Video"`) para que la rama posterior sepa qué gate de límites y qué modo de análisis aplicar. Fuera de ese estado, el media SHALL seguir clasificándose como hoy.

#### Scenario: Imagen recibida como publicidad existente

- **WHEN** el estado de chat es `ESPERANDO PUBLICIDAD EXISTENTE` y el usuario envía una foto
- **THEN** `Code in JavaScript5` devuelve `tipo: "Imagen"`, `resultado: "Publicidad existente"` y `Switch3` rutea a la rama de validación de contenido existente

#### Scenario: Video recibido como publicidad existente

- **WHEN** el estado de chat es `ESPERANDO PUBLICIDAD EXISTENTE` y el usuario envía un video
- **THEN** `Code in JavaScript5` devuelve `tipo: "Video"`, `resultado: "Publicidad existente"` y `Switch3` rutea a la misma rama de validación

#### Scenario: `message.photo` en `ESPERANDO IMAGENES` conserva su significado actual

- **WHEN** el usuario envía una foto estando en `ESPERANDO IMAGENES` (fotos de referencia del producto para el catálogo)
- **THEN** el comportamiento actual se mantiene sin cambios (`tipo: "Imagen"`, `resultado: "Imagen de informacion"`, la foto se acumula en la lista `fotos_{chat_id}`), NO se aplica el gate de moderación y NO se publica nada

#### Scenario: Media fuera de contexto

- **WHEN** el usuario envía una foto o un video en un estado que no contempla media (por ejemplo `ESPERANDO RESPUESTA`)
- **THEN** el resultado es `Acciones no permitidas` y el bot reenvía el último mensaje sin procesar el archivo

### Requirement: Límites de tamaño y duración validados antes de descargar

El sistema SHALL validar los metadatos del media tomados del payload del `Telegram Trigger`, **antes** de llamar a `getFile`: para video, `message.video.file_size` y `message.video.duration`; para imagen, el `file_size` del tamaño seleccionado de `message.photo`. SHALL rechazar el media cuando supere **20 MB** (límite duro de descarga de la Bot API de Telegram) o, solo en el caso de video, la duración máxima configurada (por defecto 90 s), notificando al usuario y sin descargar el binario ni invocar al modelo de moderación.

#### Scenario: Video demasiado grande

- **WHEN** el usuario envía un video con `file_size` mayor a 20 MB
- **THEN** el bot informa que el video excede el límite, no ejecuta la descarga ni el análisis, y el flujo no continúa a la publicación

#### Scenario: Video demasiado largo

- **WHEN** el usuario envía un video con `duration` mayor a la duración máxima configurada
- **THEN** el bot informa el límite de duración y el flujo no continúa

#### Scenario: Imagen demasiado grande

- **WHEN** el usuario envía una imagen cuyo `file_size` supera los 20 MB
- **THEN** el bot informa el límite y el flujo no continúa; el gate de duración NO se evalúa para imágenes

#### Scenario: Media dentro de los límites

- **WHEN** el media está por debajo de los límites que le corresponden a su tipo
- **THEN** el flujo continúa a la descarga del binario y al gate de moderación

### Requirement: Gate de moderación de contenido con IA para todo media subido por el usuario

El sistema SHALL analizar **todo media subido por el usuario en la rama de publicidad existente — imagen y video por igual** — con un modelo de IA (nodo Google Gemini: `resource: video` con la operación de análisis de video para videos, `resource: image` con la operación de análisis de imagen para imágenes), usando el mismo prompt de clasificación de violaciones de políticas de redes sociales (contenido sexual, drogas, violencia/sangre, discurso de odio, actividad ilegal y contenido prohibido en general) y SHALL exigir una respuesta JSON con la forma `{"apto": boolean, "categoria": string, "motivo": string}`. Ningún media subido por el usuario SHALL ser subido a Postiz sin un veredicto `apto: true`.

#### Scenario: Video apto continúa el flujo

- **WHEN** el análisis de un video devuelve `{"apto": true, "categoria": "ninguna", ...}`
- **THEN** el `file_id` y el tipo de media se guardan en Redis `media_existente_{chat_id}` con TTL 86400 y el flujo continúa a la etapa de descripción

#### Scenario: Imagen subida apta continúa el flujo

- **WHEN** el análisis de una imagen subida por el usuario devuelve `{"apto": true, ...}`
- **THEN** el `file_id` y el tipo de media se guardan en Redis `media_existente_{chat_id}` con TTL 86400 y el flujo continúa a la etapa de descripción, con el mismo embudo (descripción → plataformas → cuándo) que el video

#### Scenario: Media que viola políticas es rechazado

- **WHEN** el análisis devuelve `apto: false` con una categoría de violación, sea sobre una imagen o sobre un video
- **THEN** el bot envía un mensaje de rechazo con la categoría y el motivo, el media NO se sube a Postiz, no se crea ningún post, y el flujo vuelve al menú principal

#### Scenario: La imagen generada por la IA no pasa por este gate

- **WHEN** la imagen a publicar proviene de `Generate an image` o `Edit an image`
- **THEN** la cadena de publicación NO ejecuta el gate de moderación (es contenido que el propio bot controla vía prompt) y el flujo de generación conserva su latencia actual

#### Scenario: La IA no genera ni modifica el media del usuario

- **WHEN** un media subido por el usuario es aprobado por el gate
- **THEN** el binario que se sube a Postiz es exactamente el que el usuario envió: sin re-encoding, sin recorte, sin generación de contenido y **sin marca de agua** (la marca de agua de IA aplica solo a imágenes generadas por el bot)

### Requirement: Política fail-closed del gate de moderación

El sistema SHALL rechazar el media cuando el análisis no pueda completarse: error del nodo de IA, timeout, respuesta vacía o respuesta que no pueda parsearse como el JSON esperado. Los nodos de análisis (imagen y video) SHALL declarar `onError: "continueErrorOutput"` como propiedad del nodo (hermana de `parameters`, nunca dentro de `parameters`) y sus salidas de error SHALL converger en la rama de rechazo.

#### Scenario: El modelo falla o no responde

- **WHEN** el nodo de análisis (de imagen o de video) devuelve error o supera su timeout
- **THEN** el flujo toma la salida de error, el usuario recibe un mensaje de que el contenido no pudo verificarse y no será publicado, y no se ejecuta ninguna llamada a Postiz

#### Scenario: Respuesta no parseable

- **WHEN** el modelo devuelve texto que no es un JSON válido con el campo `apto`
- **THEN** el nodo de parseo devuelve `apto: false` y el flujo toma la rama de rechazo

### Requirement: Persistencia del media existente en Redis

El sistema SHALL guardar el media aprobado en la clave Redis `media_existente_{chat_id}` como JSON `{ "tipo": "imagen"|"video", "file_id": "<file_id de Telegram>" }` con TTL 86400 s, conforme a la convención del change `redis-expiration`, y la cadena de publicación SHALL usar esa clave para decidir qué media publicar.

#### Scenario: Clave escrita con expiración

- **WHEN** un media es aprobado por el gate de moderación
- **THEN** `media_existente_{chat_id}` se escribe con `expire: true` y `ttl: 86400`, y contiene el tipo y el `file_id`

#### Scenario: Sin media existente, se publica la imagen generada

- **WHEN** la clave `media_existente_{chat_id}` no existe al momento de publicar
- **THEN** la cadena usa la imagen generada por la IA (`publicidad_{chat_id}`), como hoy

### Requirement: Subida del media existente a Postiz y referencia en el post

El sistema SHALL subir el binario aprobado a `POST http://postiz:5000/api/public/v1/upload` (multipart, campo `file`, autenticación por Header Auth de n8n) mediante un nodo propio con timeout ampliado, y SHALL referenciar el `{id, path}` devuelto dentro del array `value[0].image[]` del body de `POST /api/public/v1/posts` — el mismo array se usa para imagen y para video, dado que la API de Postiz no expone un campo `video` separado.

#### Scenario: Media subido y publicado

- **WHEN** el media aprobado se sube correctamente y Postiz devuelve `{id, path}`
- **THEN** el body del post incluye `value: [{ content: <descripcion>, image: [{ id, path }] }]` con esos valores y Postiz acepta la publicación

#### Scenario: Una publicación lleva un solo media

- **WHEN** existe la clave Redis `media_existente_{chat_id}` para el chat en curso
- **THEN** la cadena de publicación usa ese media y no adjunta además la imagen generada por el bot

#### Scenario: Falla la subida

- **WHEN** la subida a Postiz devuelve error (por ejemplo HTTP 413 por exceso de tamaño de body, o 5xx)
- **THEN** el usuario recibe un mensaje de error entendible y no se crea ningún post

### Requirement: Sin secretos en texto plano en el workflow

Los nodos nuevos que llamen a Postiz o a Gemini SHALL usar credenciales de n8n (Header Auth / credencial de Gemini) y NO SHALL contener tokens, API keys ni ids reales de credencial en texto plano dentro de `codigo.json`, conforme a `docs/secret-sanitization-procedure.md` (el repositorio es público).

#### Scenario: Revisión previa al commit

- **WHEN** se exporta `codigo.json` con los nodos nuevos
- **THEN** ningún nodo nuevo contiene tokens ni ids de credencial reales, y los valores sensibles quedan como placeholders
