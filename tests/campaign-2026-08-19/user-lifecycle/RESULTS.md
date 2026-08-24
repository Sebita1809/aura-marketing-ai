# Resultados — Bloqueo y baja de usuario

Re-corrido el 2026-08-20 (madrugada, misma sesión de campaña) contra el pin de versión actual — hash de `codigo.json` verificado idéntico a `../codigo.snapshot.json` (`fb306bb4...`) al momento de la corrida. Reemplaza la verificación previa del 2026-08-18 (anterior a esta campaña, ver historial).

**Método**: secuencia real de acciones admin (bloquear/desbloquear/dar de baja/reactivar sobre la cuenta de prueba "Sebita", desde una cuenta admin separada) intercalada con mensajes al bot por Telegram. Verificado con la base de ejecuciones de n8n (`execution_entity`/`execution_data`), no solo por observación.

## Secuencia verificada

| # | Acción admin | Ejecución n8n | `HTTP - Chequear vinculacion` | Resultado real |
|---|---|---|---|---|
| 1 | Bloquear | #1037 · 01:01:07–01:01:09 | `{}` (sin id — no vinculado) | Bot pide código de verificación |
| 2 | Desbloquear | #1038 · 01:01:22–01:01:24 | `{id: "d42fa2f7-..."}` (vinculado) | Bot muestra el menú directo — **no pide código de nuevo** |
| 3 | Dar de baja | #1039 · 01:01:58–01:02:00 | `{}` (sin id) | Bot pide código de verificación |
| 4 | Reactivar | #1040 · 01:02:20–01:02:22 | `{}` (sin id, todavía) | Bot vuelve a pedir código — confirma que la baja invalidó el vínculo, a diferencia del bloqueo |
| 5 | (con código reingresado) | #1041 · 01:02:57–01:02:59 | `{id: "d42fa2f7-..."}` (vinculado de nuevo) | Bot muestra el menú normal |

## Interpretación

**Confirmado exactamente como se reportó el 2026-08-18, ahora con evidencia verificable contra la versión actual**: el bloqueo es una suspensión reversible que preserva el vínculo Telegram↔cuenta (`id` de vinculación no se pierde, paso #2 lo confirma sin necesidad de código). La baja, en cambio, invalida el vínculo — el paso #4 muestra que incluso *después* de reactivar la cuenta, `HTTP - Chequear vinculacion` sigue sin encontrar el `id` hasta que el usuario reingresa el código (paso #5). Diferencia de comportamiento intencional entre los dos niveles de severidad, tal como estaba documentado.
