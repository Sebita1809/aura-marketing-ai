## ADDED Requirements

### Requirement: Sección de Productos en el panel de usuario

El panel SHALL exponer una sección nueva de Productos en `/app/products`, protegida por autenticación, accesible desde un ítem propio del menú lateral del usuario junto a Conexiones, Métricas y Perfil. La página SHALL listar el catálogo del usuario autenticado.

#### Scenario: Navegación desde el menú

- **WHEN** un usuario autenticado abre el panel
- **THEN** ve un ítem "Productos" en el menú lateral que lo lleva a `/app/products` y queda marcado como activo al estar en esa ruta

#### Scenario: Acceso sin sesión

- **WHEN** una sesión sin autenticar intenta acceder a `/app/products`
- **THEN** es redirigida al login sin consultar el catálogo

### Requirement: Catálogo normalizado como array JSON

`products.product_data` SHALL contener siempre un array JSON, incluso cuando el catálogo esté vacío. La migración SHALL convertir las filas existentes que hoy contienen un objeto suelto a un array de un elemento, y las nulas a un array vacío. Una vez migrados todos los escritores, el sistema SHALL impedir por restricción de base que se escriba un valor que no sea array.

#### Scenario: Fila heredada con objeto suelto

- **WHEN** se migra una fila cuyo `product_data` es un objeto con un solo producto
- **THEN** queda convertida en un array de un elemento con ese mismo producto, sin pérdida de campos

#### Scenario: Fila heredada nula

- **WHEN** se migra una fila cuyo `product_data` es nulo
- **THEN** queda como array vacío

#### Scenario: Escritura con forma inválida

- **WHEN** un escritor intenta guardar un objeto suelto en `product_data` una vez activa la restricción
- **THEN** la escritura falla de forma visible en vez de degradar la forma del dato

### Requirement: Lectura defensiva del catálogo

La página SHALL renderizar el catálogo aunque los items tengan formas heterogéneas. SHALL destacar los campos conocidos (nombre del producto, precio, detalle) y SHALL mostrar el resto de las claves de forma genérica. Un item con campos faltantes o inesperados MUST NOT romper el renderizado de la página ni de los demás items.

#### Scenario: Item con el contrato conocido

- **WHEN** el catálogo tiene un item con nombre, precio y detalle
- **THEN** esos tres campos se muestran destacados en la tarjeta del producto

#### Scenario: Item con claves inesperadas

- **WHEN** un item trae claves adicionales o distintas de las conocidas
- **THEN** se muestran como pares clave/valor y la página sigue funcionando

#### Scenario: Catálogo vacío o inexistente

- **WHEN** el usuario no tiene fila en `products` o su catálogo está vacío
- **THEN** la página muestra un estado vacío que invita a agregar el primer producto, sin error

### Requirement: Alta de producto atómica del lado del servidor

El alta de un producto SHALL ejecutarse mediante una función de base de datos que resuelva la identidad del usuario internamente y agregue el item al array en una única sentencia de actualización. El panel MUST NOT leer el catálogo completo, modificarlo en el navegador y reescribirlo entero.

#### Scenario: Alta sobre catálogo existente

- **WHEN** el usuario agrega un producto a un catálogo que ya tiene tres
- **THEN** el catálogo queda con cuatro items, conservando los tres anteriores intactos

#### Scenario: Alta sin fila previa

- **WHEN** un usuario sin fila en `products` agrega su primer producto
- **THEN** se crea su fila con un catálogo de un item

#### Scenario: Intento de alta para otro usuario

- **WHEN** un cliente manipula la llamada para agregar un producto al catálogo de otro usuario
- **THEN** la operación afecta únicamente al catálogo del usuario autenticado, porque la identidad se resuelve dentro de la función y no se acepta como parámetro del cliente

#### Scenario: Alta concurrente con el bot

- **WHEN** el usuario agrega un producto desde el panel mientras el bot está agregando otro para el mismo usuario
- **THEN** ambos productos quedan en el catálogo y ninguno se pierde

### Requirement: Baja de producto por identificador estable

Cada item del catálogo SHALL tener un identificador estable, asignado por la función de escritura cuando el item no lo traiga. La baja SHALL realizarse por ese identificador y MUST NOT realizarse por posición dentro del array.

#### Scenario: Baja de un producto

- **WHEN** el usuario elimina un producto de su catálogo
- **THEN** ese item desaparece y los demás permanecen sin cambios

#### Scenario: El catálogo cambió entre el listado y la baja

- **WHEN** el bot reordena o agrega items después de que el usuario cargó la lista y antes de que confirme la baja
- **THEN** se elimina exactamente el producto que el usuario eligió y no otro

#### Scenario: Item heredado sin identificador

- **WHEN** el usuario opera sobre un catálogo cuyos items fueron escritos por el bot sin identificador
- **THEN** la función les asigna un identificador al escribir, dejándolos direccionables para la baja

#### Scenario: Confirmación antes de borrar

- **WHEN** el usuario presiona eliminar en un producto
- **THEN** se le pide confirmación explícita antes de ejecutar la baja

### Requirement: El bot acumula en vez de reemplazar el catálogo

Las escrituras de catálogo del workflow del bot SHALL agregar productos al array existente. El sistema MUST NOT reemplazar el documento completo del catálogo en ninguna de las ramas de carga (documento PDF, imagen o información de texto).

#### Scenario: Carga por el bot posterior a un alta manual

- **WHEN** el usuario agrega un producto desde el panel y luego carga otro por el bot
- **THEN** el catálogo contiene ambos productos

#### Scenario: Carga de varios productos en una misma operación del bot

- **WHEN** una rama del bot produce varios productos en una misma operación
- **THEN** todos quedan agregados al catálogo, no solo el último

### Requirement: Aislamiento del catálogo por usuario

`products` SHALL exponer a cada cliente autenticado únicamente su propia fila. Las mutaciones del catálogo SHALL pasar exclusivamente por las funciones de alta y baja, y no por permisos directos de escritura del cliente sobre la tabla.

#### Scenario: Lectura sin filtro

- **WHEN** un usuario autenticado consulta `products` sin filtro
- **THEN** recibe únicamente su propia fila

#### Scenario: Escritura directa del cliente

- **WHEN** una sesión del panel intenta actualizar `product_data` directamente sobre la tabla
- **THEN** la operación es rechazada
