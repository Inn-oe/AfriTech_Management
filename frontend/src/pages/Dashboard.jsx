import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { DonutWithLegend, GroupedBars } from '../components/Charts.jsx';
import { initials } from '../nav.js';
import { ErrorBox, Loading, PageHeader, StatCard, StatusBadge } from '../components/ui.jsx';
import { date, humanize, money } from '../format.js';
import { useApi } from '../hooks.js';

const pct = (now, before) => {
  if (!before) return null;
  const change = ((now - before) / before) * 100;
  return `${change >= 0 ? '↗' : '↘'} ${Math.abs(change).toFixed(1)}% vs last month`;
};

export default function Dashboard() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useApi('/dashboard');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const { jobs, quotes, monthly, low_stock: lowStock, recent_invoices: recent } = data;
  const trend = pct(data.month_revenue, data.prev_month_revenue);
  const pipeline = (quotes.by_status || []).map((s) => ({ label: humanize(s.label === 'PROCESSED' ? 'Converted' : s.label === 'PENDING' ? 'Open' : s.label), value: s.count }));

  // Things that need attention today, from real records only.
  const priorities = [
    quotes.open_count > 0 && { icon: 'fa-file-lines', title: 'Follow up open quotations', sub: `${quotes.open_count} awaiting a decision`, tag: money(quotes.open_value), to: '/quotations', tone: 'warning' },
    jobs.today > 0 && { icon: 'fa-screwdriver-wrench', title: 'Jobs scheduled today', sub: `${jobs.today} on the calendar`, tag: 'Today', to: '/projects', tone: 'info' },
    lowStock.length > 0 && { icon: 'fa-cube', title: 'Reorder low stock', sub: `${lowStock.length} item${lowStock.length > 1 ? 's' : ''} at or below minimum`, tag: 'Urgent', to: '/inventory', tone: 'danger' },
    data.unpriced_stock_in?.count > 0 && { icon: 'fa-tag', title: 'Add missing buying prices', sub: `${data.unpriced_stock_in.count} item${data.unpriced_stock_in.count > 1 ? 's' : ''} stocked in without a price (${data.unpriced_stock_in.invoices} invoice${data.unpriced_stock_in.invoices > 1 ? 's' : ''})`, tag: 'Warning', to: `/invoices/${data.unpriced_stock_in.invoice_id}`, tone: 'warning' },
    data.overdue_invoices > 0 && { icon: 'fa-credit-card', title: 'Chase overdue invoices', sub: `${data.overdue_invoices} with a missed payment or past due date`, tag: money(data.overdue_amount ?? data.outstanding_balance), to: '/invoices', tone: 'danger' },
  ].filter(Boolean);

  return (
    <>
      <PageHeader title="Executive Dashboard" subtitle="A complete overview of your solar business performance.">
        {can('sales', 'write') && <Link to="/quotations/new" className="btn btn-primary"><i className="fas fa-plus me-2" />New quotation</Link>}
      </PageHeader>

      <div className="row g-3 mb-4">
        <div className="col-sm-6 col-xl-3"><StatCard label="Revenue this month" value={money(data.month_revenue)} icon="fa-wallet" hint={trend || 'Invoiced this month'} tone={trend?.startsWith('↘') ? 'bad' : ''} /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Active installations" value={jobs.active} icon="fa-screwdriver-wrench" color="info" hint={`${jobs.scheduled} scheduled`} /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Open quotations" value={quotes.open_count} icon="fa-file-lines" color="warning" hint={`Total value ${money(quotes.open_value)}`} tone="warn" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Low stock alerts" value={lowStock.length} icon="fa-triangle-exclamation" color="danger" hint={lowStock.length ? 'Items need attention' : 'All stocked'} tone={lowStock.length ? 'bad' : ''} /></div>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-lg-8">
          <div className="card h-100"><div className="card-body">
            <div className="d-flex justify-content-between align-items-start mb-2">
              <div><h2 className="panel-title">Revenue performance</h2><div className="panel-sub">Invoiced revenue and expenses, last 6 months</div></div>
              <span className="badge text-bg-secondary">Last 6 months</span>
            </div>
            <GroupedBars labels={monthly.map((m) => m.label)} series={[
              { label: 'Revenue', data: monthly.map((m) => m.revenue), color: '#0f7b5a' },
              { label: 'Expenses', data: monthly.map((m) => m.expenses), color: '#e8b04a' },
            ]} />
          </div></div>
        </div>
        <div className="col-lg-4">
          <div className="card h-100"><div className="card-body">
            <h2 className="panel-title">Quotation pipeline</h2>
            <div className="panel-sub mb-3">Number of quotations by stage</div>
            <DonutWithLegend items={pipeline} centerLabel="Quotations" isMoney={false} />
            {quotes.open_count > 0 && <div className="note-bar mt-3"><i className="fas fa-bolt" /><span><b>{quotes.open_count}</b> quotation{quotes.open_count > 1 ? 's' : ''} need a follow-up</span></div>}
          </div></div>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-8">
          <div className="card h-100">
            <div className="card-body pb-0 d-flex justify-content-between align-items-start">
              <div><h2 className="panel-title">Recent projects</h2><div className="panel-sub">Latest installation and service jobs</div></div>
              <Link to="/projects" className="small fw-semibold">View all →</Link>
            </div>
            <div className="table-responsive mt-3">
              <table className="table table-hover align-middle mb-0">
                <thead><tr><th>Customer</th><th>Job</th><th>Technician</th><th>Date</th><th>Status</th></tr></thead>
                <tbody>
                  {jobs.recent.length === 0 && <tr><td colSpan="5" className="text-center text-muted py-4">No jobs yet.</td></tr>}
                  {jobs.recent.map((j) => (
                    <tr key={j.id}>
                      <td className="fw-semibold">{j.customer_name || '—'}</td>
                      <td>{j.activity_type_name || j.description || '—'}</td>
                      <td>{j.technician || '—'}</td>
                      <td>{date(j.date)}</td>
                      <td><StatusBadge value={j.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="col-lg-4">
          <div className="card h-100"><div className="card-body">
            <h2 className="panel-title mb-3">Today's priorities</h2>
            {priorities.length === 0 && <div className="text-muted small">Nothing needs attention right now.</div>}
            {priorities.map((p) => (
              <Link key={p.title} to={p.to} className="d-flex align-items-center gap-3 py-2 text-decoration-none text-reset border-bottom">
                <span className="stat-icon" style={{ width: 38, height: 38, fontSize: '0.95rem', background: '#e5f4ee', color: '#0f7b5a' }}><i className={`fas ${p.icon}`} /></span>
                <span className="min-w-0 flex-grow-1"><span className="d-block fw-semibold small">{p.title}</span><span className="d-block text-muted" style={{ fontSize: '0.78rem' }}>{p.sub}</span></span>
                <span className={`badge text-bg-${p.tone}`}>{p.tag}</span>
              </Link>
            ))}
          </div></div>
        </div>
      </div>

      {recent.length > 0 && (
        <div className="card mt-3">
          <div className="card-body pb-0"><h2 className="panel-title">Latest invoices</h2></div>
          <div className="table-responsive mt-2">
            <table className="table table-hover align-middle mb-0">
              <thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th className="text-end">Total</th><th className="text-end">Balance</th><th>Status</th></tr></thead>
              <tbody>
                {recent.map((i) => (
                  <tr key={i.id}>
                    <td><Link to={`/invoices/${i.id}`} className="fw-semibold">{i.invoice_number}</Link></td>
                    <td><span className="d-inline-flex align-items-center gap-2"><span className="avatar soft" style={{ width: 28, height: 28, fontSize: '0.68rem' }}>{initials(i.customer?.name)}</span>{i.customer?.name || '—'}</span></td>
                    <td>{date(i.date_created)}</td>
                    <td className="text-end">{money(i.total_amount)}</td>
                    <td className="text-end fw-semibold">{money(i.balance_due)}</td>
                    <td><StatusBadge value={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
