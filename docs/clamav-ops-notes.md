# Notas de ops — Escaneo antivirus de PDFs (ClamAV)

Cambio: `pdf-virus-scan` — ver `openspec/changes/pdf-virus-scan/`.

> **Extensión a imagen/video**: la rama `existing-media-publishing` reutiliza este mismo
> contenedor y contrato — ver la sección [Extensión: rama imagen/video](#extensión-rama-imagenvideo-media-virus-scan)
> más abajo (`openspec/changes/input-security-hardening/`, capability `media-virus-scan`).
> No se repite acá lo que ya está documentado arriba (arquitectura, contrato `/v2/scan`,
> variables de entorno): es el mismo servicio, sin cambios.

## Arquitectura

Un **único contenedor** `clamav-rest` (imagen **`ajilaag/clamav-rest`** — "two in one", Alpine + Go REST + daemon ClamAV + freshclam, mantenida activamente, semver v1.2.x 2025+) corre el daemon y la REST API juntos. El servicio daemon separado planificado originalmente (`mkodockx/docker-clamav`) quedó **eliminado**: `solita/clamav-rest` no existe en Docker Hub (pull access denied) y `lokori/clamav-rest` crashea con exit 139 (segfault) en Docker moderno.

- REST interno en el puerto **9000**; bind host **`8082:9000` SOLO para debug** (`curl http://localhost:8082/version`). Los contenedores de la misma red usan el nombre del servicio + puerto interno, no el publicado. HTTPS en 9443 solo si se proveen certificados (no se usa por defecto).
- n8n llama **`http://clamav-rest:9000/v2/scan`** (red `postiz-network`).
- **Contrato `/v2/scan`** (`POST`, multipart field `file`): la respuesta es un **JSON array** — limpio → `[{"Status":"OK","Description":"","FileName":"..."}]` (HTTP **200**); infectado → `[{"Status":"FOUND","Description":"Eicar-Test-Signature","FileName":"..."}]` (HTTP **406**). Como es un array, n8n lo divide en items y `$json.Status` resuelve por item en el IF.
- Utilidades: `GET /version`, `GET /` (stats), `GET /metrics`.
- Volumen nombrado **`clamav_db:/clamav/data`** — firmas persistentes ante recreación del contenedor.
- Variables de entorno: `MAX_SCAN_SIZE` (100M), `MAX_FILE_SIZE` (25M — PDFs > 25 MB no se escanean; el gate de n8n es 20 MB), `SIGNATURE_CHECKS` (2 = actualización de firmas 2×/día), `TZ`, y `PROXY_*` si hacen falta.
- Healthcheck: `wget -q -O /dev/null http://localhost:9000/version` (wget existe en la imagen), `interval: 60s`, `retries: 5`, `start_period: 300s`.

## Puesta en marcha (primer arranque)

1. `docker compose up -d clamav-rest` (el bloque de compose ya está aplicado; no hace falta más).
2. La **primera descarga de firmas** se absorbe con `start_period: 300s`. Con la DB ya presente el contenedor llega a `healthy` en **~15 s**. Esperar a `healthy` en `docker compose ps`.
3. Smoke test desde el host: `curl http://localhost:8082/version`.
4. Workflow n8n: los nodos ya están en `codigo.json`; **re-importar `codigo.json` en n8n** para el workflow actualizado. URL del escáner fija: `http://clamav-rest:9000/v2/scan`.
5. `start-dev.ps1` no necesita cambios: como `n8n` tiene `depends_on: clamav-rest (service_healthy)`, el `docker compose up -d n8n postiz` del script levanta automáticamente `clamav-rest` (compose inicia dependencias transitivas). En el primer arranque n8n **no** arranca hasta que `clamav-rest` esté healthy (fail-closed a nivel infra); es el comportamiento esperado.

## Comportamiento y límites

- **Fail-closed**: si el escáner no responde, da timeout (≥ 60 s), devuelve 5xx o no devuelve `Status: OK`, el PDF se rechaza y el usuario recibe el mensaje `PDF rechazado`. Nunca llega a Gemini. El HTTP **406** (infectado) cae al error output del nodo HTTP (opción `Continue Error Output`) → `PDF rechazado`.
- **Límite de tamaño**: PDFs > 20 MB se rechazan con `PDF muy grande` ANTES de llamar al escáner (nodo IF `IF - Límite de tamaño PDF`). Umbral configurable en el nodo; por debajo del `MAX_FILE_SIZE` del contenedor (25M).
- ClamAV detecta **solo malware conocido por firmas** (no 0-days, no heurística avanzada). Considerar controles adicionales si el riesgo lo amerita.
- `clamd` consume memoria proporcional a las firmas (varios cientos de MB). El volumen `clamav_db` evita redescargas.

## Issues conocidos (fuera de scope)

- `codigo.json` contiene **secretos hardcodeados** (tokens de Supabase/Postiz). No se modifican en este cambio; documentados como issue conocido.

## Procedimiento de prueba EICAR

### Verificación de la API sin tocar el host (no requiere stack)

```
node tests/eicar/scan-rest-test.js
```

Construye el multipart **en memoria** con los bytes EICAR y POSTea a `/v2/scan`. Resultados **verificados live**:

| Test | Resultado |
|---|---|
| EICAR 68 bytes | `406 [{"Status":"FOUND","Description":"Eicar-Test-Signature",...}]` |
| PDF limpio | `200 [{"Status":"OK",...}]` |
| Body vía `/scanHandlerBody` | `{OK 200}` |
| Contenedor healthy | ~15 s (DB 27966, ClamAV 1.4.4) |

> **Caveat Windows Defender:** Defender bloquea la **lectura** de `tests/eicar/eicar-test.pdf` en el filesystem del host (PowerShell `Get-Content`/`Copy-Item` y `curl` no pueden leerlo: "el archivo contiene un virus"). Node sí puede **escribirlos** con el generador, pero los lectores del host quedan bloqueados. **Esto NO afecta el flujo real**: el archivo nunca toca el disco del host (Telegram → memoria de n8n → contenedor `clamav-rest`). Para pruebas locales de API sin leer archivos del host, usar `scan-rest-test.js`.

### End-to-end vía Telegram (requiere stack)

Generar los archivos de prueba (no requiere contenedores; node puede escribirlos):

```
node tests/eicar/generate-test-pdfs.js
```

Genera en `tests/eicar/`:

| Archivo | Caso | Resultado esperado |
|---|---|---|
| `eicar-test.pdf` | Malicioso (cadena EICAR exacta, 68 bytes) | `PDF rechazado` |
| `eicar-embedded-in-pdf.pdf` | Malicioso (EICAR dentro de PDF válido) | **Puede NO detectarse** (ver nota) |
| `catalogo-limpio.pdf` | Limpio (catálogo) | Procesamiento normal |

Nota sobre EICAR: ClamAV es **estricto** — solo detecta la cadena si el archivo **empieza** con los 68 caracteres y mide exactamente 68 bytes (hasta 128 con whitespace). EICAR **embebido** en medio de otro archivo generalmente NO se detecta (confirmado por el mantenedor de ClamAV, issue Cisco-Talos/clamav#1277). El caso confiable es `eicar-test.pdf`. El bot no valida estructura PDF antes del escaneo, así que un archivo de 68 bytes nombrado `.pdf` es suficiente para probar la ruta de rechazo.

### Pasos manuales

1. Stack arriba y `clamav-rest` en `healthy`.
2. Enviar al bot por Telegram (estado "PDF"): `eicar-test.pdf`.
   - **Esperado**: llega `PDF rechazado` (el archivo parece malicioso / no será procesado). El flujo NO continúa a Gemini y NO se escribe nada en Supabase.
3. Enviar `catalogo-limpio.pdf`.
   - **Esperado**: pasa el escaneo, continúa a `Analyze document` y el usuario recibe el resultado normal del catálogo.
4. **Fail-closed**: `docker compose stop clamav-rest`, enviar `catalogo-limpio.pdf` → debe llegar `PDF rechazado` (el PDF NO llega a Gemini). Volver a levantar: `docker compose start clamav-rest`.
5. **Límite de tamaño**: enviar un PDF > 20 MB (o simular) → debe llegar `PDF muy grande` sin invocar al escáner.

Advertencia: algunos antivirus del host (p.ej. Windows Defender) pueden marcar `eicar-test.pdf`; es un archivo de prueba inofensivo estándar. Si se borra, regenerar con el script. Para leerlo/enviarlo desde el host, desactivar momentáneamente la protección en tiempo real de Defender o usar `scan-rest-test.js`.

## Extensión: rama imagen/video (`media-virus-scan`)

Change: `input-security-hardening` — ver `openspec/changes/input-security-hardening/`, capability `media-virus-scan` (grupo 3 de `tasks.md`).

Extiende el mismo `clamav-rest` (sin servicio nuevo) a la rama de imagen/video de `existing-media-publishing`. Nodos nuevos en `codigo.json`, insertados entre `IF - Firma media válida` (grupo 1, `binary-signature-validation`) y `Ruteo por tipo de media`:

```
IF - Firma media válida (TRUE)
   ├─> Escaneo ClamAV media  ──(éxito, main output 0)──> Merge - Media + veredicto ClamAV (input 1)
   │        └─(error: timeout/5xx/conexión, main output 1)──> Media rechazada - malware
   └─> Merge - Media + veredicto ClamAV (input 0, recupera el binario original)
              └─> IF - Media limpia ($json.Status equals "OK")
                     ├─ TRUE  ─> Ruteo por tipo de media (flujo existente sin cambios)
                     └─ FALSE ─> Media rechazada - malware
```

Mismo contrato que la rama PDF: `POST http://clamav-rest:9000/v2/scan`, `multipart-form-data`, campo `file` tipo `formBinaryData` sobre el binario `data`, `timeout: 60000`, `onError: "continueErrorOutput"` como propiedad del nodo (verificado por script que NO está anidado dentro de `parameters`). El antivirus corre **antes** de `Moderar imagen Gemini` / `Moderar video Gemini`: son dos controles independientes (malware vs. contenido inapropiado, `design.md` D3) y ambos deben pasar — ninguno de los dos nodos de moderación fue modificado por este grupo (verificado por diff byte a byte contra el `codigo.json` previo).

### Límites verificados (no asumidos) — 2026-08-17

Contenedor `clamav-rest` ya corriendo (no se levantó nada nuevo), verificado con `docker inspect`:

| Variable | Valor efectivo |
|---|---|
| `MAX_FILE_SIZE` | `25M` |
| `MAX_SCAN_SIZE` | `100M` |

Límite de la rama media (`IF - Límite media existente`): **20 MB** y **90 s** de video — por debajo de `MAX_FILE_SIZE` (25M), con margen.

**Prueba real contra el contenedor** (`POST http://localhost:8082/v2/scan`, puerto de host solo para debug — igual que el resto de este documento): archivo sintético de **20.00 MB** (20,971,520 bytes) enviado como `video/mp4`:

| Corrida | HTTP | Resultado | Latencia observada |
|---|---|---|---|
| 1 (cold) | 200 | `{"Status":"OK"}` | 1457 ms |
| 2 (warm) | 200 | `{"Status":"OK"}` | 399 ms |

Ambas muy por debajo del `timeout: 60000` configurado en el nodo HTTP Request. No se rechaza ningún archivo dentro del límite de 20 MB por motivos del escáner.

### Verificación EICAR de la rama media

Mismo string EICAR estándar de 68 bytes que la rama PDF (no es malware real). Generador dedicado: `tests/eicar/generate-test-media.js` → escribe `tests/eicar/eicar-test-media.jpg` y `tests/eicar/eicar-test-media.mp4` (68 bytes cada uno). El archivo no necesita ser una imagen/video estructuralmente válido porque ClamAV escanea por bytes, no por extensión, y el escaneo corre antes que Gemini.

**Verificado directamente contra la API** (`node tests/eicar/scan-rest-test.js`-style call, sin pasar por Telegram):

```
eicar-test-media.jpg -> 406 [{"Status":"FOUND","Description":"Eicar-Test-Signature","FileName":"eicar-test-media.jpg"}]
```

Mismo veredicto y contrato que la rama PDF. **Pendiente (requiere Telegram real, no automatizable desde acá)**: enviar `eicar-test-media.jpg` al bot en el paso de subida de media existente y confirmar que llega `Media rechazada - malware` sin tocar `Moderar imagen/video Gemini`, `Redis - Guardar media existente` ni Postiz; luego enviar una imagen limpia normal y confirmar que sigue el flujo habitual.

### Fail-closed verificado en vivo — 2026-08-17

1. `docker compose stop clamav-rest` → confirmado detenido (`docker compose ps -a`: `Exited (137)`).
2. Con el contenedor detenido, una llamada a `/v2/scan` falla en ~94 ms (`fetch failed`, conexión rechazada) — el mismo modo de fallo que dispara `onError: "continueErrorOutput"` en el nodo `Escaneo ClamAV media` de n8n.
3. Verificado por inspección de `connections` en `codigo.json` (no a ojo) que la salida de error (`main` output index 1) de `Escaneo ClamAV media` apunta **únicamente** a `Media rechazada - malware`, y que ese nodo es terminal (no reenvía a `Moderar imagen/video Gemini`, `Redis - Guardar media existente` ni al nodo de subida a Postiz).
4. `docker compose up -d clamav-rest` → confirmado `healthy` de nuevo en ~45 s (`docker inspect --format '{{.State.Health.Status}}'`), y un escaneo de prueba posterior devolvió `200 {"Status":"OK"}`, confirmando que el servicio quedó operativo.

**Pendiente (requiere Telegram real)**: repetir el paso 2 pero enviando una imagen/video limpio real al bot mientras `clamav-rest` está detenido, y confirmar que el usuario recibe `Media rechazada - malware` en vez de que el archivo llegue a Gemini.

### Limitación declarada (igual que la rama PDF)

ClamAV detecta **malware conocido por firmas** (`SIGNATURE_CHECKS=2`, actualización 2×/día); no es sandboxing ni detección de comportamiento, y no cubre 0-days. Se documenta como riesgo residual conocido (`design.md` NG2), no como control completo — la moderación de contenido por IA es un control aparte, no un sustituto.
