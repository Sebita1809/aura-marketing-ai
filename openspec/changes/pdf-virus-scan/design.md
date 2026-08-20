# Design: pdf-virus-scan

## Context

El bot de Telegram "Aura" ingesta catálogos de productos que los usuarios envían como PDFs. El flujo actual (rama PDF del workflow en `codigo.json`) es:

```
Send a text message2 → Get a file2 → Analyze document (Gemini) → If3 ("Contenido inapropiado") → parse + upsert Supabase + mensaje de catálogo
```

Hoy un PDF enviado por un usuario llega **sin ninguna verificación** al análisis de Gemini. No existe control sobre el binario: el pipeline asume que todo PDF es un catálogo benigno. El objetivo de este cambio es insertar una barrera antivirus (ClamAV) antes de Gemini.

**Estado actual verificado:**
- `docker-compose.yml` tiene servicios n8n, redis, postiz, postiz-postgres, postiz-redis, temporal-elasticsearch, temporal-postgresql, temporal, temporal-ui. Todos usan `container_name:` explícito, redes bridge (`postiz-network`, `temporal-network`) y volúmenes nombrados.
- n8n corre en la red `postiz-network` (línea 24) y se comunica con servicios internos por hostname docker (ej. `http://postiz:5000/...`).
- En `codigo.json`, la rama PDF: `Get a file2` (línea 499, descarga el PDF por `fileId` de Telegram) → `Analyze document` (línea 478, Gemini, `inputType: "binary"`) → `If3`. La conexión está en las líneas 3839-3849.
- Los mensajes Telegram usan `chatId: "={{ $('Code in JavaScript5').item.json.id_chat }}"` (patrón visto en `Send a text message10`, línea 355).

**Desviación final de la arquitectura (corregida durante implementación):** el plan y este diseño asumían **dos servicios** — daemon `mkodockx/docker-clamav:buster` + sidecar REST `solita/clamav-rest`. Esa arquitectura **falló en implementación**:
- `solita/clamav-rest` **no existe en Docker Hub** (pull access denied).
- La alternativa `lokori/clamav-rest` (build CentOS7/Java8 del mismo proyecto) **crash con exit 139 (segfault)** en Docker moderno.
- Imagen **verificada y adoptada**: `ajilaag/clamav-rest` — imagen "two in one" mantenida activamente (semver v1.2.x, 2025+): Alpine + Go REST + daemon ClamAV + freshclam updates. Corre **daemon Y REST en UN solo contenedor**, por lo que el servicio daemon separado `clamav` queda **eliminado**.
- El contrato REST cambió respecto del plan: endpoint **`POST /v2/scan`** (multipart field `file`) en el puerto interno **9000**, respuesta JSON **array** y **HTTP 406** para archivos infectados (ver D1/D2/D3).

## Goals / Non-Goals

**Goals:**
- Escanear con ClamAV todo PDF que llegue al bot antes de que Gemini lo procese.
- Rechazar (y notificar al usuario) PDFs maliciosos o no escaneables sin interrumpir el resto del bot.
- Política **fail-closed**: si el escáner no responde o falla, el PDF no se procesa.
- Limitar tamaño de PDFs para respetar límites prácticos de ClamAV y Gemini.
- Proveer un procedimiento de prueba reproducible con el estándar EICAR.

**Non-Goals:**
- Detectar malware 0-day o comportamientos heurísticos avanzados (ClamAV es basado en firmas).
- Escanear las otras fuentes del bot (Google Sheets links, imágenes). Solo PDFs (la rama `Get a file2`).
- Modificar `WgetExecFormatter`, `Dockerfile`s ni crear imágenes custom.
- Resolver los secretos hardcodeados en `codigo.json` (issue conocido, documentado pero fuera de scope).

## Decisions

### D1. Servicio Docker único: `ajilaag/clamav-rest` (daemon + REST en un contenedor)

Un **único servicio** reemplaza a los dos planificados (daemon + sidecar), porque la imagen elegida es self-contained (daemon ClamAV + REST API Go + freshclam en el mismo contenedor):

```yaml
  clamav-rest:
    image: ajilaag/clamav-rest
    container_name: clamav-rest
    restart: unless-stopped
    ports:
      - "8082:9000"          # solo para debug/curl desde el host (REST interno en 9000)
    environment:
      MAX_SCAN_SIZE: 100M
      MAX_FILE_SIZE: 25M     # PDFs > 25 MB no se escanean (el gate de n8n es 20 MB)
      SIGNATURE_CHECKS: 2    # actualización de firmas 2x/día
      TZ: America/Argentina/Buenos_Aires
    volumes:
      - clamav_db:/clamav/data   # firmas persisten ante recreación del contenedor
    networks:
      - postiz-network
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://localhost:9000/version"]
      interval: 60s
      timeout: 10s
      retries: 5
      start_period: 300s   # carga inicial de firmas al primer arranque
```

- El healthcheck usa `wget` contra `GET /version` (el binario `wget` existe en la imagen; verificado). El `start_period: 300s` absorbe la carga inicial de firmas del primer arranque (con la DB ya presente el contenedor llega a `healthy` en ~15 s).
- Volumen nombrado `clamav_db:` montado en **`/clamav/data`** (ruta de firmas de esta imagen; no `/var/lib/clamav`). Las firmas persisten ante recreación del contenedor.
- Variables de entorno del wrapper REST: `MAX_SCAN_SIZE` (100M), `MAX_FILE_SIZE` (25M — PDFs mayores no se escanean; el gate de n8n es 20 MB), `SIGNATURE_CHECKS` (2 = actualización de firmas 2×/día), `TZ`. También disponibles `PROXY_*`, etc.
- REST escucha en el puerto interno **9000**; el bind host `8082:9000` es **solo** para debug/curl desde el host. HTTPS en 9443 solo si se proveen certificados (no se usa por defecto).
- `n8n` tiene `depends_on: clamav-rest: condition: service_healthy` (ver task 1.4).

**Decisión de imagen (desviación final documentada):** la arquitectura de dos servicios del plan (daemon `mkodockx/docker-clamav:buster` + sidecar `solita/clamav-rest`) **falló en implementación** — `solita/clamav-rest` no existe en Docker Hub (pull access denied) y `lokori/clamav-rest` (mismo proyecto, build CentOS7/Java8) crashea con exit 139 (segfault) en Docker moderno. Se adoptó **`ajilaag/clamav-rest`**, la imagen "two in one" mantenida activamente (semver v1.2.x, 2025+) con daemon + REST en un solo contenedor. El contrato REST cambió a `/v2/scan` en el puerto 9000 con respuesta array y HTTP 406 para infectado (el contrato original `/api/scan` + `/health` en 8080 no existe en esta imagen).

### D2. Networking: n8n llama el puerto INTERNO 9000, no el publicado

**Decisión:** n8n llama **`http://clamav-rest:9000/v2/scan`** (puerto interno 9000 del contenedor, vía DNS del servicio en la red `postiz-network`). El puerto publicado `8082:9000` es **solo** para depuración desde el host (`curl http://localhost:8082/version`).

**Aclaración sobre networking Docker (reconcilia el supuesto del plan):** el plan suponía que n8n debía llamar al puerto publicado `8082` ("el mapeo del servicio resuelve en el puerto publicado"). Eso **no es correcto** en redes bridge user-defined de Docker: los contenedores de la misma red se alcanzan por `nombre_servicio:puerto_interno_del_contenedor`. El bind publicado (`0.0.0.0:8082`) aplica únicamente al host. Por lo tanto la opción más limpia (y la adoptada) es que n8n use el puerto interno 9000. No se necesita alias interno adicional porque `clamav-rest` es el nombre del servicio.

### D3. Workflow n8n: inserción de nodos en la rama PDF

Rama PDF ANTES:

```
Send a text message2 → Get a file2 → Analyze document → If3 → (rechazo "Contenido inapropiado" | parse + Supabase)
```

Rama PDF DESPUÉS:

```
Send a text message2
   │
   v
Get a file2
   │
   v
IF "IF - Límite de tamaño PDF"          ← NUEVO (size check ≤ 20 MB)
   ├── FALSE ──> Telegram "PDF muy grande"        ← NUEVO
   └── TRUE ──> HTTP Request "Escaneo ClamAV"     ← NUEVO (POST http://clamav-rest:9000/v2/scan)
                  │ success (HTTP 200)
                  v
                IF "IF - PDF limpio"               ← NUEVO (Status == "OK")
                  ├── TRUE  ──> Analyze document   (existente, sin cambios)
                  └── FALSE ──> Telegram "PDF rechazado"   ← NUEVO
                  · (error output: 406 infectado, timeout, 5xx) ──> Telegram "PDF rechazado"  ← fail-closed
```

Detalle de los nodos nuevos:

1. **`IF - Límite de tamaño PDF`** (n8n-nodes-base.if): condición numérica sobre el tamaño del binario descargado por `Get a file2`, usando la propiedad `fileSize` del binary item: `={{ $('Get a file2').item.binary.data.fileSize }}` `<= 20000000` (20 MB). Umbral configurable (nodo). Razón: gate de n8n por debajo del `MAX_FILE_SIZE` del contenedor (25M) y razonable para Gemini. Con 20 MB quedamos por debajo del límite del contenedor.
2. **`Escaneo ClamAV`** (n8n-nodes-base.httpRequest):
   - Método `POST`, URL `http://clamav-rest:9000/v2/scan`.
   - Body: `Multipart Form-Data`, parámetro de nombre `file` con tipo `File`, referenciando el binario del item (`data`) de `Get a file2`.
   - Timeout ≥ 60000 ms (el scan de archivos grandes puede tardar). Si el scan supera el límite del contenedor, ClamAV responde error → cae en fail-closed.
   - Opción **On Error → "Continue Error Output"**: como `/v2/scan` devuelve **HTTP 406** para archivos infectados, esos archivos caen al output de error → `PDF rechazado` (fail-closed). Los limpios (HTTP 200) siguen al output de éxito → `IF - PDF limpio`.
   - Respuesta de `/v2/scan`: **JSON array** — limpio → `[{"Status":"OK","Description":"","FileName":"..."}]`; infectado → `[{"Status":"FOUND","Description":"Eicar-Test-Signature","FileName":"..."}]` (HTTP 406). Como la respuesta es un array, n8n la divide en items; `$json.Status` resuelve por item en `IF - PDF limpio`.
3. **`IF - PDF limpio`** (n8n-nodes-base.if): condición string `={{ $json.Status }}` `equals` `"OK"` (el array se divide en items; en limpio `Status` es `"OK"`, en infectado `"FOUND"`). TRUE → `Analyze document`. FALSE → `PDF rechazado`.
4. **`PDF rechazado`** (n8n-nodes-base.telegram, `sendMessage`): copia el patrón de bindeo de chat del nodo existente `Send a text message10`: `chatId: "={{ $('Code in JavaScript5').item.json.id_chat }}"`. Texto (español, tono del bot): informa que el archivo parece malicioso y **no será procesado**.
5. **`PDF muy grande`** (n8n-nodes-base.telegram): mismo bindeo de chat; avisa que el PDF supera el tamaño máximo (20 MB) y no será procesado. Opcional si se descarta el límite de tamaño, pero recomendado.

Conexiones a modificar en el JSON (equivalente a editar en el editor): la salida de `Get a file2` que hoy apunta a `Analyze document` (líneas 3839-3848) pasa a apuntar a `IF - Límite de tamaño PDF`; `Analyze document` queda conectado desde `IF - PDF limpio` (TRUE). La posición (x,y) de los nodos nuevos debe acomodarse al layout existente (el eje Y de la rama PDF es `99808`).

### D4. Política de seguridad: FAIL-CLOSED

Si el escáner no responde, da timeout, devuelve 5xx o no devuelve `Status: OK`, el PDF **nunca** llega a Gemini:

- `Escaneo ClamAV` con `On Error → Continue Error Output` → su output de error alimenta `PDF rechazado`. Este output de error cubre timeout, conexión rechazada, 5xx **y el HTTP 406 de archivos infectados** (fail-closed por defecto del nodo).
- `IF - PDF limpio`: solo `TRUE` (Status == OK) continúa a `Analyze document`; cualquier otro resultado → `PDF rechazado`.
- El mensaje de rechazo es el mismo para "detectado malware" y para "no se pudo escanear" (fail-closed sin leak de detalle a usuarios); los detalles técnicos quedan en logs de n8n.

Racional: un falso positivo (rechazar un PDF limpio por escáner caído) es barato — el usuario reintenta. Un falso negativo (dejar pasar un PDF malicioso a Gemini/supabase) es inaceptable para este pipeline.

### D5. Timeout y límites

| Parámetro | Valor | Motivo |
|---|---|---|
| Timeout HTTP `Escaneo ClamAV` | ≥ 60 000 ms | Escaneo de PDFs grandes es lento |
| Límite de tamaño PDF (IF n8n) | 20 MB (configurable) | Gate de n8n por debajo del `MAX_FILE_SIZE` del contenedor; razonable para Gemini |
| `MAX_FILE_SIZE` (contenedor) | 25M | PDFs > 25 MB no se escanean en el contenedor (el gate de n8n de 20 MB los bloquea antes) |
| `MAX_SCAN_SIZE` (contenedor) | 100M | Límite de escaneo del wrapper REST |
| `SIGNATURE_CHECKS` (contenedor) | 2 | Actualización de firmas 2×/día |
| `start_period` healthcheck | 300 s | Carga inicial de firmas al primer arranque (healthy en ~15 s con la DB ya presente) |

### D6. Implementación del workflow (n8n es la fuente de verdad)

El workflow vive en n8n; `codigo.json` es un export. **La implementación debe editar el workflow en el editor de n8n y re-exportar a `codigo.json`** (o editar el JSON con mucho cuidado). Regla: nunca editar solo el JSON sin reflejarlo en n8n y viceversa — el export debe quedar sincronizado al final de cada task de workflow. Ver tasks.md.

## Risks / Trade-offs

| Riesgo | Mitigación |
|---|---|
| Primera descarga de firmas al primer arranque (bot sin escanear en ese lapso) | Healthcheck con `start_period: 300s`; `depends_on` de `n8n` hacia `clamav-rest` con `service_healthy` (aplicado) asegura fail-closed a nivel infra: n8n no arranca hasta que el escáner está listo. |
| Imagen única `ajilaag/clamav-rest` (daemon + REST juntos en un contenedor) | Es la imagen mantenida activamente (semver v1.2.x, 2025+) **verificada en implementación**; las alternativas fallaron (`solita/clamav-rest` no existe en Docker Hub; `lokori/clamav-rest` segfault con exit 139 en Docker moderno). El volumen `clamav_db` aísla las firmas y el contrato `/v2/scan` está documentado por si se migra. |
| ClamAV detecta solo malware conocido (no 0-days) | Documentado como non-goal; el gate de tamaño + fail-closed reduce la superficie. Considerar escaneo manual/adicional si el riesgo lo amerita. |
| Falso positivo rechaza un PDF limpio | Costo bajo (reintento del usuario); aceptado deliberadamente por fail-closed. |
| PDF con EICAR embebido dentro de estructura PDF real | Para la prueba EICAR se embebe la cadena `X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*` en el PDF (p.ej. como texto/string dentro del archivo); ClamAV la detecta como `Eicar-Test-Signature`. **Caveat host:** Windows Defender bloquea la **lectura** de `tests/eicar/eicar-test.pdf` en el filesystem del host (PowerShell `Get-Content`/`Copy-Item` y `curl` no pueden leerlo: "el archivo contiene un virus"). Para testear la API sin leer archivos del host se usa `tests/eicar/scan-rest-test.js` (construye el multipart en memoria con los bytes EICAR y POSTea a `/v2/scan`). En el flujo real el archivo **nunca toca el disco del host** (Telegram → memoria de n8n → contenedor `clamav-rest`), por lo que el caveat no afecta producción. |
| CPU/RAM: clamd consume memoria proporcional a las firmas | Aceptado; volumen `clamav_db` (firmas en `/clamav/data`) evita redescargas; se documenta en ops. |

## Migration Plan

**Deploy:**
1. El servicio único `clamav-rest` + volumen `clamav_db` ya están **aplicados en `docker-compose.yml`** (fuente de verdad). `n8n` tiene `depends_on: clamav-rest (service_healthy)`.
2. `docker compose up -d clamav-rest` (primer arranque: descarga inicial de firmas; `docker compose ps` hasta `healthy`).
3. Smoke test desde host: `curl http://localhost:8082/version`.
4. Workflow n8n: re-importar `codigo.json` (los nodos ya están en el export; URL del escáner `http://clamav-rest:9000/v2/scan`). Cualquier ajuste se hace en el editor de n8n y se re-exporta.
5. Probar con EICAR y PDF limpio: vía API con `node tests/eicar/scan-rest-test.js` (no requiere stack) y end-to-end vía Telegram (ver Testing / `docs/clamav-ops-notes.md`).

**Rollback:**
- Infra: `docker compose rm -sf clamav-rest` + quitar el bloque de compose; el resto del stack queda intacto.
- Workflow: restaurar la conexión directa `Get a file2 → Analyze document` desde el editor de n8n y re-exportar (o restaurar `codigo.json` desde git).
- Al eliminar el servicio, el único efecto en el bot es que los PDFs vuelven a procesarse sin escaneo (estado previo).

## Open Questions

- ¿Se fija el umbral de tamaño en 20 MB o se parametriza vía variable de entorno en n8n? (Por defecto: 20 MB hardcodeado en el nodo IF, ajustable manualmente.)
- El `depends_on` de `n8n` → `clamav-rest` (`service_healthy`) **ya está aplicado** en `docker-compose.yml` (arranque retardado garantizado; caveat de la primera descarga de firmas absorbido por `start_period: 300s`). Se mantiene como decisión cerrada.
- ¿Enviar el mismo texto de rechazo para "malware detectado" y "escáner no disponible", o distinguir? (Por defecto: mismo texto, simplicidad + no filtrar detalles.)
