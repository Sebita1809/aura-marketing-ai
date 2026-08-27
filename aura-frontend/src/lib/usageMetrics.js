// Helper puro de agregación de métricas de uso (user-panel-features, design.md
// D10). Recibe filas crudas de usage_events (ya acotadas a auth.uid() por
// RLS + el filtro de la query) y agrega en JS. Sin dependencias de
// React/Supabase — testeado con node:test.

export const PLATFORMS = ['instagram', 'facebook', 'threads', 'twitter', 'linkedin'];

/**
 * @param {Array<object>} events filas de usage_events
 * @param {{ now?: Date, since?: Date }} [opts]
 */
export function aggregateUsage(events, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const since = opts.since instanceof Date ? opts.since : null;

  const totals = {
    imagesGenerated: 0,
    imagesEdited: 0,
    postsPublished: 0,
    postsScheduledPending: 0,
  };
  const byPlatform = Object.fromEntries(PLATFORMS.map((p) => [p, 0]));

  for (const ev of events || []) {
    if (!ev || !ev.event_type) continue;
    const occurredAt = ev.occurred_at ? new Date(ev.occurred_at) : null;
    if (since && occurredAt && occurredAt < since) continue;

    switch (ev.event_type) {
      case 'image_generated':
        totals.imagesGenerated += 1;
        break;
      case 'image_edited':
        totals.imagesEdited += 1;
        break;
      case 'post_published':
        totals.postsPublished += 1;
        if (ev.platform && Object.prototype.hasOwnProperty.call(byPlatform, ev.platform)) {
          byPlatform[ev.platform] += 1;
        }
        break;
      case 'post_scheduled': {
        const scheduledFor = ev.metadata?.scheduled_for ? new Date(ev.metadata.scheduled_for) : null;
        if (scheduledFor && scheduledFor > now) {
          totals.postsScheduledPending += 1;
        } else if (scheduledFor && scheduledFor <= now) {
          // Postiz no expone (aun) un webhook confirmando la publicacion real
          // de una programada (ver gitroomhq/postiz-app#1191, sigue abierto):
          // una vez pasada scheduled_for asumimos que salio con exito, igual
          // que 'status: success' se registra ya al programarla.
          totals.postsPublished += 1;
          if (ev.platform && Object.prototype.hasOwnProperty.call(byPlatform, ev.platform)) {
            byPlatform[ev.platform] += 1;
          }
        }
        break;
      }
      default:
        // Contrato aditivo (design.md D2): event_type desconocidos se ignoran.
        break;
    }
  }

  return { totals, byPlatform };
}
