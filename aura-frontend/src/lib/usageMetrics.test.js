import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateUsage, PLATFORMS } from './usageMetrics.js';

const now = new Date('2026-08-18T12:00:00.000Z');

test('aggregateUsage sobre lista vacía da todo en cero, sin romper', () => {
  const result = aggregateUsage([], { now });
  assert.equal(result.totals.imagesGenerated, 0);
  assert.equal(result.totals.imagesEdited, 0);
  assert.equal(result.totals.postsPublished, 0);
  assert.equal(result.totals.postsScheduledPending, 0);
  assert.equal(PLATFORMS.length, 5);
  for (const p of PLATFORMS) {
    assert.equal(result.byPlatform[p], 0);
  }
});

test('aggregateUsage cuenta totales por event_type', () => {
  const events = [
    { event_type: 'image_generated', occurred_at: '2026-08-18T10:00:00Z' },
    { event_type: 'image_generated', occurred_at: '2026-08-18T10:05:00Z' },
    { event_type: 'image_edited', occurred_at: '2026-08-18T10:10:00Z' },
    { event_type: 'post_published', platform: 'instagram', occurred_at: '2026-08-18T10:15:00Z' },
  ];
  const result = aggregateUsage(events, { now });
  assert.equal(result.totals.imagesGenerated, 2);
  assert.equal(result.totals.imagesEdited, 1);
  assert.equal(result.totals.postsPublished, 1);
});

// --- Triangulación: desglose por plataforma, 5 siempre presentes, cero incluido ---

test('aggregateUsage desglosa post_published por plataforma, con las 5 siempre presentes', () => {
  const events = [
    { event_type: 'post_published', platform: 'instagram', occurred_at: '2026-08-18T10:00:00Z' },
    { event_type: 'post_published', platform: 'instagram', occurred_at: '2026-08-18T10:01:00Z' },
    { event_type: 'post_published', platform: 'facebook', occurred_at: '2026-08-18T10:02:00Z' },
  ];
  const result = aggregateUsage(events, { now });
  assert.equal(result.byPlatform.instagram, 2);
  assert.equal(result.byPlatform.facebook, 1);
  // Las 3 sin actividad quedan en 0, no se omiten:
  assert.equal(result.byPlatform.threads, 0);
  assert.equal(result.byPlatform.twitter, 0);
  assert.equal(result.byPlatform.linkedin, 0);
  assert.equal(Object.keys(result.byPlatform).length, 5);
});

// --- Triangulación: programadas pendientes vs. ya pasadas ---

test('aggregateUsage cuenta post_scheduled con scheduled_for futuro como pendiente', () => {
  const events = [
    { event_type: 'post_scheduled', platform: 'instagram', occurred_at: '2026-08-18T09:00:00Z', metadata: { scheduled_for: '2026-08-20T09:00:00Z' } },
  ];
  const result = aggregateUsage(events, { now });
  assert.equal(result.totals.postsScheduledPending, 1);
});

test('aggregateUsage NO cuenta post_scheduled con scheduled_for ya pasado como pendiente', () => {
  const events = [
    { event_type: 'post_scheduled', platform: 'instagram', occurred_at: '2026-08-10T09:00:00Z', metadata: { scheduled_for: '2026-08-11T09:00:00Z' } },
  ];
  const result = aggregateUsage(events, { now });
  assert.equal(result.totals.postsScheduledPending, 0);
});

// --- Triangulación: post_scheduled con hora ya pasada cuenta como publicado ---

test('aggregateUsage cuenta post_scheduled con scheduled_for ya pasado como publicado (total y por plataforma)', () => {
  const events = [
    { event_type: 'post_scheduled', platform: 'facebook', occurred_at: '2026-08-10T09:00:00Z', metadata: { scheduled_for: '2026-08-11T09:00:00Z' } },
  ];
  const result = aggregateUsage(events, { now });
  assert.equal(result.totals.postsPublished, 1);
  assert.equal(result.byPlatform.facebook, 1);
});

test('aggregateUsage suma post_published y post_scheduled ya pasado en el mismo total/plataforma', () => {
  const events = [
    { event_type: 'post_published', platform: 'instagram', occurred_at: '2026-08-18T10:00:00Z' },
    { event_type: 'post_scheduled', platform: 'instagram', occurred_at: '2026-08-10T09:00:00Z', metadata: { scheduled_for: '2026-08-11T09:00:00Z' } },
  ];
  const result = aggregateUsage(events, { now });
  assert.equal(result.totals.postsPublished, 2);
  assert.equal(result.byPlatform.instagram, 2);
});

test('aggregateUsage ignora event_type desconocidos sin romper (contrato aditivo, D2)', () => {
  const events = [
    { event_type: 'ai_call', occurred_at: '2026-08-18T10:00:00Z' },
    { event_type: 'image_generated', occurred_at: '2026-08-18T10:00:00Z' },
  ];
  const result = aggregateUsage(events, { now });
  assert.equal(result.totals.imagesGenerated, 1);
});

test('aggregateUsage filtra por rango cuando se pasa desde/hasta', () => {
  const events = [
    { event_type: 'image_generated', occurred_at: '2026-08-01T10:00:00Z' },
    { event_type: 'image_generated', occurred_at: '2026-08-17T10:00:00Z' },
  ];
  const result = aggregateUsage(events, { now, since: new Date('2026-08-10T00:00:00Z') });
  assert.equal(result.totals.imagesGenerated, 1);
});
