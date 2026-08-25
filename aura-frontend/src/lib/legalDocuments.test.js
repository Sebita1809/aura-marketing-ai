import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasAcceptedCurrentVersion, LEGAL_DOCUMENTS } from './legalDocuments.js';

const CURRENT_VERSION = LEGAL_DOCUMENTS.PRIVACY_POLICY.version;

// --- hasAcceptedCurrentVersion: gate de aceptación (compartido por todos los documentos/canales) ---

test('hasAcceptedCurrentVersion es false cuando no hay fila de aceptación', () => {
  assert.equal(hasAcceptedCurrentVersion(null, CURRENT_VERSION), false);
});

test('hasAcceptedCurrentVersion es true cuando la fila coincide con la versión vigente', () => {
  assert.equal(hasAcceptedCurrentVersion({ version: CURRENT_VERSION }, CURRENT_VERSION), true);
});

// --- Triangulación: fila existente pero de una versión vieja (documento actualizado) ---

test('hasAcceptedCurrentVersion es false cuando la fila es de una versión anterior', () => {
  assert.equal(hasAcceptedCurrentVersion({ version: '2026-01-01' }, CURRENT_VERSION), false);
});

test('hasAcceptedCurrentVersion no rompe con undefined', () => {
  assert.equal(hasAcceptedCurrentVersion(undefined, CURRENT_VERSION), false);
});

// --- LEGAL_DOCUMENTS: cada documento define un slug único (clave real usada por Supabase/n8n) ---

test('LEGAL_DOCUMENTS tiene slugs distintos para privacidad y términos', () => {
  assert.notEqual(LEGAL_DOCUMENTS.PRIVACY_POLICY.slug, LEGAL_DOCUMENTS.TERMS_CONDITIONS.slug);
});
