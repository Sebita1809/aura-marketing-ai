import { useId } from 'react';

// Chart de tendencia inline, sin librería (design.md D11 de admin-dashboard-metrics):
// un <path> de línea y un área rellena con <linearGradient> que se desvanece
// desde el color de la métrica (arriba, pegado a la línea) hacia transparente
// (abajo) — estilo "stock chart". Ver design.md D-chart-accent: METRICS_ACCENT
// es un acento semántico nuevo (turquesa), separado del gradiente violeta→azul
// de marca (#ddb7ff → #0566d9) que ya usa GradientButton.
export const METRICS_ACCENT = '#2dd4bf'; // Tailwind teal-400

const WIDTH = 240;
const HEIGHT = 56;
const PADDING_Y = 4;

/**
 * `data`: array de números, o de { value } / { day, value }. Se ignoran los
 * demás campos — este componente es puramente visual (una tendencia relativa,
 * no un chart con ejes ni tooltip); los valores exactos ya están en el número
 * principal de la card.
 */
export default function TrendChart({ data, color = METRICS_ACCENT }) {
  const gradientId = `trend-gradient-${useId()}`;

  const values = (data || []).map((d) =>
    typeof d === 'number' ? d : Number(d?.value ?? d?.images ?? d?.posts ?? 0)
  );

  // Con 0 o 1 punto no hay tendencia que dibujar (una sola muestra no es una
  // línea); se deja que el caller decida qué mostrar en ese caso.
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1; // evita división por cero si la serie es plana

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * WIDTH;
    const y = HEIGHT - PADDING_Y - ((v - min) / range) * (HEIGHT - PADDING_Y * 2);
    return [x, y];
  });

  const linePath = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  const areaPath = `${linePath} L${WIDTH},${HEIGHT} L0,${HEIGHT} Z`;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="w-full h-full"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
