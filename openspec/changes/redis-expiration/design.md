# Design: Expiración de claves Redis del workflow n8n (redis-expiration)

## Context

El workflow "Aura" (exportado en `codigo.json`, 115 nodos) persiste estado efímero de sesión en Redis a través de **29 nodos** de tipo `n8n-nodes-base.redis` (typeVersion 1, credencial `redis`):

- **22 nodos de escritura** — 21 `set` + 1 `push` (LPUSH) — que escriben 6 familias de claves con sufijo `<id_chat>`.
- **7 nodos de lectura** — `get`/`llen`/`pop` — que NO se modifican.

### Auditoría de nodos de escritura (evidencia)

| Nodo | Operación | Clave (patrón) | Valor | Familia |
|---|---|---|---|---|
| Redis36 | `set` | `chat_<id_chat>` | texto | chat |
| Redis35 | `set` | `chat_<id_chat>` | texto | chat |
| Redis33 | `set` | `chat_<id_chat>` | texto | chat |
| Redis32 | `set` | `chat_<id_chat>` | texto | chat |
| Redis26 | `set` | `chat_<id_chat>` | texto | chat |
| Redis25 | `set` | `chat_<id_chat>` | texto | chat |
| Redis20 | `set` | `chat_<id_chat>` | texto | chat |
| Redis22 | `set` | `chat_<id_chat>` | texto | chat |
| Redis19 | `set` | `chat_<id_chat>` | texto | chat |
| Redis18 | `set` | `chat_<id_chat>` | texto | chat |
| Redis12 | `set` | `chat_<id_chat>` | texto | chat |
| Redis11 | `set` | `chat_<id_chat>` | texto | chat |
| Redis9 | `set` | `chat_<id_chat>` | texto | chat |
| Redis13 | `set` | `chat_<id_chat>` | `""` (reseteo) | chat |
| «Redis - Estado descripcion» | `set` | `chat_<id_chat>` | texto | chat |
| Redis28 | `set` | `chat_<id_chat>` | texto | chat |
| Redis23 | `set` | `especificaciones_<id_chat>` | texto | especificaciones |
| Redis3 | `set` | `especificaciones_<id_chat>` | texto | especificaciones |
| Redis5 | `set` | `especificaciones_rehacer_<id_chat>` | texto | especificaciones_rehacer |
| Redis4 | `set` | `publicidad_<id_chat>` | texto | publicidad |
| «Redis - Guardar descripcion» | `set` | `descripcion_<id_chat>` | texto | descripcion |
| Redis6 | `push` | `fotos_<id_chat>` | `file_id` | fotos |

**Total: 22 nodos de escritura sobre 6 familias. Sin ninguna expiración hoy** (`HALLAZGOS-DEL-FLUJO-n8n.md` §3.1): las claves string y la lista `fotos_` quedan en Redis indefinidamente, incluyendo `file_id` de Telegram.

### Capacidades del nodo Redis built-in (verificado en el source de n8n)

El nodo `n8n-nodes-base.redis` es **typeVersion 1 únicamente**. Operaciones disponibles: `delete`, `get`, `incr`, `info`, `keys`, `llen`, `pop`, `publish`, `push`, `set`. **No existe** operación `EXPIRE` ni `command`. La operación **`set` soporta nativamente `expire` (boolean) + `ttl` (seconds)**: `setValue()` ejecuta `client.set(key, value)` y luego `client.expire(key, ttl)` dentro del mismo nodo, por lo que **cada escritura refresca el TTL**. La operación `push` **no** soporta TTL, y Redis auto-elimina una lista cuando se hace `pop` de su último elemento (por eso `fotos_` se auto-limpia en el happy path tras el último `lpop`, pero sobrevive si el usuario abandona la sesión sin llegar al loop de análisis).

## Goals

- **G1.** Toda clave de sesión efímera de las 6 familias expira, garantizando que ningún `file_id` ni texto de producto queda en Redis indefinidamente.
- **G2.** El TTL se refresca con cada escritura (una sesión larga no muere a mitad del flujo).
- **G3.** Sin cambios en la máquina de estados, nombres de clave, conexiones, credenciales, ni en los nodos de lectura.
- **G4.** Verificación posible offline (sin stack vivo) + verificación live opcional.

## Non-Goals

- No se implementa un barrido (sweep) externo de claves huérfanas.
- No se cambia la arquitectura de la máquina de estados ni el espacio de claves.
- No se toca la cadena ClamAV (`pdf-virus-scan`) ni la migración de credenciales (`secrets-migration`).
- No se agrega expiración a ninguna clave que no sea de estas 6 familias.

## Decisions

### D1 — Mecanismo: `expire`/`ttl` nativos en los 21 nodos `set`

En cada uno de los **21 nodos `set`** se agrega `"expire": true` + `"ttl": <constante de familia>` a `parameters`. Cero nodos nuevos, cero reconexiones; el TTL se refresca en cada escritura (la clave expira a las 24 h de su última escritura).

- Evidencia: `utils.ts` de n8n — `setValue()` → `client.set()` + `client.expire()`.
- Contraintuitivo: el valor `ttl` en el nodo es la clave del usuario; n8n lo aplica como **segundos**.

### D2 — Lista `fotos_`: la operación `push` no soporta TTL

El nodo built-in no puede poner TTL a una lista. Dos opciones, **decisión de usuario**:

- **D2-A (recomendado) — TTL real con community node.** Agregar el nodo `Redis - Expirar fotos` (community node `@fancyheat/n8n-nodes-redis-enhanced`, operación `expire`, params `key` = `fotos_<id_chat>` + `seconds` = TTL_FOTOS) como **rama colgante** a la salida de `Redis6` (fan-out aditivo: `Redis6` sigue alimentando a «Send a text message7», y además el nuevo nodo recibe la misma salida; su propia salida queda desconectada → no consume nada de los nodos posteriores). El TTL se refresca con cada `lpush`. Requiere instalar el community node antes de re-importar `codigo.json`.
- **D2-B (sin dependencias) — no TTL; auto-limpieza + barrido manual.** Redis auto-elimina la lista en el happy path (tras el último `lpop`); para sesiones abandonadas se documenta un barrido manual (`KEYS fotos_*` + `DEL`). Sin dependencias, pero los `file_id` de sesiones abandonadas persisten hasta el barrido manual.

**Recomendación: D2-A.** Es el único mecanismo que garantiza que los `file_id` no persisten nunca.

### D3 — `Redis13` (reseteo de estado): se mantiene como `set` con valor `""`

**No** se convierte en `delete`: el reseteo hoy escribe `chat_<id_chat>` = `""`, y el evaluador de estados lee esa clave con `get` (Redis27) esperando un string (estado vacío). Convertirlo en `delete` haría que `get` devuelva `null` (clave ausente) → riesgo de cambiar el comportamiento de la máquina de estados. Con TTL nativo, `Redis13` escribe `""` + `expire`/`ttl` de la familia `chat_`: resetea igual que hoy y además se auto-limpia.

### D4 — Constantes TTL por familia (valores propuestos, ajustables)

Una sola constante por familia; el mismo TTL en todos los nodos de esa familia:

| Constante | Valor | Familia | Nodos |
|---|---|---|---|
| `TTL_CHAT` | 86400 s (24 h) | `chat_` | 16 |
| `TTL_ESPECIFICACIONES` | 86400 s | `especificaciones_` | 2 |
| `TTL_ESPECIFICACIONES_REHACER` | 86400 s | `especificaciones_rehacer_` | 1 |
| `TTL_DESCRIPCION` | 86400 s | `descripcion_` | 1 |
| `TTL_PUBLICIDAD` | 86400 s | `publicidad_` | 1 |
| `TTL_FOTOS` | 86400 s | `fotos_` (D2-A) | 1 (nodo expire) |

Justificación del 24 h: las sesiones duran minutos/horas; los `Wait` más largos del flujo son 10 min; la generación/publicación de imágenes insumía minutos. 24 h cubre la sesión más larga razonable + un día completo de abandono, y luego la clave se auto-elimina. Como el TTL se refresca por escritura, el riesgo de matar una sesión activa es nulo. **Ajustables por el usuario si prefiere otro valor.**

## Risks and Trade-offs

- **Sesión abandonada > 24 h → el usuario debe volver a `/start`.** El evaluador verá `get` = `null` (misma clase de degradación que el reseteo de `Redis13`). Aceptable y es el comportamiento deseado (la clave muere).
- **D2-A agrega una dependencia de community node** (paquete tercero, menos mantenido que el built-in) y requiere instalarlo antes del re-import. Mitigación: es una rama colgante — si el nodo fallara, su error solo impacta la rama `fotos_` y queda visible en el ejecutor; el resto del flujo no depende de su salida. Alternativa: D2-B.
- **Si el usuario elige D2-B**, el requisito de spec para `fotos_` («no persiste indefinidamente») no se cumple en el caso de abandono → requiere ajustar el spec (desviación documentada).
- **Renovación de TTL en flujos en bucle**: la operación `set` con `expire` refresca en cada ejecución; sin riesgo de expiración prematura.
- **Valor de `ttl` mal entendido como minutos** — es segundos. El script de verificación estática valida el rango.

## Migration

1. Aplicar los cambios de `parameters` en `codigo.json` (marcar task → editar → validar JSON) — la fuente de sincronización es `codigo.json`.
2. Si D2-A: instalar community node `@fancyheat/n8n-nodes-redis-enhanced` en n8n; **antes** de re-importar.
3. Re-importar `codigo.json` en n8n (si aplica).
4. Verificación offline: `node tests/redis-expiration/verify-ttl.js` (auditoría estática + simulación mock).
5. Verificación live (pending-manual): mensaje real al bot; desde `redis-cli` confirmar `TTL <clave>` = 86400 y que las claves desaparecen tras el TTL; confirmar refresco durante una sesión activa.
6. Actualizar `HALLAZGOS-DEL-FLUJO-n8n.md` §3.1 (estado de remediación).

## Open Questions

- ¿24 h por familia o un valor global único? (propuesto: 86400 en todas)
- ¿D2-A (community node, TTL real en `fotos_`) o D2-B (sin dependencias, barrido manual)?
- ¿Se requiere verificación live en este entorno, o basta con la offline?
