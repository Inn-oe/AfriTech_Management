// Managing the public equipment shop (platform operator only): orders from customers, the product list read from
// other shops (approve / hide / own price), items added by hand, the markup and the shops we read from.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import Modal from '../components/Modal.jsx';
import { SHOP_TRADES as TRADES, usd } from '../components/PublicSite.jsx';
import { useToast } from '../components/Toast.jsx';
import { ErrorBox, Loading, PageHeader, SearchBox, StatCard } from '../components/ui.jsx';
import { dateTime } from '../format.js';
import { useApi } from '../hooks.js';

const ORDER_STATUSES = ['NEW', 'CONTACTED', 'PAID', 'DELIVERED', 'CANCELLED'];
const ORDER_COLORS = { NEW: 'warning', CONTACTED: 'info', PAID: 'primary', DELIVERED: 'success', CANCELLED: 'secondary' };
const tradeLabel = (k) => TRADES.find((t) => t.key === k)?.label || k;

// ---------------------------------------------------------------- Orders
export function ShopOrders() {
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useApi(`/shop/admin/orders${status ? `?status=${status}` : ''}`);
  const notify = useToast();
  const [open, setOpen] = useState(null);

  const update = async (o, body) => {
    try {
      const saved = await api.patch(`/shop/admin/orders/${o.id}`, body);
      setOpen((cur) => (cur && cur.id === saved.id ? saved : cur));
      reload();
      notify(`Order ${saved.ref} updated`);
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const wa = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '');
    return `https://wa.me/${digits.startsWith('0') ? `263${digits.slice(1)}` : digits}`;
  };

  return (
    <>
      <PageHeader title="Shop orders" icon="fa-bag-shopping" subtitle="Orders placed on the public equipment shop. Call the customer, take payment, buy from the source shop and deliver.">
        <a className="btn btn-outline-primary" href="/shop" target="_blank" rel="noreferrer"><i className="fas fa-store me-2" />Open the shop</a>
      </PageHeader>
      <div className="d-flex gap-2 flex-wrap mb-3">
        {['', ...ORDER_STATUSES].map((s) => (
          <button key={s || 'all'} type="button" className={`btn btn-sm ${status === s ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setStatus(s)}>
            {s ? s.charAt(0) + s.slice(1).toLowerCase() : 'All'}
          </button>
        ))}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead><tr><th>Order</th><th>Customer</th><th>Town</th><th>Items</th><th className="text-end">Total</th><th>Payment</th><th>Status</th><th /></tr></thead>
              <tbody>
                {(data?.orders || []).map((o) => (
                  <tr key={o.id} role="button" onClick={() => setOpen(o)}>
                    <td><strong>{o.ref}</strong><div className="small text-muted">{dateTime(o.created)}</div></td>
                    <td>{o.customer_name}<div className="small text-muted">{o.phone}</div></td>
                    <td>{o.town}</td>
                    <td className="small">{o.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}</td>
                    <td className="text-end fw-semibold">{usd(o.total)}{o.installer && <div className="small text-muted fw-normal"><i className="fas fa-screwdriver-wrench me-1" />installer</div>}</td>
                    <td><PaymentBadge o={o} /></td>
                    <td><span className={`badge text-bg-${ORDER_COLORS[o.status]}`}>{o.status}</span></td>
                    <td className="text-end"><i className="fas fa-chevron-right text-muted" /></td>
                  </tr>
                ))}
                {!data?.orders?.length && <tr><td colSpan="8" className="text-center text-muted py-4">No orders yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {open && (
        <Modal title={`Order ${open.ref}`} size="lg" onClose={() => setOpen(null)}>
          <div className="row g-3 mb-3">
            <div className="col-md-6">
              <div className="fw-semibold">{open.customer_name}</div>
              <div><a href={`tel:${open.phone}`}>{open.phone}</a> · <a href={wa(open.phone)} target="_blank" rel="noreferrer"><i className="fab fa-whatsapp" /> WhatsApp</a></div>
              {open.email && <div className="small">{open.email}</div>}
              <div className="small text-muted">{[open.address, open.town].filter(Boolean).join(', ')}</div>
            </div>
            <div className="col-md-6">
              <label className="form-label small fw-semibold" htmlFor="o-status">Status</label>
              <select id="o-status" className="form-select" value={open.status} onChange={(e) => update(open, { status: e.target.value })}>
                {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <PaymentBox key={`${open.id}-${open.paid_amount}`} o={open} onSave={(v) => update(open, { paid_amount: v })} />
          {open.notes && <div className="alert alert-light small"><strong>Customer note:</strong> {open.notes}</div>}
          <table className="table table-sm">
            <thead><tr><th>Item</th><th className="text-end">Qty</th><th className="text-end">Our price</th><th>Supplier / buy from</th><th className="text-end">Their price</th></tr></thead>
            <tbody>
              {open.items.map((i) => (
                <tr key={i.name}>
                  <td>{i.name}</td><td className="text-end">{i.quantity}</td><td className="text-end">{usd(i.unit_price)}</td>
                  <td className="small">{i.supplier_company && <div><strong>{i.supplier_company}</strong></div>}{i.source_url ? <a href={i.source_url} target="_blank" rel="noreferrer">{i.source_name || 'Shop'} <i className="fas fa-up-right-from-square" /></a> : (i.source_name || (i.supplier_company ? '' : '—'))}</td>
                  <td className="text-end small">{i.source_price ? usd(i.source_price) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {open.installer && <tr><th colSpan="2">Installer fee</th><th className="text-end">{usd(open.installation_fee)}</th><th colSpan="2" /></tr>}
              <tr><th colSpan="2">Total</th><th className="text-end">{usd(open.total)}</th><th className="small text-muted">Margin on goods</th>
                <th className="text-end small">{usd(open.total - (open.installation_fee || 0) - open.items.reduce((n, i) => n + (i.source_price || 0) * i.quantity, 0))}</th></tr>
            </tfoot>
          </table>
          <label className="form-label small fw-semibold" htmlFor="o-note">Our notes (not shown to the customer)</label>
          <NoteBox key={open.id} value={open.admin_note || ''} onSave={(v) => update(open, { admin_note: v })} />
        </Modal>
      )}
    </>
  );
}

function PaymentBadge({ o }) {
  const method = o.payment_option === 'ONLINE' ? `Online ${o.deposit_percent}%` : 'On delivery';
  const state = o.paid_amount >= o.total && o.total > 0 ? ['success', 'Paid in full'] : o.paid_amount > 0 ? ['info', `Paid ${usd(o.paid_amount)}`] : ['warning', 'Not paid'];
  return (
    <>
      <span className={`badge text-bg-${state[0]}`}>{state[1]}</span>
      <div className="small text-muted">{method}</div>
    </>
  );
}

function PaymentBox({ o, onSave }) {
  const [received, setReceived] = useState(String(o.paid_amount || ''));
  return (
    <div className="border rounded p-3 mb-3 bg-light">
      <div className="fw-semibold mb-2"><i className="fas fa-money-bill-wave me-2" />Payment</div>
      <div className="small mb-2">
        {o.payment_option === 'ONLINE'
          ? <>Customer chose to <strong>pay {o.deposit_percent}% online now</strong> ({usd(o.deposit_due)}) by {o.payment_method === 'TRANSFER' ? 'bank transfer' : 'EcoCash'}; the balance of {usd(o.total - o.deposit_due)} is due on delivery.</>
          : <>Customer chose <strong>cash on delivery</strong>: {usd(o.total)} to collect when delivered.</>}
        {o.payment_reference && <div>Payment reference they sent: <strong>{o.payment_reference}</strong></div>}
        {o.installer && <div><i className="fas fa-screwdriver-wrench me-1" />Wants an installer: {o.installation_fee > 0 ? usd(o.installation_fee) : 'fee to agree'} (included in the total).</div>}
      </div>
      <div className="d-flex flex-wrap gap-2 align-items-end">
        <div>
          <label className="form-label small mb-1" htmlFor="o-paid">Money received so far ($)</label>
          <input id="o-paid" type="number" min="0" max={o.total} step="0.01" className="form-control" style={{ width: 170 }} value={received} onChange={(e) => setReceived(e.target.value)} />
        </div>
        <button type="button" className="btn btn-primary" disabled={Number(received || 0) === Number(o.paid_amount || 0)} onClick={() => onSave(Number(received || 0))}>Save payment</button>
        <div className="ms-auto text-end small">Balance still to collect<div className="fs-5 fw-bold">{usd(o.balance_due)}</div></div>
      </div>
    </div>
  );
}

function NoteBox({ value, onSave }) {
  const [text, setText] = useState(value);
  return (
    <div>
      <textarea id="o-note" className="form-control" rows="2" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
      <button type="button" className="btn btn-sm btn-outline-primary mt-2" disabled={text === value} onClick={() => onSave(text)}>Save note</button>
    </div>
  );
}

// ---------------------------------------------------------------- Products
const EMPTY_ITEM = { name: '', trade: 'solar', source_name: '', source_url: '', source_price: '', price_override: '', image_url: '', description: '', supplier_company: '', install_fee: '' };

export function ShopProducts() {
  const [status, setStatus] = useState('pending');
  const [trade, setTrade] = useState('');
  const [q, setQ] = useState('');
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (trade) params.set('trade', trade);
  if (q.trim()) params.set('q', q.trim());
  const { data, loading, error, reload } = useApi(`/shop/admin/products?${params}`);
  const overview = useApi('/shop/admin/overview');
  const notify = useToast();
  const confirm = useConfirm();
  const [selected, setSelected] = useState(new Set());
  const [editing, setEditing] = useState(null);

  useEffect(() => setSelected(new Set()), [status, trade, q]);
  const rows = data?.products || [];
  const allOn = rows.length > 0 && rows.every((p) => selected.has(p.id));

  const patch = async (p, body) => {
    try {
      await api.patch(`/shop/admin/products/${p.id}`, body);
      reload();
      overview.reload();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const bulk = async (to) => {
    const ids = [...selected];
    if (!ids.length) return;
    await api.post('/shop/admin/products/bulk', { ids, status: to });
    notify(`${ids.length} item${ids.length === 1 ? '' : 's'} ${to === 'listed' ? 'listed in the shop' : to}`);
    setSelected(new Set());
    reload();
    overview.reload();
  };

  const remove = async (p) => {
    if (!(await confirm(`Delete "${p.name}"?`, { tone: 'danger', confirmLabel: 'Delete' }))) return;
    try {
      await api.del(`/shop/admin/products/${p.id}`);
      reload();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const counts = overview.data?.products || {};
  return (
    <>
      <PageHeader title="Shop products" icon="fa-boxes-stacked" subtitle="Items read from other shops arrive as 'Waiting'. List the ones you want to sell; the price shown is their price plus your markup.">
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ ...EMPTY_ITEM })}><i className="fas fa-plus me-2" />List a product</button>
      </PageHeader>
      <div className="d-flex gap-2 flex-wrap mb-3 align-items-center">
        {[['pending', 'Waiting'], ['listed', 'Listed'], ['hidden', 'Hidden'], ['', 'All']].map(([s, label]) => (
          <button key={s || 'all'} type="button" className={`btn btn-sm ${status === s ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setStatus(s)}>
            {label}{s && counts[s] !== undefined ? ` (${counts[s]})` : ''}
          </button>
        ))}
        <select className="form-select form-select-sm w-auto" value={trade} onChange={(e) => setTrade(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {TRADES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <div className="ms-auto" style={{ minWidth: 220 }}><SearchBox value={q} onChange={setQ} placeholder="Search items or shops" /></div>
      </div>

      {selected.size > 0 && (
        <div className="alert alert-primary d-flex align-items-center gap-2 py-2">
          <span className="me-auto">{selected.size} selected</span>
          <button type="button" className="btn btn-sm btn-success" onClick={() => bulk('listed')}>List in shop</button>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => bulk('hidden')}>Hide</button>
        </div>
      )}

      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th style={{ width: 32 }}><input type="checkbox" className="form-check-input" checked={allOn} aria-label="Select all"
                    onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((p) => p.id)))} /></th>
                  <th>Item</th><th>Category</th><th>From</th><th className="text-end">Their price</th><th className="text-end">Our price</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className={p.in_stock ? '' : 'opacity-50'}>
                    <td><input type="checkbox" className="form-check-input" checked={selected.has(p.id)} aria-label={`Select ${p.name}`}
                      onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} /></td>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        {p.image_url ? <img src={p.image_url} alt="" width="40" height="40" className="rounded border" style={{ objectFit: 'contain' }} referrerPolicy="no-referrer" loading="lazy" /> : null}
                        <div>
                          <div className="fw-semibold small">{p.name}</div>
                          {p.supplier_company && <div className="small text-muted"><i className="fas fa-building me-1" />{p.supplier_company}</div>}
                          {!p.in_stock && <span className="badge text-bg-secondary">Out of stock at source</span>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <select className="form-select form-select-sm" value={p.trade} onChange={(e) => patch(p, { trade: e.target.value })} aria-label="Category">
                        {TRADES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                      </select>
                    </td>
                    <td className="small">{p.source_url ? <a href={p.source_url} target="_blank" rel="noreferrer">{p.source_name || 'Shop'}</a> : (p.source_name || 'Added by hand')}</td>
                    <td className="text-end small">{p.source_price ? usd(p.source_price) : '—'}</td>
                    <td className="text-end">
                      <PriceCell p={p} onSave={(v) => patch(p, { price_override: v })} />
                    </td>
                    <td>
                      <select className={`form-select form-select-sm ${p.status === 'listed' ? 'border-success' : ''}`} value={p.status} onChange={(e) => patch(p, { status: e.target.value })} aria-label="Status">
                        <option value="pending">Waiting</option><option value="listed">Listed</option><option value="hidden">Hidden</option>
                      </select>
                    </td>
                    <td className="text-end text-nowrap">
                      <button type="button" className="btn btn-sm btn-link" title="Edit" onClick={() => setEditing({ ...EMPTY_ITEM, ...p, price_override: p.price_override ?? '', install_fee: p.install_fee_own ?? '', supplier_company: p.supplier_company || '' })}><i className="fas fa-pen" /></button>
                      {!p.source_id && <button type="button" className="btn btn-sm btn-link text-danger" title="Delete" onClick={() => remove(p)}><i className="fas fa-trash" /></button>}
                    </td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan="8" className="text-center text-muted py-4">No items here. Use “Sync now” in Shop settings, or add an item by hand.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {editing && <ItemForm item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); overview.reload(); }} />}
    </>
  );
}

function PriceCell({ p, onSave }) {
  const [edit, setEdit] = useState(false);
  const [value, setValue] = useState(p.price_override ?? '');
  if (!edit) {
    return (
      <button type="button" className="btn btn-sm btn-link text-decoration-none fw-semibold p-0" title="Set your own price" onClick={() => setEdit(true)}>
        {usd(p.price)}{p.price_override ? <i className="fas fa-thumbtack ms-1 small text-warning" title="Your own price" /> : null}
      </button>
    );
  }
  const save = () => { setEdit(false); onSave(value === '' ? null : Number(value)); };
  return (
    <div className="d-flex gap-1 justify-content-end">
      <input className="form-control form-control-sm text-end" style={{ width: 90 }} type="number" min="0" step="0.01" autoFocus
        value={value} placeholder="auto" onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      <button type="button" className="btn btn-sm btn-primary" onClick={save} aria-label="Save price"><i className="fas fa-check" /></button>
    </div>
  );
}

function ItemForm({ item, onClose, onSaved }) {
  const synced = !!item.source_id;           // read from another shop: only our own details can change
  const [v, setV] = useState(item);
  const [photo, setPhoto] = useState(null);  // a new photo chosen from this computer: { name, data }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const notify = useToast();
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));

  const pickPhoto = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) { notify('Please choose a PNG or JPEG photo.', 'error'); return; }
    if (file.size > 1000000) { notify('The photo is too big (1 MB at most).', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => setPhoto({ name: file.name, data: reader.result });
    reader.readAsDataURL(file);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = {
      trade: v.trade, supplier_company: v.supplier_company, install_fee: v.install_fee === '' ? null : Number(v.install_fee),
      price_override: v.price_override === '' ? null : Number(v.price_override),
      ...(synced ? {} : {
        name: v.name, source_name: v.source_name, source_url: v.source_url, image_url: v.image_url,
        description: v.description, source_price: v.source_price === '' ? 0 : Number(v.source_price),
      }),
    };
    try {
      const saved = item.id ? await api.patch(`/shop/admin/products/${item.id}`, body) : await api.post('/shop/admin/products', body);
      if (photo && !synced) await api.put(`/shop/admin/products/${saved.id}/image`, { image: photo.data });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  const field = (k, label, props = {}) => (
    <div className={props.col || 'col-12'}>
      <label className="form-label small fw-semibold" htmlFor={`it-${k}`}>{label}</label>
      <input id={`it-${k}`} className="form-control" value={v[k] ?? ''} onChange={set(k)} {...{ ...props, col: undefined }} />
    </div>
  );
  const preview = photo ? photo.data : v.image_url;
  return (
    <Modal title={item.id ? 'Edit item' : 'List a product'} onClose={onClose}
      footer={<><button type="button" className="btn btn-light" onClick={onClose}>Cancel</button><button type="submit" form="item-form" className="btn btn-primary" disabled={busy}>Save</button></>}>
      <form id="item-form" onSubmit={save} className="row g-3">
        {error && <div className="col-12"><div className="alert alert-danger py-2 small mb-0">{error}</div></div>}
        {synced ? <div className="col-12"><div className="fw-semibold">{v.name}</div><div className="small text-muted">Read from {v.source_name || 'another shop'}. You can set the supplier company, your own price and the installer fee.</div></div>
          : field('name', 'Product name', { required: true, maxLength: 250 })}
        <div className="col-sm-6">
          <label className="form-label small fw-semibold" htmlFor="it-trade">Category</label>
          <select id="it-trade" className="form-select" value={v.trade} onChange={set('trade')}>
            {TRADES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        {field('supplier_company', 'Company providing this product', { col: 'col-sm-6', maxLength: 100, placeholder: 'e.g. Steel Fencing Zimbabwe' })}
        {!synced && field('source_price', 'Price today (USD)', { col: 'col-sm-6', type: 'number', min: 0, step: '0.01' })}
        {field('price_override', synced ? 'Our selling price (empty = their price + markup)' : 'Our selling price (empty = price today + markup)', { col: 'col-sm-6', type: 'number', min: 0, step: '0.01' })}
        {field('install_fee', 'Installer fee for this item (empty = the shop default)', { col: 'col-sm-6', type: 'number', min: 0, step: '0.01' })}
        {!synced && (
          <>
            <div className="col-12">
              <div className="form-label small fw-semibold mb-1">Photo</div>
              <div className="d-flex align-items-center gap-3 flex-wrap">
                {preview ? <img src={preview} alt="" width="72" height="72" className="rounded border" style={{ objectFit: 'contain' }} referrerPolicy="no-referrer" /> : <div className="rounded border bg-light d-flex align-items-center justify-content-center text-muted" style={{ width: 72, height: 72 }}><i className="fas fa-image" /></div>}
                <label className="btn btn-outline-primary btn-sm mb-0"><i className="fas fa-upload me-2" />{preview ? 'Change photo' : 'Upload photo'}
                  <input type="file" accept="image/png,image/jpeg" hidden onChange={pickPhoto} />
                </label>
                <span className="small text-muted">PNG or JPEG, up to 1 MB. Or paste a photo link below.</span>
              </div>
            </div>
            {field('image_url', 'Photo link (optional)', { type: 'text', maxLength: 500, placeholder: 'https://…' })}
            {field('source_name', 'Where you found it (private, e.g. a shop name)', { col: 'col-sm-6', maxLength: 100 })}
            {field('source_url', 'Link to it online (private, optional)', { col: 'col-sm-6', type: 'url', maxLength: 500 })}
            <div className="col-12">
              <label className="form-label small fw-semibold" htmlFor="it-desc">Short description (optional)</label>
              <textarea id="it-desc" className="form-control" rows="2" maxLength={2000} value={v.description || ''} onChange={set('description')} />
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Settings & sources
export function ShopSettings() {
  const { data, loading, error, reload } = useApi('/shop/admin/overview');
  const notify = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState(null);
  const [newSource, setNewSource] = useState({ name: '', base_url: '', categories: '' });

  useEffect(() => { if (data && !form) setForm(data.settings); }, [data, form]);
  useEffect(() => {
    if (!data?.syncing) return undefined;
    const t = setTimeout(reload, 4000);
    return () => clearTimeout(t);
  }, [data, reload]);

  const example = useMemo(() => {
    if (!form) return '';
    const raw = 100 * (1 + (Number(form.markup_percent) || 0) / 100) + (Number(form.markup_flat) || 0);
    return `A $100.00 item sells for ${usd(Math.ceil(raw - 1e-9))}.`;
  }, [form]);

  const saveSettings = async (e) => {
    e.preventDefault();
    try {
      const res = await api.put('/shop/admin/settings', form);
      setForm(res.settings);
      notify('Shop settings saved');
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const sync = async (sourceId) => {
    const res = await api.post('/shop/admin/sync', sourceId ? { source_id: sourceId } : {});
    notify(res.started ? 'Reading the shops now. This takes a minute.' : res.message);
    setTimeout(reload, 1500);
  };

  const addSource = async (e) => {
    e.preventDefault();
    try {
      await api.post('/shop/admin/sources', newSource);
      setNewSource({ name: '', base_url: '', categories: '' });
      reload();
      notify('Shop added. Press “Sync now” to read its items.');
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const toggle = async (s) => { await api.patch(`/shop/admin/sources/${s.id}`, { active: !s.active }); reload(); };
  const removeSource = async (s) => {
    if (!(await confirm(`Stop reading ${s.name}? Items you have listed stay in the shop, but are marked out of stock.`, { tone: 'danger', confirmLabel: 'Remove' }))) return;
    await api.del(`/shop/admin/sources/${s.id}`);
    reload();
  };

  if (loading && !data) return <Loading />;
  return (
    <>
      <PageHeader title="Shop settings" icon="fa-sliders" subtitle="Your markup, how customers pay, installer fees, your WhatsApp number, and the shops whose items and prices are read every day." />
      <ErrorBox error={error} onRetry={reload} />
      {data && (
        <div className="row g-3 mb-3">
          <div className="col-6 col-lg-3"><StatCard label="New orders" value={data.new_orders} icon="fa-bag-shopping" color="warning" /></div>
          <div className="col-6 col-lg-3"><StatCard label="Listed items" value={data.products.listed || 0} icon="fa-store" /></div>
          <div className="col-6 col-lg-3"><StatCard label="Waiting for approval" value={data.products.pending || 0} icon="fa-hourglass-half" color="info" /></div>
          <div className="col-6 col-lg-3"><StatCard label="Hidden" value={data.products.hidden || 0} icon="fa-eye-slash" color="secondary" /></div>
        </div>
      )}

      {form && (
        <form className="card mb-3" onSubmit={saveSettings}>
          <div className="card-body row g-3 align-items-end">
            <div className="col-sm-4 col-lg-3">
              <label className="form-label small fw-semibold" htmlFor="s-pct">Markup (%)</label>
              <input id="s-pct" className="form-control" type="number" min="0" max="1000" step="0.1" value={form.markup_percent} onChange={(e) => setForm({ ...form, markup_percent: e.target.value })} />
            </div>
            <div className="col-sm-4 col-lg-3">
              <label className="form-label small fw-semibold" htmlFor="s-flat">Plus a fixed amount per item ($)</label>
              <input id="s-flat" className="form-control" type="number" min="0" step="0.5" value={form.markup_flat} onChange={(e) => setForm({ ...form, markup_flat: e.target.value })} />
            </div>
            <div className="col-sm-4 col-lg-3">
              <label className="form-label small fw-semibold" htmlFor="s-wa">WhatsApp number for customers</label>
              <input id="s-wa" className="form-control" value={form.whatsapp_number} placeholder="263771234567" onChange={(e) => setForm({ ...form, whatsapp_number: e.target.value })} />
            </div>
            <div className="col-lg-3"><button type="submit" className="btn btn-primary w-100">Save</button></div>
            <div className="col-12 small text-muted">{example} Prices are rounded up to a whole dollar. An item with its own price ignores the markup.</div>
            <div className="col-12"><hr className="my-1" /><div className="fw-semibold">Paying and installing</div></div>
            <div className="col-sm-4 col-lg-3">
              <label className="form-label small fw-semibold" htmlFor="s-dep">Smallest deposit when paying online (%)</label>
              <input id="s-dep" className="form-control" type="number" min="1" max="100" step="1" value={form.min_deposit_percent} onChange={(e) => setForm({ ...form, min_deposit_percent: e.target.value })} />
            </div>
            <div className="col-sm-4 col-lg-3">
              <label className="form-label small fw-semibold" htmlFor="s-fee">Installer fee when an item has none ($)</label>
              <input id="s-fee" className="form-control" type="number" min="0" step="0.5" value={form.install_fee_default} onChange={(e) => setForm({ ...form, install_fee_default: e.target.value })} />
            </div>
            <div className="col-lg-6">
              <label className="form-label small fw-semibold" htmlFor="s-pay">How customers pay you (shown after they order)</label>
              <textarea id="s-pay" className="form-control" rows="2" maxLength={500} value={form.payment_instructions} placeholder="EcoCash: 077 123 4567 (Afritech). Bank: ZB Bank, account 1234567890, Harare branch." onChange={(e) => setForm({ ...form, payment_instructions: e.target.value })} />
            </div>
            <div className="col-12 small text-muted">Customers can pay cash on delivery, or pay online up front: at least this deposit, and the balance on delivery. The installer fee is charged once per kind of item when the customer asks for an installer.</div>
          </div>
        </form>
      )}

      <div className="card">
        <div className="card-header d-flex align-items-center">
          <strong className="me-auto">Shops we read items from</strong>
          <button type="button" className="btn btn-sm btn-primary" disabled={data?.syncing} onClick={() => sync()}>
            {data?.syncing ? <><span className="spinner-border spinner-border-sm me-2" />Reading…</> : <><i className="fas fa-rotate me-2" />Sync now</>}
          </button>
        </div>
        <div className="table-responsive">
          <table className="table align-middle mb-0">
            <thead><tr><th>Shop</th><th>Categories read</th><th className="text-end">Items</th><th>Last read</th><th /></tr></thead>
            <tbody>
              {(data?.sources || []).map((s) => (
                <tr key={s.id} className={s.active ? '' : 'opacity-50'}>
                  <td><strong>{s.name}</strong><div className="small"><a href={s.base_url} target="_blank" rel="noreferrer">{s.base_url}</a></div></td>
                  <td className="small">{s.categories || 'Whole shop (only solar, CCTV, borehole and alarm items are kept)'}</td>
                  <td className="text-end">{s.item_count}</td>
                  <td className="small">
                    {s.last_sync ? dateTime(s.last_sync) : 'Never'}
                    {s.last_error && <div className="text-danger">{s.last_error}</div>}
                  </td>
                  <td className="text-end text-nowrap">
                    <button type="button" className="btn btn-sm btn-link" onClick={() => sync(s.id)} disabled={!s.active || data?.syncing} title="Read this shop now"><i className="fas fa-rotate" /></button>
                    <button type="button" className="btn btn-sm btn-link" onClick={() => toggle(s)} title={s.active ? 'Pause' : 'Resume'}><i className={`fas ${s.active ? 'fa-pause' : 'fa-play'}`} /></button>
                    <button type="button" className="btn btn-sm btn-link text-danger" onClick={() => removeSource(s)} title="Remove"><i className="fas fa-trash" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="card-body border-top row g-2 align-items-end" onSubmit={addSource}>
          <div className="col-md-3"><label className="form-label small fw-semibold" htmlFor="ns-name">Shop name</label>
            <input id="ns-name" className="form-control" required value={newSource.name} onChange={(e) => setNewSource({ ...newSource, name: e.target.value })} /></div>
          <div className="col-md-4"><label className="form-label small fw-semibold" htmlFor="ns-url">Website</label>
            <input id="ns-url" className="form-control" required placeholder="https://www.example.co.zw" value={newSource.base_url} onChange={(e) => setNewSource({ ...newSource, base_url: e.target.value })} /></div>
          <div className="col-md-3"><label className="form-label small fw-semibold" htmlFor="ns-cat">Categories (optional)</label>
            <input id="ns-cat" className="form-control" placeholder="solar, cctv" value={newSource.categories} onChange={(e) => setNewSource({ ...newSource, categories: e.target.value })} /></div>
          <div className="col-md-2"><button type="submit" className="btn btn-outline-primary w-100"><i className="fas fa-plus me-1" />Add shop</button></div>
          <div className="col-12 small text-muted">Works with shops built on WooCommerce (most Zimbabwean online shops). For a shop without a website, such as Mahommed Mussa, add its items by hand under Shop products.</div>
        </form>
      </div>
    </>
  );
}
