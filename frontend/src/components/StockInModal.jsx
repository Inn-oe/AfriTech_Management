import { useState } from 'react';
import Modal from './Modal.jsx';

/**
 * Pop-up shown when an invoice needs items that are not on the shelf. For each one the user can book the missing
 * stock in right now, with the buying price if they know it (it can be left blank and added later).
 *   items: [{ inventory_id, name, available, need, short }]
 *   onConfirm(restock): restock = [{ inventory_id, quantity, cost_price|null }]
 */
export default function StockInModal({ items, onCancel, onConfirm, busy = false, confirmLabel = 'Stock in and continue' }) {
  const [entries, setEntries] = useState(() => Object.fromEntries(items.map((i) => [i.inventory_id, { quantity: String(i.short), cost: '' }])));
  const set = (id, patch) => setEntries((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  const unpriced = items.filter((i) => entries[i.inventory_id].cost === '').length;

  const submit = (e) => {
    e.preventDefault();
    onConfirm(items.map((i) => ({
      inventory_id: i.inventory_id,
      quantity: Number(entries[i.inventory_id].quantity),
      cost_price: entries[i.inventory_id].cost === '' ? null : Number(entries[i.inventory_id].cost),
    })));
  };

  return (
    <Modal title="Out of stock" onClose={busy ? () => {} : onCancel} size="lg">
      <form id="stock-in-form" onSubmit={submit}>
        <div className="alert alert-warning d-flex gap-2 py-2 small">
          <i className="fas fa-triangle-exclamation mt-1" />
          <div>
            {items.length === 1 ? 'This item is' : 'These items are'} not in stock. Stock {items.length === 1 ? 'it' : 'them'} in now so the
            invoice can go through, for example when you bought the goods and went straight to the installation.
          </div>
        </div>
        <div className="table-responsive">
          <table className="table align-middle mb-2">
            <thead>
              <tr><th>Item</th><th className="text-center">On hand</th><th className="text-center">Needed</th><th style={{ width: 120 }}>Stock in</th><th style={{ width: 190 }}>Buying price each</th></tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.inventory_id}>
                  <td className="fw-semibold">{i.name}</td>
                  <td className="text-center">{i.available}</td>
                  <td className="text-center">{i.need}</td>
                  <td>
                    <input type="number" min={i.short} step="1" className="form-control" required aria-label={`Stock in ${i.name}`}
                      value={entries[i.inventory_id].quantity} onChange={(e) => set(i.inventory_id, { quantity: e.target.value })} />
                  </td>
                  <td>
                    <div className="input-group">
                      <span className="input-group-text">$</span>
                      <input type="number" min="0" step="0.01" className="form-control" placeholder="optional" aria-label={`Buying price ${i.name}`}
                        value={entries[i.inventory_id].cost} onChange={(e) => set(i.inventory_id, { cost: e.target.value })} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="small text-muted">
          The buying price is optional.
          {unpriced > 0 && ' Anything left blank shows as a warning on your dashboard and on the invoice until you add the price, so your records stay complete.'}
        </div>
      </form>
      <div className="d-flex justify-content-end gap-2 mt-4">
        <button type="button" className="btn btn-light" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" form="stock-in-form" className="btn btn-primary" disabled={busy}>
          {busy && <span className="spinner-border spinner-border-sm me-2" />}{confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
