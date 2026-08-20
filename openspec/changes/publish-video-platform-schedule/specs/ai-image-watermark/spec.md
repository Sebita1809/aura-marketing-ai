## ADDED Requirements

### Requirement: Toda imagen generada por IA lleva una marca de agua de aviso

El sistema SHALL aplicar una marca de agua de texto sobre **todas** las imágenes producidas por los nodos de IA del workflow (`Generate an image` y `Edit an image`) antes de que esas imágenes salgan del bot, con el texto **"Imagen ilustrativa · generada con IA"**. El objetivo es dejar constancia visible de que la imagen es ilustrativa y generada por IA, para evitar reclamos por publicidad engañosa.

#### Scenario: Imagen recién generada

- **WHEN** `Generate an image` produce una imagen publicitaria a partir del catálogo
- **THEN** la imagen pasa por el paso de marca de agua antes de ser enviada al usuario y antes de cualquier subida a Postiz, y el texto de la marca aparece en la imagen resultante

#### Scenario: Imagen re-editada tras un rechazo

- **WHEN** el usuario rechaza la imagen, envía nuevas especificaciones y `Edit an image` produce una versión editada
- **THEN** la versión editada también pasa por el paso de marca de agua, con los mismos parámetros que la generación inicial

#### Scenario: Lo que aprueba el usuario es lo que se publica

- **WHEN** la imagen con marca de agua se envía al usuario para su aprobación
- **THEN** el binario aprobado (el `file_id` guardado en `publicidad_{chat_id}`) corresponde a la imagen ya marcada, de modo que lo que se sube a Postiz es exactamente lo que el usuario vio y aprobó

### Requirement: La marca de agua es sutil y no arruina la composición

La marca de agua SHALL ser discreta: texto chico ubicado en una esquina de la imagen (por defecto la **inferior derecha**, para no tapar el producto que suele estar centrado), con contraste suficiente para leerse sobre cualquier fondo (fondo semitransparente detrás del texto) pero sin competir visualmente con el contenido publicitario. SHALL NOT cubrir el centro de la imagen ni superponerse a los precios o al nombre del producto cuando estos estén en la composición.

#### Scenario: Fondo claro y fondo oscuro

- **WHEN** la imagen generada tiene una zona inferior derecha muy clara o muy oscura
- **THEN** la marca de agua sigue siendo legible gracias al recuadro semitransparente de respaldo detrás del texto

#### Scenario: Proporción respecto de la imagen

- **WHEN** se aplica la marca de agua sobre una imagen de la resolución que devuelve el modelo
- **THEN** el bloque de la marca ocupa un área marginal de la imagen (referencia: alto del texto ≈ 2 % del alto de la imagen) y queda pegado al borde inferior derecho con un margen de separación

### Requirement: La marca de agua se aplica con el nodo nativo `Edit Image` de n8n

El sistema SHALL implementar la marca de agua como un paso de post-procesamiento con el nodo core `n8n-nodes-base.editImage`, ejecutado **después** de la generación/edición por Gemini y **antes** de enviar la imagen al usuario y de subirla a Postiz. El sistema SHALL NOT delegar el texto de la marca al prompt del modelo de imágenes.

#### Scenario: El texto no depende del modelo

- **WHEN** se revisa el workflow después del cambio
- **THEN** el texto de la marca de agua está en los parámetros del nodo `Edit Image`, y los prompts de `Generate an image` / `Edit an image` no piden renderizar ningún texto de marca de agua

#### Scenario: Sin servicios nuevos

- **WHEN** se revisa `docker-compose.yml` después del cambio
- **THEN** no se agregaron servicios ni contenedores nuevos para procesar imágenes (el nodo `Edit Image` es core de n8n y corre dentro del propio servicio n8n)

#### Scenario: Falla del paso de marca de agua

- **WHEN** el nodo `Edit Image` falla (por ejemplo, dependencia de imagen no disponible en el runtime de n8n)
- **THEN** el usuario recibe un aviso de que la publicidad no pudo prepararse y el flujo no continúa con una imagen sin marcar

### Requirement: La marca de agua NUNCA se aplica al contenido subido por el usuario

El sistema SHALL aplicar la marca de agua **exclusivamente** a las imágenes generadas por la IA. El contenido que el usuario sube en la rama de publicidad existente — imagen o video propios — SHALL publicarse tal cual llegó, sin marca de agua y sin ninguna otra alteración del binario. Marcar como "generada con IA" una foto o un video reales del usuario sería falso y contradiría el propósito de la funcionalidad.

#### Scenario: Imagen subida por el usuario

- **WHEN** el usuario publica una imagen propia por la rama `Subir publicidad existente` y esa imagen es aprobada por el gate de moderación
- **THEN** el binario subido a Postiz es byte a byte el que envió el usuario, sin marca de agua

#### Scenario: Video subido por el usuario

- **WHEN** el usuario publica un video propio por la rama `Subir publicidad existente`
- **THEN** el video no pasa por ningún nodo de marca de agua ni de re-encoding

#### Scenario: El paso de marca vive en la rama de generación

- **WHEN** se revisan las conexiones del workflow
- **THEN** los nodos de marca de agua están conectados únicamente aguas abajo de `Generate an image` y `Edit an image`, y la rama de publicidad existente no los atraviesa por ningún camino
