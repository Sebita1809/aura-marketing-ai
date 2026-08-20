# Tasks: pdf-virus-scan

## 1. Docker — Servicio ClamAV (contenedor único daemon + REST)

> **Decisión de imagen (desviación final documentada):** la arquitectura original de dos servicios (daemon `mkodockx/docker-clamav:buster` + sidecar `solita/clamav-rest`) **falló en implementación** — `solita/clamav-rest` no existe en Docker Hub (pull access denied) y `lokori/clamav-rest` (mismo proyecto, build CentOS7/Java8) crashea con exit 139 (segfault) en Docker moderno. Se adoptó **`ajilaag/clamav-rest`** (imagen "two in one" mantenida activamente, semver v1.2.x 2025+): daemon ClamAV + REST Go en UN solo contenedor. El servicio daemon separado `clamav` queda **eliminado** y el contrato REST pasa a `/v2/scan` en el puerto interno 9000.

- [x] 1.1 Agregar el servicio único `clamav-rest` a `docker-compose.yml` con imagen `ajilaag/clamav-rest` (daemon + REST en el mismo contenedor), `container_name: clamav-rest`, `restart: unless-stopped`, puerto publicado `"8082:9000"` (solo debug desde el host; REST interno en 9000), env `MAX_SCAN_SIZE: 100M`, `MAX_FILE_SIZE: 25M`, `SIGNATURE_CHECKS: 2`, `TZ: America/Argentina/Buenos_Aires`, volumen `clamav_db:/clamav/data`, red `postiz-network`
- [x] 1.2 Configurar healthcheck de `clamav-rest`: `test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://localhost:9000/version"]`, `interval: 60s`, `timeout: 10s`, `retries: 5`, `start_period: 300s` (el binario `wget` existe en la imagen; verificado; healthy en ~15 s con la DB de firmas ya presente)
- [x] 1.3 Agregar el volumen nombrado `clamav_db:` a la sección `volumes:` de `docker-compose.yml` (firmas persistentes en `/clamav/data` ante recreación del contenedor)
- [x] 1.4 Agregar (aplicado) `clamav-rest` al `depends_on` del servicio `n8n` con `condition: service_healthy` para garantizar fail-closed a nivel infraestructura; el caveat de la primera descarga de firmas se absorbe con `start_period: 300s`
- [x] 1.5 Levantar el servicio: `docker compose up -d clamav-rest` y esperar a que reporte `healthy` en `docker compose ps` (primera descarga de firmas al primer arranque) — VERIFICADO live 2026-08-06: contenedor `Up 3 hours (healthy)`
- [x] 1.6 Smoke test desde el host: `curl http://localhost:8082/version` responde correctamente — VERIFICADO live 2026-08-06: `{ "Clamav": "1.4.4", "Signature": "28083", "Signature_date": "Wed Aug 5 03:24:50 2026" }`

## 2. Workflow n8n — Inserción de nodos en la rama PDF

> El workflow vive en n8n; `codigo.json` es un export. Implementar los cambios en el editor de n8n (o editando `codigo.json` con cuidado) y **re-exportar/sincronizar `codigo.json` al finalizar cada task de este grupo**. No dejar el export desincronizado.

- [x] 2.1 Crear el nodo IF `IF - Límite de tamaño PDF` entre `Get a file2` y el resto de la rama: condición numérica sobre `={{ $('Get a file2').item.binary.data.fileSize }}` `<= 20000000` (umbral configurable, 20 MB por defecto)
- [x] 2.2 Crear el nodo Telegram `PDF muy grande` (output FALSE del IF de tamaño) con `chatId: "={{ $('Code in JavaScript5').item.json.id_chat }}"`, avisando que el PDF supera el tamaño máximo y no será procesado
- [x] 2.3 Crear el nodo HTTP Request `Escaneo ClamAV` (output TRUE del IF de tamaño): `POST http://clamav-rest:9000/v2/scan`, body `Multipart Form-Data`, parámetro `file` con tipo `File` vinculado al binario (`data`) de `Get a file2`, timeout ≥ 60000 ms, opción **On Error → Continue Error Output** (el HTTP 406 de archivos infectados cae al error output → `PDF rechazado`, fail-closed; limpios HTTP 200 → output de éxito). Respuesta `/v2/scan` es un **JSON array** que n8n divide en items: limpio `[{"Status":"OK",...}]`, infectado `[{"Status":"FOUND","Description":"Eicar-Test-Signature",...}]`
- [x] 2.4 Crear el nodo IF `IF - PDF limpio` (output del HTTP Request): condición string `={{ $json.Status }}` `equals` `"OK"`
- [x] 2.5 Crear el nodo Telegram `PDF rechazado`: `chatId: "={{ $('Code in JavaScript5').item.json.id_chat }}"`, mensaje informando que el archivo parece malicioso y **no será procesado**; conectar el output FALSE de `IF - PDF limpio` Y el error output de `Escaneo ClamAV` (fail-closed)
  - ⚠️ **Regresión detectada y corregida (2026-08-17)**: verificación en vivo durante el change `input-security-hardening` (grupo 3, antivirus de media) encontró que el error output de `Escaneo ClamAV` **no tenía ninguna conexión** en `codigo.json`, pese a que esta task lo daba por hecho — si ClamAV fallaba/timeouteaba escaneando un PDF, no caía en fail-closed. Confirmado por inspección directa de `connections` (no solo por lo que decía este archivo). Corregido: `Escaneo ClamAV` salida de error (índice 1) → `PDF rechazado` (índice 0). Backup pre-fix en `codigo.json.bak-pdf-clamav-error-fix`.
- [x] 2.6 Reconectar la rama: output de `Get a file2` → `IF - Límite de tamaño PDF` (reemplaza la conexión directa actual a `Analyze document`); output TRUE de `IF - PDF limpio` → `Analyze document` (nodo existente, sin cambios en sus parámetros)
- [x] 2.7 Acomodar las posiciones (x,y) de los nodos nuevos al layout existente de la rama PDF (eje Y `99808`) — validación de guardado/ejecución en el editor n8n: pending-manual tras re-import
- [x] 2.8 `codigo.json` editado como export sincronizado; verificado por inspección que `Get a file2` ya no apunta directo a `Analyze document` y que los 5 nodos nuevos existen (el "re-export" real requiere re-importar en el editor n8n: pending-manual)

## 3. Configuración

- [x] 3.1 Confirmar que n8n no requiere variables de entorno nuevas (URL del escáner es fija `http://clamav-rest:9000/v2/scan` en la red interna; límite de tamaño configurable dentro del nodo IF)
- [x] 3.2 Documentar en el README/notas de ops: primer arranque descarga firmas (`start_period: 300s`), ClamAV detecta solo malware conocido (no 0-days), puerto host `8082` solo para debug, contrato `/v2/scan` (array + HTTP 406), caveat de Windows Defender sobre el archivo EICAR — `docs/clamav-ops-notes.md`
- [x] 3.3 Nota (fuera de scope, documentar): `codigo.json` contiene secretos hardcodeados (Supabase/Postiz); no se modifican en este cambio — documentado en `docs/clamav-ops-notes.md`

## 4. Testing — Procedimiento EICAR

- [x] 4.1 Preparar el archivo de caso malicioso: `tests/eicar/generate-test-pdfs.js` genera `eicar-test.pdf` (cadena EICAR exacta, 68 bytes — único caso con detección garantizada por ClamAV; ver nota en `docs/clamav-ops-notes.md` sobre el comportamiento estricto de EICAR) y `eicar-embedded-in-pdf.pdf` (EICAR embebido en PDF válido, detección NO garantizada). Nota: node puede ESCRIBIR los archivos, pero **Windows Defender bloquea su lectura desde el host** (PowerShell `Get-Content`/`Copy-Item` y `curl` no pueden leerlos: "el archivo contiene un virus")
- [x] 4.2 Preparar el archivo de caso limpio: `tests/eicar/generate-test-pdfs.js` genera `catalogo-limpio.pdf` (catálogo normal)
- [x] 4.3 Verificación de la API sin leer archivos del host: `node tests/eicar/scan-rest-test.js` (construye el multipart en memoria con los bytes EICAR y POSTea a `http://clamav-rest:9000/v2/scan`; elude el bloqueo de Windows Defender sobre `eicar-test.pdf` en el filesystem). Resultados verificados live: EICAR 68 bytes → `406 [{"Status":"FOUND","Description":"Eicar-Test-Signature",...}]`; PDF limpio → `200 [{"Status":"OK",...}]`; body vía `/scanHandlerBody` → `{OK 200}`; contenedor healthy en ~15 s (DB 27966, ClamAV 1.4.4)
- [ ] 4.4 Enviar el PDF con EICAR al bot por Telegram y verificar: llega el mensaje `PDF rechazado` (archivo parece malicioso), el flujo NO continúa a Gemini y NO se escribe nada en Supabase — pending-manual: requiere stack + Telegram
- [ ] 4.5 Enviar el PDF limpio al bot por Telegram y verificar: pasa el escaneo, continúa a `Analyze document` y el usuario recibe el resultado normal del catálogo — pending-manual: requiere stack + Telegram
- [ ] 4.6 Verificar fail-closed: detener el servicio `clamav-rest` (`docker compose stop clamav-rest`), enviar un PDF limpio y confirmar que el usuario recibe el mensaje de rechazo en vez de que el PDF llegue a Gemini; volver a levantar el servicio — pending-manual: requiere manipular contenedores
- [ ] 4.7 Verificar límite de tamaño: enviar (o simular) un PDF > 20 MB y confirmar el mensaje `PDF muy grande` sin invocar al escáner — pending-manual: requiere stack
