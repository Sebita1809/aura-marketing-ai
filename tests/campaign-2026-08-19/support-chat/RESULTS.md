# Resultados — Chat de soporte en tiempo real

**Método**: verificación manual por el equipo (no instrumentada vía logs de n8n, a diferencia del resto de la campaña — esta funcionalidad corre del lado de `aura-frontend`/Supabase realtime, no a través del workflow de n8n). Fecha: 2026-08-19.

## Resultado

Reportado por el equipo: **mensajes y notificación (campanita en la UI) llegan en tiempo real**, sin demoras perceptibles.

## Alcance de la verificación

Esto confirma el funcionamiento básico (entrega en tiempo real, feature ya implementada según registro previo del proyecto — ver notificación/campanita de `support-messaging`). No se registraron: cantidad de mensajes probados, si se probó con más de un usuario simultáneo, ni comportamiento bajo desconexión/reconexión. Si se quiere un resultado más riguroso para la tesis (con evidencia verificable, no solo reporte del equipo), habría que instrumentar esto de otra forma — por ejemplo capturando timestamps de envío/recepción en Supabase o en la consola del navegador.
