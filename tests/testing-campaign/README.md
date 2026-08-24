# Campaña de testeos — Aura (TFC)

Versión congelada final: tag `campana-testing-final` (commit `0e848b2`, 2026-08-24). **Todos los resultados en `resultados/` corresponden a esta versión** — cualquier caso que haya fallado contra una versión anterior fue re-corrido tras el fix correspondiente hasta pasar contra esta versión final.

`campana-testing-v1` (commit `668306a`, 2026-08-23) fue el punto de partida de la campaña, antes de los fixes que la propia campaña encontró necesarios — se conserva como referencia histórica, no como versión de evidencia.

## Metodología

- El plan completo de casos está en `plan.json` (7 categorías, ~63 casos).
- Cada test se ejecuta manualmente contra el bot real de Telegram por el usuario.
- Después de cada test, se consulta la API de ejecuciones de n8n (`GET /api/v1/executions`) para extraer evidencia objetiva: qué nodos corrieron, con qué datos, si el gate correspondiente (injection/marcas/malware/confirmación) disparó como se esperaba.
- Cada resultado se guarda en `resultados/<categoria>/<id-del-caso>.json` con este esquema:

```json
{
  "id": "pdf-02",
  "categoria": "injection-pdf",
  "descripcion": "...",
  "esperado": "...",
  "timestamp": "2026-08-23T...",
  "execution_id": "1234",
  "evidencia": { "nodos_relevantes": {...} },
  "resultado_real": "...",
  "pass": true,
  "notas": "..."
}
```

- `resumen.json` en la raíz de `resultados/` agrega el conteo pass/fail por categoría, actualizado a medida que se corren los tests.

## Para quien lea esto (incluida una IA redactando el informe)

Esta carpeta es la fuente de verdad de la campaña de testeos. `plan.json` define qué se probó y por qué; cada archivo en `resultados/` es la evidencia de un caso puntual, con el ID de ejecución real de n8n como referencia verificable.
