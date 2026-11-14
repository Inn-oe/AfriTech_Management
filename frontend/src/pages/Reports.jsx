import { useState } from 'react';
import { api, pdfUrl } from '../api.js';
import { useAuth } from '../auth.jsx';
import { DonutWithLegend, GroupedBars } from '../components/Charts.jsx';
import { useToast } from '../components/Toast.jsx';
import { ErrorBox, Loading, PageHeader, StatCard, StatusBadge } from '../components/ui.jsx';
import { downloadCsv } from '../csv.js';
import { date, humanize, money } from '../format.js';
import { useApi } from '../hooks.js';

const COLUMNS = {
  invoices: [
    { label: 'Invoice', value: (r) => r.invoice_number }, { label: 'Customer', value: (r) => r.customer?.name },
    { label: 'Date', value: (r) => date(r.date_created) }, { label: 'Status', value: (r) => r.status },
    { label: 'Total', value: (r) => r.total_amount }, { label: 'Paid', value: (r) => r.paid_amount }, { label: 'Balance', value: (r) => r.balance_due },
  ],
  inventory: [
    { label: 'Product', value: (r) => r.name }, { label: 'Brand', value: (r) => r.brand }, { label: 'Category', value: (r) => r.category },
    { label: 'Code', value: (r) => r.specifications }, { label: 'In stock', value: (r) => r.quantity }, { label: 'Minimum', value: (r) => r.minimum_stock_level },
    { label: 'Cost price', value: (r) => r.cost_price }, { label: 'Selling price', value: (r) => r.unit_price },
    { label: 'Stock value (cost)', value: (r) => (r.quantity || 0) * (r.cost_price || 0) },
  ],
  jobs: [
    { label: 'Date', value: (r) => date(r.date) }, { label: 'Customer', value: (r) => r.customer_name }, { label: 'Job type', value: (r) => r.activity_type_name },
    { label: 'Description', value: (r) => r.description }, { label: 'Technician', value: (r) => r.technician }, { label: 'Status', value: (r) => r.status },
    { label: 'Cost', value: (r) => r.total_cost },
  ],
};

const QUICK = [
  { key: 'invoices', module: 'sales', title: 'Sales report', sub: 'All invoices, payments and balances', icon: 'fa-wallet', url: '/invoices', file: 'sales-report.csv' },
  { key: 'inventory', module: 'inventory', title: 'Inventory report', sub: 'Stock levels, prices and value', icon: 'fa-cube', url: '/inventory', file: 'inventory-report.csv' },
  { key: 'jobs', module: 'operations', title: 'Project report', sub: 'Installations and service jobs', icon: 'fa-screwdriver-wrench', url: '/activities', file: 'project-report.csv' },
];

export default function Reports() {
  const { can } = useAuth();
  const notify = useToast();
  const [busy, setBusy] = useState('');
  const summary = useApi('/financial/summary');
  const dash = useApi('/dashboard');

  const exportCsv = async (q) => {
    setBusy(q.key);
    try {
      downloadCsv(q.file, await api.get(q.url), COLUMNS[q.key]);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  if ((summary.loading && !summary.data) || (dash.loading && !dash.data)) return <Loading />;
  const error = summary.error || dash.error;
  if (error) return <ErrorBox error={error} onRetry={() => { summary.reload(); dash.reload(); }} />;

  const k = summary.data.kpis;
  const { monthly, revenue_by_category: byCategory } = dash.data;
  const margin = k.revenue > 0 ? (k.gross_profit / k.revenue) * 100 : 0;
  const top = byCategory[0];
  const topShare = top && byCategory.reduce((s, c) => s + c.value, 0) ? Math.round((top.value / byCategory.reduce((s, c) => s + c.value, 0)) * 100) : 0;
  const period = `month=${summary.data.month}&year=${summary.data.year}`;

  return (
    <>
      <PageHeader title="Reports & Analytics" subtitle="Understand profitability, sales trends and business performance.">
        <a className="btn btn-outline-secondary" href={pdfUrl(`/financial/income-statement.pdf?${period}`)}><i className="fas fa-file-pdf me-2" />Income statement</a>
        <a className="btn btn-primary" href={pdfUrl(`/financial/balance-sheet.pdf?${period}`)}><i className="fas fa-download me-2" />Balance sheet</a>
      </PageHeader>

      <div className="row g-3 mb-4">
        <div className="col-sm-6 col-xl-3"><StatCard label="Gross revenue" value={money(k.revenue)} icon="fa-wallet" hint="Invoiced this month" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Operating costs" value={money(k.expenses)} icon="fa-cube" color="warning" hint={k.revenue > 0 ? `${((k.expenses / k.revenue) * 100).toFixed(1)}% of revenue` : undefined} tone="warn" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Gross profit" value={money(k.gross_profit)} icon="fa-chart-column" hint="Revenue minus cost of goods" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Gross margin" value={`${margin.toFixed(1)}%`} icon="fa-arrow-trend-up" color="info" hint={`Net profit ${money(k.net_profit)}`} tone={k.net_profit < 0 ? 'bad' : ''} /></div>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-lg-8">
          <div className="card h-100"><div className="card-body">
            <h2 className="panel-title">Revenue vs expenses</h2>
            <div className="panel-sub mb-2">Monthly performance, last 6 months</div>
            <GroupedBars labels={monthly.map((m) => m.label)} series={[
              { label: 'Revenue', data: monthly.map((m) => m.revenue), color: '#0f7b5a' },
              { label: 'Expenses', data: monthly.map((m) => m.expenses), color: '#e8b04a' },
            ]} height={300} />
          </div></div>
        </div>
        <div className="col-lg-4">
          <div className="card h-100"><div className="card-body">
            <h2 className="panel-title">Revenue by product</h2>
            <div className="panel-sub mb-3">Sales distribution this month</div>
            <DonutWithLegend items={byCategory} centerLabel="Total revenue" />
            {top && <div className="note-bar mt-3"><i className="fas fa-chart-simple" /><span><b>{top.label}</b> lead this month's sales ({topShare}%)</span></div>}
          </div></div>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-8">
          <div className="card h-100">
            <div className="card-body pb-0"><h2 className="panel-title">Recent transactions</h2><div className="panel-sub">Income and expenses recorded this month</div></div>
            <div className="table-responsive mt-3">
              <table className="table table-hover align-middle mb-0">
                <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Type</th><th className="text-end">Amount</th></tr></thead>
                <tbody>
                  {summary.data.recent_records.length === 0 && <tr><td colSpan="5" className="text-center text-muted py-4">No transactions recorded this month.</td></tr>}
                  {summary.data.recent_records.slice(0, 8).map((r) => (
                    <tr key={r.id}>
                      <td className="text-nowrap">{date(r.date)}</td>
                      <td>{r.description || '—'}</td>
                      <td>{humanize(r.category)}</td>
                      <td><StatusBadge value={r.type} /></td>
                      <td className={`text-end fw-semibold ${r.type === 'EXPENSE' ? 'text-danger' : 'text-success'}`}>{r.type === 'EXPENSE' ? '−' : '+'}{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="col-lg-4">
          <div className="card h-100"><div className="card-body">
            <h2 className="panel-title">Quick reports</h2>
            <div className="panel-sub mb-2">Download as CSV for Excel</div>
            {QUICK.filter((q) => can(q.module)).map((q) => (
              <button key={q.key} type="button" className="d-flex align-items-center gap-3 w-100 text-start border-0 bg-transparent py-3 border-bottom"
                onClick={() => exportCsv(q)} disabled={busy === q.key}>
                <span className="stat-icon" style={{ width: 38, height: 38, fontSize: '0.95rem', background: '#e5f4ee', color: '#0f7b5a' }}><i className={`fas ${q.icon}`} /></span>
                <span className="flex-grow-1"><span className="d-block fw-semibold small">{q.title}</span><span className="d-block text-muted" style={{ fontSize: '0.78rem' }}>{q.sub}</span></span>
                {busy === q.key ? <span className="spinner-border spinner-border-sm" /> : <i className="fas fa-download text-muted" />}
              </button>
            ))}
          </div></div>
        </div>
      </div>
    </>
  );
}
