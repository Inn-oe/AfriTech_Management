import {
  ArcElement, BarElement, CategoryScale, Chart as ChartJS, Filler, Legend, LinearScale, LineElement,
  PointElement, Tooltip,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { money } from '../format.js';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip, Legend);
ChartJS.defaults.font.family = "'Poppins', system-ui, sans-serif";
ChartJS.defaults.color = '#6c757d';

export const PALETTE = ['#4361ee', '#f72585', '#4cc9f0', '#f8961e', '#7209b7', '#43aa8b', '#577590', '#e63946', '#90be6d', '#adb5bd'];

function Empty() {
  return <div className="h-100 d-flex align-items-center justify-content-center text-muted small">No data for this period</div>;
}

const moneyTooltip = { callbacks: { label: (ctx) => ` ${ctx.dataset.label ? `${ctx.dataset.label}: ` : ''}${money(ctx.parsed.y ?? ctx.parsed)}` } };

export function DoughnutChart({ items, isMoney = false }) {
  if (!items?.length || items.every((i) => !i.value)) return <div className="chart-box"><Empty /></div>;
  return (
    <div className="chart-box">
      <Doughnut
        data={{
          labels: items.map((i) => i.label),
          datasets: [{ data: items.map((i) => i.value), backgroundColor: PALETTE, borderWidth: 2, borderColor: '#fff' }],
        }}
        options={{
          maintainAspectRatio: false,
          cutout: '62%',
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } }, tooltip: isMoney ? moneyTooltip : undefined },
        }}
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

export function TrendChart({ labels, series }) {
  return (
    <div className="chart-box">
      <Line
        data={{
          labels,
          datasets: series.map((s, i) => ({
            label: s.label,
            data: s.data,
            borderColor: s.color || PALETTE[i],
            backgroundColor: `${s.color || PALETTE[i]}22`,
            fill: true,
            tension: 0.35,
            pointRadius: 3,
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
