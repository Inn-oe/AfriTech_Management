import { useEffect, useState } from 'react';
import { api } from '../api.js';
import FormFields from '../components/FormFields.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { EmptyRow, ErrorBox, IconButton, Loading, PageHeader, SearchBox, StatCard } from '../components/ui.jsx';
import { dateTime, humanize, money } from '../format.js';
import { useApi } from '../hooks.js';
import { useEnum } from '../meta.jsx';

const blank = () => ({ name: '', brand: '', category: '', specifications: '', quantity: 0, unit_price: '', cost_price: '', supplier_id: '', minimum_stock_level: 5, notes: '' });

export default function Inventory() {
  const notify = useToast();
  const reasons = useEnum('stock_change_reason');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('');
  const [form, setForm] = useState(null); // { id?, values }
  const [stock, setStock] = useState(null); // { item, mode: 'in'|'out', values }
  const [historyId, setHistoryId] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const qs = new URLSearchParams({ search: debounced, category }).toString();
  const { data: items, loading, error, reload } = useApi(`/inventory?${qs}`, []);
  const { data: categories, reload: reloadCategories } = useApi('/inventory/categories', []);
  const { data: suppliers } = useApi('/suppliers', []);
  const history = useApi(historyId ? `/inventory/${historyId}` : null);

  const totalValue = (items || []).reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);
  const lowCount = (items || []).filter((i) => i.quantity <= (i.minimum_stock_level ?? 5)).length;

  const fields = [
    { name: 'name', label: 'Item name', required: true },
    { name: 'brand', label: 'Brand' },
    { name: 'category', label: 'Category', type: 'select', options: [...(categories || []), '__new__'].map((c) => (c === '__new__' ? { value: c, label: '+ New category…' } : { value: c, label: c })) },
    { name: 'new_category', label: 'New category name', required: true, hidden: (v) => v.category !== '__new__' },
    { name: 'specifications', label: 'Item code / specifications', help: 'Shown as the item code on quotations and invoices' },
    { name: 'supplier_id', label: 'Supplier', type: 'select', options: (suppliers || []).map((s) => ({ value: s.id, label: s.name })) },
    { name: 'quantity', label: 'Quantity in stock', type: 'number', step: 1, min: 0, col: 4, help: form?.id ? 'Changes are logged as adjustments' : undefined },
    { name: 'minimum_stock_level', label: 'Low-stock alert at', type: 'number', step: 1, min: 0, col: 4 },
    { name: 'cost_price', label: 'Cost price (buying)', type: 'number', min: 0, col: 4 },
    { name: 'unit_price', label: 'Selling price', type: 'number', min: 0, col: 4, required: true },
    { name: 'notes', label: 'Notes', type: 'textarea', col: 12, rows: 2 },
  ];

  const openEdit = (item) => setForm({ id: item.id, values: { ...blank(), ...Object.fromEntries(Object.entries(item).map(([k, v]) => [k, v ?? ''])) } });

  const saveItem = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { new_category: newCategory, ...values } = form.values;
    const body = { ...values, category: values.category === '__new__' ? newCategory : values.category };
    Object.keys(body).forEach((k) => body[k] === '' && (body[k] = null));
    try {
      if (form.id) await api.put(`/inventory/${form.id}`, body);
      else await api.post('/inventory', body);
      notify(`Item ${form.id ? 'updated' : 'added'} successfully`);
      setForm(null);
      reload();
      reloadCategories();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveStock = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.post(`/inventory/${stock.item.id}/stock-${stock.mode}`, stock.values);
      notify(`Stock ${stock.mode === 'in' ? 'added' : 'removed'}. New quantity: ${updated.quantity}`);
      setStock(null);
      reload();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item) => {
    if (!window.confirm(`Delete "${item.name}"? Its stock history will be removed; quotations and invoices keep their line descriptions.`)) return;
    try {
      await api.del(`/inventory/${item.id}`);
      notify('Item deleted');
      reload();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const stockFields = stock?.mode === 'in'
    ? [
      { name: 'quantity', label: 'Quantity to add', type: 'number', step: 1, min: 1, required: true },
      { name: 'unit_price', label: 'Cost per unit (buying price)', type: 'number', min: 0 },
      { name: 'notes', label: 'Notes', type: 'textarea', col: 12, rows: 2, placeholder: 'e.g. supplier invoice number' },
    ]
    : [
      { name: 'quantity', label: 'Quantity to remove', type: 'number', step: 1, min: 1, required: true },
      { name: 'reason', label: 'Reason', type: 'select', options: reasons, required: true },
      { name: 'customer_name', label: 'Customer (if applicable)', col: 12 },
      { name: 'notes', label: 'Notes', type: 'textarea', col: 12, rows: 2 },
    ];

  return (
    <>
      <PageHeader title="Inventory" icon="fa-boxes-stacked">
        <SearchBox value={search} onChange={setSearch} placeholder="Search name, brand, code…" />
        <select className="form-select w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {(categories || []).map((c) => <option key={c}>{c}</option>)}
        </select>
        <button type="button" className="btn btn-primary" onClick={() => setForm({ values: blank() })}>
          <i className="fas fa-plus me-2" />Add item
        </button>
      </PageHeader>

      <div className="row g-3 mb-4">
        <div className="col-md-4"><StatCard label="Items" value={(items || []).length} icon="fa-boxes-stacked" /></div>
        <div className="col-md-4"><StatCard label="Stock value (selling)" value={money(totalValue)} icon="fa-sack-dollar" color="success" /></div>
        <div className="col-md-4"><StatCard label="Low stock" value={lowCount} icon="fa-triangle-exclamation" color="warning" /></div>
      </div>

      <ErrorBox error={error} onRetry={reload} />
      <div className="card">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>Item</th><th>Category</th><th>Code</th><th>Supplier</th>
                <th className="text-end">Qty</th><th className="text-end">Cost</th><th className="text-end">Price</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && !items?.length ? <tr><td colSpan="8"><Loading /></td></tr>
                : !items?.length ? <EmptyRow colSpan={8} />
                  : items.map((i) => {
                    const low = i.quantity <= (i.minimum_stock_level ?? 5);
                    return (
                      <tr key={i.id}>
                        <td>
                          <div className="fw-semibold">{i.name}</div>
                          {i.brand && <div className="small text-muted">{i.brand}</div>}
                        </td>
                        <td>{i.category || '—'}</td>
                        <td><code>{i.specifications || '—'}</code></td>
                        <td>{i.supplier_name || '—'}</td>
                        <td className="text-end">
                          <span className={`badge text-bg-${i.quantity <= 0 ? 'danger' : low ? 'warning' : 'success'}`}>{i.quantity}</span>
                        </td>
                        <td className="text-end text-muted">{i.cost_price ? money(i.cost_price) : '—'}</td>
                        <td className="text-end fw-semibold">{money(i.unit_price)}</td>
                        <td className="text-end text-nowrap">
                          <div className="btn-group">
                            <IconButton icon="fa-plus" title="Stock in" variant="outline-success" onClick={() => setStock({ item: i, mode: 'in', values: { unit_price: i.cost_price || '' } })} />
                            <IconButton icon="fa-minus" title="Stock out" variant="outline-warning" onClick={() => setStock({ item: i, mode: 'out', values: { reason: 'SOLD_TO_CUSTOMER' } })} />
                            <IconButton icon="fa-clock-rotate-left" title="Stock history" onClick={() => setHistoryId(i.id)} />
                            <IconButton icon="fa-pen" title="Edit" variant="outline-primary" onClick={() => openEdit(i)} />
                            <IconButton icon="fa-trash" title="Delete" variant="outline-danger" onClick={() => remove(i)} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <Modal title={form.id ? 'Edit inventory item' : 'Add inventory item'} onClose={() => setForm(null)} size="lg">
          <form id="inv-form" onSubmit={saveItem}>
            <FormFields fields={fields} values={form.values} onChange={(values) => setForm((f) => ({ ...f, values }))} />
          </form>
          <div className="d-flex justify-content-end gap-2 mt-4">
            <button type="button" className="btn btn-light" onClick={() => setForm(null)}>Cancel</button>
            <button type="submit" form="inv-form" className="btn btn-primary" disabled={saving}>Save</button>
          </div>
        </Modal>
      )}

      {stock && (
        <Modal title={`${stock.mode === 'in' ? 'Stock in' : 'Stock out'} — ${stock.item.name}`} onClose={() => setStock(null)}>
          <p className="text-muted small">Currently in stock: <strong>{stock.item.quantity}</strong></p>
          <form id="stock-form" onSubmit={saveStock}>
            <FormFields fields={stockFields} values={stock.values} onChange={(values) => setStock((s) => ({ ...s, values }))} />
          </form>
          <div className="d-flex justify-content-end gap-2 mt-4">
            <button type="button" className="btn btn-light" onClick={() => setStock(null)}>Cancel</button>
            <button type="submit" form="stock-form" className={`btn btn-${stock.mode === 'in' ? 'success' : 'warning'}`} disabled={saving}>
              {stock.mode === 'in' ? 'Add stock' : 'Remove stock'}
            </button>
          </div>
        </Modal>
      )}

      {historyId && (
        <Modal title={`Stock history — ${history.data?.name || ''}`} onClose={() => setHistoryId(null)} size="lg">
          {history.loading ? <Loading /> : (
            <div className="table-responsive">
              <table className="table table-sm align-middle">
                <thead><tr><th>Date</th><th>Type</th><th className="text-end">Qty</th><th>Reason</th><th>Notes</th></tr></thead>
                <tbody>
                  {!history.data?.transactions?.length && <EmptyRow colSpan={5} text="No stock movements recorded." />}
                  {history.data?.transactions?.map((t) => (
                    <tr key={t.id}>
                      <td className="text-nowrap">{dateTime(t.date_created)}</td>
                      <td>{humanize(t.transaction_type)}</td>
                      <td className={`text-end fw-semibold ${t.quantity < 0 ? 'text-danger' : 'text-success'}`}>{t.quantity > 0 ? `+${t.quantity}` : t.quantity}</td>
                      <td>{t.reason ? humanize(t.reason) : '—'}</td>
                      <td className="small">{[t.customer_name, t.notes].filter(Boolean).join(' · ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
