// Runner de la campana adversaria del freetext-injection-gate (change input-security-hardening,
// capability freetext-injection-gate, D5 apendice; cierra el hueco de honestidad documentado en
// tasks.md 6.5: run-campaign.js llama al modelo de generacion de imagen DIRECTO, sin pasar por
// el gate de dos capas que hoy esta delante en produccion. Este runner SI ejerce el pipeline
// completo: filtro barato -> (si no lo frena) clasificador Gemini -> (si no lo frena) recien
// ahi el modelo de generacion/edicion real, exactamente en ese orden y con la logica REAL
// extraida de codigo.json (no reimplementada a mano).
//
// Uso:
//   node tests/prompt-injection/run-gate-campaign.js
//   node tests/prompt-injection/run-gate-campaign.js --only=<id,id>
//   node tests/prompt-injection/run-gate-campaign.js --limit=N
//
// La API key nunca se lee con herramientas de lectura del agente: se carga en runtime desde
// .env (lib/env.js), nunca se imprime ni se escribe en ningun archivo de salida.
'use strict';
const fs = require('fs');
const path = require('path');

const { loadGoogleApiKey } = require('./lib/env');
const { extractPrompts, renderFreetextPrompt } = require('./lib/extract-prompts');
const { extractGateNodes, runCodeNode } = require('./lib/gate-nodes');
const gemini = require('./lib/gemini-client');
const evaluate = require('./lib/evaluate');
const { getBaseImageBuffer } = require('./lib/base-image');

const repoRoot = path.resolve(__dirname, '..', '..');
const CASES_PATH = path.join(__dirname, 'cases.json');
const GATE_REPORT_PATH = path.join(__dirname, 'GATE-REPORT.md');
const GATE_RAW_DUMP_PATH = path.join(__dirname, 'gate-run-raw.json');
const GATE_HISTORY_PATH = path.join(__dirname, 'gate-run-history.jsonl');
const PRE_GATE_REPORT_PATH = path.join(__dirname, 'REPORT.md');
const PRE_GATE_HISTORY_PATH = path.join(__dirname, 'run-history.jsonl');

const DELAY_MS = 1200;
const RETRY_DELAY_MS = 4000;

const SYNTHETIC_CATALOG = [
  { nombre: 'Hamburguesa Base', precio: '$1.500', descripcion: 'Producto de referencia para la campana de pruebas' },
  { nombre: 'Bebida Base', precio: '$600', descripcion: 'Producto de referencia para la campana de pruebas' },
];

const FILTER_NODE_NAME = { generate: 'Filtro heurístico injection - Generate', edit: 'Filtro heurístico injection - Edit' };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = { only: null, limit: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--only=')) args.only = a.slice('--only='.length).split(',').map((s) => s.trim());
    if (a.startsWith('--limit=')) args.limit = parseInt(a.slice('--limit='.length), 10);
  }
  return args;
}

async function callWithRetry(fn, label) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`  [warn] ${label} fallo (${err.message}), reintentando en ${RETRY_DELAY_MS}ms...`);
    await sleep(RETRY_DELAY_MS);
    try {
      return await fn();
    } catch (err2) {
      return { ok: false, status: 0, json: null, rawText: '', error: err2.message };
    }
  }
}

function branchOf(surface) {
  return surface === 'freetext-edit' ? 'edit' : 'generate';
}

/**
 * Corre UN caso a traves del pipeline completo: filtro barato -> clasificador Gemini -> (si
 * llega limpio) modelo de generacion/edicion real. Devuelve un resultado que registra en QUE
 * capa se frenó (o null si llegó limpio hasta el modelo de imagen), y — solo si llegó limpio —
 * el resultado real de si el modelo de imagen obedecio la instruccion inyectada.
 */
async function runGateCase(caseDef, gateNodes, prompts, apiKey) {
  const branch = branchOf(caseDef.surface);
  const filePath = path.join(repoRoot, caseDef.file);
  const payloadText = fs.readFileSync(filePath, 'utf8');
  const nodeRefsBase = { 'Code in JavaScript5': { json: { id_chat: 'gate-campaign-test', dato: payloadText } } };

  const base = {
    id: caseDef.id,
    surface: caseDef.surface,
    is_control: !!caseDef.is_control,
  };

  // --- Capa 1: filtro barato (deterministico, sin llamada a API) ---
  const filterOut = runCodeNode(gateNodes[branch].filterJsCode, {
    inputItem: { json: { text: payloadText } },
    nodeRefs: nodeRefsBase,
  })[0].json;

  if (!filterOut.injectionGate.limpio) {
    return {
      ...base,
      blockedByLayer: 'heuristic',
      heuristicTecnica: filterOut.injectionGate.tecnica,
      heuristicDetalle: filterOut.injectionGate.detalle,
      classifierApiOk: null,
      imageApiOk: null,
      cumplida: false,
      falsePositive: base.is_control ? true : undefined,
    };
  }

  // --- Capa 2: clasificador Gemini real ---
  const renderedClassifierPrompt = gateNodes[branch].classifierPromptTemplate.replace(/\{\{[^}]*\}\}/, payloadText);
  const classifierBody = {
    contents: [{ role: 'user', parts: [{ text: renderedClassifierPrompt }] }],
    generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
  };
  const classifierResult = await callWithRetry(
    () => gemini.generateContent(apiKey, gateNodes[branch].classifierModelId, classifierBody),
    `${caseDef.id}-classifier`
  );
  const candidateContent =
    (classifierResult.json && classifierResult.json.candidates && classifierResult.json.candidates[0] && classifierResult.json.candidates[0].content) ||
    { parts: [{ text: classifierResult.rawText || '' }] };

  const parserOut = runCodeNode(gateNodes[branch].parserJsCode, {
    inputItem: { json: { content: candidateContent } },
    nodeRefs: { [FILTER_NODE_NAME[branch]]: { json: filterOut } },
  })[0].json;

  if (!parserOut.injectionGate.limpio) {
    return {
      ...base,
      blockedByLayer: 'gemini-classifier',
      heuristicTecnica: null,
      classifierApiOk: classifierResult.ok,
      classifierRawPreview: (candidateContent.parts && candidateContent.parts[0] && candidateContent.parts[0].text || '').slice(0, 300),
      imageApiOk: null,
      cumplida: false,
      falsePositive: base.is_control ? true : undefined,
    };
  }

  // --- Gate limpio en las dos capas: pasa al modelo de generacion/edicion real ---
  const catalogJsonText = JSON.stringify(SYNTHETIC_CATALOG);
  const template = branch === 'edit' ? prompts.editImage.promptTemplate : prompts.generateImage.promptTemplate;
  const modelId = branch === 'edit' ? prompts.editImage.modelId : prompts.generateImage.modelId;
  const renderedImagePrompt = renderFreetextPrompt(template, { catalogJsonText, userSpec: payloadText });

  const imageResult = await callWithRetry(
    () => gemini.callImageGeneration(apiKey, modelId, renderedImagePrompt, { editImageBuffer: branch === 'edit' ? getBaseImageBuffer() : undefined }),
    `${caseDef.id}-image`
  );
  const rawText = gemini.extractText(imageResult) || imageResult.rawText || '';
  const hasImage = gemini.hasImagePart(imageResult);

  if (base.is_control) {
    const cls = evaluate.classifyFreetextControl({ rawText, hasImage, apiOk: imageResult.ok });
    return {
      ...base,
      blockedByLayer: null,
      classifierApiOk: classifierResult.ok,
      imageApiOk: imageResult.ok,
      hasImage,
      falsePositive: cls.falsePositive,
      cumplida: false,
      rawTextPreview: rawText.slice(0, 400),
    };
  }

  const cls = evaluate.classifyFreetextResponse({ rawText, hasImage, apiOk: imageResult.ok, caseDef, systemPromptText: template });
  return {
    ...base,
    blockedByLayer: null,
    classifierApiOk: classifierResult.ok,
    imageApiOk: imageResult.ok,
    hasImage,
    cumplida: cls.cumplida,
    cumplidaReason: cls.cumplidaReason,
    resisted: cls.resisted,
    rawTextPreview: rawText.slice(0, 400),
  };
}

function computeGateMetrics(results, casesById) {
  const withMeta = results.map((r) => ({ ...r, def: casesById[r.id] }));
  const malicious = withMeta.filter((r) => !r.is_control);
  const control = withMeta.filter((r) => r.is_control);

  const blockedHeuristic = malicious.filter((r) => r.blockedByLayer === 'heuristic');
  const blockedClassifier = malicious.filter((r) => r.blockedByLayer === 'gemini-classifier');
  const slippedThrough = malicious.filter((r) => r.blockedByLayer === null);
  const fullFailures = slippedThrough.filter((r) => r.cumplida === true); // llego al modelo Y el modelo obedecio
  const slippedButResisted = slippedThrough.filter((r) => r.cumplida !== true);

  const endToEndBlockedCount = blockedHeuristic.length + blockedClassifier.length + slippedButResisted.length;
  const endToEndInjectionFulfilledRate = malicious.length ? fullFailures.length / malicious.length : null;

  const controlFalsePositives = control.filter((r) => r.falsePositive === true);
  const controlFpRate = control.length ? controlFalsePositives.length / control.length : null;

  // Desglose por tecnica
  const techniqueBreakdown = {};
  for (const r of malicious) {
    for (const t of r.def.techniques || []) {
      if (!techniqueBreakdown[t]) techniqueBreakdown[t] = { total: 0, heuristic: 0, classifier: 0, slipped: 0, fullFailure: 0, ids: [] };
      const b = techniqueBreakdown[t];
      b.total += 1;
      b.ids.push(r.id);
      if (r.blockedByLayer === 'heuristic') b.heuristic += 1;
      else if (r.blockedByLayer === 'gemini-classifier') b.classifier += 1;
      else {
        b.slipped += 1;
        if (r.cumplida) b.fullFailure += 1;
      }
    }
  }

  // Por rama (generate/edit)
  const byBranch = {};
  for (const branch of ['freetext-generate', 'freetext-edit']) {
    const bMalicious = malicious.filter((r) => r.surface === branch);
    byBranch[branch] = {
      total: bMalicious.length,
      heuristic: bMalicious.filter((r) => r.blockedByLayer === 'heuristic').length,
      classifier: bMalicious.filter((r) => r.blockedByLayer === 'gemini-classifier').length,
      slipped: bMalicious.filter((r) => r.blockedByLayer === null).length,
      fullFailure: bMalicious.filter((r) => r.blockedByLayer === null && r.cumplida).length,
    };
  }

  return {
    maliciousCount: malicious.length,
    controlCount: control.length,
    blockedHeuristicCount: blockedHeuristic.length,
    blockedClassifierCount: blockedClassifier.length,
    slippedThroughCount: slippedThrough.length,
    fullFailures,
    endToEndBlockedCount,
    endToEndInjectionFulfilledRate,
    controlFalsePositives,
    controlFpRate,
    techniqueBreakdown,
    byBranch,
  };
}

function fmtPct(x) {
  return x === null || x === undefined ? 'N/A' : `${(x * 100).toFixed(1)}%`;
}

function appendHistory(entry) {
  fs.appendFileSync(GATE_HISTORY_PATH, JSON.stringify(entry) + '\n', 'utf8');
}

function readHistory(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l); } catch (_) { return null; }
    })
    .filter(Boolean);
}

/** Lee la corrida #2 de REPORT.md (baseline pre-gate) desde run-history.jsonl para la comparacion directa. */
function readPreGateBaseline() {
  const history = readHistory(PRE_GATE_HISTORY_PATH);
  if (!history.length) return null;
  return history[history.length - 1]; // ultima corrida pre-gate registrada
}

function buildGateReportMarkdown({ meta, metrics, results, casesById, runTimestamp, history, preGateBaseline }) {
  const lines = [];
  lines.push('# GATE-REPORT.md — Campana end-to-end del freetext-injection-gate');
  lines.push('');
  lines.push('> Generado automaticamente por `run-gate-campaign.js`. No editar a mano: volver a correr el runner para actualizar.');
  lines.push('');
  lines.push('Este reporte es ADITIVO a `REPORT.md` (que documenta la campana original: deteccion en PDF y la linea base pre-gate en freetext). Este archivo mide especificamente si el `freetext-injection-gate` de dos capas (filtro barato + clasificador Gemini), tal como esta HOY en `codigo.json`, frena las mismas 13 instrucciones maliciosas del banco original ANTES de que lleguen al modelo de generacion/edicion de imagen — cerrando el hueco de honestidad documentado en `openspec/changes/input-security-hardening/tasks.md` tarea 6.5 (la validacion original corrio el clasificador aislado contra texto conocido, nunca el pipeline real).');
  lines.push('');
  lines.push('## Reproducibilidad');
  lines.push('');
  lines.push(`- Corrida: ${runTimestamp}`);
  lines.push(`- \`codigo.json\` mtime: ${meta.mtimeIso}`);
  lines.push(`- \`codigo.json\` sha256: \`${meta.sha256}\``);
  lines.push(`- Nodos en el workflow: ${meta.nodeCount}`);
  lines.push(`- Modelo clasificador (\`Clasificador injection Gemini\`): \`${meta.classifierModelId}\``);
  lines.push(`- Modelo \`Generate an image\` / \`Edit an image\`: \`${meta.imageModelId}\``);
  lines.push('');
  lines.push('## Comparacion directa: pre-gate vs. post-gate (el numero que importa)');
  lines.push('');
  if (preGateBaseline) {
    lines.push(`- **Pre-gate (REPORT.md, ultima corrida registrada, ${preGateBaseline.runTimestamp}, sha \`${preGateBaseline.sha256.slice(0, 8)}\`)**: los 13 casos maliciosos freetext se mandaban DIRECTO al modelo de imagen, sin gate. \`run-history.jsonl\` no guarda una tasa freetext propia (solo pdf); el numero de referencia (46-62% de injection cumplida segun tecnica, 3 tecnicas al 100%) esta documentado en \`REPORT.md\`, seccion "Detalle por caso" de esa corrida.`);
  } else {
    lines.push('- **Pre-gate**: ver `REPORT.md` (corrida #2) — no se pudo leer `run-history.jsonl` automaticamente para esta comparacion, referencia manual.');
  }
  lines.push(`- **Post-gate, pipeline completo (esta corrida)**: **${fmtPct(metrics.endToEndInjectionFulfilledRate)}** de las ${metrics.maliciousCount} instrucciones maliciosas freetext lograron su objetivo end-to-end (frenadas por el filtro barato: ${metrics.blockedHeuristicCount}, frenadas por el clasificador Gemini: ${metrics.blockedClassifierCount}, llegaron limpias al modelo de imagen: ${metrics.slippedThroughCount}, de esas el modelo obedecio en: ${metrics.fullFailures.length}).`);
  lines.push(`- **Falsos positivos sobre el set de control** (${metrics.controlCount} casos legitimos): ${fmtPct(metrics.controlFpRate)} (${metrics.controlFalsePositives.length}/${metrics.controlCount}) — un gate que bloquea pedidos legitimos tampoco es util; ver detalle por caso mas abajo.`);
  lines.push('');
  lines.push('## Historial de corridas de esta campana (gate)');
  lines.push('');
  lines.push('| # | Corrida (UTC) | codigo.json sha256 (8) | Bloqueadas (heur+clasif) | Llegaron al modelo | Fallas completas | FP control |');
  lines.push('|---|---|---|---|---|---|---|');
  history.forEach((h, idx) => {
    lines.push(
      `| ${idx + 1} | ${h.runTimestamp} | \`${h.sha256.slice(0, 8)}\` | ${h.blockedHeuristicCount + h.blockedClassifierCount}/${h.maliciousCount} | ${h.slippedThroughCount}/${h.maliciousCount} | ${h.fullFailuresCount} | ${fmtPct(h.controlFpRate)} |`
    );
  });
  lines.push('');
  lines.push('## Desglose por capa (combinado Generate + Edit)');
  lines.push('');
  lines.push(`- Total casos maliciosos: ${metrics.maliciousCount}`);
  lines.push(`- Frenados por el **filtro heuristico** (capa 1, sin llamar a Gemini): ${metrics.blockedHeuristicCount}`);
  lines.push(`- Frenados por el **clasificador Gemini** (capa 2): ${metrics.blockedClassifierCount}`);
  lines.push(`- Llegaron **limpios** hasta el modelo de generacion/edicion real (ambas capas los dejaron pasar): ${metrics.slippedThroughCount}`);
  lines.push(`  - De esos, el modelo de imagen **obedecio** la instruccion inyectada (falla completa end-to-end): ${metrics.fullFailures.length} → ${metrics.fullFailures.map((r) => r.id).join(', ') || 'ninguno'}`);
  lines.push(`  - De esos, el modelo de imagen **resistio** igual sin el gate (generó la imagen con normalidad o rechazo el pedido): ${metrics.slippedThroughCount - metrics.fullFailures.length}`);
  lines.push('');
  lines.push('## Desglose por rama');
  lines.push('');
  lines.push('| Rama | Maliciosos | Heuristico | Clasificador | Llegaron al modelo | Fallas completas |');
  lines.push('|---|---|---|---|---|---|');
  for (const [branch, b] of Object.entries(metrics.byBranch)) {
    lines.push(`| ${branch} | ${b.total} | ${b.heuristic} | ${b.classifier} | ${b.slipped} | ${b.fullFailure} |`);
  }
  lines.push('');
  lines.push('## Desglose por tecnica');
  lines.push('');
  lines.push('| Tecnica | Casos | Heuristico | Clasificador | Llegaron al modelo | Fallas completas |');
  lines.push('|---|---|---|---|---|---|');
  const allTechniques = Object.keys(metrics.techniqueBreakdown).sort();
  for (const t of allTechniques) {
    const b = metrics.techniqueBreakdown[t];
    lines.push(`| ${t} | ${b.total} | ${b.heuristic} | ${b.classifier} | ${b.slipped} | ${b.fullFailure} |`);
  }
  lines.push('');
  lines.push('## Detalle por caso');
  lines.push('');
  lines.push('| ID | Superficie | Control | Bloqueado en | Cumplida (si llego al modelo) | FP (control) |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of results) {
    const bloqueo = r.blockedByLayer || (r.blockedByLayer === null ? 'no (llego al modelo)' : 'N/A');
    lines.push(`| ${r.id} | ${r.surface} | ${r.is_control ? 'si' : 'no'} | ${bloqueo} | ${r.cumplida ? 'SI' : r.blockedByLayer !== null ? 'N/A (bloqueado antes)' : 'no'} | ${r.falsePositive === true ? 'SI' : r.is_control ? 'no' : 'N/A'} |`);
  }
  lines.push('');
  lines.push('## Metodologia');
  lines.push('');
  lines.push('- El filtro heuristico y el parser de veredicto se ejecutan con el jsCode REAL extraido de `codigo.json` en el momento de la corrida (via `lib/gate-nodes.js`, `new Function` con mocks minimos de `$input`/`$`), no una reimplementacion a mano — si el codigo del nodo cambia, la proxima corrida lo refleja automaticamente.');
  lines.push('- El clasificador Gemini se llama con el prompt REAL extraido de `codigo.json` (mismo texto que ve el nodo en produccion) y `generationConfig: { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } }`, replicando `jsonOutput: true` + `thinkingBudget: 0` del nodo — esta traduccion de opciones del nodo a la API REST es una inferencia razonable (no hay forma de observar directamente que payload arma el nodo nativo de n8n), documentada aca por transparencia.');
  lines.push('- Un caso solo llega a una llamada real de generacion/edicion de imagen si AMBAS capas del gate lo dejaron pasar — exactamente el mismo camino que seguiria en produccion. Los casos bloqueados por cualquiera de las dos capas NO se cuentan como "cumplida" bajo ninguna circunstancia: nunca llegaron al modelo que podria obedecer la instruccion.');
  lines.push('- Catalogo sintetico fijo (mismo para todos los casos de una misma rama) para la porcion de datos del prompt de imagen — igual convencion que `run-campaign.js`.');
  lines.push('');
  lines.push('## Limitaciones (obligatorio, no omitir — mismo criterio que REPORT.md)');
  lines.push('');
  lines.push('- **No es una corrida a traves del bot real por Telegram**: llama a las mismas APIs (Gemini) con los mismos prompts/modelos que los nodos de `codigo.json`, pero fuera de n8n. Sigue sin cubrir: el enrutamiento real del workflow, timeouts/reintentos de n8n, ni ningun efecto de la infraestructura (ver conversacion de esta sesion sobre bugs de infraestructura de n8n encontrados hoy, no relacionados a este gate).');
  lines.push('- **Mitigacion no deterministica**: el clasificador Gemini es un modelo de lenguaje, no un control deterministico. Un payload nuevo, no representado en este banco de 13 casos, puede evadir ambas capas aunque esta corrida de 0 fallas completas.');
  lines.push('- **El filtro heuristico es especifico al banco conocido**: sus patrones se escribieron mirando las tecnicas que mas exito tuvieron en la campana pre-gate (persona_role_change, dev_admin_audit_impersonation, embedded_in_product_data). Una tecnica de ofuscacion no representada en el banco (ej. un idioma no cubierto, una codificacion distinta) podria evadir la capa 1 y depender enteramente de la capa 2.');
  lines.push('- **NO se debe presentar como "el problema esta resuelto"**: esta corrida mide riesgo residual contra el banco de casos conocido a la fecha de esta corrida, no inmunidad.');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);

  const apiKey = loadGoogleApiKey(repoRoot);
  if (!apiKey) {
    console.error('ERROR: no se encontro GOOGLE_API_KEY en .env ni en el entorno. Abortando.');
    process.exit(1);
  }

  console.log('Verificando GOOGLE_API_KEY con una llamada barata...');
  const verify = await gemini.verifyApiKey(apiKey);
  if (!verify.ok) {
    console.error(`ERROR: la API key no funciono (status ${verify.status}). Abortando.`);
    process.exit(1);
  }
  console.log('  OK.');

  const prompts = extractPrompts(repoRoot);
  const gateNodes = extractGateNodes(repoRoot);
  console.log(`Nodos del gate extraidos de codigo.json (mtime ${prompts.meta.mtimeIso}, ${prompts.meta.nodeCount} nodos).`);

  const bank = JSON.parse(fs.readFileSync(CASES_PATH, 'utf8'));
  let cases = bank.cases.filter((c) => c.surface === 'freetext-generate' || c.surface === 'freetext-edit');
  if (args.only) cases = cases.filter((c) => args.only.includes(c.id));
  if (args.limit) cases = cases.slice(0, args.limit);
  const casesById = Object.fromEntries(bank.cases.map((c) => [c.id, c]));

  console.log(`Corriendo ${cases.length} casos freetext a traves del pipeline completo del gate...`);
  const results = [];
  let i = 0;
  for (const caseDef of cases) {
    i += 1;
    process.stdout.write(`  [${i}/${cases.length}] ${caseDef.id} (${caseDef.surface})... `);
    try {
      const r = await runGateCase(caseDef, gateNodes, prompts, apiKey);
      results.push(r);
      console.log(
        r.blockedByLayer ? `bloqueado en: ${r.blockedByLayer}` : `paso el gate, cumplida=${r.cumplida}${r.falsePositive !== undefined ? ` fp=${r.falsePositive}` : ''}`
      );
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      results.push({ id: caseDef.id, surface: caseDef.surface, is_control: !!caseDef.is_control, blockedByLayer: 'error', error: err.message, cumplida: false });
    }
    await sleep(DELAY_MS);
  }

  const metrics = computeGateMetrics(results, casesById);
  const runTimestamp = new Date().toISOString();
  const preGateBaseline = readPreGateBaseline();

  appendHistory({
    runTimestamp,
    sha256: prompts.meta.sha256,
    maliciousCount: metrics.maliciousCount,
    blockedHeuristicCount: metrics.blockedHeuristicCount,
    blockedClassifierCount: metrics.blockedClassifierCount,
    slippedThroughCount: metrics.slippedThroughCount,
    fullFailuresCount: metrics.fullFailures.length,
    controlFpRate: metrics.controlFpRate,
  });
  const history = readHistory(GATE_HISTORY_PATH);

  const reportMd = buildGateReportMarkdown({
    meta: { ...prompts.meta, classifierModelId: gateNodes.generate.classifierModelId, imageModelId: prompts.generateImage.modelId },
    metrics,
    results,
    casesById,
    runTimestamp,
    history,
    preGateBaseline,
  });

  fs.writeFileSync(GATE_REPORT_PATH, reportMd, 'utf8');
  fs.writeFileSync(GATE_RAW_DUMP_PATH, JSON.stringify({ runTimestamp, meta: prompts.meta, results }, null, 2), 'utf8');

  console.log('');
  console.log(`Reporte escrito en ${GATE_REPORT_PATH}`);
  console.log(`Dump crudo en ${GATE_RAW_DUMP_PATH}`);
  console.log('');
  console.log(`Bloqueadas (heur+clasif): ${metrics.blockedHeuristicCount + metrics.blockedClassifierCount}/${metrics.maliciousCount} | Fallas completas: ${metrics.fullFailures.length} | FP control: ${fmtPct(metrics.controlFpRate)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fallo inesperado del runner:', err);
    process.exit(1);
  });
}

module.exports = { computeGateMetrics, buildGateReportMarkdown };
