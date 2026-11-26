import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, pdfUrl } from '../api.js';
import FormFields from '../components/FormFields.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { EmptyRow, ErrorBox, IconButton, Loading, PageHeader, SearchBox, StatCard } from '../components/ui.jsx';
import { date, humanize, money, toDateInput } from '../format.js';
import { useApi } from '../hooks.js';
import { useEnum } from '../meta.jsx';

export default function Payments() {
  const notify = useToast();
  const confirm = useConfirm();
  const methods = useEnum('payment_type');
  const { data, loading, error, reload } = useApi('/payments', []);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data || []).filter((p) => !q || [p.transaction_id, p.invoice_number, p.customer?.name, p.payer_name, p.reference_number, p.payment_method]
      .some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [data, search]);

  const total = rows.reduce((s, p) => s + (p.amount || 0), 0);
  const byMethod = rows.reduce((m, p) => ({ ...m, [p.payment_method]: (m[p.payment_method] || 0) + p.amount }), {});
  const topMethod = Object.entries(byMethod).sort((a, b) => b[1] - a[1])[0];

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/payments/${editing.id}`, editing);
      notify('Payment updated and invoice balance adjusted');
      setEditing(null);
      reload();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const remove = async (p) => {
    if (!(await confirm(`Delete payment ${p.transaction_id} of ${money(p.amount)}? The invoice balance will be increased.`))) return;
    try {
      await api.del(`/payments/${p.id}`);
      notify('Payment deleted');
      reload();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <>
      <PageHeader title="Payments" icon="fa-money-bill-wave" subtitle="Record new payments from an invoice page.">
        <SearchBox value={search} onChange={setSearch} placeholder="Transaction, invoice, payer…" />
      </PageHeader>

      <div className="row g-3 mb-4">
        <div className="col-md-4"><StatCard label="Total received" value={money(total)} icon="fa-sack-dollar" color="success" /></div>
        <div className="col-md-4"><StatCard label="Payments" value={rows.length} icon="fa-receipt" /></div>
        <div className="col-md-4"><StatCard label="Top method" value={topMethod ? humanize(topMethod[0]) : '—'} icon="fa-credit-card" color="info" hint={topMethod ? money(topMethod[1]) : undefined} /></div>
      </div>

      <ErrorBox error={error} onRetry={reload} />
      <div className="card">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead>
              <tr><th>Date</th><th>Transaction</th><th>Invoice</th><th>Customer</th><th>Method</th><th>Payer</th><th className="text-end">Amount</th><th className="text-end">Actions</th></tr>
            </thead>
            <tbody>
              {loading && !data?.length ? <tr><td colSpan="8"><Loading /></td></tr>
                : rows.length === 0 ? <EmptyRow colSpan={8} />
                  : rows.map((p) => (
                    <tr key={p.id}>
                      <td>{date(p.payment_date)}</td>
                      <td><code>{p.transaction_id || '—'}</code></td>
                      <td>{p.invoice_id ? <Link to={`/invoices/${p.invoice_id}`}>{p.invoice_number || `#${p.invoice_id}`}</Link> : '—'}</td>
                      <td>{p.customer?.name || '—'}</td>
                      <td>{humanize(p.payment_method)}</td>
                      <td>{p.payer_name || '—'}</td>
                      <td className="text-end fw-semibold">{money(p.amount)}</td>
                      <td className="text-end text-nowrap">
                        <div className="btn-group">
                          <IconButton icon="fa-receipt" title="Receipt PDF" href={pdfUrl(`/payments/${p.id}/pdf`)} />
                          <IconButton icon="fa-pen" title="Edit" variant="outline-primary"
                            onClick={() => setEditing({ ...p, payment_date: toDateInput(p.payment_date) })} />
                          <IconButton icon="fa-trash" title="Delete" variant="outline-danger" onClick={() => remove(p)} />
                        </div>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <Modal title={`Edit payment ${editing.transaction_id || ''}`} onClose={() => setEditing(null)}>
          <form id="pay-edit" onSubmit={save}>
            <FormFields values={editing} onChange={setEditing} fields={[
              { name: 'amount', label: 'Amount', type: 'number', min: 0.01, step: 0.01, required: true },
              { name: 'payment_method', label: 'Method', type: 'select', options: methods, required: true },
              { name: 'payment_date', label: 'Date', type: 'date' },
              { name: 'payer_name', label: 'Paid by' },
              { name: 'reference_number', label: 'Reference', col: 12 },
              { name: 'notes', label: 'Notes', type: 'textarea', col: 12, rows: 2 },
            ]} />
          </form>
          <div className="d-flex justify-content-end gap-2 mt-4">
            <button type="button" className="btn btn-light" onClick={() => setEditing(null)}>Cancel</button>
            <button type="submit" form="pay-edit" className="btn btn-primary">Save</button>
          </div>
        </Modal>
      )}
    </>
  );
}
