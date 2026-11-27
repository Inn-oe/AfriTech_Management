// Public equipment shop: solar, CCTV, borehole and alarm items. Customers build an order basket and send it; the
// team then calls them to confirm, take payment and arrange delivery (no online payment yet).
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import {
  PartnerBadge, ProductImage, PublicFooter, PublicNav, TRADES, usd, useCart,
} from '../components/PublicSite.jsx';

function Checkout({ cart, onClose, onDone }) {
  const [values, setValues] = useState({ name: '', phone: '', town: '', address: '', email: '', notes: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/shop/orders', { ...values, items: cart.items.map((i) => ({ id: i.id, quantity: i.quantity })) });
      cart.clear();
      onDone(res);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const input = (k, label, props = {}) => (
    <div className={props.half ? 'col-sm-6' : 'col-12'}>
      <label className="form-label small fw-semibold" htmlFor={`co-${k}`}>{label}</label>
      <input id={`co-${k}`} className="form-control" value={values[k]} onChange={set(k)} {...{ ...props, half: undefined }} />
    </div>
  );

  return (
    <div className="sp-overlay" role="dialog" aria-modal="true" aria-label="Send your order"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sp-sheet" onSubmit={submit}>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h2 className="h5 fw-bold m-0">Send your order</h2>
          <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
        </div>
        <p className="small text-muted">We will call or WhatsApp you to confirm the price, delivery date and how you would like to pay (EcoCash, bank transfer or cash).</p>
        {error && <div className="alert alert-danger py-2 small">{error}</div>}
        <div className="row g-3">
          {input('name', 'Your name', { required: true, maxLength: 100, autoComplete: 'name', half: true })}
          {input('phone', 'Phone / WhatsApp', { required: true, type: 'tel', maxLength: 40, autoComplete: 'tel', placeholder: '077 123 4567', half: true })}
          {input('town', 'Town or city', { required: true, maxLength: 80, placeholder: 'Harare', half: true })}
          {input('email', 'Email (optional)', { type: 'email', maxLength: 120, autoComplete: 'email', half: true })}
          {input('address', 'Delivery address (optional)', { maxLength: 300, autoComplete: 'street-address' })}
          <div className="col-12">
            <label className="form-label small fw-semibold" htmlFor="co-notes">Notes (optional)</label>
            <textarea id="co-notes" className="form-control" rows="2" maxLength={1000} value={values.notes} onChange={set('notes')}
              placeholder="Do you also need installation?" />
          </div>
          {/* left empty by people; bots fill it */}
          <input type="text" name="website" tabIndex="-1" autoComplete="off" className="sp-hp" value={values.website} onChange={set('website')} aria-hidden="true" />
        </div>
        <div className="sp-sum mt-3">
          <span>{cart.count} item{cart.count === 1 ? '' : 's'}</span>
          <strong>{usd(cart.total)}</strong>
        </div>
        <button type="submit" className="btn btn-primary btn-lg fs-6 w-100 mt-3" disabled={busy || !cart.count}>
          {busy && <span className="spinner-border spinner-border-sm me-2" />}Send order<i className="fas fa-paper-plane ms-2" />
        </button>
        <p className="text-muted text-center mt-2 mb-0" style={{ fontSize: '0.75rem' }}>
          <i className="fas fa-lock me-1" />No payment is taken now. Prices include our sourcing and are confirmed when we call.
        </p>
      </form>
    </div>
  );
}

function Basket({ cart, onClose, onCheckout }) {
  return (
    <div className="sp-overlay" role="dialog" aria-modal="true" aria-label="Order basket"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="sp-drawer">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h2 className="h5 fw-bold m-0"><i className="fas fa-cart-shopping me-2 text-success" />Your order</h2>
          <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
        </div>
        {!cart.items.length && <p className="text-muted">Your basket is empty. Add items from the shop.</p>}
        <div className="sp-lines">
          {cart.items.map((i) => (
            <div key={i.id} className="sp-line">
              <div className="flex-grow-1">
                <div className="fw-semibold small">{i.name}</div>
                <div className="text-muted small">{usd(i.price)} each</div>
              </div>
              <div className="sp-qty">
                <button type="button" aria-label="One less" onClick={() => cart.setQty(i.id, i.quantity - 1)}>−</button>
                <span>{i.quantity}</span>
                <button type="button" aria-label="One more" onClick={() => cart.setQty(i.id, i.quantity + 1)}>+</button>
              </div>
            </div>
          ))}
        </div>
        <div className="sp-sum mt-auto">
          <span>Total</span><strong>{usd(cart.total)}</strong>
        </div>
        <button type="button" className="btn btn-primary btn-lg fs-6 w-100 mt-3" disabled={!cart.count} onClick={onCheckout}>
          Continue<i className="fas fa-arrow-right ms-2" />
        </button>
      </aside>
    </div>
  );
}

function Done({ result, onClose }) {
  const wa = result.whatsapp_number
    ? `https://wa.me/${result.whatsapp_number}?text=${encodeURIComponent(`Hello, I have placed order ${result.ref} (${usd(result.total)}) on your website.`)}`
    : null;
  return (
    <div className="sp-overlay" role="dialog" aria-modal="true" aria-label="Order sent">
      <div className="sp-sheet text-center">
        <div className="sp-done"><i className="fas fa-check" /></div>
        <h2 className="h4 fw-bold">Order sent</h2>
        <p className="mb-1">Your order number is <strong>{result.ref}</strong>, total <strong>{usd(result.total)}</strong>.</p>
        <p className="text-muted small">We will contact you shortly to confirm the price, payment and delivery.</p>
        {wa && (
          <a className="btn btn-success w-100 mb-2" href={wa} target="_blank" rel="noreferrer">
            <i className="fab fa-whatsapp me-2" />Message us on WhatsApp
          </a>
        )}
        <button type="button" className="btn btn-outline-secondary w-100" onClick={onClose}>Back to the shop</button>
      </div>
    </div>
  );
}

export function ProductCard({ p, onAdd, added }) {
  return (
    <div className="sp-card">
      <ProductImage src={p.image_url} trade={p.trade} alt={p.name} />
      <div className="sp-body">
        <span className={`sp-tag tone-${TRADES.find((t) => t.key === p.trade)?.tone || 'teal'}`}>
          {TRADES.find((t) => t.key === p.trade)?.label}
        </span>
        <h3 title={p.name}>{p.name}</h3>
        {p.description && <p className="sp-desc">{p.description}</p>}
        <div className="sp-foot">
          <strong>{usd(p.price)}</strong>
          <button type="button" className={`btn btn-sm ${added ? 'btn-success' : 'btn-primary'}`} onClick={() => onAdd(p)}>
            <i className={`fas ${added ? 'fa-check' : 'fa-cart-plus'} me-1`} />{added ? 'Added' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Shop() {
  const cart = useCart();
  const initialTrade = new URLSearchParams(window.location.search).get('trade') || '';
  const [trade, setTrade] = useState(TRADES.some((t) => t.key === initialTrade) ? initialTrade : '');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [data, setData] = useState({ loading: true, products: [], error: '' });
  const [panel, setPanel] = useState(null);       // 'basket' | 'checkout' | {ref,...}
  const [justAdded, setJustAdded] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let live = true;
    setData((d) => ({ ...d, loading: true, error: '' }));
    const params = new URLSearchParams({ limit: '200' });
    if (trade) params.set('trade', trade);
    if (term) params.set('q', term);
    api.get(`/shop/products?${params}`)
      .then((r) => live && setData({ loading: false, products: r.products, error: '' }))
      .catch((e) => live && setData({ loading: false, products: [], error: e.message }));
    return () => { live = false; };
  }, [trade, term]);

  const add = (p) => {
    cart.add(p);
    setJustAdded(p.id);
    setTimeout(() => setJustAdded((id) => (id === p.id ? null : id)), 1500);
  };

  const inCart = useMemo(() => new Set(cart.items.map((i) => i.id)), [cart.items]);

  return (
    <div className="lp">
      <PublicNav cartCount={cart.count} onCart={() => setPanel('basket')} />

      <section className="sp-hero">
        <div className="lp-wrap">
          <div className="lp-eyebrow">Equipment shop</div>
          <h1>Solar, CCTV, borehole &amp; alarm equipment.<span>Ordered online, delivered to you.</span></h1>
          <p className="lead">Choose your items, send your order, and we call you to confirm the price, payment and delivery. Installation can be arranged too.</p>
          <div className="sp-promises">
            <span><i className="fas fa-truck-fast" />Delivery arranged</span>
            <span><i className="fas fa-money-bill-wave" />Pay by EcoCash, transfer or cash</span>
            <span><i className="fas fa-screwdriver-wrench" />Installation on request</span>
          </div>
          <div className="mt-3"><PartnerBadge /></div>
        </div>
      </section>

      <section className="lp-section pt-4">
        <div className="lp-wrap">
          <div className="sp-filters">
            <div className="sp-tabs" role="tablist">
              <button type="button" className={!trade ? 'on' : ''} onClick={() => setTrade('')}>All</button>
              {TRADES.map((t) => (
                <button key={t.key} type="button" className={trade === t.key ? 'on' : ''} onClick={() => setTrade(t.key)}>
                  <i className={`fas ${t.icon} me-1`} />{t.label}
                </button>
              ))}
            </div>
            <div className="sp-search">
              <i className="fas fa-search" />
              <input className="form-control" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search panels, cameras, pumps…" aria-label="Search products" />
            </div>
          </div>

          {data.error && <div className="alert alert-danger">{data.error}</div>}
          {data.loading && <div className="text-center text-muted py-5"><span className="spinner-border spinner-border-sm me-2" />Loading products…</div>}
          {!data.loading && !data.error && !data.products.length && (
            <div className="sp-empty">
              <i className="fas fa-box-open" />
              <p>{term || trade ? 'No items match your search yet.' : 'New stock is being added. Please check again soon.'}</p>
              <p className="small text-muted">Looking for something specific? Send an order with a note and we will source it for you.</p>
            </div>
          )}
          <div className="sp-grid">
            {data.products.map((p) => <ProductCard key={p.id} p={p} onAdd={add} added={justAdded === p.id || inCart.has(p.id)} />)}
          </div>
        </div>
      </section>

      {cart.count > 0 && !panel && (
        <button type="button" className="sp-float" onClick={() => setPanel('basket')}>
          <i className="fas fa-cart-shopping me-2" />{cart.count} item{cart.count === 1 ? '' : 's'} · {usd(cart.total)}
          <span className="ms-2 fw-bold">Order<i className="fas fa-arrow-right ms-1" /></span>
        </button>
      )}

      {panel === 'basket' && <Basket cart={cart} onClose={() => setPanel(null)} onCheckout={() => setPanel('checkout')} />}
      {panel === 'checkout' && <Checkout cart={cart} onClose={() => setPanel('basket')} onDone={(r) => setPanel(r)} />}
      {panel && typeof panel === 'object' && <Done result={panel} onClose={() => setPanel(null)} />}

      <PublicFooter />
    </div>
  );
}
