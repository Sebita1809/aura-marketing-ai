// Imagen base minima (PNG 1x1) usada como "foto de producto" de entrada para los casos de la
// superficie freetext-edit (Edit an image necesita una imagen de entrada para poder editarla;
// el contenido visual de esa imagen es irrelevante para lo que esta campana mide, que es el
// prompt de texto libre, no la imagen).
'use strict';
const BASE_PNG_1x1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function getBaseImageBuffer() {
  return Buffer.from(BASE_PNG_1x1_B64, 'base64');
}

module.exports = { getBaseImageBuffer };
