import { useState, useEffect, useCallback, useMemo } from 'react';
import Sidebar from '../components/Sidebar';
import GlassCard from '../components/GlassCard';
import MaterialIcon from '../components/MaterialIcon';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { aggregateUsage, PLATFORMS } from '../lib/usageMetrics';

// user-panel-features, Grupo 6 (design.md D10). Trae las filas del rango
// elegido y agrega en JS con aggregateUsage (helper puro, testeado en
// src/lib/usageMetrics.test.js). Sin librería de charting: barras propias.

// Fecha de activación del tracking (Grupo 4, registrada en el reporte de
// apply): las métricas solo existen desde acá — no hay fuente de la cual
// reconstruir el pasado (design.md Non-Goals).
const TRACKING_SINCE = new Date('2026-08-18T00:00:00Z');

const PLATFORM_META = {
  instagram: { label: 'Instagram', color: 'bg-gradient-to-br from-[#833ab4] via-[#fd1d1d] to-[#fcb045]' },
  facebook: { label: 'Facebook', color: 'bg-[#1877F2]' },
  threads: { label: 'Threads', color: 'bg-[#101010]' },
  twitter: { label: 'X / Twitter', color: 'bg-on-background' },
  linkedin: { label: 'LinkedIn', color: 'bg-[#0077b5]' },
};

const RANGES = [
  { id: '7', label: '7 días', days: 7 },
  { id: '30', label: '30 días', days: 30 },
  { id: '90', label: '90 días', days: 90 },
  { id: 'all', label: 'Todo', days: null },
];

function StatTile({ icon, label, value }) {
  return (
    <GlassCard className="p-5 flex items-center gap-4">
      <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
        <MaterialIcon icon={icon} className="text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none">{value}</p>
        <p className="font-label-sm text-on-surface-variant mt-1">{label}</p>
      </div>
    </GlassCard>
  );
}

export default function MetricsPage() {
  const { user } = useAuth();
  const [range, setRange] = useState('30');
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const since = useMemo(() => {
    const r = RANGES.find((x) => x.id === range);
    if (!r || r.days === null) return null;
    const d = new Date();
    d.setDate(d.getDate() - r.days);
    return d;
  }, [range]);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      // RLS ya acota a la fila propia (usage_events_select_own); se
      // explicita igual el filtro por usuario en la query (design.md D10).
      let query = supabase
        .from('usage_events')
        .select('event_type, platform, metadata, occurred_at')
        .eq('user_id', user.id)
        .order('occurred_at', { ascending: false });
      if (since) query = query.gte('occurred_at', since.toISOString());

      const { data, error: fetchError } = await query;
      if (fetchError) throw fetchError;
      setEvents(data || []);
    } catch (err) {
      console.error('Error al cargar métricas:', err.message);
      setError('No se pudieron cargar tus métricas. Intentá de nuevo más tarde.');
    } finally {
      setLoading(false);
    }
  }, [user?.id, since]);

  useEffect(() => {
    load();
  }, [load]);

  const { totals, byPlatform } = useMemo(() => aggregateUsage(events, {}), [events]);
  const hasAnyActivity = events.length > 0;
  const maxPlatformValue = Math.max(1, ...PLATFORMS.map((p) => byPlatform[p]));

  const trackingSinceLabel = TRACKING_SINCE.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });

  return (
    <div className="min-h-screen bg-surface-dim text-on-surface">
      <Sidebar />
      <main className="md:ml-64 min-h-screen overflow-y-auto relative">
        <header className="sticky top-0 z-40 bg-surface-container-lowest/80 backdrop-blur-xl border-b border-white/10 px-margin-mobile md:px-margin-desktop h-16 flex justify-between items-center">
          <div className="md:hidden flex items-center gap-2">
            <button
              onClick={() => document.dispatchEvent(new CustomEvent('open-sidebar'))}
              className="p-1 -ml-1 rounded-lg text-primary hover:bg-white/5 active:scale-95 transition-all"
              aria-label="Abrir menú"
            >
              <MaterialIcon icon="menu" />
            </button>
            <span className="font-headline-lg-mobile text-headline-lg-mobile font-bold text-primary">Aura</span>
          </div>
          <div className="hidden md:block">
            <span className="text-on-surface-variant font-label-sm">
              <span className="text-primary">Métricas</span>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full overflow-hidden border border-white/10 cursor-pointer active:scale-95 transition-all">
              <MaterialIcon icon="account_circle" size="text-[32px]" />
            </div>
          </div>
        </header>

        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-12 relative z-10">
          <section className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <h2 className="font-display-lg text-display-lg text-on-surface mb-2">Tu uso de Aura</h2>
              <p className="font-body-md text-on-surface-variant">
                Registrando actividad desde el {trackingSinceLabel}. Las métricas de antes de esa fecha no existen — no se estiman ni se inventan.
              </p>
            </div>
            <div className="flex gap-1 p-1 rounded-xl bg-surface-container-highest border border-white/10 w-fit">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRange(r.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
                    range === r.id ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </section>

          {error && (
            <section className="p-6 glass-card rounded-xl border-l-4 border-l-error mb-8">
              <div className="flex items-start gap-3">
                <MaterialIcon icon="error" className="text-error mt-1" />
                <div>
                  <p className="font-body-md text-error font-bold mb-1">Error</p>
                  <p className="font-body-md text-on-surface-variant">{error}</p>
                  <button onClick={load} className="mt-3 text-primary font-bold font-label-sm hover:underline">
                    Intentar de nuevo
                  </button>
                </div>
              </div>
            </section>
          )}

          {loading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-24 glass-card rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : !hasAnyActivity ? (
            <GlassCard className="p-12 flex flex-col items-center text-center" hover={false}>
              <MaterialIcon icon="bar_chart" className="text-on-surface-variant text-4xl mb-4" />
              <p className="font-body-md text-on-surface-variant max-w-md">
                Todavía no hay actividad registrada en este rango. En cuanto generes una imagen o publiques algo con el bot, va a aparecer acá.
              </p>
            </GlassCard>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <StatTile icon="auto_awesome" label="Imágenes generadas" value={totals.imagesGenerated} />
                <StatTile icon="edit" label="Imágenes editadas" value={totals.imagesEdited} />
                <StatTile icon="send" label="Publicaciones realizadas" value={totals.postsPublished} />
                <StatTile icon="schedule" label="Programadas pendientes" value={totals.postsScheduledPending} />
              </div>

              <GlassCard className="p-6" hover={false}>
                <h3 className="font-bold text-lg mb-5 flex items-center gap-2">
                  <MaterialIcon icon="share" className="text-primary" />
                  Publicaciones por red social
                </h3>
                <div className="space-y-3">
                  {PLATFORMS.map((p) => {
                    const value = byPlatform[p];
                    const pct = Math.round((value / maxPlatformValue) * 100);
                    return (
                      <div key={p} className="flex items-center gap-3">
                        <span className="w-24 shrink-0 font-label-sm text-on-surface-variant">{PLATFORM_META[p].label}</span>
                        <div className="flex-1 h-3 rounded-full bg-surface-container-highest overflow-hidden">
                          <div
                            className={`h-full rounded-full ${PLATFORM_META[p].color} transition-all duration-500`}
                            style={{ width: `${value === 0 ? 0 : Math.max(pct, 4)}%` }}
                          />
                        </div>
                        <span className="w-8 text-right font-bold text-sm">{value}</span>
                      </div>
                    );
                  })}
                </div>
              </GlassCard>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
