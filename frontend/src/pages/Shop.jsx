// Public equipment shop: solar, CCTV, borehole and alarm items. Customers build an order basket and send it; the
// team then calls them to confirm, take payment and arrange delivery (no online payment yet).
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import {
  InstallerNotice, OnlineBusinessNotice, ProductImage, PublicFooter, PublicNav, SHOP_TRADES as TRADES, usd, useCart,
} from '../components/PublicSite.jsx';

// Deposit choices for paying online: the shop's smallest deposit, then every 10% up to paying it all.
function depositChoices(min) {
  const out = [min];
  for (let p = Math.floor(min / 10) * 10 + 10; p < 100; p += 10) out.push(p);
  if (min < 100) out.push(100);
  return out;
}

function Checkout({ cart, info, onClose, onDone }) {
  const min = info.min_deposit_percent || 70;
  const [values, setValues] = useState({
    name: '', phone: '', town: '', address: '', email: '', notes: '', website: '',
    payment_option: 'COD', deposit_percent: min, payment_method: 'ECOCASH', installer: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  // The same sums the server does (it has the final say): the installer fee is charged once per kind of item.
  const feeAll = cart.items.reduce((n, i) => n + (i.install_fee || 0), 0);
  const installFee = values.installer ? feeAll : 0;
  const total = cart.total + installFee;
  const online = values.payment_option === 'ONLINE';
  const payNow = online ? Math.round(total * Number(values.deposit_percent)) / 100 : 0;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/shop/orders', {
        ...values, deposit_percent: Number(values.deposit_percent), items: cart.items.map((i) => ({ id: i.id, quantity: i.quantity })),
      });
      cart.clear();
      onDone({ ...res, phone: values.phone });
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

  const choice = (name, value, title, text) => (
    <label className={`sp-choice${values[name] === value ? ' on' : ''}`}>
      <input type="radio" name={name} value={value} checked={values[name] === value} onChange={set(name)} />
      <span><strong>{title}</strong><small>{text}</small></span>
    </label>
  );

  return (
    <div className="sp-overlay" role="dialog" aria-modal="true" aria-label="Place your order"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sp-sheet" onSubmit={submit}>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h2 className="h5 fw-bold m-0">Place your order</h2>
          <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
        </div>
        <OnlineBusinessNotice className="mb-3" />
        {error && <div className="alert alert-danger py-2 small">{error}</div>}
        <div className="row g-3">
          {input('name', 'Your name', { required: true, maxLength: 100, autoComplete: 'name', half: true })}
          {input('phone', 'Phone / WhatsApp', { required: true, type: 'tel', maxLength: 40, autoComplete: 'tel', placeholder: '077 123 4567', half: true })}
          {input('town', 'Town or city', { required: true, maxLength: 80, placeholder: 'Harare', half: true })}
          {input('email', 'Email (optional)', { type: 'email', maxLength: 120, autoComplete: 'email', half: true })}
          {input('address', 'Delivery address', { maxLength: 300, autoComplete: 'street-address', placeholder: 'Street, suburb' })}

          <div className="col-12">
            <label className={`sp-choice sp-installer${values.installer ? ' on' : ''}`}>
              <input type="checkbox" checked={values.installer} onChange={(e) => setValues((v) => ({ ...v, installer: e.target.checked }))} />
              <span>
                <strong><i className="fas fa-screwdriver-wrench me-1" />Add an installer</strong>
                <small>
                  There is a high chance of a credible installer when you buy here. We do not list installer profiles; we arrange one for you. It is an extra fee:{' '}
                  {feeAll > 0 ? <b>{usd(feeAll)}</b> : <b>confirmed when we call you</b>}.
                </small>
              </span>
            </label>
          </div>

          <div className="col-12">
            <div className="form-label small fw-semibold mb-1">How would you like to pay?</div>
            <div className="d-grid gap-2">
              {choice('payment_option', 'COD', 'Cash on delivery', 'Pay the full amount in cash when your order is delivered.')}
              {choice('payment_option', 'ONLINE', 'Pay online now', `Pay ${min}% or more up front (EcoCash or bank transfer). The balance is paid on delivery.`)}
            </div>
          </div>

          {online && (
            <>
              <div className="col-sm-6">
                <label className="form-label small fw-semibold" htmlFor="co-pct">How much to pay now</label>
                <select id="co-pct" className="form-select" value={values.deposit_percent} onChange={set('deposit_percent')}>
                  {depositChoices(min).map((p) => <option key={p} value={p}>{p === 100 ? 'All of it (100%)' : `${p}% up front`}</option>)}
                </select>
              </div>
              <div className="col-sm-6">
                <label className="form-label small fw-semibold" htmlFor="co-method">Pay with</label>
                <select id="co-method" className="form-select" value={values.payment_method} onChange={set('payment_method')}>
                  <option value="ECOCASH">EcoCash</option>
                  <option value="TRANSFER">Bank transfer</option>
                </select>
              </div>
            </>
          )}

          <div className="col-12">
            <label className="form-label small fw-semibold" htmlFor="co-notes">Notes (optional)</label>
            <textarea id="co-notes" className="form-control" rows="2" maxLength={1000} value={values.notes} onChange={set('notes')}
              placeholder="Anything we should know about delivery or the site" />
          </div>
          {/* left empty by people; bots fill it */}
          <input type="text" name="website" tabIndex="-1" autoComplete="off" className="sp-hp" value={values.website} onChange={set('website')} aria-hidden="true" />
        </div>

        <div className="sp-totals mt-3">
          <div><span>{cart.count} item{cart.count === 1 ? '' : 's'}</span><span>{usd(cart.total)}</span></div>
          {values.installer && <div><span>Installer</span><span>{installFee > 0 ? usd(installFee) : 'fee confirmed on the call'}</span></div>}
          <div className="sp-grand"><span>Total</span><strong>{usd(total)}</strong></div>
          {online
            ? <><div><span>Pay now ({values.deposit_percent}%)</span><b>{usd(payNow)}</b></div><div><span>Balance on delivery</span><span>{usd(total - payNow)}</span></div></>
            : <div><span>Pay on delivery</span><b>{usd(total)}</b></div>}
        </div>
        <button type="submit" className="btn btn-primary btn-lg fs-6 w-100 mt-3" disabled={busy || !cart.count}>
          {busy && <span className="spinner-border spinner-border-sm me-2" />}Place order<i className="fas fa-paper-plane ms-2" />
        </button>
        <p className="text-muted text-center mt-2 mb-0" style={{ fontSize: '0.75rem' }}>
          <i className="fas fa-lock me-1" />Prices are confirmed when we call. Nothing is charged by this website; you pay by the method you chose.
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
  const [reference, setReference] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const online = result.payment_option === 'ONLINE';
  const wa = result.whatsapp_number
    ? `https://wa.me/${result.whatsapp_number}?text=${encodeURIComponent(`Hello, I have placed order ${result.ref} (${usd(result.total)}) on your website.`)}`
    : null;

  const sendReference = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/shop/orders/${result.ref}/payment`, { phone: result.phone, reference });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sp-overlay" role="dialog" aria-modal="true" aria-label="Order placed">
      <div className="sp-sheet">
        <div className="text-center">
          <div className="sp-done"><i className="fas fa-check" /></div>
          <h2 className="h4 fw-bold">Order placed</h2>
          <p className="mb-1">Your order number is <strong>{result.ref}</strong>, total <strong>{usd(result.total)}</strong>.</p>
        </div>

        <div className="sp-totals my-3">
          <div><span>Goods</span><span>{usd(result.goods_total)}</span></div>
          {result.installer && <div><span>Installer</span><span>{result.installation_fee > 0 ? usd(result.installation_fee) : 'fee confirmed on the call'}</span></div>}
          {online
            ? <><div><span>Pay now ({result.deposit_percent}%)</span><b>{usd(result.deposit_due)}</b></div><div><span>Balance on delivery</span><span>{usd(result.balance_on_delivery)}</span></div></>
            : <div><span>Pay in cash on delivery</span><b>{usd(result.total)}</b></div>}
        </div>

        {online && (
          <div className="sp-pay">
            <div className="fw-semibold mb-1"><i className="fas fa-mobile-screen me-1" />Pay {usd(result.deposit_due)} now by {result.payment_method === 'TRANSFER' ? 'bank transfer' : 'EcoCash'}</div>
            <div className="small" style={{ whiteSpace: 'pre-line' }}>
              {result.payment_instructions || 'We will send you the payment details on WhatsApp.'}
            </div>
            <div className="small mt-1">Use <strong>{result.ref}</strong> as the reference.</div>
            {sent ? (
              <div className="alert alert-success py-2 small mt-2 mb-0">Thank you. We will confirm your payment and call you.</div>
            ) : (
              <form onSubmit={sendReference} className="mt-2">
                <label className="form-label small fw-semibold mb-1" htmlFor="co-ref">Already paid? Send us your payment reference</label>
                <div className="input-group">
                  <input id="co-ref" className="form-control" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} required placeholder="e.g. EcoCash confirmation code" />
                  <button type="submit" className="btn btn-primary" disabled={busy}>Send</button>
                </div>
                {error && <div className="text-danger small mt-1">{error}</div>}
              </form>
            )}
          </div>
        )}

        {result.installer && (
          <p className="small mt-3 mb-0"><i className="fas fa-screwdriver-wrench me-1 text-success" />
            <strong>Your installer:</strong> there is a high chance of a credible installer when you buy here. We do not list installer profiles in the app, so we will arrange one for you and agree the date when we call.</p>
        )}
        <p className="text-muted small mt-2">We are an online business, not a shop, so everything is delivered to your address. We will contact you shortly to confirm the price and delivery.</p>
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
        {p.supplier_company && <div className="sp-supplier"><i className="fas fa-building me-1" />Supplied by {p.supplier_company}</div>}
        <div className="sp-install"><i className="fas fa-screwdriver-wrench me-1" />Installer available{p.install_fee > 0 ? `: +${usd(p.install_fee)}` : ' for a fee'}</div>
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
  const [info, setInfo] = useState({ min_deposit_percent: 70 });

  useEffect(() => { api.get('/shop/info').then(setInfo).catch(() => {}); }, []);

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
          <div className="lp-eyebrow">Online store · E-commerce</div>
          <h1>Solar, CCTV, alarms, razor wire &amp; borehole equipment.<span>Ordered online, delivered to you.</span></h1>
          <p className="lead">We are an online (e-commerce) business, not a shop. Choose your items, order here, and we deliver. Need it fitted? There is a high chance of a credible installer when you buy here, arranged for a fee.</p>
          <div className="sp-promises">
            <span><i className="fas fa-truck-fast" />Delivered to your address</span>
            <span><i className="fas fa-money-bill-wave" />Pay on delivery, or {info.min_deposit_percent || 70}% or more up front online</span>
            <span><i className="fas fa-screwdriver-wrench" />A credible installer, arranged for a fee</span>
          </div>
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
          <OnlineBusinessNotice className="mb-2" />
          <InstallerNotice className="mb-3" />
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
      {panel === 'checkout' && <Checkout cart={cart} info={info} onClose={() => setPanel('basket')} onDone={(r) => setPanel(r)} />}
      {panel && typeof panel === 'object' && <Done result={panel} onClose={() => setPanel(null)} />}

      <PublicFooter />
    </div>
  );
}
