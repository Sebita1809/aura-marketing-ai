import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProductData, pickProductFields, filterProducts } from './productCatalog.js';

// --- normalizeProductData: array | object | null -> array (design.md D5, frontend defensivo) ---

test('normalizeProductData devuelve el mismo array si ya es array', () => {
  const input = [{ producto: 'A' }, { producto: 'B' }];
  assert.deepEqual(normalizeProductData(input), input);
});

test('normalizeProductData envuelve un objeto suelto en un array de 1 (caso heredado imagen)', () => {
  const input = { producto: 'Remera', precio: 500 };
  assert.deepEqual(normalizeProductData(input), [input]);
});

test('normalizeProductData convierte null en array vacío', () => {
  assert.deepEqual(normalizeProductData(null), []);
});

test('normalizeProductData convierte undefined en array vacío', () => {
  assert.deepEqual(normalizeProductData(undefined), []);
});

// --- pickProductFields: campos conocidos destacados + resto como pares clave/valor ---
// Muestras reales de codigo.json (Gate 0 tasks.md 0.4): las 3 ramas del bot
// generan claves distintas para "lo mismo".

test('pickProductFields destaca producto/precio/detalle (rama imagen)', () => {
  const item = { id: '1', producto: 'Remera', precio: 500, detalle: 'Talle M' };
  const result = pickProductFields(item);
  assert.equal(result.name, 'Remera');
  assert.equal(result.price, 500);
  assert.equal(result.description, 'Talle M');
  assert.deepEqual(result.extra, []);
});

test('pickProductFields destaca "nombre del producto"/precio/descripcion y deja el resto como extra (rama PDF)', () => {
  const item = {
    id: '2',
    'nombre del producto': 'Alfajor',
    precio: '$ 1.200',
    descripcion: 'Triple de chocolate',
    'otros aspectos que consideres necesarios': 'Sin TACC',
  };
  const result = pickProductFields(item);
  assert.equal(result.name, 'Alfajor');
  assert.equal(result.price, '$ 1.200');
  assert.equal(result.description, 'Triple de chocolate');
  assert.deepEqual(result.extra, [['otros aspectos que consideres necesarios', 'Sin TACC']]);
});

test('pickProductFields no rompe con un item de claves totalmente desconocidas (rama texto libre)', () => {
  const item = { id: '3', foo: 'bar', baz: 42 };
  const result = pickProductFields(item);
  assert.equal(result.name, null);
  assert.equal(result.price, null);
  assert.equal(result.description, null);
  assert.deepEqual(result.extra.sort(), [['baz', 42], ['foo', 'bar']]);
});

test('pickProductFields nunca incluye "id" en extra', () => {
  const item = { id: '4', producto: 'X', otraClave: 'y' };
  const result = pickProductFields(item);
  assert.ok(!result.extra.some(([k]) => k === 'id'));
});

// --- pickProductFields: claves reales usadas (para editar sin duplicar clave) ---

test('pickProductFields devuelve la clave real de nombre/precio/detalle (rama imagen)', () => {
  const item = { id: '1', producto: 'Remera', precio: 500, detalle: 'Talle M' };
  const result = pickProductFields(item);
  assert.equal(result.nameKey, 'producto');
  assert.equal(result.priceKey, 'precio');
  assert.equal(result.descKey, 'detalle');
});

test('pickProductFields devuelve la clave real cuando difiere de la canónica (rama PDF)', () => {
  const item = { id: '2', 'nombre del producto': 'Alfajor', precio: '$ 1.200', descripcion: 'Triple de chocolate' };
  const result = pickProductFields(item);
  assert.equal(result.nameKey, 'nombre del producto');
  assert.equal(result.priceKey, 'precio');
  assert.equal(result.descKey, 'descripcion');
});

test('pickProductFields devuelve null en las claves ausentes (rama texto libre)', () => {
  const item = { id: '3', foo: 'bar' };
  const result = pickProductFields(item);
  assert.equal(result.nameKey, null);
  assert.equal(result.priceKey, null);
  assert.equal(result.descKey, null);
});

// --- filterProducts: búsqueda de texto libre para la searchbar del panel ---

const catalog = [
  { id: '1', producto: 'Remera', precio: 500, detalle: 'Talle M' },
  { id: '2', 'nombre del producto': 'Alfajor', precio: '$ 1.200', descripcion: 'Triple de chocolate', 'otros aspectos': 'Sin TACC' },
  { id: '3', foo: 'bar' },
];

test('filterProducts con query vacío devuelve todos los items sin tocar el array', () => {
  assert.deepEqual(filterProducts(catalog, ''), catalog);
  assert.deepEqual(filterProducts(catalog, '   '), catalog);
});

test('filterProducts matchea por nombre, case-insensitive', () => {
  const result = filterProducts(catalog, 'reMERA');
  assert.deepEqual(result, [catalog[0]]);
});

test('filterProducts matchea por precio', () => {
  const result = filterProducts(catalog, '1.200');
  assert.deepEqual(result, [catalog[1]]);
});

test('filterProducts matchea por detalle/descripcion', () => {
  const result = filterProducts(catalog, 'chocolate');
  assert.deepEqual(result, [catalog[1]]);
});

test('filterProducts matchea por un campo extra', () => {
  const result = filterProducts(catalog, 'TACC');
  assert.deepEqual(result, [catalog[1]]);
});

test('filterProducts no rompe con un item sin ningún campo conocido y no matchea nada si el query no aparece', () => {
  assert.deepEqual(filterProducts(catalog, 'inexistente'), []);
});
