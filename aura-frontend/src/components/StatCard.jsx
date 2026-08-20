import GlassCard from './GlassCard';
import MaterialIcon from './MaterialIcon';
import TrendChart from './TrendChart';

/**
 * Card de KPI del dashboard de admin (tasks.md 4.1). `state` gobierna qué se
 * renderiza en el cuerpo:
 *  - 'loading': skeleton (usado si algún día se pagina KPI por KPI; hoy
 *    AdminDashboard.jsx muestra un loader de página entera mientras carga,
 *    ver spec "Loading state").
 *  - 'error': mensaje corto in-card (defensivo; el error de la llamada RPC
 *    se maneja a nivel de página con retry, spec "RPC fails").
 *  - 'empty': "sin datos aún" en vez de 0/$0 — nunca se debe leer un 0 como
 *    "no hay costo" cuando en realidad es "no hay instrumentación todavía"
 *    (spec: no-data state, D3 del design).
 *  - 'ok' (default): valor real + subValue/note opcionales, y — solo si se
 *    pasa `trend` — un mini area-chart de tendencia (design.md D-chart-scope:
 *    únicamente las cards de serie temporal lo reciben; Clientes y Costo
 *    estimado nunca pasan `trend`).
 */
export default function StatCard({
  title,
  value,
  subValue,
  icon,
  note,
  state = 'ok',
  trend,
  trendColor,
}) {
  return (
    <GlassCard hover={false} className="p-5 flex flex-col gap-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider truncate">
          {title}
        </span>
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
          <MaterialIcon icon={icon} className="text-[20px]" />
        </div>
      </div>

      {state === 'loading' && (
        <div className="space-y-2">
          <div className="h-8 w-24 rounded-lg bg-white/5 animate-pulse" />
          <div className="h-3 w-16 rounded bg-white/5 animate-pulse" />
        </div>
      )}

      {state === 'error' && (
        <p className="text-error text-sm flex items-center gap-1.5">
          <MaterialIcon icon="error" className="text-[16px]" />
          No se pudo cargar
        </p>
      )}

      {state === 'empty' && (
        <div>
          <p className="font-headline-lg text-headline-lg font-bold text-on-surface-variant/50">
            Sin datos aún
          </p>
          {note && <p className="text-xs text-on-surface-variant/60 mt-1">{note}</p>}
        </div>
      )}

      {state === 'ok' && (
        <div>
          <p className="font-headline-lg text-headline-lg font-bold text-on-surface">{value}</p>
          {subValue && <p className="text-sm text-on-surface-variant mt-0.5">{subValue}</p>}
        </div>
      )}

      {state === 'ok' && Array.isArray(trend) && trend.length > 1 && (
        <div className="h-14 -mx-1 -mb-1">
          <TrendChart data={trend} color={trendColor} />
        </div>
      )}

      {state === 'ok' && note && <p className="text-xs text-on-surface-variant/60">{note}</p>}
    </GlassCard>
  );
}
