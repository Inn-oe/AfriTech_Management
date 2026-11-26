import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, pdfUrl } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { EmptyRow, ErrorBox, IconButton, Loading, PageHeader, SearchBox, StatCard, StatusBadge } from '../components/ui.jsx';
import { date, money } from '../format.js';
import { useApi } from '../hooks.js';
import { useEnum } from '../meta.jsx';

export default function Invoices() {
  const notify = useToast();
  const navigate = useNavigate();
  const statuses = useEnum('invoice_status');
  const [params, setParams] = useSearchParams();
  const customerFilter = params.get('customer') || '';
  const { data, loading, error, reload } = useApi(`/invoices${customerFilter ? `?customer_id=${encodeURIComponent(customerFilter)}` : ''}`, []);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data || []).filter((r) => (!status || (r.display_status || r.status) === status)
      && (!q || [r.invoice_number, r.customer?.name, r.customer?.id].some((v) => String(v ?? '').toLowerCase().includes(q))));
  }, [data, search, status]);

  const totals = rows.reduce((t, r) => ({
    billed: t.billed + (r.status === 'CANCELLED' ? 0 : r.total_amount || 0),
    paid: t.paid + (r.paid_amount || 0),
    due: t.due + (r.status === 'CANCELLED' ? 0 : r.balance_due || 0),
  }), { billed: 0, paid: 0, due: 0 });

  const remove = async (inv) => {
    if (!window.confirm(`Delete invoice ${inv.invoice_number}? Stock will be restored and its payments deleted.`)) return;
    try {
      await api.del(`/invoices/${inv.id}`);
      notify('Invoice deleted and stock restored');
      reload();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <>
      <PageHeader title="Invoices" icon="fa-file-invoice-dollar">
        <SearchBox value={search} onChange={setSearch} placeholder="Number or customer…" />
        <select className="form-select w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Link to="/invoices/new" className="btn btn-primary"><i className="fas fa-plus me-2" />New invoice</Link>
      </PageHeader>

      {customerFilter && (
        <div className="alert alert-info d-flex justify-content-between align-items-center py-2">
          <span>Showing invoices for customer <strong>{customerFilter}</strong></span>
          <button type="button" className="btn btn-sm btn-outline-info" onClick={() => setParams({})}>Show all</button>
        </div>
      )}

      <div className="row g-3 mb-4">
        <div className="col-md-4"><StatCard label="Billed" value={money(totals.billed)} icon="fa-file-invoice" /></div>
        <div className="col-md-4"><StatCard label="Collected" value={money(totals.paid)} icon="fa-circle-check" color="success" /></div>
        <div className="col-md-4"><StatCard label="Outstanding" value={money(totals.due)} icon="fa-hourglass-half" color="danger" /></div>
      </div>

      <ErrorBox error={error} onRetry={reload} />
      <div className="card">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead>
              <tr><th>Number</th><th>Customer</th><th>Date</th><th>Activity</th><th className="text-end">Total</th><th className="text-end">Balance</th><th>Status</th><th className="text-end">Actions</th></tr>
            </thead>
            <tbody>
              {loading && !data?.length ? <tr><td colSpan="8"><Loading /></td></tr>
                : rows.length === 0 ? <EmptyRow colSpan={8} />
                  : rows.map((inv) => (
                    <tr key={inv.id}>
                      <td><Link to={`/invoices/${inv.id}`} className="fw-semibold">{inv.invoice_number || `#${inv.id}`}</Link></td>
                      <td>{inv.customer?.name || <span className="text-muted">Unlinked</span>}</td>
                      <td>{date(inv.date_created)}</td>
                      <td>{inv.activity_type_name || <span className="text-muted">General</span>}</td>
                      <td className="text-end">{money(inv.total_amount)}</td>
                      <td className={`text-end fw-semibold ${inv.balance_due > 0 ? 'text-danger' : 'text-success'}`}>{money(inv.balance_due)}</td>
                      <td><StatusBadge value={inv.display_status || inv.status} />{inv.has_plan && <i className="fas fa-calendar-check text-muted ms-2" title="Has a payment plan" />}</td>
                      <td className="text-end text-nowrap">
                        <div className="btn-group">
                          <IconButton icon="fa-eye" title="View" onClick={() => navigate(`/invoices/${inv.id}`)} />
                          <IconButton icon="fa-file-pdf" title="Download PDF" variant="outline-danger" href={pdfUrl(`/invoices/${inv.id}/pdf`)} />
                          <IconButton icon="fa-pen" title="Edit" variant="outline-primary" onClick={() => navigate(`/invoices/${inv.id}/edit`)} />
                          <IconButton icon="fa-trash" title="Delete" variant="outline-danger" onClick={() => remove(inv)} />
                        </div>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
