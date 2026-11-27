import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { PRODUCT_NAME } from '../components/Brand.jsx';
import { OnlineBusinessNotice, PublicFooter, PublicNav, TRADES, useCart } from '../components/PublicSite.jsx';
import { ProductCard } from './Shop.jsx';

// ---- Audience 1: installation businesses (B2B). Exactly the eight tools the software has.
const FEATURES = [
  { icon: 'fa-file-lines', title: 'Quotations', text: 'Professional quotes with your logo, turned into invoices in one click.' },
  { icon: 'fa-file-invoice-dollar', title: 'Invoicing', text: 'Automatic invoice numbers, PDFs and a record of every payment received.' },
  { icon: 'fa-boxes-stacked', title: 'Inventory', text: 'Products, suppliers, stock-in and warnings before you sell what you do not have.' },
  { icon: 'fa-screwdriver-wrench', title: 'Projects & jobs', text: 'A project board for site visits, installations and job progress.' },
  { icon: 'fa-calendar-check', title: 'Payment plans', text: 'Monthly instalments, with missed payments flagged as overdue.' },
  { icon: 'fa-whatsapp', brand: true, title: 'WhatsApp enquiries', text: 'A WhatsApp bot that answers customers and collects new leads for you.' },
  { icon: 'fa-chart-column', title: 'Reports', text: 'Sales, income, expenses and profit in clear charts and reports.' },
  { icon: 'fa-truck-pickup', title: 'Fuel & mileage', text: 'Log fuel, mileage and journeys so travel costs are not forgotten.' },
];

const BENEFITS = [
  { icon: 'fa-hand-holding-dollar', title: 'Get paid on time', text: 'Deposits, instalments and overdue alerts show exactly who owes you and since when, with no chasing through notebooks.' },
  { icon: 'fa-bolt', title: 'Quote in minutes, not hours', text: 'Pick items from your product list, and the totals and a branded PDF are ready to send while you are still on site.' },
  { icon: 'fa-comments', title: 'Never miss an enquiry', text: 'The WhatsApp bot replies day and night, answers price questions and lists new potential clients for your team.' },
  { icon: 'fa-box-open', title: 'No more selling stock you do not have', text: 'Stock goes down as you invoice, and you are warned before a quote includes an item that is out of stock.' },
  { icon: 'fa-sack-dollar', title: 'Know your real profit', text: 'Income, expenses, fuel and travel sit next to sales, so you can see what each month and each job really earns.' },
  { icon: 'fa-user-shield', title: 'Your team, your rules', text: 'Give sales, technicians and accounts their own logins and roles. An activity log shows who changed what.' },
  { icon: 'fa-award', title: 'Look bigger than you are', text: 'Every quote and invoice carries your logo and details, so even a two-person team looks established.' },
  { icon: 'fa-mobile-screen', title: 'Works from your phone', text: 'Check a quote, a payment or stock levels from site. Nothing to install, it runs in the browser.' },
  { icon: 'fa-lock', title: 'Private and secure', text: 'Each company has its own separate workspace. Your customers and prices are never shared with anyone.' },
];

const COMPARE = [
  { topic: 'Quotes', before: 'Typed in Word or Excel', after: 'Branded quotes and invoices in minutes' },
  { topic: 'Payments', before: 'Tracked in a notebook', after: 'Instalments and overdue payments tracked' },
  { topic: 'Stock', before: 'Counted by memory', after: 'Live stock with out-of-stock warnings' },
  { topic: 'Enquiries', before: 'WhatsApp messages lost in the chat', after: 'Every enquiry captured as a lead' },
  { topic: 'Profit', before: 'No idea which job made money', after: 'Profit and reports at a glance' },
];

// ---- The two paths through the page.
const FOR_BUSINESSES = {
  badge: 'For installation businesses (B2B)',
  title: 'Run your whole installation business in one workspace',
  points: ['Quotations and invoices with your own logo', 'Inventory, projects and site visits', 'Payment plans with overdue alerts', 'WhatsApp enquiries, reports, fuel and mileage'],
};
const FOR_BUYERS = {
  badge: 'For property owners & buyers (direct clients)',
  title: 'Buy equipment online. We deliver to you.',
  points: ['Browse solar, CCTV, borehole and alarm hardware', 'Delivery arranged to your address', 'Pay by EcoCash, bank transfer or cash', 'Add a professional installer for a fee when you need one'],
};

const STEPS = [
  { title: 'Choose your path', buyer: 'Browse the equipment shop and add what you need to your order.', business: 'Create your company account in a couple of minutes.' },
  { title: 'Order or set up', buyer: 'Place your order and we arrange delivery to your address.', business: 'Add your logo, products and team with the right roles.' },
  { title: 'Get it fitted, or get paid', buyer: 'Ask for a professional installer, for a fee, if you want one.', business: 'Quote, invoice, install and get paid, all tracked in one place.' },
];

/** Up to eight items from the equipment shop. Shows a friendly message when the shop has nothing listed yet. */
function ShopStrip() {
  const cart = useCart();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, items: [] });
  useEffect(() => {
    let live = true;
    api.get('/shop/products?limit=8')
      .then((r) => live && setState({ loading: false, items: r.products || [] }))
      .catch(() => live && setState({ loading: false, items: [] }));
    return () => { live = false; };
  }, []);
  const add = (p) => { cart.add(p); navigate('/shop'); window.scrollTo({ top: 0 }); };
  return (
    <section id="shop" className="lp-section lp-shop">
      <div className="lp-wrap">
        <div className="lp-eyebrow dark">Equipment shop</div>
        <h2 className="lp-h2">Buy solar, CCTV, borehole &amp; alarm equipment</h2>
        <p className="lp-sub">For homes, farms and businesses. Order online and we deliver.</p>
        <OnlineBusinessNotice className="lp-shop-note" />
        {state.loading && <div className="text-center text-muted py-4"><span className="spinner-border spinner-border-sm me-2" />Loading products…</div>}
        {!state.loading && !state.items.length && (
          <div className="sp-empty">
            <i className="fas fa-box-open" />
            <p>New stock is being added. Please check again soon.</p>
            <p className="small text-muted">Looking for something specific? Send an order with a note and we will source it for you.</p>
          </div>
        )}
        {state.items.length > 0 && (
          <div className="sp-grid">
            {state.items.map((p) => <ProductCard key={p.id} p={p} onAdd={add} added={false} />)}
          </div>
        )}
        <div className="text-center mt-4">
          <Link to="/shop" className="btn btn-primary btn-lg px-4"><i className="fas fa-store me-2" />Visit the shop</Link>
        </div>
      </div>
    </section>
  );
}

/** Public landing page with the sign-in / register card (mode = 'login' | 'signup'). */
export default function AuthPage({ mode }) {
  const isSignup = mode === 'signup';
  const { login, signup } = useAuth();
  const navigate = useNavigate();
  const cart = useCart();
  const [values, setValues] = useState({ company_name: '', name: '', phone: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const field = (name, label, icon, props = {}) => (
    <div className="mb-3">
      <label className="form-label small fw-semibold" htmlFor={`a-${name}`}>{label}</label>
      <div className="lp-input">
        <i className={`fas ${icon}`} />
        <input id={`a-${name}`} className="form-control" value={values[name]}
          onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))} {...props} />
      </div>
    </div>
  );

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (isSignup) {
        await signup(values);
        navigate('/', { replace: true });
      } else {
        await login({ email: values.email, password: values.password });
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const go = (path) => { navigate(path); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  return (
    <div className="lp">
      <PublicNav cartCount={cart.count} onCart={() => navigate('/shop')} />

      {/* ---------- Hero + auth card ---------- */}
      <section className="lp-hero">
        <div className="lp-wrap lp-hero-grid">
          <div className="lp-hero-copy">
            <div className="lp-eyebrow">For installers · For every buyer</div>
            <h1>Built for installers.<span>Open to every buyer.</span></h1>
            <p className="lead">
              Installation businesses run quotes, stock, jobs and payments in one workspace. Homes, farms and
              businesses buy <strong>solar, CCTV, borehole and alarm equipment</strong> online, delivered to their address.
            </p>
            <div className="lp-chips" role="group" aria-label="Shop by trade">
              {TRADES.map((t) => (
                <Link key={t.key} to={`/shop?trade=${t.key}`} className="lp-chip" aria-label={`Shop ${t.label} equipment`}>
                  <i className={`fas ${t.icon}`} />{t.label}
                </Link>
              ))}
            </div>
            <div className="lp-hero-actions">
              <Link to="/shop" className="btn lp-cta btn-lg px-4"><i className="fas fa-store me-2" />Shop equipment</Link>
              <button type="button" className="btn btn-outline-light btn-lg px-4" onClick={() => go('/signup')}>
                <i className="fas fa-screwdriver-wrench me-2" />Installer account
              </button>
            </div>
            <div className="lp-hero-strip" aria-hidden="true">
              {TRADES.map((t) => (
                <figure key={t.key}><img src={t.photo} alt="" loading="lazy" width="800" height="500" /><figcaption>{t.label}</figcaption></figure>
              ))}
            </div>
          </div>

          <div className="card lp-auth">
            <div className="card-body p-4">
              <div className="lp-auth-for"><i className="fas fa-screwdriver-wrench me-2" />Installer and business sign-in</div>
              <div className="lp-tabs">
                <Link to="/login" className={!isSignup ? 'on' : ''}>Sign in</Link>
                <Link to="/signup" className={isSignup ? 'on' : ''}>Create an account</Link>
              </div>
              <h2 className="h5 fw-bold mb-1">{isSignup ? 'Register your company' : 'Welcome back'}</h2>
              <p className="text-muted small mb-3">
                {isSignup ? 'Set up a private workspace for your company and team.' : 'Sign in to your company workspace.'}
              </p>

              {error && <div className="alert alert-danger py-2 small" role="alert">{error}</div>}

              <form onSubmit={submit}>
                {isSignup && field('company_name', 'Company name', 'fa-building', { required: true, maxLength: 150, autoFocus: true })}
                {isSignup && field('name', 'Your name', 'fa-user', { required: true, maxLength: 100, autoComplete: 'name' })}
                {isSignup && field('phone', 'Company phone (optional)', 'fa-phone', { type: 'tel', maxLength: 100 })}
                {field('email', 'Email', 'fa-envelope', {
                  type: 'email', required: true, autoComplete: 'email', autoFocus: !isSignup, placeholder: 'name@business.co.zw',
                })}
                <div className="mb-3">
                  <label className="form-label small fw-semibold" htmlFor="a-password">Password</label>
                  <div className="lp-input">
                    <i className="fas fa-lock" />
                    <input id="a-password" className="form-control" type={showPw ? 'text' : 'password'} required
                      minLength={isSignup ? 8 : undefined} autoComplete={isSignup ? 'new-password' : 'current-password'}
                      value={values.password} onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))} />
                    <button type="button" className="lp-eye" aria-label={showPw ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPw((s) => !s)}>
                      <i className={`fas ${showPw ? 'fa-eye-slash' : 'fa-eye'}`} />
                    </button>
                  </div>
                  {isSignup && <div className="form-text">Use at least 8 characters.</div>}
                </div>
                <button type="submit" className="btn btn-primary btn-lg fs-6 w-100 mt-1" disabled={busy}>
                  {busy && <span className="spinner-border spinner-border-sm me-2" />}
                  {isSignup ? 'Create company account' : 'Sign in securely'}
                  {!busy && <i className="fas fa-arrow-right ms-2" />}
                </button>
              </form>

              <div className="text-center small mt-3">
                {isSignup
                  ? <>Already registered? <Link to="/login" className="fw-semibold">Sign in</Link></>
                  : <>New to {PRODUCT_NAME}? <Link to="/signup" className="fw-semibold">Create an account</Link></>}
              </div>
              <div className="text-center text-muted mt-2" style={{ fontSize: '0.75rem' }}>
                <i className="fas fa-lock me-1" />Your company data stays private and secure
              </div>
              <div className="lp-auth-buyer">
                Buying equipment? <Link to="/shop" className="fw-semibold">No account needed, visit the shop <i className="fas fa-arrow-right ms-1" /></Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Who it is for ---------- */}
      <section id="who" className="lp-section">
        <div className="lp-wrap">
          <div className="lp-eyebrow dark">Who it&apos;s for</div>
          <h2 className="lp-h2">One platform, two ways to use it</h2>
          <p className="lp-sub">Whether you install equipment for a living or need equipment for your home, farm or business, start on the path that fits you.</p>
          <div className="lp-who">
            <article className="lp-who-card tone-teal">
              <div className="lp-who-photo"><img src="/landing/who-installers.jpg" alt="Installation team fitting solar panels on a roof" loading="lazy" width="1000" height="650" /></div>
              <div className="lp-who-body">
                <span className="lp-who-badge"><i className="fas fa-screwdriver-wrench" />{FOR_BUSINESSES.badge}</span>
                <h3>{FOR_BUSINESSES.title}</h3>
                <ul>{FOR_BUSINESSES.points.map((x) => <li key={x}>{x}</li>)}</ul>
                <div className="lp-who-actions">
                  <button type="button" className="btn btn-primary px-4" onClick={() => go('/signup')}>Create business account</button>
                  <button type="button" className="btn btn-outline-secondary px-4" onClick={() => go('/login')}>Sign in</button>
                </div>
              </div>
            </article>
            <article className="lp-who-card tone-amber">
              <div className="lp-who-photo">
                <img src="/landing/who-buyers.jpg" alt="Home with solar panels on the roof" loading="lazy" width="1000" height="650" />
                <div className="lp-who-minis" aria-hidden="true">
                  <img src="/landing/buyer-water.jpg" alt="" loading="lazy" width="600" height="480" />
                  <img src="/landing/buyer-cctv.jpg" alt="" loading="lazy" width="600" height="480" />
                </div>
              </div>
              <div className="lp-who-body">
                <span className="lp-who-badge"><i className="fas fa-house-signal" />{FOR_BUYERS.badge}</span>
                <h3>{FOR_BUYERS.title}</h3>
                <ul>{FOR_BUYERS.points.map((x) => <li key={x}>{x}</li>)}</ul>
                <div className="lp-who-actions">
                  <Link to="/shop" className="btn lp-cta px-4"><i className="fas fa-store me-2" />Shop equipment</Link>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* ---------- Industries ---------- */}
      <section id="industries" className="lp-section lp-alt">
        <div className="lp-wrap">
          <h2 className="lp-h2">Four trades, one platform</h2>
          <p className="lp-sub">Installers run their solar, security, water or alarm business here. Buyers shop the same four trades.</p>
          <div className="lp-grid lp-grid-4">
            {TRADES.map((t) => (
              <div key={t.key} className={`lp-trade has-photo tone-${t.tone}`}>
                <div className="lp-photo">
                  <img src={t.photo} alt={t.photoAlt} loading="lazy" width="800" height="500" />
                  <span className="lp-ico"><i className={`fas ${t.icon}`} /></span>
                </div>
                <div className="lp-trade-body">
                  <h3>{t.title}</h3>
                  <p>{t.text}</p>
                  <div className="lp-trade-links">
                    <Link to={`/shop?trade=${t.key}`}><i className="fas fa-store me-1" />Shop {t.label}</Link>
                    <Link to="/signup"><i className="fas fa-briefcase me-1" />Business account</Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ShopStrip />

      {/* ---------- Features ---------- */}
      <section id="features" className="lp-section lp-alt">
        <div className="lp-wrap">
          <div className="lp-eyebrow dark">For installation businesses</div>
          <h2 className="lp-h2">Everything you need to run your installation business</h2>
          <p className="lp-sub">One login replaces the spreadsheets, notebooks and scattered WhatsApp chats.</p>
          <div className="lp-grid lp-grid-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="lp-feature">
                <i className={`${f.brand ? 'fab' : 'fas'} ${f.icon}`} />
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Benefits ---------- */}
      <section id="benefits" className="lp-section">
        <div className="lp-wrap">
          <div className="lp-eyebrow dark">Why installers choose {PRODUCT_NAME}</div>
          <h2 className="lp-h2">Less admin. More jobs. Faster payments.</h2>
          <p className="lp-sub">What changes for your business from the first week.</p>
          <div className="lp-grid lp-grid-3">
            {BENEFITS.map((b) => (
              <div key={b.title} className="lp-benefit">
                <span className="lp-ico sm"><i className={`fas ${b.icon}`} /></span>
                <div>
                  <h3>{b.title}</h3>
                  <p>{b.text}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="lp-table-wrap">
            <table className="lp-table">
              <thead>
                <tr>
                  <th scope="col"><span className="visually-hidden">Area</span></th>
                  <th scope="col" className="before"><i className="fas fa-circle-xmark me-2" />Without {PRODUCT_NAME}</th>
                  <th scope="col" className="after"><i className="fas fa-circle-check me-2" />With {PRODUCT_NAME}</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((r) => (
                  <tr key={r.topic}>
                    <th scope="row">{r.topic}</th>
                    <td className="before">{r.before}</td>
                    <td className="after">{r.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section id="how" className="lp-section lp-alt">
        <div className="lp-wrap">
          <h2 className="lp-h2">Up and running today</h2>
          <p className="lp-sub">Order equipment in minutes, or set up your installation business. No installation, no training course. If you can use WhatsApp, you can use {PRODUCT_NAME}.</p>
          <div className="lp-grid lp-grid-3">
            {STEPS.map((s, i) => (
              <div key={s.title} className="lp-step">
                <span className="lp-num">{i + 1}</span>
                <h3>{s.title}</h3>
                <p className="lp-step-line"><b><i className="fas fa-house-signal" />Buying equipment</b>{s.buyer}</p>
                <p className="lp-step-line"><b><i className="fas fa-screwdriver-wrench" />Installation business</b>{s.business}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Final call to action ---------- */}
      <section className="lp-final">
        <div className="lp-wrap text-center">
          <h2>Buy equipment, or run your installation business properly.</h2>
          <p>One place for every order, quote, job, stock item and payment, for solar, CCTV, borehole and alarm work.</p>
          <div className="d-flex gap-2 justify-content-center flex-wrap">
            <Link to="/shop" className="btn lp-cta btn-lg px-4"><i className="fas fa-store me-2" />Shop equipment</Link>
            <button type="button" className="btn btn-outline-light btn-lg px-4" onClick={() => go('/signup')}>Create your account</button>
            <button type="button" className="btn btn-link text-white btn-lg" onClick={() => go('/login')}>Sign in</button>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
