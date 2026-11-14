export function money(value, currency = 'USD') {
  const n = Number(value || 0);
  const symbol = { USD: '$', ZWL: 'ZWL ', RAND: 'R ' }[currency] ?? '$';
  return `${n < 0 ? '-' : ''}${symbol}${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function number(value, digits = 0) {
  if (value === null || value === undefined || value === '') return '—';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function date(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function dateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Values for <input type="date"> / <input type="datetime-local">
export const toDateInput = (v) => (v ? String(v).slice(0, 10) : '');
export const toDateTimeInput = (v) => (v ? String(v).slice(0, 16) : '');
export const today = () => new Date().toISOString().slice(0, 10);
export const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export const humanize = (s) =>
  s ? String(s).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : '—';

const STATUS_COLORS = {
  PAID: 'success', COMPLETED: 'success', PROCESSED: 'success', INCOME: 'success',
  PARTIAL: 'warning', PENDING: 'warning', IN_PROGRESS: 'info', SCHEDULED: 'primary',
  PLANNED: 'primary', SENT: 'info', DRAFT: 'secondary', OVERDUE: 'danger',
  CANCELLED: 'dark', EXPENSE: 'danger',
};
export const statusColor = (s) => STATUS_COLORS[String(s || '').toUpperCase()] || 'secondary';
