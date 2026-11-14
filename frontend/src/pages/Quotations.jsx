import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, pdfUrl } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { EmptyRow, ErrorBox, IconButton, Loading, PageHeader, SearchBox, StatusBadge } from '../components/ui.jsx';
import { date, money } from '../format.js';
import { useApi } from '../hooks.js';

export default function Quotations() {
  const notify = useToast();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi('/quotations', []);
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data || []).filter((r) => !q || [r.quotation_number, r.customer?.name, r.customer?.id, r.status]
      .some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [data, search]);

  const convert = async (q) => {
    if (!window.confirm(`Convert quotation ${q.quotation_number} to an invoice? Stock will be deducted.`)) return;
    try {
      const inv = await api.post(`/quotations/${q.id}/convert`);
      notify(`Invoice ${inv.invoice_number} created`);
      navigate(`/invoices/${inv.id}`);
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const remove = async (q) => {
    if (!window.confirm(`Delete quotation ${q.quotation_number}?`)) return;
    try {
      await api.del(`/quotations/${q.id}`);
      notify('Quotation deleted');
      reload();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <>
      <PageHeader title="Quotations" icon="fa-file-signature">
        <SearchBox value={search} onChange={setSearch} placeholder="Number, customer, status…" />
        <Link to="/quotations/new" className="btn btn-primary"><i className="fas fa-plus me-2" />New quotation</Link>
      </PageHeader>
      <ErrorBox error={error} onRetry={reload} />
      <div className="card">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead>
              <tr><th>Number</th><th>Customer</th><th>Date</th><th className="text-end">Items</th><th className="text-end">Total</th><th>Status</th><th className="text-end">Actions</th></tr>
            </thead>
            <tbody>
              {loading && !data?.length ? <tr><td colSpan="7"><Loading /></td></tr>
                : rows.length === 0 ? <EmptyRow colSpan={7} />
                  : rows.map((q) => (
                    <tr key={q.id}>
                      <td><Link to={`/quotations/${q.id}`} className="fw-semibold">{q.quotation_number || `#${q.id}`}</Link></td>
                      <td>{q.customer?.name || <span className="text-muted">Unlinked</span>}</td>
                      <td>{date(q.date_created)}</td>
                      <td className="text-end">{q.item_count}</td>
                      <td className="text-end fw-semibold">{money(q.total_amount)}</td>
                      <td>
                        <StatusBadge value={q.status} />
                        {q.invoice_id && <Link to={`/invoices/${q.invoice_id}`} className="ms-2 small">Invoice</Link>}
                      </td>
                      <td className="text-end text-nowrap">
                        <div className="btn-group">
                          <IconButton icon="fa-eye" title="View" onClick={() => navigate(`/quotations/${q.id}`)} />
                          <IconButton icon="fa-file-pdf" title="Download PDF" variant="outline-danger" href={pdfUrl(`/quotations/${q.id}/pdf`)} />
                          {q.status !== 'PROCESSED' && (
                            <>
                              <IconButton icon="fa-pen" title="Edit" variant="outline-primary" onClick={() => navigate(`/quotations/${q.id}/edit`)} />
                              <IconButton icon="fa-file-invoice-dollar" title="Convert to invoice" variant="outline-success" onClick={() => convert(q)} />
                            </>
                          )}
                          <IconButton icon="fa-trash" title="Delete" variant="outline-danger" onClick={() => remove(q)} />
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
