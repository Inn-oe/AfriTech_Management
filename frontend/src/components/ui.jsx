import { humanize, statusColor } from '../format.js';

export function PageHeader({ title, icon, subtitle, children }) {
  return (
    <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-4">
      <div>
        <h1 className="h2 mb-0 fw-bold">{title}</h1>
        {subtitle && <div className="text-muted small mt-1">{subtitle}</div>}
      </div>
      <div className="d-flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

// color: primary (green) | warning | danger | info | secondary. tone colours the hint: '' | 'warn' | 'bad'.
const ICON_TINT = {
  primary: ['#e5f4ee', '#0f7b5a'], success: ['#e5f4ee', '#0f7b5a'], warning: ['#fdf0cf', '#a86c00'],
  danger: ['#fde8e6', '#c53030'], info: ['#dfeefb', '#2c6fbb'], secondary: ['#eceff3', '#55657a'],
};

export function StatCard({ label, value, icon, color = 'primary', hint, tone = '' }) {
  const [bg, fg] = ICON_TINT[color] || ICON_TINT.primary;
  return (
    <div className="card stat-card h-100">
      <div className="card-body d-flex align-items-center">
        <div className="stat-icon" style={{ background: bg, color: fg }}>
          <i className={`fas ${icon}`} />
        </div>
        <div className="ms-3 min-w-0">
          <div className="stat-label">{label}</div>
          <div className="fs-4 fw-bold text-truncate">{value}</div>
          {hint && <div className={`stat-hint ${tone}`}>{hint}</div>}
        </div>
      </div>
    </div>
  );
}

export function Loading({ text = 'Loading…' }) {
  return (
    <div className="text-center text-muted py-5">
      <div className="spinner-border spinner-border-sm me-2" role="status" />
      {text}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert alert-danger d-flex justify-content-between align-items-center">
      <span><i className="fas fa-exclamation-triangle me-2" />{error}</span>
      {onRetry && <button type="button" className="btn btn-sm btn-outline-danger" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function StatusBadge({ value }) {
  if (!value) return <span className="text-muted">—</span>;
  return <span className={`badge text-bg-${statusColor(value)}`}>{humanize(value)}</span>;
}

export function SearchBox({ value, onChange, placeholder = 'Search…' }) {
  return (
    <div className="input-group search-box">
      <span className="input-group-text bg-white"><i className="fas fa-search text-muted" /></span>
      <input className="form-control" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function IconButton({ icon, title, variant = 'outline-secondary', onClick, href, disabled }) {
  const cls = `btn btn-sm btn-${variant}`;
  if (href) {
    return (
      <a className={cls} href={href} title={title} aria-label={title}>
        <i className={`fas ${icon}`} />
      </a>
    );
  }
  return (
    <button type="button" className={cls} title={title} aria-label={title} onClick={onClick} disabled={disabled}>
      <i className={`fas ${icon}`} />
    </button>
  );
}

export function EmptyRow({ colSpan, text = 'No records found.' }) {
  return (
    <tr>
      <td colSpan={colSpan} className="text-center text-muted py-4">{text}</td>
    </tr>
  );
}
