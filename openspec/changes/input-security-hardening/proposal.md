## Why

El hallazgo **C-09** de la auditoría de tesis ("Único control de entrada = LLM; sin MIME, tamaño, antimalware, límite de tasa ni defensa anti-inyección") está **PARCIALMENTE RESUELTO**: el change `pdf-virus-scan` cubrió la rama PDF (límite de 20 MB + ClamAV vía `ajilaag/clamav-rest` + verificación fail-closed del veredicto), y hoy se agregó detección de prompt injection en `Analyze document` con alerta al admin. Pero el propio informe declara pendientes en §4.7.2 cuatro controles que siguen **sin implementar**, y el alcance creció: el change `publish-video-platform-schedule` (capability `existing-media-publishing`) habilitó que el usuario suba **imagen y video propios** para publicarlos, abriendo una superficie de entrada binaria que hoy **no pasa por ningún antivirus**.

Verificado contra `codigo.json` (177 nodos): `ClamAV` aparece únicamente en `Escaneo ClamAV` y `Merge - PDF + veredicto ClamAV`, ambos exclusivos de la rama PDF. El gate agregado en la rama de media (`Moderar imagen Gemini` / `Moderar video Gemini`) es moderación de **contenido** por IA (sexual/violencia/drogas/odio/ilegal), **no es antimalware**: un archivo con un exploit embebido y contenido visual inocuo pasa sin ser escaneado. Además, tanto en PDF como en media se confía en el `mime_type` que **declara** Telegram (`msg.document?.mime_type`), nunca en los magic bytes reales del binario; no existe ningún límite de tasa a nivel del bot; y la mejora de detección de injection de hoy es una prueba manual informal (4 PDFs, 3/4 no detectados en la primera pasada) que **no** constituye la campaña adversaria sistemática que pide §7.1/§7.2.

## What Changes

> **Gobernanza — CRITICAL (Seguridad).** Este change vive en el dominio de Seguridad. Según la política del proyecto, en dominios CRITICAL los agentes hacen **solo análisis y diseño; no escriben código sin aprobación humana explícita**. Los artefactos de este change (proposal, design, specs, tasks) son planificación. La fase `apply` **requiere confirmación explícita del usuario, tarea por tarea o grupo por grupo**, antes de tocar `codigo.json`, `docker-compose.yml` o cualquier archivo del repo. Ver `design.md` §Gobernanza y la intro de `tasks.md`.

Cuatro bloques de trabajo, uno por control pendiente de C-09:

- **Validación de firma binaria (magic bytes)** en las tres ramas de ingesta (PDF, imagen, video). Un nodo Code determinista lee los primeros bytes del binario ya descargado y verifica que la firma real coincida con la familia de tipo declarada por Telegram (`%PDF-` para PDF; `\xFF\xD8\xFF` JPEG / `\x89PNG` / `RIFF…WEBP` / `GIF8` para imagen; `ftyp` ISO-BMFF, `\x1A\x45\xDF\xA3` Matroska/WebM para video). Fail-closed: discrepancia declarado-vs-real → rechazo + mensaje al usuario, sin llegar a Gemini ni a Postiz. **No** reemplaza a ClamAV: es un control de tipo, no de malware.
- **Límite de tasa por `chat_id`** a nivel del bot, hoy inexistente. Contador en Redis con ventana deslizante/fija por `chat_id` (patrón `INCR` + `EXPIRE`, mismo Redis que ya usa el workflow con TTL 86400 para estado transitorio), con cuotas separadas para mensajes de texto y para archivos (PDF/imagen/video), aplicado inmediatamente después del `Telegram Trigger`. Al superar la cuota: aviso una sola vez por ventana y descarte silencioso del resto. El límite de Postiz (30 req/hora) protege la API de Postiz, **no** al bot.
- **Antimalware en la rama de imagen/video** (`existing-media-publishing`), reutilizando el servicio `clamav-rest` que **ya corre** en `docker-compose.yml` — no se levanta ningún servicio nuevo. Escaneo del binario descargado por `Telegram - Get a file media existente` antes de `Ruteo por tipo de media`, con la misma política fail-closed y el mismo contrato (`POST /v2/scan`, HTTP 406 = infectado, `onError: continueErrorOutput` como propiedad del nodo). Queda **complementario** al gate de moderación de contenido: son dos controles distintos (malware vs. contenido inapropiado) y ambos deben pasar.
- **Campaña formal de pruebas adversarias de prompt injection** (§7.1/§7.2): banco de casos versionado y reproducible en `tests/prompt-injection/`, cubriendo tanto el flujo PDF (`Analyze document`) como los **prompts de texto libre** del usuario que llegan a `Generate an image` y `Edit an image` — hoy sin ningún gate de injection. Runner que ejecuta el banco contra los prompts reales del workflow, métricas de tasa de detección / falsos negativos / falsos positivos, umbral de aceptación declarado y reporte reproducible. Incluye la **decisión explícita** (con criterio de datos, no de intuición) sobre si hace falta agregar un gate de detección de injection también en esos dos nodos Gemini.

Fuera de alcance (declarado): reescribir la rama PDF ya entregada por `pdf-virus-scan`; sandboxing/detonación de archivos; WAF o rate limiting a nivel de infraestructura; reemplazar la moderación por IA por un clasificador propio.

## Capabilities

### New Capabilities

- `binary-signature-validation`: Validación determinista de firma binaria (magic bytes) contra el tipo declarado por Telegram, para PDF, imagen y video, fail-closed y previa a cualquier procesamiento por Gemini o publicación.
- `bot-rate-limiting`: Límite de tasa por `chat_id` a nivel del bot de Telegram, con contadores en Redis, cuotas diferenciadas para texto y archivos, aviso único por ventana y descarte del exceso.
- `media-virus-scan`: Extensión del escaneo antivirus ClamAV (servicio `clamav-rest` existente) a la rama de imagen/video de `existing-media-publishing`, fail-closed y complementario al gate de moderación de contenido por IA.
- `prompt-injection-test-campaign`: Campaña adversaria formal y reproducible de prompt injection — banco de casos versionado (PDF + prompts libres de `Generate an image` / `Edit an image`), runner, métricas de detección y decisión documentada sobre gates adicionales.

### Modified Capabilities

*(Ninguna. `openspec/specs/` contiene hoy `dashboard-social-connections`, `meta-oauth`, `token-manager` y `x-twitter-oauth`; ninguna cambia sus requirements. Las capabilities `pdf-virus-scan` y `existing-media-publishing` viven todavía en sus changes activos sin archivar, por lo que este change las **referencia y complementa** en vez de emitir deltas sobre ellas: `media-virus-scan` reutiliza el contrato de escaneo probado en `pdf-virus-scan` aplicándolo a una rama distinta, sin alterar la rama PDF.)*

## Impact

- **Workflow n8n (`codigo.json`, fuente de verdad versionada, 177 nodos)**:
  - Rama PDF: nodo de validación de magic bytes entre `Get a file2` y `Escaneo ClamAV`.
  - Rama media existente: nodos de magic bytes + `Escaneo ClamAV media` entre `Telegram - Get a file media existente` y `Ruteo por tipo de media`, más su nodo Telegram de rechazo.
  - Entrada global: nodos de rate limiting (Redis `INCR`/`EXPIRE` + IF) inmediatamente después del `Telegram Trigger`, aguas arriba de `Code in JavaScript5`.
  - Posible gate de injection en `Generate an image` / `Edit an image` (**condicionado** al resultado de la campaña, no asumido).
- **Docker/infra (`docker-compose.yml`)**: sin servicios nuevos. Se reutiliza `clamav-rest` (imagen `ajilaag/clamav-rest`, volumen `clamav_db`, healthcheck, red `postiz-network`) y el `redis` existente. A revisar: `MAX_FILE_SIZE`/`MAX_SCAN_SIZE` de ClamAV frente al límite de 20 MB de video.
- **Redis**: nuevo espacio de claves para contadores de rate limit (`ratelimit:<chat_id>:<bucket>`), con TTL corto por ventana — distinto del estado transitorio existente con TTL 86400.
- **Tests / documentación**: `tests/prompt-injection/` (banco de casos + runner + reporte de métricas); notas de operación en `docs/` siguiendo el patrón de `docs/clamav-ops-notes.md`. Repo público (`PabloAVivas/correccion-de-informe`): cualquier credencial nueva sigue `docs/secret-sanitization-procedure.md` — no se prevén credenciales nuevas.
- **UX del bot**: mensajes de rechazo nuevos (tipo de archivo inválido, media infectada, cuota excedida). Riesgo de falsos positivos y de fricción para el usuario legítimo; se mitiga con umbrales conservadores y mensajes explicativos.
- **Informe de tesis**: cierra los cuatro pendientes declarados en §4.7.2 y aporta la evidencia reproducible que piden §7.1 y §7.2.
