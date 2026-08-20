// Extrae, en runtime y sin copiar a mano, el codigo/prompts REALES de los 5 nodos del
// freetext-injection-gate (capability freetext-injection-gate, D5 apendice) para ambas ramas
// (Generate/Edit), y un ejecutor minimo de nodos Code de n8n (mock de $input/$) para poder
// correr esa logica exacta contra el banco de pruebas sin reimplementarla a mano (evita drift
// entre lo que dice codigo.json y lo que el test simula).
'use strict';
const fs = require('fs');
const path = require('path');

const GATE_NODE_NAMES = {
  generate: {
    filter: 'Filtro heurístico injection - Generate',
    ifCheap: 'IF - Filtro barato detectó patrón - Generate',
    classifier: 'Clasificador injection Gemini - Generate',
    parser: 'Parsear veredicto injection Gemini - Generate',
    ifClean: 'IF - Gate limpio (injection) - Generate',
  },
  edit: {
    filter: 'Filtro heurístico injection - Edit',
    ifCheap: 'IF - Filtro barato detectó patrón - Edit',
    classifier: 'Clasificador injection Gemini - Edit',
    parser: 'Parsear veredicto injection Gemini - Edit',
    ifClean: 'IF - Gate limpio (injection) - Edit',
  },
};

function stripExpressionPrefix(value) {
  if (typeof value !== 'string') return value;
  return value.startsWith('=') ? value.slice(1) : value;
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((n) => n.name === name);
  if (!node) throw new Error(`Nodo de gate "${name}" no encontrado en codigo.json (¿cambió de nombre?)`);
  return node;
}

/**
 * Devuelve, para cada rama, el jsCode real del filtro barato y del parser de veredicto, mas el
 * prompt real (sin el "=" de expresion) y el modelId real del clasificador Gemini.
 */
function extractGateNodes(repoRoot) {
  const codigoPath = path.join(repoRoot, 'codigo.json');
  const workflow = JSON.parse(fs.readFileSync(codigoPath, 'utf8'));

  const out = {};
  for (const branch of ['generate', 'edit']) {
    const names = GATE_NODE_NAMES[branch];
    const filterNode = findNode(workflow, names.filter);
    const classifierNode = findNode(workflow, names.classifier);
    const parserNode = findNode(workflow, names.parser);

    out[branch] = {
      filterJsCode: filterNode.parameters.jsCode,
      filterNodeName: names.filter,
      classifierPromptTemplate: stripExpressionPrefix(
        classifierNode.parameters.messages.values[0].content
      ),
      classifierModelId:
        classifierNode.parameters.modelId?.value || classifierNode.parameters.modelId,
      parserJsCode: parserNode.parameters.jsCode,
    };
  }
  return out;
}

/**
 * Ejecuta el jsCode real de un nodo Code de n8n contra mocks minimos de $input/$. El código de
 * los 5 nodos del gate solo usa `$input.first()` y `$('<nombre de nodo>').first()` (nunca
 * `$json`, `$items()`, etc.), asi que estos dos mocks alcanzan para correrlo tal cual esta en
 * codigo.json, sin reimplementar la logica a mano (evita drift entre lo documentado y lo real).
 */
function runCodeNode(jsCode, { inputItem, nodeRefs = {} }) {
  const $input = { first: () => inputItem };
  const $ = (name) => {
    if (!(name in nodeRefs)) {
      throw new Error(`runCodeNode: referencia a nodo no mockeada: "${name}"`);
    }
    return { first: () => nodeRefs[name] };
  };
  // eslint-disable-next-line no-new-func -- ejecuta el jsCode REAL extraido de codigo.json, a proposito
  const fn = new Function('$input', '$', jsCode);
  return fn($input, $);
}

module.exports = { GATE_NODE_NAMES, extractGateNodes, runCodeNode };
