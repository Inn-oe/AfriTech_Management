// For the person who runs the platform: how much each company uses the software every day, and a calculator that
// turns that usage into a monthly price. Only listed in the menu for emails in PLATFORM_ADMIN_EMAILS.
import { useEffect, useMemo, useState } from 'react';
import { downloadCsv } from '../csv.js';
import { ErrorBox, Loading, PageHeader, StatCard } from '../components/ui.jsx';
import { money, number } from '../format.js';
import { useApi } from '../hooks.js';

const PERIODS = [7, 30, 90];
const RATE_FIELDS = [
  { key: 'base', label: 'Base fee per month' },
  { key: 'per_user', label: 'Per user per month' },
  { key: 'per_1000_requests', label: 'Per 1,000 requests' },
  { key: 'per_whatsapp_message', label: 'Per WhatsApp message' },
  { key: 'per_1000_records', label: 'Per 1,000 stored records' },
];
const STORE_KEY = 'platform-usage-rates';

function loadRates() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch {
    return {};
  }
}

/** Tiny bar chart of one number per day. */
function Spark({ series, field }) {
  const max = Math.max(1, ...series.map((r) => r[field]));
  const w = 4;
  return (
    <svg width={series.length * (w + 1)} height="26" role="img" aria-label={`${field} per day`}>
      {series.map((r, i) => {
        const h = r[field] ? Math.max(2, Math.round((r[field] / max) * 24)) : 1;
        return <rect key={r.day} x={i * (w + 1)} y={26 - h} width={w} height={h} rx="1" fill={r[field] ? '#0f7b5a' : '#d5dbe2'}><title>{`${r.day}: ${r[field]}`}</title></rect>;
      })}
    </svg>
  );
}

export default function PlatformUsage() {
  const [days, setDays] = useState(30);
  const { data, loading, error, reload } = useApi(`/platform/usage?days=${days}`);
  const [rates, setRates] = useState(loadRates);

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(rates)); } catch { /* private window: rates are just not remembered */ }
  }, [rates]);

  const price = (c) => {
    const r = (k) => Number(rates[k]) || 0;
    const monthly = (perDay) => perDay * 30;
    return r('base') + r('per_user') * c.users + r('per_1000_requests') * monthly(c.per_day.requests) / 1000
      + r('per_whatsapp_message') * monthly(c.per_day.whatsapp_messages) + r('per_1000_records') * c.stored_records / 1000;
  };
  const priced = useMemo(() => (data?.companies || []).map((c) => ({ ...c, price: price(c) })), [data, rates]); // eslint-disable-line react-hooks/exhaustive-deps
  const anyRate = RATE_FIELDS.some((f) => Number(rates[f.key]) > 0);

  const exportCsv = () => downloadCsv(`platform-usage-${days}d.csv`, priced, [
    { label: 'Company', value: (c) => c.name }, { label: 'Users', value: (c) => c.users },
    { label: 'Active users per day', value: (c) => c.per_day.active_users }, { label: 'Requests per day', value: (c) => c.per_day.requests },
    { label: 'Changes per day', value: (c) => c.per_day.writes }, { label: 'WhatsApp messages per day', value: (c) => c.per_day.whatsapp_messages },
    { label: 'New records per day', value: (c) => c.per_day.new_records }, { label: 'Records stored', value: (c) => c.stored_records },
    { label: 'Days used', value: (c) => c.days_used }, { label: 'Suggested monthly price', value: (c) => c.price.toFixed(2) },
  ]);

  const t = data?.totals || {};
  const live = (data?.companies || []).filter((c) => c.totals.requests > 0).length;
  const mb = data?.database_bytes ? `${number(data.database_bytes / 1048576, 1)} MB` : 'n/a';
  return (
    <>
      <PageHeader title="Platform usage" icon="fa-gauge-high" subtitle="How much each company uses the software every day. Use it to price the platform from real consumption.">
        <select className="form-select w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          {PERIODS.map((p) => <option key={p} value={p}>Last {p} days</option>)}
        </select>
        <button type="button" className="btn btn-outline-secondary" onClick={reload}><i className="fas fa-rotate me-2" />Refresh</button>
        <button type="button" className="btn btn-outline-primary" onClick={exportCsv} disabled={!data}><i className="fas fa-file-csv me-2" />CSV</button>
      </PageHeader>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="row g-3 mb-4">
            <div className="col-6 col-lg-3"><StatCard label="Companies in use" value={`${live} of ${data.companies.length}`} icon="fa-building" hint={`active in the last ${days} days`} /></div>
            <div className="col-6 col-lg-3"><StatCard label="Requests per day" value={number((t.requests || 0) / days, 0)} icon="fa-arrow-right-arrow-left" color="info" hint={`${number(t.writes || 0)} changes in total`} /></div>
            <div className="col-6 col-lg-3"><StatCard label="WhatsApp messages per day" value={number((t.whatsapp_messages || 0) / days, 0)} icon="fa-comments" color="warning" hint={`${number(t.whatsapp_conversations || 0)} conversation-days`} /></div>
            <div className="col-6 col-lg-3"><StatCard label="Database size" value={mb} icon="fa-database" color="secondary" hint="all companies together" /></div>
          </div>

          <div className="card mb-4"><div className="card-body">
            <h2 className="h6 mb-1">Price calculator</h2>
            <p className="small text-muted mb-3">Enter what you would charge for each unit of use (in USD). The table then shows each company's monthly price, projected from its daily average over the period. These figures stay in this browser only; nothing is saved on the server.</p>
            <div className="row g-2">
              {RATE_FIELDS.map((f) => (
                <div className="col-6 col-lg" key={f.key}>
                  <label className="form-label small mb-1" htmlFor={`rate-${f.key}`}>{f.label}</label>
                  <div className="input-group input-group-sm"><span className="input-group-text">$</span>
                    <input id={`rate-${f.key}`} type="number" min="0" step="any" className="form-control" value={rates[f.key] ?? ''}
                      onChange={(e) => setRates({ ...rates, [f.key]: e.target.value })} placeholder="0" /></div>
                </div>
              ))}
            </div>
          </div></div>

          <div className="card"><div className="table-responsive">
            <table className="table align-middle mb-0">
              <thead><tr>
                <th>Company</th><th className="text-end">Users</th><th className="text-end">Active / day</th><th className="text-end">Requests / day</th>
                <th className="text-end">WhatsApp msgs / day</th><th className="text-end">New records / day</th><th className="text-end">Records stored</th>
                <th>Requests, day by day</th><th className="text-end">Monthly price</th>
              </tr></thead>
              <tbody>
                {priced.map((c) => (
                  <tr key={c.id} className={c.totals.requests ? '' : 'text-muted'}>
                    <td><div className="fw-semibold">{c.name}</div>
                      <div className="small text-muted">{c.whatsapp && <span className="badge text-bg-success me-1">WhatsApp bot</span>}used {c.days_used} of {data.days} days</div></td>
                    <td className="text-end">{number(c.users)}</td>
                    <td className="text-end">{number(c.per_day.active_users, 1)}</td>
                    <td className="text-end">{number(c.per_day.requests, 0)}</td>
                    <td className="text-end">{c.whatsapp ? number(c.per_day.whatsapp_messages, 0) : '–'}</td>
                    <td className="text-end">{number(c.per_day.new_records, 1)}</td>
                    <td className="text-end">{number(c.stored_records)}</td>
                    <td><Spark series={c.series} field="requests" /></td>
                    <td className="text-end fw-semibold">{anyRate ? money(c.price) : <span className="text-muted fw-normal">set prices above</span>}</td>
                  </tr>
                ))}
                {!priced.length && <tr><td colSpan="9" className="text-center text-muted py-4">No companies yet.</td></tr>}
              </tbody>
            </table>
          </div></div>
          <p className="small text-muted mt-3">A request is any call a signed-in person's screen makes to the server; a company that only opens the app still uses some. Counts are collected from the day this page was released, so older days read zero. WhatsApp figures belong to the single company the bot serves.</p>
        </>
      )}
    </>
  );
}
