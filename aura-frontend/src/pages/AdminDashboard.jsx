import { useCallback, useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar';
import GlassCard from '../components/GlassCard';
import MaterialIcon from '../components/MaterialIcon';
import StatCard from '../components/StatCard';
import {
  PERIODS,
  DEFAULT_PERIOD,
  periodToRange,
  fetchDashboardMetrics,
  formatUsd,
  formatCount,
  formatDate,
} from '../lib/metrics';
import { METRICS_ACCENT } from '../components/TrendChart';

const PERIOD_LABELS = { 7: '7 días', 30: '30 días', 90: '90 días', all: 'Todo' };

// design.md D3: la nota que acompaña siempre al KPI de costo — nunca se
// muestra la cifra sin esta aclaración (tasks.md 4.4).
const COST_NOTE = 'Estimación por invocación — no es facturación de Google Cloud.';

export default function AdminDashboard() {
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { from, to } = periodToRange(period);
      // Una sola llamada por período (tasks.md 4.3, spec "KPIs render from
      // one request"): nada de queries adicionales ni agregación en el browser.
      const data = await fetchDashboardMetrics({ from, to });
      setMetrics(data);
    } catch (err) {
      console.error('Error al cargar métricas del dashboard:', err.message);
      // `forbidden` (42501) es un caso real y esperado si alguien sin rol
      // admin activo llega hasta acá (defensa en profundidad detrás de
      // ProtectedRoute); se muestra igual que cualquier otro fallo, sin
      // datos fabricados ni stale.
      setError(
        err?.code === '42501' || /forbidden/i.test(err?.message || '')
          ? 'No tenés permisos para ver estas métricas.'
          : 'No se pudieron cargar las métricas. Verificá la conexión a la base de datos.'
      );
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  // Vacío por período (spec "Metrics still uninstrumented"): sin publicaciones
  // ni imágenes en el rango seleccionado. El KPI de clientes es independiente
  // y siempre muestra datos reales (spec "Client KPI works without any usage data").
  const isUsageEmpty = !!metrics && metrics.posts === 0 && metrics.images.total === 0;
  const usageState = isUsageEmpty ? 'empty' : 'ok';

  const dailyImages = metrics?.daily?.map((d) => d.images) ?? [];
  const dailyPosts = metrics?.daily?.map((d) => d.posts) ?? [];

  const firstEventLabel = formatDate(metrics?.firstEventAt);
  const lastEventLabel = formatDate(metrics?.lastEventAt);

  return (
    <div className="min-h-screen bg-background text-on-background font-body-md">
      <Sidebar />

      <main className="md:ml-64 min-h-screen overflow-y-auto relative">
        <header className="h-16 flex items-center justify-between px-margin-desktop bg-surface-container-lowest/80 backdrop-blur-xl border-b border-white/10 sticky top-0 z-30">
          <div>
            <h2 className="font-headline-lg text-headline-lg font-bold text-primary">Dashboard</h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-surface-container-high border border-white/10 flex items-center justify-center">
              <MaterialIcon icon="account_circle" className="text-[20px]" />
            </div>
          </div>
        </header>

        <div className="p-margin-desktop max-w-container-max mx-auto space-y-6">
          {/* Selector de período (tasks.md 4.5) */}
          <div className="flex items-center gap-2 flex-wrap">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
                  period === p
                    ? 'bg-primary/15 text-primary border border-primary/30'
                    : 'bg-surface-container-low text-on-surface-variant border border-transparent hover:bg-surface-container-high'
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>

          {loading ? (
            <GlassCard hover={false} className="p-12 text-center">
              <MaterialIcon icon="autorenew" className="text-primary text-4xl animate-spin mx-auto mb-4" />
              <p className="text-on-surface-variant">Cargando métricas...</p>
            </GlassCard>
          ) : error ? (
            <GlassCard hover={false} className="p-12 text-center">
              <div className="flex items-center justify-center gap-2 text-error mb-4">
                <MaterialIcon icon="error" />
                <span className="font-bold">Error</span>
              </div>
              <p className="text-on-surface-variant mb-4">{error}</p>
              <button onClick={() => load()} className="text-primary font-bold hover:underline">
                Intentar de nuevo
              </button>
            </GlassCard>
          ) : (
            <>
              {/* 4 KPI cards (tasks.md 4.4). Solo Publicaciones e Imágenes son
                  series temporales y reciben `trend` (design.md D-chart-scope);
                  Clientes y Costo estimado quedan como número plano. */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  title="Clientes"
                  icon="group"
                  state="ok"
                  value={formatCount(metrics.clients.total)}
                  subValue={`${formatCount(metrics.clients.active)} activos`}
                />
                <StatCard
                  title="Costo estimado Google AI"
                  icon="payments"
                  state={usageState}
                  value={formatUsd(metrics.costUsd)}
                  note={COST_NOTE}
                />
                <StatCard
                  title="Publicaciones realizadas"
                  icon="send"
                  state={usageState}
                  value={formatCount(metrics.posts)}
                  trend={dailyPosts}
                  trendColor={METRICS_ACCENT}
                />
                <StatCard
                  title="Imágenes generadas"
                  icon="image"
                  state={usageState}
                  value={formatCount(metrics.images.total)}
                  subValue={`${formatCount(metrics.images.new)} nuevas · ${formatCount(metrics.images.redone)} rehechas`}
                  trend={dailyImages}
                  trendColor={METRICS_ACCENT}
                />
              </div>

              {/* Cobertura de datos (tasks.md 4.8) */}
              <GlassCard hover={false} className="p-4 flex items-center gap-3 text-sm">
                <MaterialIcon icon="schedule" className="text-on-surface-variant text-[18px] shrink-0" />
                {firstEventLabel ? (
                  <p className="text-on-surface-variant">
                    Datos desde <span className="text-on-surface font-medium">{firstEventLabel}</span>
                    {' · '}
                    Último evento <span className="text-on-surface font-medium">{lastEventLabel}</span>
                  </p>
                ) : (
                  <p className="text-on-surface-variant">
                    Todavía no hay eventos registrados — la instrumentación del bot está pendiente
                    (ver <code className="text-xs">docs/usage-events-contract.md</code>).
                  </p>
                )}
              </GlassCard>

              {/* Desglose de costo por modelo (tasks.md 4.6) */}
              <GlassCard hover={false} className="overflow-hidden">
                <div className="px-6 py-4 border-b border-white/10">
                  <h3 className="font-headline-sm font-bold text-on-surface">Desglose de costo por modelo</h3>
                </div>
                {metrics.byModel.length === 0 ? (
                  <div className="p-8 text-center text-on-surface-variant text-sm">
                    Sin eventos con costo en el período seleccionado.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-white/10 bg-white/5">
                          <th className="px-6 py-3 font-bold text-xs text-outline uppercase tracking-wider">Modelo</th>
                          <th className="px-6 py-3 font-bold text-xs text-outline uppercase tracking-wider">Eventos</th>
                          <th className="px-6 py-3 font-bold text-xs text-outline uppercase tracking-wider">Imágenes</th>
                          <th className="px-6 py-3 font-bold text-xs text-outline uppercase tracking-wider">Tokens in</th>
                          <th className="px-6 py-3 font-bold text-xs text-outline uppercase tracking-wider">Tokens out</th>
                          <th className="px-6 py-3 font-bold text-xs text-outline uppercase tracking-wider">Costo estimado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {metrics.byModel.map((row) => (
                          <tr key={row.model || 'sin-modelo'} className="hover:bg-white/[0.03] transition-colors">
                            <td className="px-6 py-3 text-on-surface font-mono text-sm">{row.model || '—'}</td>
                            <td className="px-6 py-3 text-on-surface-variant">{formatCount(row.events)}</td>
                            <td className="px-6 py-3 text-on-surface-variant">{formatCount(row.images)}</td>
                            <td className="px-6 py-3 text-on-surface-variant">{formatCount(row.tokensIn)}</td>
                            <td className="px-6 py-3 text-on-surface-variant">{formatCount(row.tokensOut)}</td>
                            <td className="px-6 py-3">
                              {row.priced ? (
                                <span className="text-on-surface">{formatUsd(row.costUsd)}</span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-amber-400 text-xs font-bold">
                                  <MaterialIcon icon="warning" className="text-[14px]" />
                                  sin precio configurado
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </GlassCard>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
