import { Link } from 'react-router-dom';
import { DoughnutChart } from '../components/Charts.jsx';
import { ErrorBox, Loading, PageHeader, StatCard, StatusBadge } from '../components/ui.jsx';
import { date, money } from '../format.js';
import { useApi } from '../hooks.js';

const QUICK_ACTIONS = [
  { to: '/quotations/new', label: 'New quotation', icon: 'fa-file-signature', color: 'primary' },
  { to: '/invoices/new', label: 'New invoice', icon: 'fa-file-invoice-dollar', color: 'success' },
  { to: '/inventory', label: 'Manage stock', icon: 'fa-boxes-stacked', color: 'warning' },
  { to: '/financial', label: 'Financial report', icon: 'fa-chart-line', color: 'info' },
];

export default function Dashboard() {
  const { data, loading, error, reload } = useApi('/dashboard');

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const { counts, outstanding_balance: outstanding, low_stock: lowStock, recent_invoices: recent, top_locations: locations } = data;

  return (
    <>
      <PageHeader title="Dashboard" icon="fa-gauge-high" subtitle="Overview of your business at a glance" />

      <div className="row g-3 mb-4">
        <div className="col-sm-6 col-xl-3"><StatCard label="Customers" value={counts.customers} icon="fa-users" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Inventory items" value={counts.inventory} icon="fa-boxes-stacked" color="warning" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Invoices" value={counts.invoices} icon="fa-file-invoice-dollar" color="success" hint={`${counts.quotations} quotations`} /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Outstanding" value={money(outstanding)} icon="fa-hourglass-half" color="danger" hint="Unpaid invoice balances" /></div>
      </div>

      <div className="row g-3 mb-4">
        {QUICK_ACTIONS.map((a) => (
          <div key={a.to} className="col-6 col-lg-3">
            <Link to={a.to} className={`btn btn-outline-${a.color} w-100 py-3`}>
              <i className={`fas ${a.icon} me-2`} />{a.label}
            </Link>
          </div>
        ))}
      </div>

      <div className="row g-3">
        <div className="col-lg-7">
          <div className="card h-100">
            <div className="card-header d-flex justify-content-between align-items-center">
              Recent invoices <Link to="/invoices" className="small">View all</Link>
            </div>
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th className="text-end">Total</th><th>Status</th></tr></thead>
                <tbody>
                  {recent.length === 0 && <tr><td colSpan="5" className="text-center text-muted py-4">No invoices yet.</td></tr>}
                  {recent.map((inv) => (
                    <tr key={inv.id}>
                      <td><Link to={`/invoices/${inv.id}`}>{inv.invoice_number || `#${inv.id}`}</Link></td>
                      <td>{inv.customer?.name || '—'}</td>
                      <td>{date(inv.date_created)}</td>
                      <td className="text-end">{money(inv.total_amount)}</td>
                      <td><StatusBadge value={inv.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="col-lg-5">
          <div className="card mb-3">
            <div className="card-header d-flex justify-content-between align-items-center">
              <span><i className="fas fa-triangle-exclamation text-warning me-2" />Low stock</span>
              <Link to="/inventory" className="small">Inventory</Link>
            </div>
            <ul className="list-group list-group-flush">
              {lowStock.length === 0 && <li className="list-group-item text-muted small">All items are above their minimum level.</li>}
              {lowStock.map((i) => (
                <li key={i.id} className="list-group-item d-flex justify-content-between">
                  <span>{i.name}</span>
                  <span className={`badge text-bg-${i.quantity <= 0 ? 'danger' : 'warning'}`}>{i.quantity} left</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <div className="card-header">Most visited locations</div>
            <div className="card-body"><DoughnutChart items={locations} /></div>
          </div>
        </div>
      </div>
    </>
  );
}
