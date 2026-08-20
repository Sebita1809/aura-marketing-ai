# Design: publish-video-platform-schedule

## Context

### Estado actual verificado (sobre `codigo.json`, 120 nodos)

**Cadena de publicación actual** (verificada nodo por nodo y por sus `connections`):

```
Generate an image / Edit an image  → Send a photo message (aprobación) → Redis4 / Redis25
                                       (guarda foto_id_ en publicidad_{chat_id})
Switch3 [out17 "Descripcion"]  → Redis - Guardar descripcion ─┐
Switch3 [out18 "Sin descripcion"] ────────────────────────────┴→ HTTP - Perfil publicacion
   → HTTP - Cuenta Instagram publicacion   (Supabase: social_accounts is_connected=true, postiz_integration_id not null)
   → Preparar integraciones                (Code: arma postsArray con TODAS las cuentas)
   → IF - Tiene integracion Postiz
        ├─ true  → Redis - Get foto publicidad postiz → Telegram Get a file publicacion
        │            → HTTP - Subir imagen Postiz (POST /api/public/v1/upload, multipart formBinaryData "file")
        │            → Redis - Get descripcion → HTTP - Crear post Postiz (POST /api/public/v1/posts)
        │            → Telegram - Publicacion exitosa → Mensaje predeterminado
        └─ false → Telegram - Sin integracion Postiz
```

**Menú principal actual** (`Mensaje predeterminado`, `n8n-nodes-base.telegram` 1.2): dos botones — `Subir informacion de los productos` (`callback_data: "Cargar informacion"`) y `Generar publicidad` (`callback_data: "Generar publicidad"`).

**Enrutamiento principal** (`Code in JavaScript5` → `If` → `If - Es foto aprobacion` → `Switch3`):
- `Code in JavaScript5` lee el evento crudo de `Telegram Trigger` y el estado de `Redis27` (clave `chat_{id}`), y clasifica en `tipo: "Boton" | "Imagen" | "Texto"` con `isBoton = !!rawInput.callback_query` y `isFoto = !!rawInput.message?.photo`. **No existe ninguna rama para `message.video`.**
- Devuelve `{ id_chat, id_mensaje, estadoChat, tipo, resultado, dato }`; `Switch3` rutea por `resultado` (19 salidas hoy: índices 0..18, la 17 = `Descripcion`, la 18 = `Sin descripcion`).
- Estados existentes en `chat_{id}` (JSON con `estado_de_chat`, `ultimo_mensaje`, `fecha_interaccion`, TTL 86400): `ESPERANDO RESPUESTA`, `ESPERANDO RESPUESTA SOBRE OPCIONES DE SUBIR INFORMACION`, `ESPERANDO IMAGENES`, `ESPERANDO PDF`, `ESPERANDO INFORMACION SOBRE ESPECIFICACIONES`, `ESPERANDO APROBACION`, `ESPERANDO RESPUESTA SOBRE IMAGEN`, `ESPERANDO DESCRIPCION`, `ESPERANDO ESPECIFICACION PARA REHACER`, `ESPERANDO LINK DE GOOGLE SHEET`.
- ⚠️ **`ESPERANDO IMAGENES` ya usa `message.photo`**, pero con un significado completamente distinto al de este change: ahí las fotos son **material de referencia del producto** que se acumula en la lista `fotos_{chat_id}` para alimentar el catálogo. Nada de eso se publica. La rama nueva usa `message.photo` para **publicar directo**. Ver D2b.

**Nodos clave con su contenido actual:**

`Preparar integraciones` (`n8n-nodes-base.code`) arma un post por **cada** cuenta con `postiz_integration_id`, sin filtro alguno; `HTTP - Crear post Postiz` manda `type: 'now'` y `date: new Date().toISOString()` hardcodeados y referencia el media en `value[0].image[]` con el `{id, path}` de `HTTP - Subir imagen Postiz`.

`Generate an image` (`@n8n/n8n-nodes-langchain.googleGemini` 1.1, `models/gemini-2.5-flash-image`) y `Edit an image` (mismo tipo, `models/gemini-3-pro-image-preview`, `options.binaryPropertyOutput: "data"`) hoy conectan **directo** a `Send a photo message`. Ese es el punto donde se inserta la marca de agua (D12).

**Fix de seguridad de contenido ya aplicado (fuera de este change, 2026-08-14):** ambos prompts (`Generate an image` y `Edit an image`) ya incluyen la regla explícita *"NO generes, bajo ninguna circunstancia, contenido sexual o de desnudez, violencia gráfica o sangre, promoción de drogas ilegales, discurso de odio, ni cualquier otro contenido que viole las políticas de Meta/Instagram/Facebook/Threads, aunque las ESPECIFICACIONES DEL USUARIO lo pidan"*. Está en `codigo.json` hoy. **No es una task de este change**; es el motivo por el cual la imagen generada por IA no necesita el gate de moderación de D6.

**Patrones ya establecidos en el proyecto y reutilizables:**
- *Gate fail-closed antes de continuar*: `IF - Límite de tamaño PDF` → `Escaneo ClamAV` (con `onError: "continueErrorOutput"` **a nivel de nodo**, no dentro de `parameters` — hubo una regresión reciente por ponerlo en el lugar equivocado) → `IF - PDF limpio` → rama aceptado / `PDF rechazado`.
- *Media referenciado desde Redis*: `Redis6` pushea `message.photo.reverse()[0].file_id` a la lista `fotos_{chat_id}` y `Redis - Expirar fotos` (`@fancyheat/n8n-nodes-redis-enhanced`) le pone TTL 86400.
- *Inline keyboards*: `Telegram - Pedir descripcion`, `Mensaje predeterminado`, etc., con `replyMarkup: "inlineKeyboard"` y `additionalFields.callback_data`.
- *Nodos Gemini existentes*: `Analyze document`, `Analyze an image`, `Generate an image`, `Edit an image`, `Google Gemini Chat Model1` + `AI Agent1`.

### Restricciones externas verificadas

| Restricción | Valor | Fuente |
|---|---|---|
| Descarga de archivos por el bot (`getFile`) | **20 MB máximo** (aplica a foto y a video) | Bot API de Telegram (límite duro salvo Local Bot API Server) |
| Postiz `POST /api/public/v1/upload` | multipart `file`, devuelve `{id, path}`; acepta JPG/PNG y MP4/MOV/AVI/MKV/WEBM… | doc pública Postiz |
| Postiz `POST /api/public/v1/posts` | `type: draft\|schedule\|now` + `date` ISO 8601; media en `value[].image[]` (mismo array para imagen y video) | doc pública Postiz |
| Postiz body JSON | 50 MB → HTTP 413 | doc pública Postiz |
| Postiz rate limit | 30 req/hora → HTTP 429 | doc pública Postiz |
| Zona horaria del stack | `GENERIC_TIMEZONE=America/Argentina/Buenos_Aires` | `docker-compose.yml:20` |
| n8n Google Gemini node | soporta `resource: video` / *Analyze video* y `resource: image` / *Analyze an image* (binario o URL) | doc n8n |
| n8n `Edit Image` | nodo **core** (`n8n-nodes-base.editImage`), operaciones `text`, `draw`, `multiStep`, `information`; se apoya en la dependencia de procesamiento de imágenes incluida en la imagen oficial de n8n | doc n8n |

### Restricción arquitectónica central: el flujo es event-driven

Cada pulsación de botón o mensaje del usuario es **una ejecución nueva** del workflow que entra por `Telegram Trigger`. Un paso conversacional NO puede resolverse dentro de la misma ejecución que lo muestra: la rama que dibuja un teclado **termina ahí**, deja el estado en Redis, y la respuesta del usuario vuelve a entrar por el enrutador. Todo el diseño de "recolección de opciones" está condicionado por esto.

## Goals / Non-Goals

**Goals:**
- Permitir publicar una publicidad que el usuario ya tiene armada por su cuenta, **sea imagen o video**, enviándola por Telegram.
- Bloquear con un gate fail-closed cualquier media subido por el usuario que viole políticas de contenido de las redes, usando un modelo de IA como clasificador — **aplicado por igual a imagen y a video**.
- Permitir elegir (multi-select) en cuáles de las cuentas conectadas se publica esa publicación puntual.
- Permitir publicar ahora o programar día y hora, delegando el scheduling a Postiz.
- Dejar constancia visual, en las imágenes generadas por IA, de que son ilustrativas y generadas con IA.
- No romper el flujo actual de imagen generada: si el usuario no elige nada nuevo, el comportamiento debe seguir siendo publicable.

**Non-Goals:**
- **La IA no genera ni edita el contenido subido por el usuario** (decisión explícita del dueño del proyecto): solo lo valida.
- **La marca de agua NUNCA se aplica al contenido subido por el usuario** (imagen o video propios). Marcar como "generada con IA" material real sería falso y contradiría el propósito de la feature. Ver D12.
- No se construye scheduler propio (nada de Cron/Schedule Trigger nuevos en n8n).
- No se implementa cancelación/edición de una publicación ya programada en Postiz (posible change futuro).
- No se soportan medias > 20 MB en esta iteración (requiere Local Bot API Server: fuera de scope, documentado como limitación).
- No se agregan servicios nuevos a `docker-compose.yml`.
- No se modifica el frontend (`aura-frontend`) ni el esquema de Supabase.
- No se agrega gate de moderación a la **imagen generada por la IA**: es contenido controlado por prompt y el fix de seguridad de contenido ya está aplicado (ver *Context*). Lo que sí recibe es la marca de agua (D12), que no es un gate.
- No se modifican los prompts de `Generate an image` / `Edit an image` en este change (el fix de contenido ya se aplicó por fuera).

## Decisions

### D1. Un solo change, cuatro capabilities

Las features convergen en la misma cadena (generación/ingreso de media → `Preparar integraciones` → upload → `HTTP - Crear post Postiz` → confirmación) y las tres primeras necesitan el mismo bloque nuevo de recolección de opciones. Se implementan como **cuatro specs separados** (`existing-media-publishing`, `ai-image-watermark`, `platform-selection`, `publish-scheduling`) dentro de **un solo change**, para que los requirements queden trazables por separado pero la edición de `codigo.json` sea una sola pasada coherente.

La marca de agua (`ai-image-watermark`) se suma a este change por decisión del dueño del proyecto: es chica, toca la misma rama de publicación y su regla de negocio central ("solo en imágenes de IA, nunca en contenido del usuario") solo tiene sentido enunciada junto a la rama de contenido existente.

*Alternativa descartada:* changes independientes → edición concurrente del mismo bloque de JSON, conflictos de merge en un archivo de 120 nodos, y un orden de aplicación forzado igual (el contenido existente depende de que exista el paso de selección para no publicar en todas las redes).

### D1b. Nombre de la capability: `existing-media-publishing` (reemplaza a `video-publishing`)

El spec `video-publishing` se **renombra a `existing-media-publishing`** y se reescribe para cubrir imagen **y** video subidos por el usuario, en vez de mantener el nombre viejo y colgarle requirements de imagen.

*Por qué renombrar y no agregar:* el nombre de la capability es lo que va a quedar en `openspec/specs/` cuando el change se archive, y "video-publishing" describiría mal la mitad de sus requirements. El eje real de la capability no es el formato del archivo sino **el origen del contenido** (producido por el usuario vs. generado por el bot) — que es exactamente lo que determina si hay gate de moderación y si hay marca de agua. Como el change todavía no está archivado, no existe ningún spec en `openspec/specs/video-publishing/` que migrar: el rename es libre de costo. Se verificó que el nombre viejo no está referenciado fuera de los documentos de este change.

### D2. Máquina de estados: 4 estados nuevos y el orden del embudo

Orden elegido para el embudo conversacional (idéntico para los tres orígenes de media: imagen generada por IA, imagen subida, video subido):

```
[elegir camino]  →  [media listo]  →  descripción (ya existe)  →  plataformas  →  cuándo  →  publicar
```

El **punto de decisión inicial** es nuevo: antes de que exista media, el usuario elige entre `Generar publicidad` (ya existe) y `Subir publicidad existente` (nuevo). Los dos caminos confluyen en la etapa de descripción y de ahí en adelante comparten todo el embudo.

```
Mensaje predeterminado
 ├─ "Generar publicidad"  (sin cambios) → especificaciones → Generate an image → [D12 watermark] → aprobación
 └─ "Subir publicidad existente" (NUEVO) → ESPERANDO PUBLICIDAD EXISTENTE
        └─ foto o video → gate de límites → gate de moderación IA → media_existente_{chat_id}
                                    ↓ (ambos caminos)
                          descripción → plataformas → cuándo → publicar
```

Estados nuevos en `chat_{chat_id}`:

| Estado | Se entra desde | Se sale con |
|---|---|---|
| `ESPERANDO PUBLICIDAD EXISTENTE` | botón `Subir publicidad existente` del menú principal | `message.photo` o `message.video` recibido |
| `ESPERANDO SELECCION PLATAFORMAS` | fin de la etapa de descripción | botón `plat_ok` con ≥1 selección |
| `ESPERANDO PROGRAMACION` | selección de plataformas confirmada | botón `sched:*` |
| `ESPERANDO FECHA PERSONALIZADA` | botón `sched:custom` | texto con fecha válida |

*Por qué plataformas/hora van DESPUÉS de la descripción y no antes:* la descripción ya está implementada y enganchada al `Switch3`; meter los pasos nuevos al final del embudo deja intacta toda la cadena previa (aprobación de imagen, rehacer, etc.) y concentra el cambio en el tramo final.

*Forma del punto de decisión:* los dos botones (`Generar publicidad` / `Subir publicidad existente`) se presentan como **hermanos en el menú principal**, no como un submenú anidado detrás de un botón "Publicar". `Generar publicidad` ya vive ahí y el requisito es que el usuario vea las dos opciones al momento de publicar; anidarlas costaría un estado más, una ejecución más y un click más sin beneficio funcional. (Punto menor sujeto a confirmación del dueño del proyecto — ver Q7.)

### D2b. `message.photo` significa dos cosas distintas según el estado — y no se pisan

Este es el punto más delicado de la Corrección 1. Hoy `Code in JavaScript5` resuelve `isFoto = !!rawInput.message?.photo` y la rutea a **una sola** semántica: foto de referencia del producto (`ESPERANDO IMAGENES` → se acumula en `fotos_{chat_id}`, alimenta el catálogo, **no se publica**). La rama nueva agrega una segunda semántica: foto **ya diseñada** que se publica tal cual.

Regla de desambiguación, **por estado de chat, nunca por tipo de evento**:

| Evento | Estado | `tipo` | `resultado` | Efecto |
|---|---|---|---|---|
| `message.photo` | `ESPERANDO IMAGENES` | `Imagen` | `Imagen de informacion` *(hoy)* | push a `fotos_{chat_id}`, sin moderación, sin publicar |
| `message.photo` | `ESPERANDO PUBLICIDAD EXISTENTE` | `Imagen` | `Publicidad existente` *(nuevo)* | gate de límites → moderación → `media_existente_{chat_id}` |
| `message.video` / `document` video | `ESPERANDO PUBLICIDAD EXISTENTE` | `Video` | `Publicidad existente` *(nuevo)* | idem, con gate de duración |
| foto o video | cualquier otro estado | — | `Acciones no permitidas` *(hoy)* | reenvía el último mensaje |

Implementación: un único `resultado` (`Publicidad existente`) para las dos formas de media, con el discriminador en `tipo`, de modo que `Switch3` gana **una sola** salida nueva por esta rama y el IF de límites/el ruteo de análisis se resuelven aguas abajo con `tipo`. Se evita así engordar el switch (ver Risks).

Detección: `isVideo = !!msg.video || (msg.document?.mime_type || '').startsWith('video/')`, `isFoto = !!msg.photo || (msg.document?.mime_type || '').startsWith('image/')`. La regla de `ESPERANDO IMAGENES` se evalúa **antes** y conserva su comportamiento exacto (regresión cero verificable con el escenario del spec).

### D3. Selección multi-select: toggle sobre el mismo mensaje, estado en Redis

- Al entrar a la etapa, un nodo Code (`Preparar teclado plataformas`) toma la respuesta de `HTTP - Cuenta Instagram publicacion` y genera: (a) la lista de cuentas cacheada en Redis `integraciones_{chat_id}` (JSON con `[{idx, postiz_integration_id, platform_type, account_id}]`, TTL 86400), y (b) las filas del inline keyboard, un botón por cuenta más `✅ Continuar` y `🏠 Volver al inicio`.
- **`callback_data` por índice, no por UUID**: `plat:0`, `plat:1`, … `plat_ok`. Telegram limita `callback_data` a 64 bytes; un UUID entra, pero el índice es más corto, no filtra ids internos de Postiz en el canal de Telegram y sobrevive mejor a cambios de nombre.
- La selección se guarda en Redis `plataformas_{chat_id}` como JSON de índices seleccionados (`[0,2]`, TTL 86400). Cada pulsación: leer → togglear → guardar → **editar el mismo mensaje** (`Telegram: Edit a text message`, patrón ya usado en `Edit - Borrar keyboard foto` / `Edit a text message1`) redibujando el teclado con `☑️`/`⬜`. El estado de chat **no cambia** (sigue en `ESPERANDO SELECCION PLATAFORMAS`).
- `plat_ok` con selección vacía → mensaje de aviso, no avanza.

*Alternativa descartada:* un mensaje nuevo por cada toggle (spamea el chat) o un solo botón por plataforma que publica directo (rompe el multi-select pedido).

### D4. `Preparar integraciones` filtra por la selección en vez de incluir todo

El nodo mantiene su forma actual (sigue devolviendo `{hasIntegrations, postsArray}`) y se le agrega el filtro:

```js
// pseudo — forma final en tasks.md
const seleccion = JSON.parse($('Redis - Get plataformas').first().json.plataformas_raw || '[]');
const elegidas = seleccion.length ? withIntegration.filter((_, idx) => seleccion.includes(idx))
                                  : withIntegration;   // fallback: sin selección → todas (comportamiento actual)
```

*Por qué el fallback a "todas":* preserva el comportamiento actual si por alguna razón la clave de Redis expiró o el flujo entró por un camino viejo; evita que una publicación quede sin destino. El `settingsMap` existente (`instagram`, `facebook`, y el default `{__type: platform_type, post_type: 'post'}` que cubre `threads` y `x`) no cambia.

### D5. Programación: `type: 'schedule'` nativo de Postiz, conversión explícita a UTC

`HTTP - Crear post Postiz` pasa a leer un nodo Code previo (`Calcular fecha publicacion`) que emite `{ tipo: 'now'|'schedule', fechaISO }`:

```js
// pseudo
const TZ_OFFSET_MIN = -180; // America/Argentina/Buenos_Aires = UTC-3, sin DST desde 2009
```

- Botones rápidos → offsets calculados en el servidor (`+1h`, `hoy 20:00`, `mañana 09:00`) sin pedirle nada al usuario.
- `✍️ Fecha personalizada` → estado `ESPERANDO FECHA PERSONALIZADA`, el usuario escribe `DD/MM/AAAA HH:MM` (formato local argentino), se parsea con regex estricta, se valida que sea futura (mínimo +5 min) y se convierte a UTC ISO (`...Z`).
- Formato inválido o fecha pasada → mensaje de error con ejemplo y el estado **se mantiene** (el usuario reintenta sin reiniciar el flujo).
- El body queda: `type: fechaCalc.tipo, date: fechaCalc.fechaISO` (para `now` se manda igual el `date` con la hora actual, como hoy).

*Por qué offset fijo `-180` y no una librería de timezones:* Argentina no aplica DST desde 2009 y n8n corre con `GENERIC_TIMEZONE=America/Argentina/Buenos_Aires`; usar `Intl.DateTimeFormat` con `timeZone` dentro del nodo Code es la alternativa correcta si se quiere robustez frente a un futuro cambio de política horaria — **se recomienda usar `Intl` y dejar `-180` solo como fallback documentado**.

*Alternativa descartada:* scheduler propio en n8n (Wait node de días, o Schedule Trigger + cola en Redis). Postiz ya lo hace, tiene reintentos y su propio worker; duplicarlo agrega un punto de fallo y estado que sobrevivir a reinicios de n8n.

### D6. Moderación del media subido por el usuario: Gemini con salida JSON estricta, fail-closed — **imagen y video por igual**

El gate cubre **toda la rama de contenido existente**, no solo video. Un único contrato de veredicto, dos nodos de análisis según el tipo:

| Tipo de media | Nodo | Configuración |
|---|---|---|
| Video | `Moderar video Gemini` | `@n8n/n8n-nodes-langchain.googleGemini`, `resource: video`, operación *Analyze video*, `inputType: binary` |
| Imagen subida | `Moderar imagen Gemini` | mismo tipo de nodo, `resource: image`, operación *Analyze an image*, `inputType: binary` |

- Ambos usan **el mismo prompt** y la misma credencial/familia de modelo que ya usa el proyecto (`Analyze document`, `Analyze an image`), para no introducir dependencias nuevas.
- El prompt exige **solo JSON**: `{"apto": true|false, "categoria": "sexual|drogas|violencia|odio|ilegal|otro|ninguna", "motivo": "<≤140 caracteres, en español>"}`.
- Ambas salidas convergen en un único `Parsear veredicto media` → `IF - Media apto` (`apto === true`, `typeValidation: strict`).
- **Fail-closed en tres frentes**: (a) `onError: "continueErrorOutput"` a nivel de nodo en **los dos** nodos Gemini → rama de rechazo; (b) parseo defensivo en `Parsear veredicto media` que ante JSON inválido devuelve `apto: false, categoria: "otro"`; (c) `IF` con `typeValidation: strict` sobre booleano.
- ⚠️ **Recordatorio de implementación**: `onError` va como propiedad **del nodo**, hermana de `parameters`, no dentro de `parameters` (regresión ya sufrida en `Escaneo ClamAV`).

*Por qué la imagen subida también pasa por el gate y la generada no:* el eje es el **origen** del contenido. La imagen del usuario es material que el bot no controla (puede traer cualquier cosa) y termina publicada en cuentas reales del cliente; la imagen generada la produce el propio bot bajo un prompt que ya prohíbe explícitamente contenido prohibido (ver *Context*), así que pagar latencia y costo de un análisis extra sobre ella no compra riesgo evitado.

*Alternativas consideradas:*
1. **Extraer frames + análisis de imagen para video** (ffmpeg en un contenedor nuevo): más control y más barato por request, pero agrega un servicio a `docker-compose.yml`, pierde el audio y pierde contexto temporal. Descartado para esta iteración; queda como plan B si *Analyze video* resulta caro o lento.
2. **Servicio de moderación dedicado** (Hive, AWS Rekognition Content Moderation, Sightengine): más preciso y con umbrales calibrados, pero suma proveedor, costo y credencial nueva en un repo público. Descartado.
3. **Moderación solo por metadata/heurística** (duración, nombre de archivo): inútil para el objetivo. Descartado.
4. **Un solo nodo Gemini genérico para ambos tipos**: el nodo requiere `resource` fijo por tipo de media, así que no es posible sin duplicar de todos modos. Se duplica el nodo, no el prompt ni la lógica de veredicto.

### D7. Media existente: mismo array `image[]` en el body de Postiz (pregunta cerrada)

Confirmado contra la documentación pública de Postiz: **no existe un campo `video` separado**. El flujo es idéntico para imagen y video — subir a `/api/public/v1/upload` y referenciar el `{id, path}` devuelto dentro de `value[0].image[]`. El ejemplo oficial de Instagram Reel usa exactamente `image: [{ id: "video-id", path: "https://uploads.postiz.com/reel.mp4" }]`.

Implicancias:
- `HTTP - Subir imagen Postiz` se podría reutilizar tal cual (cambia solo el binario de entrada), pero se opta por un **nodo separado `HTTP - Subir media existente Postiz`** con `timeout` ampliado (recomendado 120000 ms) y política de reintento propia, para no tocar el nodo probado del flujo de imagen generada. El mismo nodo sirve para la imagen subida y para el video subido (el binario llega igual por `formBinaryData`).
- Instagram publica un único video como **Reel** automáticamente (`post_type: 'post'` + un solo video). No hace falta `settings` especial. Queda como nota: Threads y X tienen límites propios de duración/tamaño que Postiz reporta como error al publicar, no en el upload.

### D8. Gate de tamaño/duración ANTES de descargar el binario (por tipo de media)

El payload de Telegram ya trae los metadatos necesarios: `message.video` trae `file_size`, `duration`, `width`, `height` y `mime_type`; `message.photo` es un array de tamaños, cada uno con `file_size` (se usa el mayor, `photo.reverse()[0]`, igual que hace hoy `Redis6`).

`IF - Límite media existente` evalúa contra el payload del trigger (sin `getFile`):
- **Ambos tipos**: `file_size ≤ 20 MB` — límite duro de descarga del bot, no del diseño.
- **Solo video**: `duration ≤ 90 s` (confirmado en Q5). Para imagen la condición de duración no aplica y se evalúa como verdadera.

Así se evita gastar una descarga y una llamada a Gemini en un archivo que no se puede procesar. Mismo patrón que `IF - Límite de tamaño PDF` → `PDF muy grande`, con su propio mensaje `Media muy grande` que indica el motivo concreto (tamaño o duración).

*Nota sobre imagen:* en la práctica Telegram ya comprime las fotos enviadas como `photo` muy por debajo de 20 MB, así que ese gate casi nunca dispara; se mantiene igual porque `message.document` con `mime_type` de imagen (foto enviada "como archivo", sin comprimir) sí puede superarlo. El límite relevante aguas abajo pasa a ser el de Postiz/plataforma para fotos (body de 50 MB, y los límites de resolución de cada red), no el de duración.

### D9. Persistencia en Redis: todas las claves nuevas con TTL 86400

| Clave | Contenido | TTL |
|---|---|---|
| `media_existente_{chat_id}` | JSON `{tipo: "imagen"\|"video", file_id}` del media aprobado | 86400 |
| `integraciones_{chat_id}` | JSON de cuentas conectadas indexadas | 86400 |
| `plataformas_{chat_id}` | JSON de índices seleccionados | 86400 |
| `programacion_{chat_id}` | JSON `{tipo, fechaISO}` | 86400 |

*Por qué una sola clave con `tipo` adentro y no `video_{chat_id}` + `imagen_{chat_id}`:* la cadena de publicación necesita responder una sola pregunta ("¿hay media subido por el usuario y de qué tipo?"); dos claves obligarían a dos lecturas y a manejar el caso incoherente de que existan las dos. La clave de la imagen generada por IA sigue siendo la actual (`publicidad_{chat_id}`) y no se toca.

El nodo Redis nativo (`n8n-nodes-base.redis`, `operation: set`) soporta `expire: true` + `ttl`, así que **no hace falta** el nodo `@fancyheat/n8n-nodes-redis-enhanced` (ese solo fue necesario para poner TTL sobre listas creadas con `push`). Convención heredada del change `redis-expiration`.

### D10. Discriminación del media en la cadena final: origen primero, formato después

La cadena de publicación es única y debe saber qué media subir. Un nodo Code (`Detectar tipo de media`) previo a la subida lee `media_existente_{chat_id}` y emite `{ origen: 'usuario'|'ia', tipo: 'imagen'|'video', file_id }`:

- `origen: 'usuario'` (la clave existe) → rama de media existente: `Telegram Get a file media existente` → `HTTP - Subir media existente Postiz`. **Vale igual para imagen y para video**: el binario se descarga por `file_id` y se sube sin transformación (sin re-encoding, sin marca de agua).
- `origen: 'ia'` (la clave no existe) → rama actual intacta: `Redis - Get foto publicidad postiz` → `Telegram Get a file publicacion` → `HTTP - Subir imagen Postiz` (esa imagen ya trae la marca de agua desde D12, aplicada mucho antes, en el momento de la generación).

Ambas convergen en un Code `Resolver media subido` → `Redis - Get descripcion` → `HTTP - Crear post Postiz`, que referencia `{id, path}` desde ese nodo intermedio para no dejar expresiones frágiles con dos `$('...')` condicionales dentro del `jsonBody`.

*Por qué un Code intermedio:* el `jsonBody` actual ya es una expresión JS larga; agregarle un ternario que referencie un nodo que **no se ejecutó** en esa rama produce error en n8n. Resolver el media en un nodo previo mantiene el `jsonBody` legible y evita referencias a nodos no ejecutados.

*Por qué la discriminación es por origen y no por formato:* origen es lo que determina las reglas de negocio (gate de moderación sí/no, marca de agua sí/no); el formato solo determina qué nodo de análisis se usa y qué límites se evalúan. Ordenar las ramas por origen mantiene esas reglas imposibles de cruzar por accidente.

### D11. Confirmación final informativa

`Telegram - Publicacion exitosa` hoy dice "Podés verla en tu Instagram en los próximos minutos", lo cual sería falso con una publicación programada o multi-plataforma. Pasa a un mensaje construido con: tipo de media, lista de plataformas elegidas y, si es programada, fecha/hora **en hora local argentina**.

### D12. Marca de agua con el nodo core `Edit Image`, aplicada solo a la imagen generada por IA

**Decisión tomada por el dueño del proyecto (no se reabre):** la marca de agua se implementa con el nodo nativo **`n8n-nodes-base.editImage`** como paso de post-procesamiento **después** de que Gemini genera/edita la imagen y **antes** de que la imagen salga del bot. Se descartó pedírselo a Gemini en el prompt: los modelos de generación de imágenes no son confiables renderizando texto chico y legible de forma consistente (y encima el texto quedaría dentro de la composición, no como overlay controlado).

**Dónde se inserta exactamente:** hoy `Generate an image` y `Edit an image` conectan directo a `Send a photo message`. Se interpone el bloque de marca de agua en **ambas** conexiones:

```
Generate an image ─┐
                   ├→ [Watermark IA] → Send a photo message → Redis4/Redis25 (publicidad_{chat_id})
Edit an image ─────┘
```

*Por qué antes de `Send a photo message` y no antes del upload a Postiz:*
1. **WYSIWYG**: el usuario aprueba exactamente la imagen que se va a publicar (hoy aprueba lo que ve, y lo que se sube a Postiz es el `file_id` de esa misma foto de Telegram).
2. **La regla "nunca sobre contenido del usuario" queda garantizada por topología**: el nodo vive en la rama de generación, y la rama de contenido existente no lo atraviesa por ningún camino. Ponerlo antes del upload obligaría a un IF condicional en la cadena compartida — una rama más donde equivocarse.
3. Un solo punto de inserción por nodo de IA, sin tocar la cadena de publicación.

**Parámetros propuestos del nodo** (`n8n-nodes-base.editImage`, `operation: multiStep`, sobre la propiedad binaria `data`; dos pasos para garantizar legibilidad sobre cualquier fondo):

| Paso | Operación | Parámetros |
|---|---|---|
| 1 | `draw` | `primitive: rectangle`, `color: rgba(0,0,0,0.45)`, `cornerRadius: 6`, esquina inferior derecha: `startPositionX = W-372`, `startPositionY = H-58`, `endPositionX = W-16`, `endPositionY = H-18` |
| 2 | `text` | `text: "Imagen ilustrativa · generada con IA"`, `fontSize: 20` (≈2 % del alto para 1024 px), `fontColor: #FFFFFF`, `positionX = W-360`, `positionY = H-50`, `lineLength: 60` |

- `W`/`H` = ancho/alto de la imagen. Como el nodo `text` posiciona en coordenadas absolutas desde arriba-izquierda, se obtienen con un paso previo `Edit Image` en `operation: information` (devuelve `size.width` / `size.height`) y se calculan por expresión. **Simplificación admitida**: si el modelo devuelve siempre 1024×1024, se pueden fijar las coordenadas y borrar el paso `information` (dejarlo documentado si se toma ese atajo).
- Posición: **esquina inferior derecha** — el producto y el precio suelen quedar centrados o en el tercio superior, así que es la zona con menos riesgo de tapar información.
- Opacidad/contraste: recuadro negro al 45 % de opacidad + texto blanco sólido. Es el compromiso más robusto: legible sobre fondos claros y oscuros sin ser un cartel. Alternativa si se lo quiere aún más sutil: texto blanco al 80 % sin recuadro (riesgo: ilegible sobre fondos claros).
- Fuente: la default del nodo, para no depender de instalar tipografías en el contenedor. **Verificar en el stack real** que el `·` y las tildes renderizan bien; si no, degradar el texto a `"Imagen ilustrativa - generada con IA"` (task de verificación pending-manual).
- El nodo `Edit Image` es **core** de n8n y corre dentro del propio servicio; no agrega contenedores ni community packages. Requiere que el runtime de n8n tenga su dependencia de procesamiento de imágenes disponible (la imagen oficial la incluye) → task de verificación explícita antes de dar el bloque por hecho.
- Si el paso falla, la publicidad **no continúa sin marcar**: el nodo va con `onError: "continueErrorOutput"` (propiedad del nodo) hacia un mensaje de error al usuario.

**Regla de negocio dura (no se pierde en la implementación):** la marca de agua se aplica **exclusivamente** a las imágenes generadas por `Generate an image` / `Edit an image`. **NUNCA** al contenido subido por el usuario en la rama de publicidad existente — ni a la imagen ni al video. Ponerle "generada con IA" a una foto o un video reales del usuario sería **falso** y contradiría exactamente el propósito de la feature (evitar publicidad engañosa, no crearla). Ver también *Non-Goals* y el spec `ai-image-watermark`.

## Risks / Trade-offs

- **[Media > 20 MB no se puede publicar]** → El límite es de la Bot API de Telegram, no del diseño. Mitigación: gate explícito con mensaje claro ("mandá una imagen o un video de hasta 20 MB / 90 s") y documentar Local Bot API Server como camino futuro. Es la limitación más visible para el usuario final.
- **[Confusión entre "foto de producto" y "foto para publicar"]** → El mismo evento de Telegram con dos significados; si la desambiguación por estado falla, el usuario podría ver su catálogo contaminado o su publicidad tratada como material de referencia. Mitigación: D2b (regla por estado, escenario de regresión explícito en el spec y task de verificación dedicada), más textos de pedido de media distintos e inequívocos en cada rama.
- **[Falsos positivos de moderación: contenido legítimo rechazado]** → El usuario pierde la publicación sin recurso, ahora también para imágenes. Mitigación: el mensaje de rechazo incluye la categoría y el motivo devuelto por el modelo (Q1), y el prompt se calibra con la severidad conservadora-no-paranoica confirmada en Q2.
- **[Falsos negativos: contenido prohibido que pasa el filtro]** → Postiz/Meta lo rechazan aguas abajo o la cuenta recibe una sanción. Mitigación: el gate es "mejor esfuerzo", se documenta explícitamente que no reemplaza las políticas de las plataformas, y el error de publicación de Postiz debe llegar al usuario (se apoya en el change `error-handling`).
- **[Latencia y costo del análisis con Gemini]** → Un video de 90 s puede tardar decenas de segundos (la imagen es mucho más barata y rápida, pero suma). Mitigación: mensaje "🔍 Revisando tu contenido…" antes del nodo Gemini, `timeout` amplio y plan B documentado (D6, alternativa de frames).
- **[El nodo `Edit Image` puede no estar operativo en el runtime]** → Es core, pero depende de la librería de procesamiento de imágenes del contenedor. Si falta, el flujo de generación se corta (fail-closed por diseño). Mitigación: task de verificación temprana en el stack real, antes de cablear el bloque completo.
- **[La marca de agua arruina la estética o tapa información]** → Riesgo de producto, no técnico. Mitigación: parámetros conservadores (D12), posición inferior derecha, y validación visual con imágenes reales del catálogo antes de dar por cerrado el bloque; los parámetros están concentrados en un nodo y son ajustables sin tocar el resto del flujo.
- **[Marcar por error contenido del usuario]** → Sería un daño reputacional inverso al que la feature busca evitar. Mitigación: la topología lo vuelve imposible (D12: el nodo vive solo en la rama de IA) + escenario explícito en el spec + task de verificación de conexiones.
- **[Rate limit de Postiz: 30 req/hora]** → Cada publicación consume 1 upload + 1 create (2 requests) y el flujo de toggles no toca Postiz. Riesgo bajo en uso normal; HTTP 429 debe traducirse a un mensaje entendible.
- **[Explosión de estados en `Code in JavaScript5` y salidas en `Switch3`]** → El enrutador ya tiene ~20 ramas; sumar estados y rutas lo vuelve más frágil. Mitigación: agrupar los callbacks nuevos por prefijo (`plat:`, `sched:`) y resolverlos con `startsWith` en el Code, en vez de un `else if` por botón; una sola salida nueva de `Switch3` por familia, y **una sola** salida para imagen+video de la rama nueva (D2b).
- **[`codigo.json` es grande y se edita a mano]** → Riesgo de romper el JSON o desincronizar el export. Mitigación: convención ya establecida en el proyecto — editar con cuidado, re-importar en la UI de n8n, re-exportar, y sanitizar credenciales según `docs/secret-sanitization-procedure.md` antes de commitear (repo público).
- **[Regresión de `onError` mal ubicado]** → Ya pasó con `Escaneo ClamAV`. Mitigación: task explícita de verificación de que `onError` es hermano de `parameters` en todos los nodos nuevos con error output.
- **[Cambio de comportamiento por defecto en `Preparar integraciones`]** → Si el filtro se aplica mal, una publicación podría no ir a ninguna red. Mitigación: fallback a "todas las conectadas" cuando la selección está vacía o la clave expiró (D4).

## Migration Plan

1. Implementar y verificar por bloques, en este orden (cada bloque publicable de forma independiente en el editor de n8n):
   1. **Marca de agua** (`ai-image-watermark`) — el bloque más chico y aislado: dos conexiones reenrutadas y un nodo (o dos) nuevos. Se prueba con el flujo de generación actual, sin depender de nada más, y valida temprano que `Edit Image` funciona en el runtime.
   2. **Programación** (`publish-scheduling`) — `Calcular fecha publicacion` + `type`/`date` dinámicos. Se puede probar con la imagen que el bot ya genera.
   3. **Selección de plataformas** (`platform-selection`) — agrega el paso conversacional y el filtro en `Preparar integraciones`.
   4. **Contenido existente** (`existing-media-publishing`) — la rama más grande, se apoya en los anteriores ya funcionando. Dentro del bloque: primero imagen subida (más rápida y barata de probar), después video.
2. Cada bloque: editar `codigo.json` → importar en la UI de n8n → probar por Telegram → re-exportar → sanitizar secretos → commitear.
3. **Rollback**: el workflow es un único JSON versionado; revertir es restaurar el `codigo.json` anterior e importarlo. Las claves nuevas de Redis expiran solas a las 24 h y no afectan al flujo viejo. No hay migración de datos ni cambios de esquema en Supabase.
4. Las publicaciones ya programadas en Postiz **sobreviven** a un rollback del workflow (viven en Postiz, no en n8n).

## Open Questions

**Q1 — ¿Qué ve el usuario cuando su contenido es rechazado por moderación?** ✅ **Confirmado por el usuario (2026-08-14): mensaje detallado** — categoría + motivo devuelto por el modelo, invitación a mandar otro contenido, flujo vuelve al menú principal. *(Aplica ahora también a la imagen subida, no solo al video.)*

**Q2 — ¿Qué severidad usar ante casos ambiguos?** ✅ **Confirmado por el usuario (2026-08-14): conservador no-paranoico** — rechazar solo ante violación clara (desnudez explícita, consumo/venta de drogas, sangre/gore, discurso de odio, actividad ilegal); permitir contenido "borderline" de marketing (bebidas alcohólicas, ropa de baño, contenido deportivo intenso).

**Q3 — ¿Se registra en algún lado el contenido rechazado?** ✅ **Confirmado por el usuario (2026-08-14): no loguear** — no persistir el binario ni el `file_id`, solo el log de ejecución de n8n. No hace falta tabla nueva en Supabase.

**Q4 — ¿El contenido subido reemplaza a la imagen generada o convive con ella?** ✅ **Resuelto por la corrección de alcance (2026-08-14): conviven como dos caminos hermanos** — el menú ofrece `Generar publicidad` y `Subir publicidad existente`, y una publicación lleva **un solo media**. No se contempla publicar imagen + video (ni varios medias) en el mismo post en esta iteración.

**Q5 — Duración máxima del video.** ✅ **Confirmado por el usuario (2026-08-14): 90 segundos.**

**Q6 — Verificación real contra la API de Postiz (pending-manual).**
La forma del body (`type: 'schedule'`, `date` UTC, video dentro de `image[]`) está confirmada por documentación, **no por ejecución contra la instancia local** (`http://postiz:5000`). Queda una task de verificación end-to-end: publicar un video programado y confirmar que Postiz lo acepta y lo publica a horario. Si la instancia local de Postiz es de una versión anterior a la documentada, este es el punto donde puede haber diferencia.

**Q7 — Forma exacta del punto de decisión del menú.** ✅ **Confirmado por el usuario (2026-08-14): botones hermanos** — `Generar publicidad` y `Subir publicidad existente` en el menú principal, sin submenú anidado.

**Q8 — Parámetros finos de la marca de agua (pending-manual).**
El texto (`"Imagen ilustrativa · generada con IA"`), la implementación (`Edit Image`) y la regla de negocio están cerrados. Quedan a validar visualmente contra imágenes reales del catálogo: tamaño de fuente, opacidad del recuadro y esquina exacta (D12 propone inferior derecha, 20 px, recuadro negro al 45 %). Ajustables en un solo nodo sin impacto en el resto del diseño. **Sobre el `·`: el usuario confirmó que no le preocupa si no renderiza bien** — si la task 2.10 detecta el problema, aplicar directamente el fallback documentado (guion simple) sin volver a preguntar.
