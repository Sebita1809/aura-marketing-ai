# Resultados — Sincronización de producto nuevo (página → bot)

**Ejecución n8n**: #1045 · inicio 2026-08-20 01:14:12.966 · fin 01:14:53.559 · **duración 40,59 s**. Verificado contra el pin de versión actual (hash de `codigo.json` idéntico a `../codigo.snapshot.json` al momento de la corrida).

**Método**: se agregó un producto nuevo ("Hamburguesa nueva", $20.000) directamente desde la página (panel admin), y se le pidió al bot por Telegram, con una referencia **deliberadamente vaga** ("podrías hacer una publicación de la hamburguesa nueva") — sin nombrarlo exacto, para probar si el sistema lo identifica por contexto.

## Resultado: ÉXITO, verificado visualmente

Se descargó el binario real generado por el flujo (no solo la confirmación de Telegram) desde el almacenamiento local de n8n (`storage/workflows/.../executions/1045/binary_data/`) y se inspeccionó directamente. La imagen final contiene, correctamente:

- Nombre: **"Hamburguesa nueva"**
- Precio: **$20.000**
- Descripción: **"hamburguesa clasica de carne, lechuga, tomate, jamon, queso y huevo frito"**

Coincide exacto con lo cargado en la página. El bot identificó correctamente cuál era "la hamburguesa nueva" entre 60 productos del catálogo, sin que el usuario lo nombrara explícito.

## Hallazgo — la página admin usa un tercer esquema de campos, distinto a Sheets/PDF/imagen

Al inspeccionar `product_data` completo (60 items) para armar este caso, se confirmó el origen de una inconsistencia ya señalada como "hallazgo aparte" en corridas anteriores (`../excel-injection/RESULTS.md`, `../prompt-injection-media/RESULTS.md`): **la página admin guarda los productos con las claves `producto`/`precio`/`detalle`**, mientras que Sheets/PDF/imagen usan `nombre del producto`/`precio`/`descripcion`/`otros aspectos`. Confirmado con el propio producto de este test:

```json
{
  "id": "4a486e9f-7491-4a11-9965-0c903f317d2a",
  "precio": "20000",
  "detalle": "hamburguesa clasica de carne, lechuga, tomate, jamon, queso y huevo frito",
  "producto": "Hamburguesa nueva"
}
```

**A pesar de la inconsistencia, el resultado funcionó** — Gemini interpretó correctamente ambos esquemas de campos dentro del mismo array (`product_data` mezcla objetos con `nombre del producto` y objetos con `producto` en la misma llamada) gracias a que el modelo entiende el contenido semánticamente, no por matching exacto de claves. Aun así, es una inconsistencia real de esquema que vale la pena unificar — no todos los consumidores de `product_data` son tan tolerantes como un LLM (por ejemplo, `Code in JavaScript2` en el camino de Sheets lee literalmente `prod["nombre del producto"]`, y con un producto de la página fallaría mostrando "undefined").

## Conclusión

Confirma que la sincronización página↔bot funciona en tiempo real (el producto recién agregado estuvo disponible inmediatamente), y que el sistema tolera razonar sobre pedidos ambiguos del usuario. La inconsistencia de esquema entre vías de carga queda como recomendación de unificación para la tesis, ahora con su origen identificado con certeza (página admin vs. resto de las vías).
