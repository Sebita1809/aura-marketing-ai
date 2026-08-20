## Why

Hoy el bot Aura publica **siempre lo mismo, en todas partes, ahora mismo**: solo puede publicar la imagen que él mismo generó (no acepta contenido ya producido por el usuario, ni imagen ni video), arma un post para **todas** las cuentas conectadas con `postiz_integration_id` sin permitir elegir, y manda a Postiz un `type: 'now'` hardcodeado, sin opción de programar. Eso deja fuera tres cosas que el dueño del proyecto necesita para que el bot sirva como herramienta real de marketing: **subir una publicidad ya producida** (imagen o video), elegir en qué redes se publica, y decidir cuándo se publica. A eso se suma una cuarta pieza chica pero necesaria del lado legal/reputacional: **avisar en la propia imagen cuando la publicidad fue generada con IA**, para no exponerse a reclamos por publicidad engañosa.

Las cuatro funcionalidades viven sobre la **misma cadena de nodos** (generación/ingreso de media → `Preparar integraciones` → `HTTP - Subir imagen Postiz` → `HTTP - Crear post Postiz` → confirmación por Telegram) y las tres primeras necesitan el mismo paso nuevo de "recolección de opciones" antes de armar el post. Separarlas en changes distintos generaría edición concurrente del mismo bloque de `codigo.json` sin independencia real, por eso van en un solo change.

## What Changes

### 1. Publicación de contenido existente subido por el usuario: imagen **o** video (con moderación por IA)

- **El punto de entrada es una elección entre dos caminos, no un botón aislado.** Cuando el usuario va a publicar, el menú le ofrece dos opciones:
  - **`Generar publicidad`** — el flujo actual, sin cambios: la IA arma la imagen a partir del catálogo.
  - **`Subir publicidad existente`** — nuevo: el usuario ya tiene el contenido armado por su cuenta y se lo manda al bot tal cual, **sea foto o video**.
- La opción nueva pone el chat en el estado `ESPERANDO PUBLICIDAD EXISTENTE` y acepta indistintamente `message.photo` o `message.video` (y `message.document` con `mime_type` de imagen/video).
- Nueva rama de clasificación en el "Enrutamiento Principal": `Code in JavaScript5` hoy distingue `callback_query` / `message.photo` / texto. Se agrega la detección de video y, sobre todo, **la desambiguación de `message.photo` según el estado**: una foto en `ESPERANDO IMAGENES` sigue siendo una foto de referencia del producto (flujo de catálogo, intacto), mientras que una foto en `ESPERANDO PUBLICIDAD EXISTENTE` es una publicidad lista para publicar. Son dos usos distintos del mismo evento de Telegram y no se pisan.
- **Gate de tamaño/duración antes de descargar**: se valida contra el payload del trigger, sin bajar el binario. Límite duro **20 MB** para ambos tipos (límite de `getFile` de la Bot API de Telegram) y, solo para video, duración máxima **90 s** (confirmada por el dueño del proyecto).
- **Gate de moderación con IA para los dos tipos de media**: el binario descargado pasa por un nodo Google Gemini —*Analyze video* para video, *Analyze an image* para imagen— con el **mismo** prompt de clasificación de políticas de redes sociales (contenido sexual, drogas, violencia/sangre/gore, odio, actividad ilegal, contenido prohibido en general). El modelo devuelve un veredicto estructurado (`{ apto, categoria, motivo }`). El filtro ya no es exclusivo de video: la imagen subida por el usuario (capability que hoy no existe, nace con este change) pasa por el mismo gate.
- **La imagen generada por la IA NO pasa por este gate**: es contenido que el bot controla por prompt (ver *Contexto* más abajo: los prompts de `Generate an image` / `Edit an image` ya incluyen la regla de no generar contenido prohibido). Lo que sí se le agrega a la imagen de IA es la marca de agua del punto 4 — que es otra cosa, no un gate de moderación.
- **Fail-closed**: si el análisis falla, no responde o devuelve algo no parseable, el media se rechaza y no se publica (mismo patrón ya probado en la cadena PDF: `IF - Límite de tamaño PDF` → `Escaneo ClamAV` → `IF - PDF limpio` → rama aceptado/rechazado).
- La IA **NO genera ni edita el contenido del usuario**: solo lo valida. El binario se sube a Postiz tal cual llegó, sin re-encoding y **sin marca de agua**.
- El `file_id` y el tipo del media aprobado se guardan en Redis (`media_existente_{chat_id}` = `{tipo, file_id}`, TTL 86400) siguiendo el patrón existente de `fotos_{chat_id}`.
- La subida usa el endpoint que ya se usa para imágenes (`POST /api/public/v1/upload`, multipart `file`), con timeout ampliado; el `{id, path}` resultante se referencia en el **mismo array `image[]`** del post (confirmado contra la doc pública de Postiz: los videos se referencian por ese array, no hay campo `video` separado).

### 2. Selección de plataformas destino (multi-select por botones de Telegram)

- `Preparar integraciones` deja de generar un post por **cada** cuenta conectada: pasa a filtrar por la selección del usuario.
- Nuevo paso conversacional con **inline keyboard tipo toggle**: un botón por cuenta conectada (Instagram / Facebook / Threads / X), que al presionarse marca/desmarca (`☑️`/`⬜`) editando el mismo mensaje, más un botón `✅ Continuar`.
- La lista de cuentas y la selección viven en Redis (`integraciones_{chat_id}`, `plataformas_{chat_id}`, TTL 86400), porque cada pulsación de botón es una ejecución nueva del workflow (el flujo es event-driven, no puede "esperar" dentro de la misma ejecución).
- Si el usuario intenta continuar sin ninguna plataforma marcada, el bot lo avisa y no avanza.

### 3. Programación de día y hora (nativo de Postiz)

- `HTTP - Crear post Postiz` deja de mandar `type: 'now', date: new Date().toISOString()` hardcodeado y pasa a leer el modo y la fecha elegidos por el usuario desde Redis (`programacion_{chat_id}`).
- Nuevo paso conversacional con botones rápidos (`🚀 Publicar ahora`, `⏰ En 1 hora`, `🌙 Hoy 20:00`, `📅 Mañana 09:00`, `✍️ Fecha personalizada`) y, para la opción personalizada, entrada de texto libre en formato `DD/MM/AAAA HH:MM`.
- **No se construye ningún mecanismo de scheduling propio** (nada de nodos Cron/Schedule Trigger nuevos en n8n): Postiz ya soporta `type: "schedule"` + `date` ISO 8601 en su API pública, y su worker se encarga de publicar a horario.
- Conversión de zona horaria: el usuario habla en `America/Argentina/Buenos_Aires` (`GENERIC_TIMEZONE` del servicio n8n en `docker-compose.yml`); el `date` enviado a Postiz se normaliza a UTC (`...Z`). Se valida que la fecha sea futura.
- El mensaje de confirmación final deja de decir "Podés verla en tu Instagram en los próximos minutos" y pasa a resumir **qué se publicó, en qué plataformas y cuándo**.

### 4. Marca de agua sutil en las imágenes generadas por IA

- Las imágenes que produce el bot (`Generate an image` y `Edit an image`) pasan por un paso nuevo de post-procesamiento que les estampa un texto chico y discreto: **"Imagen ilustrativa · generada con IA"**.
- Se implementa con el nodo **core `n8n-nodes-base.editImage`** (no es community package; hoy no se usa en este workflow), **después** de Gemini y **antes** de mandarle la imagen al usuario para su aprobación — así lo que el usuario aprueba es exactamente lo que se publica.
- Se descartó pedírselo a Gemini en el prompt: los modelos de generación de imágenes no son confiables renderizando texto chico y legible de forma consistente.
- Ubicación por defecto: **esquina inferior derecha**, texto chico sobre un recuadro semitransparente para que se lea sobre cualquier fondo, sin tapar el producto (que suele quedar centrado).
- **Regla de negocio dura**: la marca de agua va **solo** en las imágenes generadas por la IA. **Nunca** en el contenido que el usuario sube en la rama del punto 1 —sea imagen o video real suyo—, porque ponerle "generada con IA" a material real sería falso y contradiría el propósito de la funcionalidad (evitar publicidad engañosa, no crearla).

## Contexto ya resuelto fuera de este change

Hoy (2026-08-14), por pedido del dueño del proyecto y **fuera** de este change, se aplicó un fix de seguridad de contenido en los prompts de `Generate an image` y `Edit an image`: ambos incluyen ahora una regla explícita de **no generar contenido sexual/desnudez, violencia gráfica, drogas ilegales, odio ni actividad ilegal aunque las especificaciones del usuario lo pidan**. Ese fix ya está en `codigo.json` y es la razón por la que la imagen generada por IA no necesita el gate de moderación de la rama de contenido existente. No se agrega ninguna task por esto.

## Capabilities

### New Capabilities

- `existing-media-publishing`: rama de "subir publicidad existente" — elección de menú entre generar y subir, recepción por Telegram de **imagen o video** ya producidos por el usuario (clasificación del evento sin pisar el flujo de fotos de catálogo, límites de tamaño/duración), moderación de contenido con IA como gate fail-closed aplicado a ambos tipos de media, persistencia del media en Redis, subida del binario a Postiz y referencia del media en el post.
- `ai-image-watermark`: marca de agua de texto ("Imagen ilustrativa · generada con IA") aplicada con el nodo core `Edit Image` a las salidas de `Generate an image` y `Edit an image`, y prohibición explícita de aplicarla al contenido subido por el usuario.
- `platform-selection`: selección multi-select de las plataformas destino de una publicación puntual vía inline keyboard con toggle, persistencia de la selección en Redis y filtrado de `postsArray` en `Preparar integraciones` según lo elegido.
- `publish-scheduling`: elección de momento de publicación (inmediato o programado) por botones/fecha libre, conversión de `America/Argentina/Buenos_Aires` a UTC, y envío de `type: 'now' | 'schedule'` + `date` a la API pública de Postiz sin scheduler propio.

### Modified Capabilities

*(Ninguna — los specs existentes en `openspec/specs/` son `dashboard-social-connections`, `meta-oauth`, `token-manager` y `x-twitter-oauth`; ninguno define requirements sobre el pipeline de publicación, que hoy no tiene spec propio.)*

## Impact

- **Workflow n8n (`codigo.json`, 120 nodos)**: es el archivo principal afectado. Nodos existentes modificados: `Code in JavaScript5` (clasificación de evento + desambiguación de `message.photo` por estado + nuevas rutas), `Switch3` (nuevas salidas), `Mensaje predeterminado` (nuevo botón `Subir publicidad existente` junto al `Generar publicidad` actual), `Preparar integraciones` (filtrado por selección), `HTTP - Crear post Postiz` (`type`/`date` dinámicos + media resuelto), `Telegram - Publicacion exitosa` (mensaje de confirmación con resumen), y las conexiones de `Generate an image` / `Edit an image` (que dejan de ir directo a `Send a photo message` para pasar antes por la marca de agua). Nodos nuevos: rama de contenido existente (gate de tamaño/duración, `Get a file`, análisis Gemini de imagen y de video, IF de veredicto, mensaje de rechazo), rama de selección de plataformas (keyboard + toggle + Redis), rama de programación (keyboard + parseo de fecha + Redis) y los nodos `Edit Image` de marca de agua. Se edita el JSON con cuidado y se re-importa/re-exporta desde la UI de n8n para sincronizar.
- **Redis**: tres claves nuevas por chat (`media_existente_{chat_id}`, `plataformas_{chat_id}`, `programacion_{chat_id}`) más la lista de integraciones cacheada (`integraciones_{chat_id}`), todas con TTL 86400 s, respetando la convención del change `redis-expiration`.
- **Estados de chat**: se agregan `ESPERANDO PUBLICIDAD EXISTENTE`, `ESPERANDO SELECCION PLATAFORMAS`, `ESPERANDO PROGRAMACION` y `ESPERANDO FECHA PERSONALIZADA` a la máquina de estados guardada en `chat_{chat_id}`.
- **Postiz**: se usan endpoints ya integrados (`/api/public/v1/upload`, `/api/public/v1/posts`) con parámetros nuevos (`type: 'schedule'`, `date`); no se agregan servicios ni credenciales nuevas. Límites relevantes: body máximo 50 MB (HTTP 413), 30 requests/hora (HTTP 429).
- **Gemini**: nuevo consumo de análisis de video (mayor costo/latencia por request que texto o imagen) y de análisis de imagen para moderación; la latencia del gate se suma al tiempo de publicación percibido, solo en la rama de contenido existente.
- **Procesamiento de imagen**: el nodo `Edit Image` corre dentro del propio contenedor de n8n (usa la dependencia de imagen ya incluida en la imagen oficial); agrega un paso rápido de post-procesamiento al flujo de generación. Requiere verificación en el stack real (task pending-manual).
- **Docker / infraestructura**: sin servicios nuevos. Solo se apoya en `GENERIC_TIMEZONE=America/Argentina/Buenos_Aires` ya presente en `docker-compose.yml`.
- **Seguridad**: el repo (`PabloAVivas/correccion-de-informe`) es público; los nodos nuevos usan Header Auth de n8n y ningún secreto en texto plano, siguiendo `docs/secret-sanitization-procedure.md`.
- **Riesgo legal/reputacional mitigado**: la marca de agua deja explícito que la imagen es ilustrativa y generada con IA, reduciendo la exposición a reclamos por publicidad engañosa; el contenido real del usuario queda deliberadamente sin marcar para no incurrir en el problema inverso.
