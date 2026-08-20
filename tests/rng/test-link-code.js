// Test offline del algoritmo de generación de código de vinculación (Bug 1).
// Uso: node tests/rng/test-link-code.js
// NO requiere stack n8n ni contenedores: ejecuta exactamente el mismo patrón que
// el nodo `Code - Generar código` (codigo.json) usa ahora:
//   const { randomInt } = require('crypto');
//   const code = randomInt(100000, 1000000).toString();
const { randomInt } = require('crypto');

function generarCodigo() {
  const code = randomInt(100000, 1000000).toString();
  return code;
}

let fallas = 0;

function check(cond, msg) {
  if (cond) {
    console.log('OK   -', msg);
  } else {
    fallas++;
    console.log('FAIL -', msg);
  }
}

// (a) entero en [100000, 999999]
const N = 200;
let valores = new Set();
let rangeOk = true;
let lenOk = true;

for (let i = 0; i < N; i++) {
  const code = generarCodigo();
  const num = Number(code);
  if (!Number.isInteger(num) || num < 100000 || num > 999999) rangeOk = false;
  if (String(num).length !== 6) lenOk = false;
  valores.add(num);
}

check(rangeOk, `las ${N} llamadas devuelven enteros en [100000, 999999]`);
check(lenOk, `todas las llamadas producen strings de longitud 6`);
check(valores.size >= 2, `variabilidad: se observaron ${valores.size} valores distintos en ${N} llamadas (>= 2)`);

// Muestra de ejemplo
console.log('Ejemplo:', generarCodigo());

if (fallas > 0) {
  console.log(`\n${fallas} verificacion(es) fallida(s)`);
  process.exit(1);
}
console.log('\nTodas las verificaciones pasaron.');
