import {
  ArcElement, BarElement, CategoryScale, Chart as ChartJS, Filler, Legend, LinearScale, LineElement,
  PointElement, Tooltip,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { money } from '../format.js';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip, Legend);
ChartJS.defaults.font.family = "'Inter', system-ui, sans-serif";
ChartJS.defaults.color = '#6b7a8c';

export const PALETTE = ['#0f7b5a', '#3dbd98', '#e8a93a', '#d9e0e7', '#2c6fbb', '#8a63d2', '#e0625d', '#5b7083'];

function Empty() {
  return <div className="h-100 d-flex align-items-center justify-content-center text-muted small">No data for this period</div>;
}

const compact = (v) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `$${v}`);
const moneyTooltip = { callbacks: { label: (ctx) => ` ${ctx.dataset.label ? `${ctx.dataset.label}: ` : ''}${money(ctx.parsed.y ?? ctx.parsed)}` } };

/** Doughnut with the total in the middle and a percentage legend beside it. */
export function DonutWithLegend({ items, centerLabel, isMoney = true }) {
  // Keep the five biggest slices and fold the rest into "Other" so the legend stays readable.
  const sorted = (items || []).filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const rows = sorted.length > 6
    ? [...sorted.slice(0, 5), { label: 'Other', value: sorted.slice(5).reduce((s, i) => s + i.value, 0) }]
    : sorted;
  const total = rows.reduce((s, i) => s + i.value, 0);
  if (!total) return <div className="chart-box"><Empty /></div>;
  return (
    <div className="row align-items-center g-3">
      <div className="col-sm-6">
        <div className="position-relative" style={{ height: 190 }}>
          <Doughnut
            data={{ labels: rows.map((i) => i.label), datasets: [{ data: rows.map((i) => i.value), backgroundColor: PALETTE, borderWidth: 3, borderColor: '#fff' }] }}
            options={{ maintainAspectRatio: false, cutout: '66%', plugins: { legend: { display: false }, tooltip: isMoney ? moneyTooltip : undefined } }}
          />
          <div className="position-absolute top-50 start-50 translate-middle text-center" style={{ pointerEvents: 'none' }}>
            <div className="fw-bold fs-5 lh-1">{isMoney ? compact(total) : total}</div>
            {centerLabel && <div className="text-muted" style={{ fontSize: '0.72rem' }}>{centerLabel}</div>}
          </div>
        </div>
      </div>
      <div className="col-sm-6">
        {rows.map((i, n) => (
          <div className="legend-row" key={i.label}>
            <span className="dot" style={{ background: PALETTE[n % PALETTE.length] }} />
            <span className="text-truncate">{i.label}</span>
            <span className="pct">{Math.round((i.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DoughnutChart({ items, isMoney = false }) {
  if (!items?.length || items.every((i) => !i.value)) return <div className="chart-box"><Empty /></div>;
  return (
    <div className="chart-box">
      <Doughnut
        data={{ labels: items.map((i) => i.label), datasets: [{ data: items.map((i) => i.value), backgroundColor: PALETTE, borderWidth: 2, borderColor: '#fff' }] }}
        options={{ maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } }, tooltip: isMoney ? moneyTooltip : undefined } }}
      />
    </div>
  );
}

export function BarChart({ items, label, color = PALETTE[0], horizontal = false }) {
  if (!items?.length) return <div className="chart-box"><Empty /></div>;
  return (
    <div className="chart-box">
      <Bar
        data={{ labels: items.map((i) => i.label), datasets: [{ label, data: items.map((i) => i.value), backgroundColor: color, borderRadius: 6 }] }}
        options={{
          indexAxis: horizontal ? 'y' : 'x',
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: moneyTooltip },
          scales: { x: { grid: { display: horizontal } }, y: { grid: { display: !horizontal }, beginAtZero: true } },
        }}
      />
    </div>
  );
}

/** Side-by-side monthly bars, e.g. revenue vs expenses. series = [{ label, data, color }] */
export function GroupedBars({ labels, series, height = 280 }) {
  if (!labels?.length || series.every((s) => s.data.every((v) => !v))) return <div className="chart-box"><Empty /></div>;
  return (
    <div className="chart-box" style={{ height }}>
      <Bar
        data={{ labels, datasets: series.map((s, i) => ({ label: s.label, data: s.data, backgroundColor: s.color || PALETTE[i], borderRadius: 5, maxBarThickness: 34 })) }}
        options={{
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } }, tooltip: moneyTooltip },
          scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: compact }, grid: { color: '#edf1f4' }, border: { display: false } } },
        }}
      />
    </div>
  );
}

export function TrendChart({ labels, series }) {
  return (
    <div className="chart-box">
      <Line
        data={{
          labels,
          datasets: series.map((s, i) => ({
            label: s.label, data: s.data, borderColor: s.color || PALETTE[i], backgroundColor: `${s.color || PALETTE[i]}22`,
            fill: true, tension: 0.35, pointRadius: 3,
          })),
        }}
        options={{
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'top', align: 'end', labels: { boxWidth: 12 } }, tooltip: moneyTooltip },
          scales: { x: { grid: { display: false } }, y: { beginAtZero: true } },
        }}
      />
    </div>
  );
}
