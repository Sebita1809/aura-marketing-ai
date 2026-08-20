# F4 — Evidencia de ejecución de los 5 scripts de verificación

> Responde a la pregunta F4 de `Preguntas-pendientes-V6.md`: si `verify-ttl.js`, `verify-retries.js`,
> `verify-link-flow.js`, `test-link-code.js` y `verify-dashboard.js` se ejecutaron y con qué resultado.
> Antes de esta corrida, los 5 scripts existían pero ninguno tenía salida conservada — solo se habían
> corrido de forma interactiva sin guardar el output. Este archivo deja la evidencia persistida.

## Reproducibilidad

- Corrida: 2026-08-19T00:39 UTC (aprox., ver timestamp por script en cada log)
- `codigo.json` sha256: `d85ef402180de88eebe9cb1a470db673cc221a24c1a5a450c23822e670e35489`
- `codigo.json` mtime: `2026-08-19T00:39:41.580Z`
- Nodos en el workflow: 232

## Resultado

Los 5 scripts se ejecutaron con `node <script>.js` y terminaron con **exit code 0** (todas las
verificaciones pasadas). La salida completa de cada uno queda conservada junto al script, en un
archivo `*-output.log` con encabezado de fecha/comando:

| Script | Log completo | Resultado |
|---|---|---|
| `tests/redis-expiration/verify-ttl.js` | `tests/redis-expiration/verify-ttl-output.log` | exit 0 — todas OK |
| `tests/error-handling/verify-retries.js` | `tests/error-handling/verify-retries-output.log` | exit 0 — todas OK |
| `tests/link-code/verify-link-flow.js` | `tests/link-code/verify-link-flow-output.log` | exit 0 — todas OK |
| `tests/rng/test-link-code.js` | `tests/rng/test-link-code-output.log` | exit 0 — 200/200 llamadas OK |
| `tests/admin-dashboard-metrics/verify-dashboard.js` | `tests/admin-dashboard-metrics/verify-dashboard-output.log` | exit 0 — todas OK |

## Nota sobre la corrida previa (histórico, no repetir en el informe salvo que se pida el detalle)

Antes de esta corrida, `verify-ttl.js`, `verify-retries.js` y `verify-link-flow.js` fallaban por
conteos hardcodeados de una versión vieja del flujo (120 nodos vs. los 232 actuales) — no por una
regresión real. Se actualizaron los valores esperados de los tres scripts contra el `codigo.json`
real (nodos renombrados identificados por su patrón de key/operación, no borrados a ciegas; listas
de retry/TTL recalculadas por inspección directa del archivo) antes de esta corrida final. El detalle
de esas correcciones queda documentado en comentarios dentro de cada script.

## Limitaciones

- Estos 5 scripts son auditorías **estáticas y/o offline** sobre `codigo.json` y (en el caso de
  `test-link-code.js`) sobre el algoritmo real extraído del nodo `Code - Generar código`. No
  ejercitan el bot en producción end-to-end — ver `docs/pruebas-antimalware-y-firma-binaria.md` y
  `tests/prompt-injection/GATE-REPORT.md` para las corridas que sí llaman APIs reales.
- Esta corrida mide el estado de `codigo.json` al sha256 declarado arriba. Si el archivo cambia,
  hay que volver a correr los 5 scripts para que la evidencia siga siendo válida.
