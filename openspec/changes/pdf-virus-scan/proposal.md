## Why

El bot de Telegram "Aura" ingesta catálogos de productos que los usuarios envían como PDFs y los procesa con Gemini (analiza contenido, parsea a JSON y hace upsert en Supabase). Hoy no existe ninguna verificación de seguridad sobre el binario: un PDF malicioso enviado por un usuario llega directamente al pipeline de análisis, exponiendo al stack (n8n, Gemini) y a los datos del catálogo. Se necesita escanear el PDF con un antivirus (ClamAV) ANTES de que sea procesado por Gemini.

## What Changes

> **Nota de implementación (desviación final):** durante la implementación se verificó que la imagen `mkodockx/docker-clamav:buster` NO incluye REST API y que la imagen `solita/clamav-rest` no existe en Docker Hub (y `lokori/clamav-rest`, su build en CentOS7/Java8, crashea con exit 139 en Docker moderno). Se adoptó **`ajilaag/clamav-rest`** ("two in one": daemon ClamAV + REST API en un solo contenedor, Alpine/Go, mantenido con semver 2025+). Resultado: UN servicio `clamav-rest` (sin daemon separado), REST interno en `9000`, endpoint `POST /v2/scan` (multipart `file`, respuesta array con campo `Status`, HTTP 406 si infectado), volumen `clamav_db:/clamav/data`, puerto host `8082:9000` solo debug. Ver `design.md` (D1, D3) para el detalle y la evidencia de pruebas.

- **Infraestructura (Docker)**: Nuevo servicio `clamav-rest` en `docker-compose.yml` usando la imagen `ajilaag/clamav-rest` (daemon ClamAV + REST API en un solo contenedor), con `container_name: clamav-rest`, volumen persistente para firmas (`clamav_db:/clamav/data`), puerto publicado `8082:9000` (REST interno en 9000), env `MAX_SCAN_SIZE=100M`, `MAX_FILE_SIZE=25M`, `SIGNATURE_CHECKS=2`, `TZ`, y healthcheck `wget http://localhost:9000/version` con `start_period: 300s`.
- **Workflow n8n (bot Aura, rama PDF)**: Insertar dos nodos entre `Get a file2` y `Analyze document`:
  - HTTP Request `Escaneo ClamAV`: `POST multipart/form-data` a la REST API de ClamAV con el binario descargado (campo `file`), timeout ≥ 60 s.
  - IF `IF - PDF limpio`: si el resultado del escaneo es `OK` → continúa al nodo existente `Analyze document`; si no → nuevo nodo Telegram `PDF rechazado` que informa al usuario que el archivo parece malicioso y no será procesado (el flujo NO continúa a Gemini).
- **Política de seguridad**: Fail-closed. Si el escáner no responde, da error o el archivo excede el límite de tamaño, el PDF se rechaza y se notifica al usuario; jamás se procesa sin escaneo exitoso.
- **Limitación de tamaño**: IF previo al escaneo que rechaza PDFs por encima de un umbral configurable (recomendado 20 MB), por límites prácticos de ClamAV y Gemini.
- **Pruebas**: Procedimiento EICAR (PDF con la cadena EICAR estándar → caso malicioso; PDF normal → caso limpio) verificado vía Telegram.

## Capabilities

### New Capabilities

- `pdf-virus-scan`: Escaneo antivirus de PDFs entrantes en el bot Aura antes del análisis de Gemini — incluye el servicio ClamAV en el stack Docker, la inserción de nodos de escaneo y rechazo en la rama PDF del workflow, la política fail-closed y el límite de tamaño configurable.

### Modified Capabilities

*(Ninguna — no hay specs existentes que cambien sus requirements; verifica contra `openspec/specs/`)*

## Impact

- **Docker**: `docker-compose.yml` — nuevo servicio `clamav-rest` (imagen `ajilaag/clamav-rest`, volumen de firmas, puerto `8082:9000`, healthcheck, red `postiz-network`).
- **n8n**: Workflow "Aura" (rama PDF del bot). El cambio se implementa en el editor n8n y se re-exporta a `codigo.json` (export del workflow), o editando el JSON con cuidado.
- **Configuración**: Límite de tamaño configurable (recomendado 20 MB) como parámetro del nodo IF; endpoint de ClamAV (`http://clamav-rest:9000/v2/scan`).
- **Rendimiento/Operación**: Primera puesta en marcha del contenedor descarga firmas (5–15 min); ClamAV detecta malware conocido, no 0-days.
- **Seguridad (nota, fuera de scope)**: `codigo.json` contiene secretos hardcodeados (tokens de Supabase/Postiz); se documenta como issue conocido pero NO se modifica en este cambio.
