import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, pdfUrl } from '../api.js';
import FormFields from '../components/FormFields.jsx';
import Modal from '../components/Modal.jsx';
import StockInModal from '../components/StockInModal.jsx';
import { useToast } from '../components/Toast.jsx';
import { ErrorBox, IconButton, Loading, StatusBadge } from '../components/ui.jsx';
import { date, humanize, money, number } from '../format.js';
import { useApi } from '../hooks.js';
import { useEnum } from '../meta.jsx';
import { useAuth } from '../auth.jsx';

/** Printable view of a quotation or invoice (kind = 'quotation' | 'invoice'). */
export default function DocumentView({ kind }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const notify = useToast();
  const isInvoice = kind === 'invoice';
  const base = isInvoice ? '/invoices' : '/quotations';
  const { data: doc, loading, error, reload } = useApi(`${base}/${id}`);
  const methods = useEnum('payment_type');
  const { company } = useAuth();
  const [payment, setPayment] = useState(null);
  const [busy, setBusy] = useState(false);
  const [convertAsk, setConvertAsk] = useState(null); // pop-up before converting: { missing: [out-of-stock items] }
  const [costFor, setCostFor] = useState(null); // invoice line whose buying price is being added: { item, cost }

  if (loading && !doc) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const number_ = isInvoice ? doc.invoice_number : doc.quotation_number;
  const totalQty = doc.items.reduce((s, i) => s + i.quantity, 0);

  const run = async (fn, success) => {
    setBusy(true);
    try {
      const result = await fn();
      if (success) notify(success);
      return result;
    } catch (err) {
      notify(err.message, 'error');
      return null;
    } finally {
      setBusy(false);
    }
  };

  // Clicking "Convert to invoice" opens a pop-up: a simple confirmation, or, when the shelf cannot cover some
  // items, the stock-in form so they can be bought in on the spot.
  const convert = () => {
    const wanted = {};
    doc.items.forEach((i) => {
      if (!i.inventory_id) return;
      const w = wanted[i.inventory_id] || { inventory_id: i.inventory_id, name: i.description, need: 0, available: i.stock_available || 0 };
      w.need += i.quantity;
      wanted[i.inventory_id] = w;
    });
    const missing = Object.values(wanted).filter((w) => w.need > w.available).map((w) => ({ ...w, short: w.need - w.available }));
    setConvertAsk({ missing });
  };

  const doConvert = async (restock) => {
    const inv = await run(() => api.post(`/quotations/${id}/convert`, restock ? { restock } : {}));
    if (inv) {
      setConvertAsk(null);
      notify(`Invoice ${inv.invoice_number} created`);
      navigate(`/invoices/${inv.id}`);
    }
  };

  const remove = async () => {
    const msg = isInvoice ? 'Delete this invoice? Stock will be restored and its payments deleted.' : 'Delete this quotation?';
    if (!window.confirm(msg)) return;
    if (await run(() => api.del(`${base}/${id}`), `${isInvoice ? 'Invoice' : 'Quotation'} deleted`)) navigate(base);
  };

  const setStatus = async (status) => {
    if (await run(() => api.post(`/invoices/${id}/status`, { status }), `Invoice marked as ${humanize(status)}`)) reload();
  };

  const saveCost = async (e) => {
    e.preventDefault();
    const ok = await run(() => api.post(`/invoices/${id}/items/${costFor.item.id}/cost`, { cost_price: Number(costFor.cost) }), 'Buying price saved');
    if (ok) {
      setCostFor(null);
      reload();
    }
  };

  const savePayment = async (e) => {
    e.preventDefault();
    const ok = await run(() => api.post(`/invoices/${id}/payments`, payment), 'Payment recorded');
    if (ok) {
      setPayment(null);
      reload();
    }
  };

  const deletePayment = async (p) => {
    if (!window.confirm(`Delete payment of ${money(p.amount)}? The invoice balance will be increased.`)) return;
    if (await run(() => api.del(`/payments/${p.id}`), 'Payment deleted')) reload();
  };

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-4 no-print">
        <Link to={base} className="btn btn-light"><i className="fas fa-arrow-left me-2" />All {isInvoice ? 'invoices' : 'quotations'}</Link>
        <div className="d-flex flex-wrap gap-2">
          {isInvoice && doc.balance_due > 0 && doc.status !== 'CANCELLED' && (
            <button type="button" className="btn btn-success" onClick={() => setPayment({ amount: doc.balance_due, payment_method: 'CASH', payer_name: doc.customer?.name || '' })}>
              <i className="fas fa-money-bill-wave me-2" />Record payment
            </button>
          )}
          {!isInvoice && doc.status !== 'PROCESSED' && (
            <button type="button" className="btn btn-success" onClick={convert} disabled={busy}>
              <i className="fas fa-file-invoice-dollar me-2" />Convert to invoice
            </button>
          )}
          {!isInvoice && doc.invoice_id && (
            <Link to={`/invoices/${doc.invoice_id}`} className="btn btn-outline-success"><i className="fas fa-link me-2" />View invoice</Link>
          )}
          {isInvoice && doc.status === 'DRAFT' && (
            <button type="button" className="btn btn-outline-info" onClick={() => setStatus('SENT')} disabled={busy}>Mark as sent</button>
          )}
          {isInvoice && doc.status !== 'CANCELLED' && doc.paid_amount === 0 && (
            <button type="button" className="btn btn-outline-dark" onClick={() => setStatus('CANCELLED')} disabled={busy}>Cancel invoice</button>
          )}
          {isInvoice && doc.status === 'CANCELLED' && (
            <button type="button" className="btn btn-outline-dark" onClick={() => setStatus('SENT')} disabled={busy}>Reopen</button>
          )}
          <button type="button" className="btn btn-outline-secondary" onClick={() => window.print()}><i className="fas fa-print me-2" />Print</button>
          <a className="btn btn-outline-danger" href={pdfUrl(`${base}/${id}/pdf`)}><i className="fas fa-file-pdf me-2" />PDF</a>
          {(isInvoice || doc.status !== 'PROCESSED') && (
            <Link to={`${base}/${id}/edit`} className="btn btn-outline-primary"><i className="fas fa-pen me-2" />Edit</Link>
          )}
          <button type="button" className="btn btn-outline-danger" onClick={remove} disabled={busy} aria-label="Delete"><i className="fas fa-trash" /></button>
        </div>
      </div>

      {isInvoice && doc.items.some((i) => i.cost_pending) && (
        <div className="alert alert-warning d-flex flex-wrap align-items-center gap-2 no-print">
          <i className="fas fa-triangle-exclamation" />
          <div className="flex-grow-1">
            <strong>Buying price missing.</strong> {doc.items.filter((i) => i.cost_pending).map((i) => i.description).join(', ')} {doc.items.filter((i) => i.cost_pending).length > 1 ? 'were' : 'was'} stocked
            in without a price. Add it so your profit figures are right.
          </div>
        </div>
      )}

      <div className="card document mb-4">
        <div className="card-body p-4 p-md-5">
          <div className="d-flex flex-wrap align-items-center gap-3">
            <div className="flex-grow-1">
              <div className="h3 company-name mb-1">{company.name}</div>
              <div className="small text-muted">{[company.phone, company.email].filter(Boolean).join(' · ')}</div>
            </div>
            <div className="small text-md-end text-muted" style={{ whiteSpace: 'pre-line' }}>{company.address}</div>
          </div>
          <hr className="doc-rule my-4" />

          <div className="d-flex flex-wrap justify-content-between gap-3 mb-4">
            <div>
              <div className="h4 mb-1">{isInvoice ? 'Tax Invoice' : 'Quotation'}</div>
              <div className="text-muted">{number_ || `#${doc.id}`}</div>
              {isInvoice && doc.quotation_number && <div className="small text-muted">From quotation {doc.quotation_number}</div>}
            </div>
            <div className="text-md-end">
              <div><strong>Customer:</strong> {doc.customer?.name || 'Unlinked customer'}</div>
              {doc.customer?.phone && <div className="small text-muted">{doc.customer.phone}</div>}
              <div><strong>Date:</strong> {date(doc.date_created)}</div>
              {doc.due_date && <div><strong>{isInvoice ? 'Due' : 'Valid until'}:</strong> {date(doc.due_date)}</div>}
              <div className="mt-1"><StatusBadge value={doc.status} /></div>
            </div>
          </div>

          <div className="table-responsive">
            <table className="table table-bordered align-middle">
              <thead className="table-light">
                <tr><th style={{ width: 50 }}>#</th><th>Item code</th><th>Description</th><th className="text-end">Qty</th><th className="text-end">Price</th><th className="text-end">Amount</th></tr>
              </thead>
              <tbody>
                {doc.items.map((item, i) => (
                  <tr key={item.id}>
                    <td>{i + 1}</td>
                    <td><code>{item.item_code || '—'}</code></td>
                    <td>
                      {item.description}
                      {isInvoice && item.cost_pending && (
                        <div className="no-print mt-1">
                          <button type="button" className="btn btn-sm btn-warning py-0" onClick={() => setCostFor({ item, cost: '' })}>
                            <i className="fas fa-tag me-1" />Add buying price
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="text-end">{item.quantity}</td>
                    <td className="text-end">{money(item.unit_price)}</td>
                    <td className="text-end">{money(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="3" className="text-end text-muted">Total quantity</td>
                  <td className="text-end">{number(totalQty)}</td>
                  <td className="text-end fw-bold">Total</td>
                  <td className="text-end fw-bold">{money(doc.total_amount)}</td>
                </tr>
                {isInvoice && (
                  <>
                    <tr><td colSpan="5" className="text-end">Paid</td><td className="text-end text-success">{money(doc.paid_amount)}</td></tr>
                    <tr><td colSpan="5" className="text-end fw-bold">Balance due</td><td className={`text-end fw-bold ${doc.balance_due > 0 ? 'text-danger' : ''}`}>{money(doc.balance_due)}</td></tr>
                  </>
                )}
              </tfoot>
            </table>
          </div>

          {doc.notes && <p className="mt-3"><strong>Notes:</strong> {doc.notes}</p>}

          {company.banking_details && (
            <div className="mt-4 small" style={{ whiteSpace: 'pre-line' }}>
              <strong>Banking details</strong><br />
              {company.banking_details}
            </div>
          )}
        </div>
      </div>

      {isInvoice && (
        <div className="card no-print">
          <div className="card-header">Payments</div>
          <div className="table-responsive">
            <table className="table align-middle mb-0">
              <thead><tr><th>Date</th><th>Transaction</th><th>Method</th><th>Payer</th><th>Reference</th><th className="text-end">Amount</th><th /></tr></thead>
              <tbody>
                {doc.payments.length === 0 && <tr><td colSpan="7" className="text-center text-muted py-3">No payments recorded yet.</td></tr>}
                {doc.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{date(p.payment_date)}</td>
                    <td><code>{p.transaction_id}</code></td>
                    <td>{humanize(p.payment_method)}</td>
                    <td>{p.payer_name || '—'}</td>
                    <td>{p.reference_number || '—'}</td>
                    <td className="text-end fw-semibold">{money(p.amount)}</td>
                    <td className="text-end text-nowrap">
                      <div className="btn-group">
                        <IconButton icon="fa-receipt" title="Receipt PDF" href={pdfUrl(`/payments/${p.id}/pdf`)} />
                        <IconButton icon="fa-trash" title="Delete payment" variant="outline-danger" onClick={() => deletePayment(p)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {convertAsk && convertAsk.missing.length === 0 && (
        <Modal title="Convert to invoice" onClose={() => setConvertAsk(null)}>
          <p className="mb-1">Convert this quotation to an invoice?</p>
          <p className="text-muted small mb-0">Stock will be deducted for the items on it.</p>
          <div className="d-flex justify-content-end gap-2 mt-4">
            <button type="button" className="btn btn-light" onClick={() => setConvertAsk(null)} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-success" onClick={() => doConvert(null)} disabled={busy}>
              {busy && <span className="spinner-border spinner-border-sm me-2" />}OK, convert
            </button>
          </div>
        </Modal>
      )}
      {convertAsk && convertAsk.missing.length > 0 && (
        <StockInModal items={convertAsk.missing} busy={busy} onCancel={() => setConvertAsk(null)} onConfirm={doConvert}
          confirmLabel="Stock in and convert" />
      )}

      {costFor && (
        <Modal title="Add buying price" onClose={() => setCostFor(null)}>
          <p className="text-muted small mb-3">
            <strong>{costFor.item.description}</strong> was out of stock when this invoice was raised, so it was bought in.
            Enter what each one cost you; it is used for your profit figures.
          </p>
          <form id="cost-form" onSubmit={saveCost}>
            <label className="form-label" htmlFor="cost">Buying price (each)</label>
            <div className="input-group">
              <span className="input-group-text">$</span>
              <input id="cost" type="number" min="0" step="0.01" className="form-control" required autoFocus
                value={costFor.cost} onChange={(e) => setCostFor((c) => ({ ...c, cost: e.target.value }))} />
            </div>
          </form>
          <div className="d-flex justify-content-end gap-2 mt-4">
            <button type="button" className="btn btn-light" onClick={() => setCostFor(null)}>Cancel</button>
            <button type="submit" form="cost-form" className="btn btn-primary" disabled={busy}>Save</button>
          </div>
        </Modal>
      )}

      {payment && (
        <Modal title={`Record payment — ${number_}`} onClose={() => setPayment(null)}>
          <p className="text-muted small mb-3">Balance due: <strong>{money(doc.balance_due)}</strong></p>
          <form id="payment-form" onSubmit={savePayment}>
            <FormFields values={payment} onChange={setPayment} fields={[
              { name: 'amount', label: 'Amount', type: 'number', min: 0.01, step: 0.01, required: true },
              { name: 'payment_method', label: 'Method', type: 'select', options: methods, required: true },
              { name: 'payer_name', label: 'Paid by' },
              { name: 'reference_number', label: 'Reference', placeholder: 'e.g. EcoCash ref' },
              { name: 'notes', label: 'Notes', type: 'textarea', col: 12, rows: 2 },
            ]} />
          </form>
          <div className="d-flex justify-content-end gap-2 mt-4">
            <button type="button" className="btn btn-light" onClick={() => setPayment(null)}>Cancel</button>
            <button type="submit" form="payment-form" className="btn btn-success" disabled={busy}>Save payment</button>
          </div>
        </Modal>
      )}
    </>
  );
}
