import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import CustomerPicker from '../components/CustomerPicker.jsx';
import StockInModal from '../components/StockInModal.jsx';
import { useToast } from '../components/Toast.jsx';
import { ErrorBox, Loading, PageHeader } from '../components/ui.jsx';
import { money, toDateInput } from '../format.js';
import { useApi } from '../hooks.js';

let keySeq = 0;
const newLine = (props = {}) => ({ key: ++keySeq, inventory_id: '', description: '', quantity: 1, unit_price: '', ...props });

/** Create/edit form shared by quotations and invoices (kind = 'quotation' | 'invoice'). */
export default function DocumentForm({ kind }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const notify = useToast();
  const isInvoice = kind === 'invoice';
  const base = isInvoice ? '/invoices' : '/quotations';
  const label = isInvoice ? 'Invoice' : 'Quotation';

  const customers = useApi('/customers', []);
  const inventory = useApi('/inventory', []);
  const activityTypes = useApi(isInvoice ? '/activity-types' : null, []);

  const [doc, setDoc] = useState({ customer_id: '', activity_type_id: '', due_date: '', notes: '', items: [newLine()] });
  const [original, setOriginal] = useState({}); // inventory qty already held by this invoice (edit mode)
  const [askStock, setAskStock] = useState(false); // the "out of stock" pop-up is open
  const [loadingDoc, setLoadingDoc] = useState(!!id);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.get(`${base}/${id}`).then((d) => {
      setDoc({
        customer_id: d.customer?.id || '',
        activity_type_id: d.activity_type_id ?? '',
        due_date: toDateInput(d.due_date),
        notes: d.notes || '',
        number: isInvoice ? d.invoice_number : d.quotation_number,
        status: d.status,
        items: d.items.map((i) => newLine({
          inventory_id: i.inventory_id ? String(i.inventory_id) : 'custom',
          description: i.description,
          quantity: i.quantity,
          unit_price: i.unit_price,
        })),
      });
      if (isInvoice) {
        const held = {};
        d.items.forEach((i) => { if (i.inventory_id) held[i.inventory_id] = (held[i.inventory_id] || 0) + i.quantity; });
        setOriginal(held);
      }
    }).catch((e) => setLoadError(e.message)).finally(() => setLoadingDoc(false));
  }, [id, base, isInvoice]);

  const invById = useMemo(() => Object.fromEntries((inventory.data || []).map((i) => [String(i.id), i])), [inventory.data]);

  const setLine = (key, patch) => setDoc((d) => ({ ...d, items: d.items.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const pickItem = (key, value) => {
    const inv = invById[value];
    setLine(key, inv
      ? { inventory_id: value, description: inv.name, unit_price: inv.unit_price ?? '' }
      : { inventory_id: value, description: '', unit_price: '' });
  };

  const total = doc.items.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);

  // Items the invoice needs more of than the shelf holds (invoices only — quotations don't move stock). These are not
  // refused: the user bought them in right here, with the buying price now or left blank for later.
  const shortages = useMemo(() => {
    if (!isInvoice) return {};
    const need = {};
    doc.items.forEach((l) => {
      if (l.inventory_id && l.inventory_id !== 'custom') need[l.inventory_id] = (need[l.inventory_id] || 0) + (Number(l.quantity) || 0);
    });
    const out = {};
    Object.entries(need).forEach(([invId, qty]) => {
      const available = (invById[invId]?.quantity || 0) + (original[invId] || 0);
      if (qty > available) out[invId] = { available, need: qty, short: qty - available, name: invById[invId]?.name || 'This item' };
    });
    return out;
  }, [doc.items, invById, original, isInvoice]);

  const buildItems = () => doc.items.filter((l) => l.inventory_id).map((l) => ({
    inventory_id: l.inventory_id === 'custom' ? null : Number(l.inventory_id),
    description: l.description,
    quantity: Number(l.quantity),
    unit_price: Number(l.unit_price),
  }));

  const save = async (buyIn) => {
    setSaving(true);
    try {
      const body = {
        customer_id: doc.customer_id, notes: doc.notes, due_date: doc.due_date || null,
        activity_type_id: doc.activity_type_id || null, items: buildItems(),
        ...(buyIn?.length ? { restock: buyIn } : {}),
      };
      const saved = id ? await api.put(`${base}/${id}`, body) : await api.post(base, body);
      notify(`${label} ${saved.invoice_number || saved.quotation_number || ''} ${id ? 'updated' : 'created'}`);
      if (saved.plan_cleared) notify('The invoice total changed, so its payment plan was cleared. Set a new plan on the invoice.', 'error');
      navigate(`${base}/${saved.id}`);
    } catch (err) {
      notify(err.message, 'error');
      setSaving(false);
      setAskStock(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (!doc.customer_id) return notify('Please select a customer', 'error');
    if (!buildItems().length) return notify('Add at least one item', 'error');
    if (Object.keys(shortages).length) return setAskStock(true);   // out of stock: ask how many to stock in, and the price
    save(null);
  };

  if (loadingDoc || customers.loading || inventory.loading) return <Loading />;
  if (loadError) return <ErrorBox error={loadError} />;
  if (!isInvoice && doc.status === 'PROCESSED') {
    return <ErrorBox error="This quotation has already been converted to an invoice and can no longer be edited." />;
  }

  // Every product can be picked, even when none is on the shelf: an invoice then buys the missing ones in.
  const selectable = inventory.data || [];

  return (
    <form onSubmit={submit}>
      <PageHeader title={id ? `Edit ${label} ${doc.number || ''}` : `New ${label}`} icon={isInvoice ? 'fa-file-invoice-dollar' : 'fa-file-signature'}>
        <Link to={id ? `${base}/${id}` : base} className="btn btn-light">Cancel</Link>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving && <span className="spinner-border spinner-border-sm me-2" />}
          <i className="fas fa-save me-2" />Save {label.toLowerCase()}
        </button>
      </PageHeader>

      <div className="card mb-4">
        <div className="card-body">
          <div className="row g-3">
            <div className="col-lg-6">
              <label className="form-label">Customer <span className="text-danger">*</span></label>
              <CustomerPicker customers={customers.data || []} value={doc.customer_id} required
                onChange={(customer_id) => setDoc((d) => ({ ...d, customer_id }))} />
              <div className="form-text">Not listed? <Link to="/customers">Add the customer first</Link>.</div>
            </div>
            {isInvoice && (
              <div className="col-lg-3">
                <label className="form-label" htmlFor="activity">Activity type</label>
                <select id="activity" className="form-select" value={doc.activity_type_id}
                  onChange={(e) => setDoc((d) => ({ ...d, activity_type_id: e.target.value }))}>
                  <option value="">General sales</option>
                  {(activityTypes.data || []).filter((t) => t.is_active || String(t.id) === String(doc.activity_type_id))
                    .map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            <div className="col-lg-3">
              <label className="form-label" htmlFor="due">{isInvoice ? 'Due date' : 'Valid until'}</label>
              <input id="due" type="date" className="form-control" value={doc.due_date}
                onChange={(e) => setDoc((d) => ({ ...d, due_date: e.target.value }))} />
              {isInvoice && <div className="form-text">Leave empty: due 3 months after the invoice date.</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header d-flex justify-content-between align-items-center">
          Items
          <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setDoc((d) => ({ ...d, items: [...d.items, newLine()] }))}>
            <i className="fas fa-plus me-1" />Add line
          </button>
        </div>
        <div className="table-responsive line-items">
          <table className="table align-middle mb-0">
            <thead>
              <tr><th style={{ minWidth: 260 }}>Item</th><th style={{ minWidth: 200 }}>Description</th><th style={{ width: 110 }}>Qty</th><th style={{ width: 150 }}>Unit price</th><th className="text-end" style={{ width: 140 }}>Amount</th><th /></tr>
            </thead>
            <tbody>
              {doc.items.map((l) => {
                const inv = invById[l.inventory_id];
                const short = shortages[l.inventory_id];
                return (
                  <tr key={l.key}>
                    <td>
                      <select className="form-select" value={l.inventory_id} onChange={(e) => pickItem(l.key, e.target.value)} aria-label="Item">
                        <option value="">Select item…</option>
                        <option value="custom">✎ Custom item / service</option>
                        {selectable.map((i) => (
                          <option key={i.id} value={i.id}>{i.name}{i.brand ? ` (${i.brand})` : ''} — {i.quantity > 0 ? `${i.quantity} in stock` : 'OUT OF STOCK'}</option>
                        ))}
                      </select>
                      {short && <div className="small text-warning-emphasis fw-semibold mt-1"><i className="fas fa-triangle-exclamation me-1" />{short.available > 0 ? `Only ${short.available} in stock` : 'Out of stock'}</div>}
                      {inv && !short && isInvoice && <div className="small text-muted mt-1">{inv.quantity + (original[inv.id] || 0)} available</div>}
                    </td>
                    <td>
                      <input className="form-control" value={l.description} required={l.inventory_id === 'custom'}
                        placeholder={l.inventory_id === 'custom' ? 'Item or service name' : 'Description'}
                        onChange={(e) => setLine(l.key, { description: e.target.value })} aria-label="Description" />
                    </td>
                    <td>
                      <input type="number" min="1" step="1" className="form-control" value={l.quantity} required={!!l.inventory_id}
                        onChange={(e) => setLine(l.key, { quantity: e.target.value })} aria-label="Quantity" />
                    </td>
                    <td>
                      <div className="input-group">
                        <span className="input-group-text">$</span>
                        <input type="number" min="0" step="0.01" className="form-control" value={l.unit_price} required={!!l.inventory_id}
                          onChange={(e) => setLine(l.key, { unit_price: e.target.value })} aria-label="Unit price" />
                      </div>
                    </td>
                    <td className="text-end fw-semibold">{money((Number(l.quantity) || 0) * (Number(l.unit_price) || 0))}</td>
                    <td className="text-end">
                      <button type="button" className="btn btn-sm btn-outline-danger" aria-label="Remove line" disabled={doc.items.length === 1}
                        onClick={() => setDoc((d) => ({ ...d, items: d.items.filter((x) => x.key !== l.key) }))}>
                        <i className="fas fa-times" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="4" className="text-end fw-semibold">Total</td>
                <td className="text-end fs-5 fw-bold">{money(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <label className="form-label" htmlFor="notes">Notes</label>
          <textarea id="notes" className="form-control" rows="3" value={doc.notes}
            onChange={(e) => setDoc((d) => ({ ...d, notes: e.target.value }))} />
        </div>
      </div>

      {askStock && (
        <StockInModal busy={saving} onCancel={() => setAskStock(false)} onConfirm={save}
          confirmLabel={`Stock in and save ${label.toLowerCase()}`}
          items={Object.entries(shortages).map(([invId, sh]) => ({ inventory_id: Number(invId), ...sh }))} />
      )}
    </form>
  );
}
