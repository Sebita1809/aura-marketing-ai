# E2 y E5 — Verificación directa contra la base de producción (Supabase)

> A diferencia de los demás ítems de testing, E2 y E5 no se responden con un script del repo:
> requieren consultar el estado real de la base de datos en producción (proyecto `Aura-AI`,
> `legffrhakunfignlaftl`). Este archivo documenta el método y el resultado para que quede citable.

## Método

Consulta de solo lectura vía `npx supabase db dump --linked --data-only -s public`, ejecutada
contra el proyecto vinculado. El dump completo se usó solo para extraer el bloque de la tabla
relevante y se borró inmediatamente después en cada corrida (no se conservó una copia completa de
los datos de producción en el repo, por higiene de datos de otros usuarios/tablas ajenas al alcance
de esta verificación).

## E2 — ¿Hay eventos reales en `usage_events`?

- Corrida: 2026-08-18 (mismo día que los eventos encontrados)
- Resultado: **5 filas reales**, todas del **18/08/2026**, entre las **16:44:41 y las 18:25:50 UTC**.
- Las 5 son `event_type = image_generated` (modelo `models/gemini-3-pro-image-preview`, provider
  `google`, source `telegram_bot`, status `success`), mismo `user_id`.
- **0 filas** de `image_edited` y **0 filas** de `post_published_scheduled` a la fecha de esta
  verificación — los otros dos emisores están en el flujo pero todavía no dispararon un evento real.

**Redacción sugerida para el informe:** "instrumentación desplegada, con serie insuficiente todavía"
— ni "no existe instrumentación" ni "módulo operativo con serie robusta". Fecha de arranque de la
serie: 18/08/2026.

## E5 — ¿Se aplicó la migración `products_check_array_constraint.sql`?

- Precondición (ver el propio archivo de la migración): probar las 3 ramas de carga de catálogo del
  bot (PDF, imagen, texto) y la carga vía la web, y confirmar que el catálogo queda como array
  válido — **cumplida el 2026-08-18** (usuario reportó pruebas manuales por las 3 vías + la web).
- Verificación previa a aplicar: tabla `products` con 1 fila, `product_data` ya con forma de array
  válido (0 filas violarían el constraint).
- Aplicación: `npx supabase db push --linked` (dentro de `aura-frontend/`) — respondió
  `"Remote database is up to date"` (la migración ya figuraba en el historial de tracking remoto).
- Verificación física (no solo el tracking): `npx supabase db dump --linked -s public` sobre el
  esquema muestra la constraint realmente presente:
  ```sql
  CONSTRAINT "products_product_data_is_array" CHECK (("jsonb_typeof"("product_data") = 'array'::"text"))
  ```
- Verificación post-aplicación de que no rompió nada: `products.updated_at` quedó en **2026-08-18
  18:24:48 UTC** (posterior a las pruebas), el catálogo creció a **43 productos**, y sigue siendo un
  array válido.

**Redacción sugerida para el informe:** la migración está aplicada y verificada contra el esquema
real, con evidencia de que la precondición de pruebas en vivo se cumplió antes de aplicarla y de que
la tabla siguió aceptando escrituras reales después.

## Limitaciones

- Esta es una verificación puntual a la fecha indicada, no un monitoreo continuo — si se necesita
  evidencia más reciente para la defensa, hay que repetir la consulta.
- No se conservó un dump completo de los datos por privacidad/alcance — solo los valores agregados
  citados arriba quedan documentados acá.
