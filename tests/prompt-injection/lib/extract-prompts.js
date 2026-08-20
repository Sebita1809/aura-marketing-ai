// Lee codigo.json en runtime y extrae los prompts REALES de los tres nodos Gemini que este
// change necesita testear. Nunca copia el texto a mano: si el prompt cambia en codigo.json,
// la proxima corrida de run-campaign.js usa el texto nuevo automaticamente (requisito de
// design.md D4 / spec.md "Prompts stay in sync with the workflow").
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NODE_NAMES = {
  analyzeDocument: 'Analyze document',
  generateImage: 'Generate an image',
  editImage: 'Edit an image',
};

/**
 * n8n guarda los campos de tipo "expression" con un "=" inicial que marca que el valor es
 * una expresion, no un literal. El texto real del prompt empieza despues de ese primer "=".
 */
function stripExpressionPrefix(value) {
  if (typeof value !== 'string') return value;
  return value.startsWith('=') ? value.slice(1) : value;
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((n) => n.name === name);
  if (!node) throw new Error(`Nodo "${name}" no encontrado en codigo.json`);
  return node;
}

/**
 * Devuelve { text|prompt, modelId, resource, ... } para los tres nodos, mas metadatos de
 * reproducibilidad (mtime, hash sha256 de codigo.json completo) para dejar constancia en
 * REPORT.md de contra que version del workflow corrio la campana.
 */
function extractPrompts(repoRoot) {
  const codigoPath = path.join(repoRoot, 'codigo.json');
  const raw = fs.readFileSync(codigoPath, 'utf8');
  const workflow = JSON.parse(raw);
  const stat = fs.statSync(codigoPath);
  const hash = crypto.createHash('sha256').update(raw).digest('hex');

  const analyzeDocument = findNode(workflow, NODE_NAMES.analyzeDocument);
  const generateImage = findNode(workflow, NODE_NAMES.generateImage);
  const editImage = findNode(workflow, NODE_NAMES.editImage);

  return {
    meta: {
      codigoJsonPath: codigoPath,
      mtimeIso: stat.mtime.toISOString(),
      sha256: hash,
      nodeCount: Array.isArray(workflow.nodes) ? workflow.nodes.length : null,
    },
    analyzeDocument: {
      nodeName: NODE_NAMES.analyzeDocument,
      resource: analyzeDocument.parameters.resource,
      inputType: analyzeDocument.parameters.inputType,
      modelId: analyzeDocument.parameters.modelId?.value || analyzeDocument.parameters.modelId,
      promptText: stripExpressionPrefix(analyzeDocument.parameters.text),
    },
    generateImage: {
      nodeName: NODE_NAMES.generateImage,
      resource: generateImage.parameters.resource,
      modelId: generateImage.parameters.modelId?.value || generateImage.parameters.modelId,
      promptTemplate: stripExpressionPrefix(generateImage.parameters.prompt),
    },
    editImage: {
      nodeName: NODE_NAMES.editImage,
      resource: editImage.parameters.resource,
      operation: editImage.parameters.operation,
      modelId: editImage.parameters.modelId?.value || editImage.parameters.modelId,
      promptTemplate: stripExpressionPrefix(editImage.parameters.prompt),
    },
  };
}

/**
 * Los prompts de Generate/Edit an image contienen expresiones n8n ({{ ... }}) para inyectar
 * los datos del catalogo y el texto del usuario. Para la campana reemplazamos esas dos
 * expresiones puntuales por datos de catalogo sinteticos fijos (mismos para todos los casos
 * de una misma superficie, asi el unico factor que varia entre casos es el payload del
 * atacante) y por el payload del caso bajo prueba.
 */
function renderFreetextPrompt(promptTemplate, { catalogJsonText, userSpec }) {
  return promptTemplate
    .replace(/\{\{\s*JSON\.stringify\([^)]*\)\s*\}\}/, catalogJsonText)
    .replace(/\{\{[^}]*\}\}/, userSpec);
}

module.exports = { extractPrompts, renderFreetextPrompt, stripExpressionPrefix };
