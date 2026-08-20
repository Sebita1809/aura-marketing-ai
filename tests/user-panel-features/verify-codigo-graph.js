#!/usr/bin/env node
// Verificación por script (no "a ojo", patrón de input-security-hardening 1.9)
// del grafo de codigo.json tras los cambios de Grupo 3 (upsert por nombre del
// catálogo) y Grupo 4 (instrumentación de usage_events) de user-panel-features.
//
// Chequea:
//  - El archivo sigue siendo JSON válido.
//  - Todo nodo referenciado en `connections` existe en `nodes`.
//  - No hay nodos con `id` o `name` duplicados.
//  - Los nodos específicos que este change agrega/modifica están presentes
//    con las propiedades esperadas (URL de RPC, onError como propiedad del
//    nodo, no dentro de parameters, etc.)
//
// Uso: node tests/user-panel-features/verify-codigo-graph.js

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'codigo.json');

function main() {
  const raw = fs.readFileSync(FILE, 'utf8');
  let wf;
  try {
    wf = JSON.parse(raw);
  } catch (err) {
    console.error('FAIL: codigo.json no es JSON válido:', err.message);
    process.exitCode = 1;
    return;
  }

  const nodes = wf.nodes || [];
  const nodesByName = new Map(nodes.map((n) => [n.name, n]));
  const checks = [];
  const ok = (label, cond) => checks.push({ label, pass: !!cond });

  ok(`nodes[] es un array no vacío (${nodes.length} nodos)`, nodes.length > 0);

  // IDs y nombres únicos
  const ids = nodes.map((n) => n.id);
  const names = nodes.map((n) => n.name);
  ok('todos los node.id son únicos', new Set(ids).size === ids.length);
  ok('todos los node.name son únicos', new Set(names).size === names.length);

  // Toda referencia en connections apunta a un nodo real
  let danglingRefs = [];
  for (const [sourceName, def] of Object.entries(wf.connections || {})) {
    if (!nodesByName.has(sourceName)) danglingRefs.push(`source "${sourceName}" no existe como nodo`);
    for (const outputs of Object.values(def)) {
      for (const branch of outputs) {
        for (const conn of branch || []) {
          if (!nodesByName.has(conn.node)) danglingRefs.push(`"${sourceName}" -> "${conn.node}" (target no existe)`);
        }
      }
    }
  }
  ok('ninguna conexión apunta a un nodo inexistente', danglingRefs.length === 0);
  if (danglingRefs.length) console.error('  refs colgantes:', danglingRefs.join('; '));

  // --- Grupo 3: fan-out + RPC de catálogo ---
  ok('nodo "Code - Fan out productos pdf" existe', nodesByName.has('Code - Fan out productos pdf'));
  ok('"Code in JavaScript1" -> "Code - Fan out productos pdf" conectado',
    (wf.connections['Code in JavaScript1']?.main?.[0] || []).some((c) => c.node === 'Code - Fan out productos pdf'));
  ok('"Code - Fan out productos pdf" -> "HTTP - Upsert producto pdf" conectado',
    (wf.connections['Code - Fan out productos pdf']?.main?.[0] || []).some((c) => c.node === 'HTTP - Upsert producto pdf'));

  for (const name of ['HTTP - Upsert producto pdf', 'HTTP - Upsert producto imagen', 'HTTP - Upsert producto informacion']) {
    const n = nodesByName.get(name);
    ok(`${name}: existe`, !!n);
    if (n) {
      ok(`${name}: apunta al RPC product_catalog_upsert_for_user`, (n.parameters?.url || '').includes('/rpc/product_catalog_upsert_for_user'));
      ok(`${name}: body usa p_user_id + item`, (n.parameters?.jsonBody || '').includes('p_user_id') && (n.parameters?.jsonBody || '').includes('item:'));
    }
  }

  // --- Grupo 4: nodos de emisión de usage_events (si ya se agregaron) ---
  const emitterNames = nodes.filter((n) => (n.parameters?.url || '').includes('/rest/v1/usage_events'));
  if (emitterNames.length > 0) {
    ok('todos los emisores de usage_events usan Prefer: resolution=ignore-duplicates',
      emitterNames.every((n) => (n.parameters?.headerParameters?.parameters || []).some((p) => p.name === 'Prefer' && p.value === 'resolution=ignore-duplicates')));
    ok('todos los emisores de usage_events tienen onError=continueRegularOutput como propiedad del nodo (no en parameters)',
      emitterNames.every((n) => n.onError === 'continueRegularOutput' && n.parameters?.onError === undefined));
    ok('todos los emisores de usage_events tienen retryOnFail=false',
      emitterNames.every((n) => n.retryOnFail === false));
  }

  let failed = 0;
  for (const c of checks) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'} - ${c.label}`);
    if (!c.pass) failed++;
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks pasaron. Total nodos: ${nodes.length}. Total nodos emisores usage_events detectados: ${emitterNames.length}.`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
