# Contrato de eventos de uso (`usage_events`)

> Input del change hermano **`n8n-usage-events-logging`**, que instrumenta `codigo.json` para que
> el bot empiece a escribir en `public.usage_events`. Este documento es copy-ready: no debería
> requerir ninguna decisión de diseño de quien lo implemente. Fuente de verdad del esquema:
> `aura-frontend/supabase/migrations/20260818140412_usage_events.sql` y la spec
> `openspec/changes/admin-dashboard-metrics/specs/usage-events-tracking/spec.md`.

## 1. Endpoint y autenticación

```
POST https://legffrhakunfignlaftl.supabase.co/rest/v1/usage_events
```

- Nodo: `n8n-nodes-base.httpRequest`, `method: POST`.
- `authentication: genericCredentialType`, `genericAuthType: httpHeaderAuth`.
- Credencial: **"Supabase Service Role"** (la misma que usa `HTTP - Upsert producto imagen`,
  `HTTP - Chequear vinculacion` y `HTTP - Perfil publicacion` en `codigo.json`). `service_role`
  bypasea RLS — es el único escritor posible, porque `usage_events` no tiene ninguna política de
  INSERT para `anon`/`authenticated`.
- Header adicional: `Prefer: resolution=ignore-duplicates` (ver §2, idempotencia).
- `retryOnFail: true`, `alwaysOutputData: true`. **No** debe cortar el flujo si falla (§6).

**Nodo de referencia a clonar:** `HTTP - Upsert producto imagen` (mismo patrón `httpHeaderAuth` +
credencial + body JSON armado con una expresión n8n). La única diferencia funcional es el header
`Prefer` (`ignore-duplicates` acá vs. `merge-duplicates` allá, porque `usage_events` no tiene
`on_conflict` por columna de negocio, sino por `event_key`) y que este endpoint no lleva
`?on_conflict=` en la URL — el conflicto se resuelve por la constraint `UNIQUE (event_key)` de la
tabla.

## 2. `event_key` — formato obligatorio y por qué existe

```
<execution_id>:<node_name>:<item_index>
```

Expresión n8n concreta a usar en el body:

```
{{ $execution.id }}:<node_name-literal>:{{ $itemIndex }}
```

Ejemplo para el nodo posterior a `Generate an image`:

```
{{ $execution.id }}:image_generated:{{ $itemIndex }}
```

**Por qué:** n8n reintenta (`retryOnFail`) y puede re-ejecutar ramas del workflow. Sin protección,
una imagen se contaría dos veces y el costo quedaría inflado (design D9). `event_key` es
`UNIQUE NOT NULL` en la tabla; combinado con `Prefer: resolution=ignore-duplicates`, un POST
repetido con el mismo `event_key` es un no-op — PostgREST responde éxito sin insertar una segunda
fila. La deduplicación vive en la base de datos, la única frontera confiable; no se confía en que
el workflow "no se re-ejecute".

## 3. Payload por `event_type`

Todos los campos no listados explícitamente abajo quedan `null`/default (ver el `CREATE TABLE` en
la migración: `provider` default `'google'`, `quantity` default `1`, `metadata` default `{}`).

### `image_generated` — después de `Generate an image`

```json
{
  "event_key": "{{ $execution.id }}:image_generated:{{ $itemIndex }}",
  "event_type": "image_generated",
  "user_id": "{{ $('HTTP - Chequear vinculacion').item.json.id }}",
  "telegram_chat_id": "{{ $('Trigger').item.json.message.chat.id }}",
  "provider": "google",
  "model": "models/gemini-3-pro-image-preview",
  "quantity": 1,
  "input_tokens": null,
  "output_tokens": null,
  "metadata": { "node": "Generate an image" }
}
```

### `image_edited` — después de `Edit an image`

```json
{
  "event_key": "{{ $execution.id }}:image_edited:{{ $itemIndex }}",
  "event_type": "image_edited",
  "user_id": "{{ $('HTTP - Chequear vinculacion').item.json.id }}",
  "telegram_chat_id": "{{ $('Trigger').item.json.message.chat.id }}",
  "provider": "google",
  "model": "models/gemini-3-pro-image-preview",
  "quantity": 1,
  "input_tokens": null,
  "output_tokens": null,
  "metadata": { "node": "Edit an image" }
}
```

### `post_published` — después de `HTTP - Crear post Postiz`

`quantity` es la **cantidad de plataformas** a las que se publicó (design D10 / spec "One post
published to several platforms"), no 1 fijo.

```json
{
  "event_key": "{{ $execution.id }}:post_published:{{ $itemIndex }}",
  "event_type": "post_published",
  "user_id": "{{ $('HTTP - Perfil publicacion').item.json.id }}",
  "telegram_chat_id": "{{ $('Trigger').item.json.message.chat.id }}",
  "provider": "postiz",
  "model": null,
  "quantity": "{{ $json.platforms.length }}",
  "input_tokens": null,
  "output_tokens": null,
  "metadata": {
    "node": "HTTP - Crear post Postiz",
    "postiz_post_id": "{{ $json.id }}",
    "platforms": "{{ $json.platforms }}"
  }
}
```

> `provider: 'postiz'` en vez del default `'google'`: es una publicación, no una llamada a un
> modelo de Google AI. El RPC `admin_dashboard_metrics` no calcula costo para `post_published` (no
> hay `unit` de precio para publicaciones en `ai_model_prices`), así que este campo es puramente
> informativo.

### `ai_call` — después de cada nodo Gemini de texto/moderación

Un evento por invocación, en cada uno de estos nodos:

| Nodo | Motivo (sugerido para `metadata.reason`) |
|---|---|
| `Moderar imagen Gemini` | `moderation_image` |
| `Moderar video Gemini` | `moderation_video` |
| `Clasificador injection Gemini - Generate` | `prompt_injection_check_generate` |
| `Clasificador injection Gemini - Edit` | `prompt_injection_check_edit` |
| `Analyze document` | `document_analysis` |
| `Analyze an image` | `image_analysis` |

```json
{
  "event_key": "{{ $execution.id }}:ai_call:{{ $itemIndex }}",
  "event_type": "ai_call",
  "user_id": "{{ $('HTTP - Chequear vinculacion').item.json.id }}",
  "telegram_chat_id": "{{ $('Trigger').item.json.message.chat.id }}",
  "provider": "google",
  "model": "models/gemini-2.5-flash",
  "quantity": 1,
  "input_tokens": "{{ $json.usageMetadata?.promptTokenCount ?? null }}",
  "output_tokens": "{{ $json.usageMetadata?.candidatesTokenCount ?? null }}",
  "metadata": { "node": "<nombre del nodo Gemini>", "reason": "<motivo de la tabla de arriba>" }
}
```

## 4. Identidad del evento (`user_id` / `telegram_chat_id`)

- **Rama de imágenes** (`Generate an image`, `Edit an image`, y los `ai_call` que cuelgan de esa
  rama): `user_id` sale de `$('HTTP - Chequear vinculacion').item.json.id` — es el mismo nodo que
  ya resuelve `profiles.id` a partir de `telegram_chat_id` para el resto del flujo de imágenes.
- **Rama de publicación** (`HTTP - Crear post Postiz`): `user_id` sale de
  `$('HTTP - Perfil publicacion').item.json.id`.
- **`telegram_chat_id` se manda siempre**, en las cuatro variantes de evento, incluso cuando el
  chat no está vinculado (`user_id` sale `null` en ese caso — la columna es nullable con
  `ON DELETE SET NULL`, design D7). Es la identidad de respaldo que permite reconciliar a
  posteriori y la que sobrevive si se borra un perfil.
- Si el nodo de chequeo de vinculación no devolvió fila (chat no vinculado), `user_id` es `null`
  y el evento se inserta igual: el uso ocurrió y cuenta para los KPIs globales, que no filtran por
  `user_id` (design D7).

## 5. Puntos de inserción en el workflow

| Después de… | Emite | `quantity` |
|---|---|---|
| `Generate an image` | `image_generated` | `1` |
| `Edit an image` | `image_edited` | `1` |
| `HTTP - Crear post Postiz` | `post_published` | cantidad de plataformas publicadas |
| `Moderar imagen Gemini` | `ai_call` | `1` |
| `Moderar video Gemini` | `ai_call` | `1` |
| `Clasificador injection Gemini - Generate` | `ai_call` | `1` |
| `Clasificador injection Gemini - Edit` | `ai_call` | `1` |
| `Analyze document` | `ai_call` | `1` |
| `Analyze an image` | `ai_call` | `1` |

Cada punto de inserción es un nodo HTTP nuevo conectado en paralelo a la salida existente del nodo
de origen (no se reemplaza ni se reconecta nada del camino feliz existente).

## 6. Regla no negociable: loguear no puede romper el producto

Todos los nodos de logging de este contrato van configurados con:

- `onError: continueRegularOutput` (el flujo sigue aunque el POST falle).
- `alwaysOutputData: true`.
- Sin retry agresivo — `retryOnFail` opcional y acotado (1-3 intentos, no bloqueante); un evento
  perdido degrada una métrica, no debe demorar ni cortar la respuesta al usuario.

**Riesgo R5 del design:** perder un evento de `usage_events` es aceptable (el dashboard lo muestra
como "sin datos" o un número levemente subestimado). Que falle `HTTP - Crear post Postiz` o
`Generate an image`/`Edit an image` porque el nodo de logging que cuelga de ellos revienta el
workflow **no** es aceptable. El nodo de logging siempre va *después* del nodo que produce el
efecto real, nunca antes ni bloqueándolo.

## 7. Tokens (`input_tokens` / `output_tokens`) y el fallback de precio

- Cuando el nodo Gemini invocado expone `usageMetadata` (los nodos `@n8n/n8n-nodes-langchain.googleGemini`
  lo devuelven en la respuesta cruda), se manda `promptTokenCount` como `input_tokens` y
  `candidatesTokenCount` como `output_tokens`.
- Cuando no está disponible, se mandan ambos como `null` (nunca `0` — `0` significa "medido y da
  cero", `null` significa "no medido"). El RPC `admin_dashboard_metrics` trata `input_tokens`/
  `output_tokens` nulos como `0` en la suma de costo (`COALESCE(input_tokens, 0)`), así que ese
  evento contribuye únicamente como "invocación" al desglose por modelo (`events` +1) sin aportar
  costo por tokens — es el fallback declarado en design D3: la fila de `ai_model_prices` puede
  documentar en `notes` un supuesto de tokens promedio, pero ese ajuste es manual sobre el precio,
  no algo que el evento cargue por sí mismo.
- `image_generated`/`image_edited` no llevan tokens (el costo de imagen es por `quantity`, no por
  token) — quedan `null` siempre en esos dos tipos de evento.
