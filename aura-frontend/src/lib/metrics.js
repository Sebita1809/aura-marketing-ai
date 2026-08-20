import { supabase } from './supabase';

// Períodos que ofrece el selector del dashboard (design.md D-selector /
// tasks.md 3.2, 4.5). 'all' no filtra por fecha: se resuelve como un rango
// que arranca en epoch, así el RPC (que siempre filtra con
// `occurred_at >= p_from AND occurred_at < p_to`) no necesita una rama
// especial para "todo".
export const PERIODS = [7, 30, 90, 'all'];
export const DEFAULT_PERIOD = 30;

const EPOCH = new Date(0);

// `to` se calcula con un pequeño margen hacia adelante (no `now()` a secas)
// para que un evento escrito en el mismo instante en que se arma el request
// no quede excluido por el corte estricto `occurred_at < p_to` del RPC.
function toBoundary() {
  return new Date(Date.now() + 60 * 1000);
}

/**
 * Traduce una selección de período (7 | 30 | 90 | 'all') a los boundaries
 * { from, to } que consume el RPC `admin_dashboard_metrics`.
 */
export function periodToRange(period) {
  const to = toBoundary();
  if (period === 'all') {
    return { from: EPOCH, to };
  }
  const days = Number(period) || DEFAULT_PERIOD;
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { from, to };
}

// Normaliza la respuesta cruda del RPC: arrays siempre arrays (json_agg
// puede devolver null si no hubo filas antes del COALESCE, y ante cualquier
// forma inesperada de la respuesta no queremos que la UI reviente), números
// siempre números (Postgres numeric puede volver como string vía PostgREST).
function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeByModel(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    model: row?.model ?? null,
    events: toNumber(row?.events),
    images: toNumber(row?.images),
    tokensIn: toNumber(row?.tokens_in),
    tokensOut: toNumber(row?.tokens_out),
    costUsd: toNumber(row?.cost_usd),
    priced: Boolean(row?.priced),
  }));
}

function normalizeDaily(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    day: row?.day ?? null,
    images: toNumber(row?.images),
    posts: toNumber(row?.posts),
  }));
}

function normalizeMetrics(raw) {
  const data = raw || {};
  const clients = data.clients || {};
  const cost = data.cost || {};
  const images = data.images || {};
  const period = data.period || {};

  return {
    clients: {
      total: toNumber(clients.total),
      active: toNumber(clients.active),
    },
    costUsd: toNumber(cost.usd),
    posts: toNumber(data.posts),
    images: {
      new: toNumber(images.new),
      redone: toNumber(images.redone),
      total: toNumber(images.total),
    },
    byModel: normalizeByModel(data.by_model),
    daily: normalizeDaily(data.daily),
    firstEventAt: data.first_event_at ?? null,
    lastEventAt: data.last_event_at ?? null,
    period: {
      from: period.from ?? null,
      to: period.to ?? null,
    },
  };
}

/**
 * Llama al único RPC que alimenta el dashboard de admin (tasks.md 3.1).
 * No agrega ni transforma datos de negocio: solo normaliza tipos. El error
 * se propaga tal cual (con su `code` de PostgREST) para que la UI pueda
 * distinguir `forbidden` (42501, rol no admin) de un fallo de red genérico.
 */
export async function fetchDashboardMetrics({ from, to }) {
  const p_from = from instanceof Date ? from.toISOString() : from;
  const p_to = to instanceof Date ? to.toISOString() : to;

  const { data, error } = await supabase.rpc('admin_dashboard_metrics', {
    p_from,
    p_to,
  });

  if (error) throw error;
  return normalizeMetrics(data);
}

// --- Formateo (tasks.md 3.2), locale es-AR en todo el dashboard --------

const usdFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const countFormatter = new Intl.NumberFormat('es-AR');

export function formatUsd(value) {
  if (value === null || value === undefined) return '—';
  return usdFormatter.format(value);
}

export function formatCount(value) {
  if (value === null || value === undefined) return '—';
  return countFormatter.format(value);
}

export function formatDate(value) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleString('es-AR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}
