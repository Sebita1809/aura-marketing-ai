// Helpers puros de catálogo de productos (user-panel-features, design.md D5).
// Sin dependencias de React/Supabase: se testean con node:test (0.6) sin
// necesidad de un DOM ni de un runner con más ceremonia.

/**
 * Normaliza product_data (array | objeto suelto | null) a array, siempre.
 * La migración de base ya normaliza a array (D5), pero el frontend lee
 * defensivamente porque el deploy del panel y la migración no son atómicos
 * entre sí, y porque el bot (service role) podría, en teoría, volver a
 * escribir algo no-array si algún nodo quedara mal migrado.
 */
export function normalizeProductData(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw === null || raw === undefined) return [];
  if (typeof raw === 'object') return [raw];
  return [];
}

// Prioridad de claves de "nombre" / "precio" / "detalle" — reflejan la forma
// real y heterogénea que generan las 3 ramas del bot (Gate 0 tasks.md 0.4):
// la rama imagen usa producto/precio/detalle; la rama PDF usa "nombre del
// producto"/precio/descripcion (+ una clave libre inventada por la IA); la
// rama de texto libre no tiene forma fija en absoluto.
const NAME_KEYS = ['producto', 'nombre', 'nombre del producto', 'name', 'titulo'];
const PRICE_KEYS = ['precio', 'price'];
const DESCRIPTION_KEYS = ['detalle', 'descripcion', 'descripción', 'description'];

/**
 * Filtra items de catálogo por texto libre para la searchbar del panel:
 * busca en nombre, precio, detalle y cualquier campo "extra" (incluidas las
 * claves libres que la IA haya inventado al extraer un producto de un
 * PDF/imagen), case-insensitive. Query vacío/blank devuelve todos los items.
 */
export function filterProducts(items, query) {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const { name, price, description, extra } = pickProductFields(item);
    const haystack = [name, price, description, ...extra.map(([, value]) => value)]
      .filter((value) => value !== null && value !== undefined)
      .map((value) => (typeof value === 'object' ? JSON.stringify(value) : String(value)))
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

function firstPresentKey(item, keys) {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== '') return key;
  }
  return null;
}

/**
 * Separa un item de catálogo en { name, price, description, extra }: los
 * campos conocidos se destacan; todo lo demás (claves inesperadas, incluida
 * cualquier clave libre que la IA haya inventado) queda en `extra` como
 * pares [clave, valor] para render genérico. Nunca rompe por una clave
 * faltante ni inesperada — ese es el requisito, no un detalle de estilo.
 */
export function pickProductFields(item) {
  const nameKey = firstPresentKey(item, NAME_KEYS);
  const priceKey = firstPresentKey(item, PRICE_KEYS);
  const descKey = firstPresentKey(item, DESCRIPTION_KEYS);
  const usedKeys = new Set(['id', nameKey, priceKey, descKey].filter(Boolean));

  const extra = Object.entries(item).filter(([key]) => !usedKeys.has(key));

  return {
    name: nameKey ? item[nameKey] : null,
    price: priceKey ? item[priceKey] : null,
    description: descKey ? item[descKey] : null,
    extra,
    // Clave real usada para cada campo (o null si el item no la trae). El
    // panel de edición la necesita para escribir de vuelta en la MISMA
    // clave del item (p. ej. "nombre del producto" en la rama PDF) en vez
    // de siempre "producto" -- si no, quedaría una clave vieja duplicada.
    nameKey,
    priceKey,
    descKey,
  };
}
