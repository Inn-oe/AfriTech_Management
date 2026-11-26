import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, pdfUrl } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import StockInModal from '../components/StockInModal.jsx';
import { EmptyRow, ErrorBox, IconButton, Loading, PageHeader, SearchBox, StatCard, StatusBadge } from '../components/ui.jsx';
import { date, money } from '../format.js';
import { useApi } from '../hooks.js';

export default function Quotations() {
  const notify = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi('/quotations', []);
  const [search, setSearch] = useState('');
  const [stockAsk, setStockAsk] = useState(null); // out-of-stock pop-up before converting: { q, missing }
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data || []).filter((r) => !q || [r.quotation_number, r.customer?.name, r.customer?.id, r.status]
      .some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [data, search]);

  const all = data || [];
  const open = all.filter((q) => q.status === 'PENDING');
  const converted = all.filter((q) => q.status === 'PROCESSED');
  const sum = (list) => list.reduce((t, q) => t + (q.total_amount || 0), 0);

  const doConvert = async (q, restock) => {
    setBusy(true);
    try {
      const inv = await api.post(`/quotations/${q.id}/convert`, restock ? { restock } : {});
      setStockAsk(null);
      notify(`Invoice ${inv.invoice_number} created`);
      navigate(`/invoices/${inv.id}`);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  // Same as on the quotation page: items the shelf cannot cover open the stock-in pop-up instead of failing.
  const convert = async (q) => {
    let detail;
    try {
      detail = await api.get(`/quotations/${q.id}`);
    } catch (err) {
      notify(err.message, 'error');
      return;
    }
    const wanted = {};
    detail.items.forEach((i) => {
      if (!i.inventory_id) return;
      const w = wanted[i.inventory_id] || { inventory_id: i.inventory_id, name: i.description, need: 0, available: i.stock_available || 0 };
      w.need += i.quantity;
      wanted[i.inventory_id] = w;
    });
    const missing = Object.values(wanted).filter((w) => w.need > w.available).map((w) => ({ ...w, short: w.need - w.available }));
    if (missing.length) {
      setStockAsk({ q, missing });
      return;
    }
    if (!(await confirm(`Convert quotation ${q.quotation_number} to an invoice? Stock will be deducted.`, { title: 'Stock will be deducted', confirmLabel: 'Convert' }))) return;
    doConvert(q, null);
  };

  const remove = async (q) => {
    if (!(await confirm(`Delete quotation ${q.quotation_number}?`))) return;
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
      <div className="row g-3 mb-4">
        <div className="col-sm-6 col-xl-3"><StatCard label="Open quotations" value={money(sum(open))} icon="fa-file-lines" color="info" hint={`${open.length} awaiting a decision`} /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Converted to sales" value={money(sum(converted))} icon="fa-wallet" hint={`${converted.length} quotation${converted.length === 1 ? '' : 's'}`} /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Average quotation" value={money(all.length ? sum(all) / all.length : 0)} icon="fa-chart-column" color="warning" hint={`Across ${all.length} quotations`} tone="warn" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Quote conversion" value={all.length ? `${Math.round((converted.length / all.length) * 100)}%` : '—'} icon="fa-check" color="secondary" hint="Quotations turned into invoices" /></div>
      </div>
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

      {stockAsk && (
        <StockInModal items={stockAsk.missing} busy={busy} onCancel={() => setStockAsk(null)}
          onConfirm={(restock) => doConvert(stockAsk.q, restock)} confirmLabel="Stock in and convert" />
      )}
    </>
  );
}
