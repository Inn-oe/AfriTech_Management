// Shared pieces of the public website (landing page and shop): top bar, footer, trades and cart.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Brand, PRODUCT_NAME } from './Brand.jsx';

export const TRADES = [
  { key: 'solar', label: 'Solar', icon: 'fa-solar-panel', tone: 'amber', noun: 'solar',
    title: 'Solar installers', text: 'Quote systems from your own price list, track installations and collect deposits and instalments.',
    photo: '/landing/solar.jpg', photoAlt: 'Technician in a hard hat installing solar panels' },
  { key: 'cctv', label: 'CCTV', icon: 'fa-video', tone: 'teal', noun: 'CCTV and security',
    title: 'CCTV installers', text: 'Handle camera quotes, site installs, maintenance visits and customer follow-ups.',
    photo: '/landing/cctv.jpg', photoAlt: 'Technician fitting a security camera to a wall' },
  { key: 'borehole', label: 'Borehole & Water', icon: 'fa-droplet', tone: 'blue', noun: 'borehole and water',
    title: 'Borehole & water', text: 'Track drilling jobs, pump installs, travel to site and every payment for each borehole.',
    photo: '/landing/borehole.jpg', photoAlt: 'Worker beside a borehole drilling rig' },
  { key: 'alarms', label: 'Alarms & Access', icon: 'fa-shield-halved', tone: 'red', noun: 'alarm and access-control',
    title: 'Alarms & access control', text: 'Manage alarm, intruder, electric-fence and access-control jobs from quote to handover.',
    photo: '/landing/alarms.jpg', photoAlt: 'Technician in a hard hat fitting a security device to a wall' },
];

// The shop sells one more kind of product than the landing page features.
export const SHOP_TRADES = [
  ...TRADES,
  { key: 'razorwire', label: 'Razor wire & fencing', icon: 'fa-road-barrier', tone: 'slate', noun: 'razor wire' },
  { key: 'materials', label: 'Installation materials', icon: 'fa-plug', tone: 'slate', noun: 'installation materials' },
];

/** The statement customers must see: this is an online business, not a walk-in shop. */
export function OnlineBusinessNotice({ className = '' }) {
  return (
    <div className={`sp-notice ${className}`} role="note">
      <i className="fas fa-truck-fast" />
      <div>
        <strong>We are an online (e-commerce) business, not a shop.</strong> There is no walk-in store: you order here and
        we deliver to your address.
      </div>
    </div>
  );
}

/** What buyers are told about installers: a good chance of a credible one, and no installer profiles in the app. */
export function InstallerNotice({ className = '' }) {
  return (
    <div className={`sp-notice sp-notice-green ${className}`} role="note">
      <i className="fas fa-screwdriver-wrench" />
      <div>
        <strong>Buy here and there is a high chance of getting a credible installer.</strong> We do not list installer
        profiles in the app: if you ask for an installer, we arrange one for you, for a fee.
      </div>
    </div>
  );
}

export function PublicNav({ cartCount = 0, onCart }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const go = (path) => { setOpen(false); navigate(path); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const close = () => setOpen(false);
  return (
    <header className="lp-nav">
      <div className="lp-wrap lp-nav-inner">
        <Brand to="/" />
        <nav className={`lp-links${open ? ' open' : ''}`}>
          <Link to="/shop" onClick={close} className="lp-shop-link"><i className="fas fa-store me-1" />Shop</Link>
          <a href="/#industries" onClick={close}>Industries</a>
          <a href="/#features" onClick={close}>Features</a>
          <a href="/#benefits" onClick={close}>Benefits</a>
          <a href="/#how" onClick={close}>How it works</a>
          <button type="button" className="btn btn-outline-light btn-sm px-3" onClick={() => go('/login')}>Sign in</button>
        </nav>
        {onCart && (
          <button type="button" className="lp-cart-btn" onClick={onCart} aria-label={`Order basket, ${cartCount} items`}>
            <i className="fas fa-cart-shopping" />
            {cartCount > 0 && <span>{cartCount}</span>}
          </button>
        )}
        <button type="button" className="btn lp-cta btn-sm px-3" onClick={() => go('/signup')}>Get started</button>
        <button type="button" className="lp-burger" aria-label="Menu" onClick={() => setOpen((o) => !o)}>
          <i className={`fas ${open ? 'fa-xmark' : 'fa-bars'}`} />
        </button>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="lp-foot">
      <div className="lp-wrap">
        <div>
          © {new Date().getFullYear()} {PRODUCT_NAME} · Installation business management and equipment shop ·
          Built for installers across Zimbabwe and beyond. · Photos: Unsplash &amp; Pexels
        </div>
      </div>
    </footer>
  );
}

// ---------- Order basket, kept in the browser between the landing page and the shop ----------
const CART_KEY = 'shop-cart-v1';
const CART_EVENT = 'shop-cart';

function readCart() {
  try {
    const items = JSON.parse(localStorage.getItem(CART_KEY));
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

let memoryCart = null;   // used when the browser does not allow storage (private windows)

export function useCart() {
  const [items, setItems] = useState(() => memoryCart || readCart());

  useEffect(() => {
    const sync = () => setItems(memoryCart || readCart());
    window.addEventListener(CART_EVENT, sync);
    return () => window.removeEventListener(CART_EVENT, sync);
  }, []);

  const save = useCallback((next) => {
    memoryCart = next;
    try { localStorage.setItem(CART_KEY, JSON.stringify(next)); } catch { /* kept in memory only */ }
    setItems(next);
    window.dispatchEvent(new Event(CART_EVENT));
  }, []);

  const add = useCallback((product, qty = 1) => {
    const cur = memoryCart || readCart();
    const hit = cur.find((i) => i.id === product.id);
    save(hit
      ? cur.map((i) => (i.id === product.id ? { ...i, quantity: Math.min(50, i.quantity + qty) } : i))
      : [...cur, { id: product.id, name: product.name, price: product.price, image_url: product.image_url, install_fee: product.install_fee || 0, quantity: qty }]);
  }, [save]);

  const setQty = useCallback((id, qty) => {
    const cur = memoryCart || readCart();
    save(qty <= 0 ? cur.filter((i) => i.id !== id) : cur.map((i) => (i.id === id ? { ...i, quantity: Math.min(50, qty) } : i)));
  }, [save]);

  const clear = useCallback(() => save([]), [save]);
  const count = items.reduce((n, i) => n + i.quantity, 0);
  const total = items.reduce((n, i) => n + i.quantity * i.price, 0);
  return { items, add, setQty, clear, count, total };
}

export function ProductImage({ src, trade, alt }) {
  const [broken, setBroken] = useState(false);
  const icon = TRADES.find((t) => t.key === trade)?.icon || 'fa-box';
  if (!src || broken) return <div className="sp-img sp-img-empty"><i className={`fas ${icon}`} /></div>;
  return (
    <div className="sp-img">
      <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    </div>
  );
}

export const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
