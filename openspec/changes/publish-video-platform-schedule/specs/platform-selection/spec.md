## ADDED Requirements

### Requirement: El usuario elige las plataformas destino antes de publicar
El sistema SHALL presentar, después de la etapa de descripción y antes de crear el post en Postiz, un mensaje de Telegram con un inline keyboard que liste **una fila por cada cuenta conectada** del usuario (cuentas de `social_accounts` con `is_connected = true` y `postiz_integration_id` no nulo), más un botón de confirmación y un botón para volver al inicio. El estado de chat SHALL pasar a `ESPERANDO SELECCION PLATAFORMAS`.

#### Scenario: Se muestran las cuentas conectadas
- **WHEN** el usuario completa la etapa de descripción y tiene 3 cuentas conectadas con integración de Postiz
- **THEN** el bot envía un mensaje con 3 botones de plataforma (uno por cuenta, con su nombre/plataforma) más `✅ Continuar`, y guarda `estado_de_chat: "ESPERANDO SELECCION PLATAFORMAS"` en `chat_{chat_id}` con TTL 86400

#### Scenario: Sin cuentas conectadas
- **WHEN** el usuario no tiene ninguna cuenta con `postiz_integration_id`
- **THEN** el comportamiento actual se mantiene: el bot envía el mensaje de "sin integración Postiz" y no se muestra el selector

### Requirement: Selección múltiple por toggle sobre el mismo mensaje
El sistema SHALL permitir marcar y desmarcar cada plataforma de forma independiente (multi-select). Cada pulsación de un botón de plataforma SHALL alternar el estado de esa plataforma y SHALL **editar el mensaje existente** para redibujar el teclado con el indicador de marcado (`☑️`) o desmarcado (`⬜`), sin enviar un mensaje nuevo y sin cambiar el estado de chat.

#### Scenario: Marcar una plataforma
- **WHEN** el usuario presiona el botón de una plataforma no marcada
- **THEN** esa plataforma queda marcada, el mismo mensaje se edita mostrando `☑️` en ese botón, y el estado sigue en `ESPERANDO SELECCION PLATAFORMAS`

#### Scenario: Desmarcar una plataforma
- **WHEN** el usuario presiona el botón de una plataforma ya marcada
- **THEN** esa plataforma queda desmarcada y el mensaje se edita mostrando `⬜` en ese botón

#### Scenario: Selección de varias plataformas
- **WHEN** el usuario marca dos plataformas y presiona `✅ Continuar`
- **THEN** el flujo avanza a la etapa de programación con ambas plataformas seleccionadas

#### Scenario: Continuar sin seleccionar nada
- **WHEN** el usuario presiona `✅ Continuar` sin ninguna plataforma marcada
- **THEN** el bot avisa que debe elegir al menos una plataforma y el flujo NO avanza

### Requirement: La selección persiste en Redis entre ejecuciones
Dado que cada pulsación de botón es una ejecución independiente del workflow, el sistema SHALL cachear la lista de cuentas conectadas en `integraciones_{chat_id}` y la selección vigente en `plataformas_{chat_id}`, ambas en Redis con TTL 86400 s, y SHALL usar `callback_data` basado en el índice de la cuenta dentro de esa lista (por ejemplo `plat:0`), nunca el `postiz_integration_id` crudo.

#### Scenario: La selección sobrevive entre pulsaciones
- **WHEN** el usuario marca la plataforma 0, luego la 2, y después presiona `✅ Continuar`
- **THEN** la clave `plataformas_{chat_id}` contiene ambos índices y el post se crea para esas dos cuentas

#### Scenario: Claves con expiración
- **WHEN** se escriben `integraciones_{chat_id}` o `plataformas_{chat_id}`
- **THEN** ambas se escriben con TTL 86400 s, conforme a la convención del change `redis-expiration`

#### Scenario: callback_data acotado
- **WHEN** se construye el inline keyboard
- **THEN** cada `callback_data` usa el prefijo de familia con índice (`plat:<n>`, `plat_ok`) y no supera el límite de 64 bytes de Telegram ni expone identificadores internos de Postiz

### Requirement: `Preparar integraciones` construye el post solo para las plataformas elegidas
El nodo `Preparar integraciones` SHALL filtrar las cuentas con `postiz_integration_id` según la selección almacenada en `plataformas_{chat_id}` antes de construir `postsArray`, manteniendo la forma de salida actual (`{ hasIntegrations, postsArray }`) y el `settingsMap` existente (`instagram`, `facebook`, y el default `{ __type: <platform_type>, post_type: 'post' }` que cubre `threads` y `x`).

#### Scenario: Publicación dirigida
- **WHEN** el usuario tiene 3 cuentas conectadas y seleccionó 1
- **THEN** `postsArray` contiene exactamente 1 entrada, correspondiente a la cuenta seleccionada, y Postiz publica solo en esa red

#### Scenario: Fallback cuando no hay selección disponible
- **WHEN** la clave `plataformas_{chat_id}` no existe o está vacía (por expiración o por un camino previo del flujo)
- **THEN** `postsArray` incluye todas las cuentas conectadas, preservando el comportamiento actual y evitando que la publicación quede sin destino

#### Scenario: Se preservan los settings por plataforma
- **WHEN** la selección incluye una cuenta de tipo `threads` o `x`
- **THEN** su entrada en `postsArray` usa el default `{ __type: <platform_type>, post_type: 'post' }` tal como hoy
