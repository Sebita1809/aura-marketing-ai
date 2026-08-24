# Campaña de testeo — 2026-08-19

## Pin de versión

Todas las pruebas de esta carpeta corren sobre esta versión exacta del flujo, congelada acá para evitar el problema de D4-01 (campaña anterior corrida sobre una versión distinta a la entregada, sin forma verificable de comprobarlo).

| Campo | Valor |
|---|---|
| Archivo fuente | `codigo.json` (raíz del repo) |
| Snapshot congelado | `codigo.snapshot.json` (esta carpeta — copia exacta, no vivo) |
| SHA-256 | `fb306bb4ab93c791997e06da30377e7120a6d0e0be52ca4da96d092e27574c50` |
| Nº de nodos | 247 (incluye 2 nodos temporales sin ejecutar, ver abajo) |
| Fecha de congelado | 2026-08-19 (re-congelado tras simplificar la prompt de la zona del watermark, Ronda 15) |
| Cambios recientes incluidos | Rediseño de marca de agua + prompts de Gemini actualizados (zona 220x220px) + fix de pestaña hardcodeada (`iPhones Usados` → `Hoja 1`) + parser endurecido + `IF - Producto valido para upsert` + rediseño del flujo de Google Sheets (verificado en vivo, ver `excel-injection/RESULTS.md`) + **guarda de idempotencia** (`Redis - Get/Set dedup notificacion imagen` + `IF - Ya se notifico (dedup)`) en el camino de carga por imagen, para el hallazgo de mensajes duplicados (ver abajo). |
| **Nodos temporales pendientes** | `HTTP - TEMP restaurar Lombardo Simple` + su Manual Trigger — arreglan `LOMBARDO SIMPLE` (Sheets, caso 2). **Faltan armar los mismos para**: `TIJUANA SIMPLE` (imagen, quedó en $1), `LOMBARDO DOBLE` (PDF, quedó en $1). Ninguno ejecutado a propósito, para no interrumpir el registro de la campaña — restaurar los tres juntos cuando se decida cerrar la limpieza de datos de prueba. |
| **Hallazgo — inconsistencia de postura defensiva entre superficies** | Sheets rechaza el archivo completo si detecta prompt injection (`AI Agent1` → "Contenido inapropiado"). PDF (`Analyze document`) detecta, alerta al admin, pero **permite que la carga continúe igual** (ver `prompt-injection-media/RESULTS.md`, caso PDF sobrescritura). Recomendación para la tesis: unificar el criterio entre superficies o documentar la diferencia como decisión de diseño intencional. |
| **Hallazgo — mensajes duplicados en carga por imagen** | Se observaron ~20 y ~40 copias del mismo mensaje de éxito ("Hemos podido almacenar...") en tres incidentes reales durante la campaña. Investigado a fondo vía `execution_entity`/`execution_data`: en los primeros dos el nodo que manda el mensaje corrió **una sola vez** según los registros de n8n — sin evidencia de loop en la lógica del workflow ni errores en los logs del contenedor. Primer intento de mitigación (`Redis - Get/Set dedup notificacion imagen`, guarda puesta cerca del mensaje puntual) **no cortó el problema** en el tercer incidente — indica que la ejecución completa se está re-disparando desde el Trigger, no solo reintentando el último paso. Se reemplazó por una guarda global por `update_id` de Telegram (`Redis - Get/Set update_id visto` + `IF - update_id duplicado`), puesta como primer nodo después de `Telegram Trigger` — corta cualquier reprocesamiento completo de un update ya visto, no solo un mensaje puntual. Causa raíz de fondo (por qué se re-dispara) sigue sin confirmar. **Bug propio introducido por esta guarda**: el nodo Redis `get` no fusiona el valor leído con el `$json` existente como se asumió — lo reemplaza entero, dejando solo `{yaVisto: ...}` y perdiendo `message`/`callback_query`/`update_id` originales. Esto rompió el bot completo (cualquier mensaje o botón, no solo el caso probado) con el error `Cannot read properties of undefined (reading 'photo')` en `Code in JavaScript7`. Corregido con `Code - Restaurar payload original` (recompone `$json` desde `$('Telegram Trigger').item.json` justo después de la guarda). **Causa raíz REAL encontrada (no era de red)**: contando *items* por nodo (no solo cuántas veces corrió cada uno) en la ejecución #946, se vio que `HTTP - Upsert producto imagen` devolvía **49 items** en su salida — el RPC de Supabase responde con el catálogo completo del usuario, no solo el producto subido. Sin nada que lo redujera, cada nodo posterior (incluido el que manda el mensaje de Telegram) procesaba los 49 items y mandaba el mensaje 49 veces — coincide con que la cantidad reportada fue subiendo (20 → 40 → 49) al mismo ritmo que crecía el catálogo con cada test de la sesión. Corregido con `Code - Reducir a 1 item (fix duplicados)` justo después de `HTTP - Upsert producto imagen`. El camino de Sheets/PDF nunca tuvo este problema: arma su mensaje de resumen desde los datos ya parseados antes del upsert, no desde la respuesta del upsert. Las dos guardas de idempotencia agregadas antes (`update_id` y `dedup_notif_imagen`) quedan como defensa extra, inofensivas, pero esta es la corrección real. **Confirmado en vivo (ejecución #951): `HTTP - Upsert producto imagen` sigue devolviendo 49 items, `Code - Reducir a 1 item` lo reduce a 1, `Mensaje predeterminado1` mandó exactamente 1 mensaje.** Cerrado. |

Para verificar que el `codigo.json` que se importó en n8n al momento de correr una prueba coincide con este pin:

```bash
sha256sum codigo.json
# debe coincidir con el SHA-256 de arriba
```

Si no coincide, **no correr la prueba** hasta re-alinear versiones (reimportar este snapshot, o volver a congelar uno nuevo si el cambio fue intencional).

## Estructura

| Carpeta | Qué prueba | Estado |
|---|---|---|
| `excel-injection/` | 3 Google Sheets: 1 prompt injection, 1 sobrescritura de producto, 1 limpio (control) | **Completo** — ver `RESULTS.md` (caso 1: defensa OK; caso 3: OK; caso 2: vulnerabilidad confirmada) |
| `prompt-injection-media/` | 3 PDF + 3 imágenes: 1 injection + 1 sobrescritura + 1 limpio cada uno | **Completo** — ver `RESULTS.md` (imagen: 3/3 OK; PDF: injection OK, sobrescritura confirmada — vulnerabilidad transversal a las 3 superficies) |
| `product-overwrite/` | Casos de sobrescritura de productos (excel/pdf/imagen) — evidencia consolidada | Pendiente |
| `malware-signatures/` | Firmas binarias + antivirus (ClamAV) sobre esta versión — reusa/extiende `tests/eicar/` y `tests/magic-bytes/` | **Completo** — ver `RESULTS.md` (20/20 casos correctos: 5 antivirus incl. media, 15 firma binaria) |
| `user-lifecycle/` | Bloqueo y baja de usuario — verificación de comunicación página↔bot | **Completo**, re-verificado contra el pin actual con evidencia real (ejecuciones #1037-#1041) — ver `RESULTS.md` |
| `product-sync/` | Carga de producto nuevo en la página → verificación de que el bot lo reconoce | **Completo**, verificado visualmente contra el pin actual — ver `RESULTS.md` |
| `support-chat/` | Chat en tiempo real — funcionamiento del soporte | **Completo** (verificación manual, no instrumentada — ver `RESULTS.md`) |

**Nota**: `generation-timing/` (8 generaciones cronometradas) se sacó de esta carpeta — cronometrado por el equipo directamente, fuera de este registro.

Cada carpeta lleva su propio `REPORT.md`/`RESULTS.md` con resultados reales (no antes de correr la prueba), más los archivos crudos de la ejecución (export de n8n, logs, capturas) — mismo criterio que ya usan en `tests/prompt-injection/` y `docs/pruebas-antimalware-y-firma-binaria.md`.
