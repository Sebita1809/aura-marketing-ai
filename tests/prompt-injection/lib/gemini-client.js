// Cliente minimo REST para la Generative Language API (Gemini), sin SDK externo (no instalado
// en el repo). Replica la llamada que hace n8n's googleGemini node para los recursos
// `document` (Analyze document) e `image` (Generate/Edit an image), pero contra el modelo real
// tal como esta configurado hoy en codigo.json.
'use strict';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function toEndpoint(modelId) {
  // modelId ya viene como "models/gemini-2.5-flash" (incluye el prefijo "models/").
  return `${API_BASE}/${modelId}:generateContent`;
}

/**
 * Valida la API key con una llamada barata (listar modelos), sin gastar cuota de generacion.
 */
async function verifyApiKey(apiKey) {
  const res = await fetch(`${API_BASE}/models?key=${encodeURIComponent(apiKey)}&pageSize=1`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, status: res.status, body };
  }
  return { ok: true, status: res.status };
}

async function generateContent(apiKey, modelId, body, { timeoutMs = 60000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${toEndpoint(modelId)}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {
      /* respuesta no-JSON, se conserva el texto crudo */
    }
    return { ok: res.ok, status: res.status, json, rawText: text };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Llamada equivalente a "Analyze document" (resource: document, inputType: binary):
 * un part de texto (el prompt real) + un part inline_data con el PDF en base64.
 */
async function callDocumentAnalysis(apiKey, modelId, promptText, pdfBuffer) {
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: promptText },
          { inline_data: { mime_type: 'application/pdf', data: pdfBuffer.toString('base64') } },
        ],
      },
    ],
  };
  return generateContent(apiKey, modelId, body);
}

/**
 * Llamada equivalente a "Generate an image" / "Edit an image". Pide responseModalities
 * TEXT+IMAGE: el modelo "Nano Banana Pro" devuelve, ademas de la imagen, texto (explicacion,
 * negativa, o -en el peor caso- una respuesta que sigue una instruccion inyectada) que es la
 * unica senal introspectable de forma automatizada sin analizar el binario de la imagen
 * generada. Para `edit`, se agrega un part inline_data con una imagen base minima.
 */
async function callImageGeneration(apiKey, modelId, promptText, { editImageBuffer } = {}) {
  const parts = [{ text: promptText }];
  if (editImageBuffer) {
    parts.push({ inline_data: { mime_type: 'image/png', data: editImageBuffer.toString('base64') } });
  }
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  };
  return generateContent(apiKey, modelId, body);
}

/** Extrae todos los parts de texto de una respuesta generateContent exitosa. */
function extractText(result) {
  if (!result || !result.json) return result?.rawText || '';
  const candidates = result.json.candidates || [];
  const parts = candidates[0]?.content?.parts || [];
  return parts
    .filter((p) => typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n');
}

/** true si la respuesta trae al menos un part inline_data (imagen generada). */
function hasImagePart(result) {
  if (!result || !result.json) return false;
  const candidates = result.json.candidates || [];
  const parts = candidates[0]?.content?.parts || [];
  return parts.some((p) => p.inline_data || p.inlineData);
}

module.exports = {
  verifyApiKey,
  generateContent,
  callDocumentAnalysis,
  callImageGeneration,
  extractText,
  hasImagePart,
};
