# Guion de pruebas manuales — user-panel-features

Versionado junto al change (tasks.md 9.3). Todo lo de acá requiere sesiones
de usuario reales y/o disparar el bot en vivo — nada de esto se pudo
ejecutar desde el entorno del agente (sin credenciales de usuario final, sin
forma de mandarle un mensaje real a Telegram). Marcar cada ítem al
ejecutarlo contra el proyecto Supabase `legffrhakunfignlaftl`.

## 0. Pre-requisito — CHECK de array (bloqueante para 3.6/3.7)

`aura-frontend/supabase/migrations/20260818169000_products_check_array_constraint.sql`
existe pero **NO está aplicada**. Antes de aplicarla con `supabase db push`:

- [ ] Subir un PDF con catálogo por Telegram a un usuario de prueba → confirmar
      que `products.product_data` queda como array válido.
- [ ] Subir una foto de producto → ídem.
- [ ] Escribir la info de un producto por texto → ídem, y confirmar que
      **sobrevive el producto anterior** (antes se perdía — bug D7 corregido).
- [ ] Recién entonces `supabase db push` (aplicará el CHECK). Repetir las 3
      cargas y confirmar que el CHECK no las rompe (tasks.md 3.7).

## 1. RLS (Gate 0.A) — requiere DOS usuarios reales distintos

- [ ] Usuario A no ve filas de `profiles`/`products`/`usage_events` de Usuario B.
- [ ] Ninguno de los dos puede `insert` en `usage_events` desde el navegador.
- [ ] Ninguno puede `update` `products.product_data` directamente (solo vía RPC).
- [ ] Ninguno puede cambiar su propio `role`, `status` ni `telegram_chat_id`
      (probar un `update` directo por consola del navegador contra `profiles`
      con esas columnas — debe fallar con permission denied).

## 2. RPCs de catálogo

- [ ] `product_catalog_add` sobre un usuario sin fila previa en `products` → crea la fila.
- [ ] `product_catalog_add` sobre un usuario con catálogo existente → aparece al final.
- [ ] `product_catalog_remove` por id existente → desaparece, el resto queda igual.
- [ ] `product_catalog_remove` de un item heredado sin `id` (normaliza y borra).
- [ ] Intento de `product_catalog_add`/`remove` "apuntando" a otro usuario (no
      hay parámetro `user_id` en las variantes de panel — confirmar que
      `auth.uid()` es lo único que decide la fila, no manipulable desde el body).
- [ ] Concurrencia: alta simultánea panel + bot (`product_catalog_upsert_for_user`)
      sobre el mismo usuario → ambos productos sobreviven.

## 3. Productos (`/app/products`)

- [x] Alta manual, aparece en el listado con el `product_data` que devuelve la RPC — confirmado 2026-08-18: producto cargado desde `/app/products` y reconocido correctamente por el bot (misma fuente `product_data`, sin desincronización panel↔bot).
- [ ] Baja con confirmación previa (modal), nunca sin confirmar.
- [ ] Catálogo vacío → mensaje "agregá tu primer producto", no un error.
- [ ] Catálogo heredado con un objeto suelto (no array) → se renderiza igual
      (normalizeProductData lo envuelve).
- [ ] Item sin `id` → se muestra con aviso "se le asignará uno la próxima vez
      que se toque el catálogo" y el botón de borrar queda deshabilitado.
- [ ] Item con claves inesperadas (rama PDF real) → nombre/precio/detalle
      destacados si están, resto como pares clave/valor, la página no rompe.

## 4. Instrumentación de eventos (Grupo 4)

- [ ] Generar una imagen → aparece 1 fila `image_generated` con `metadata.modelo`.
- [ ] Editar una imagen ("rehacer") → 1 fila `image_edited`.
- [ ] Publicar en N redes → N filas `post_published`, una por `platform`.
- [ ] Programar una publicación → N filas `post_scheduled` con
      `metadata.scheduled_for` en el futuro.
- [ ] Ninguna fila incluye prompts, texto de publicación, ni URLs de medios
      (revisar `metadata` a ojo tras las pruebas de arriba).
- [ ] Fire-and-forget: cortar la conectividad a Supabase (o renombrar
      temporalmente la credencial) durante una generación → el usuario
      igual recibe la imagen; no se cuelga el flujo.
- [ ] Idempotencia: forzar un reintento (simular timeout) → no se duplica la
      fila (mismo `event_key`, `Prefer: resolution=ignore-duplicates`).
- [ ] Registrar acá la fecha/hora real de esta verificación como "activación
      del tracking" para el mensaje de corte histórico de Métricas.

## 5. Métricas (`/app/metrics`)

- [ ] Con actividad real (pasos anteriores), los 4 totales coinciden.
- [ ] Desglose por plataforma: las 5 redes siempre aparecen, en 0 si no hay actividad.
- [ ] Selector de rango recalcula todo.
- [ ] Dos usuarios distintos ven solo su propia actividad.
- [ ] Estado vacío antes de tener actividad: mensaje explícito, no ceros sin contexto.

## 6. Perfil (`/app/profile`)

- [ ] Editar `full_name`/`company` → se guarda, `AuthContext` se actualiza sin recargar.
- [ ] Guardar esos campos NO dispara ningún mail ni cambio de Auth.
- [ ] Cambio de contraseña: pedir la actual mal → falla, no cambia nada.
- [ ] Cambio de contraseña correcto → funciona, sesión sigue viva.
- [ ] Cambio de email: se manda el/los mail(es) de confirmación (chequear
      cuántos — depende del setting "Secure email change" del proyecto, 0.5
      pendiente de chequeo manual); la UI muestra "pendiente" y sigue
      mostrando el email viejo hasta confirmar.
- [ ] Abandonar el cambio de email a mitad (no confirmar) → el email de
      acceso sigue siendo el viejo, la UI no afirma lo contrario.
- [ ] Tras confirmar el cambio de email, `profiles.email` se actualiza solo
      (trigger `on_auth_user_email_updated`) y `AdminPanel` ya no muestra el
      email viejo.

## 7. Verificación por script (ya ejecutada en esta sesión, repetible)

```
node tests/user-panel-features/verify-schema-live.js --group=1
node tests/user-panel-features/verify-schema-live.js --group=2
node tests/user-panel-features/verify-schema-live.js --group=8
node tests/user-panel-features/verify-codigo-graph.js
cd aura-frontend && pnpm lint && pnpm test && pnpm build
```
