import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Brand, PRODUCT_NAME } from '../components/Brand.jsx';

// The trades the platform is built for. `noun` fills the hero sentence when a chip is picked.
const TRADES = [
  { key: 'solar', label: 'Solar', icon: 'fa-solar-panel', tone: 'amber', noun: 'solar',
    title: 'Solar installers', text: 'Quote systems from your own price list, track installations and collect deposits and instalments.' },
  { key: 'cctv', label: 'CCTV', icon: 'fa-video', tone: 'teal', noun: 'CCTV and security',
    title: 'CCTV installers', text: 'Handle camera quotes, site installs, maintenance visits and customer follow-ups.' },
  { key: 'water', label: 'Borehole & Water', icon: 'fa-droplet', tone: 'blue', noun: 'borehole and water',
    title: 'Borehole & water', text: 'Track drilling jobs, pump installs, travel to site and every payment for each borehole.' },
  { key: 'alarms', label: 'Alarms & Access', icon: 'fa-shield-halved', tone: 'red', noun: 'alarm and access-control',
    title: 'Alarms & access control', text: 'Manage alarm, intruder, electric-fence and access-control jobs from quote to handover.' },
];

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

const BEFORE = ['Quotes typed in Word or Excel', 'Payments tracked in a notebook', 'Stock counted by memory', 'WhatsApp messages lost in the chat', 'No idea which job made money'];
const AFTER = ['Branded quotes and invoices in minutes', 'Instalments and overdue payments tracked', 'Live stock with out-of-stock warnings', 'Every enquiry captured as a lead', 'Profit and reports at a glance'];

const STEPS = [
  { title: 'Create your company account', text: 'Register your company in a couple of minutes.' },
  { title: 'Add your logo, products and team', text: 'Load your price list and invite your staff with the right roles.' },
  { title: 'Send your first quote', text: 'Quote, invoice, install and get paid, all tracked in one place.' },
];

/** Inline illustration: sun and solar panel, CCTV camera, borehole pump and alarm shield. */
function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 640 300" aria-hidden="true">
      <defs>
        <radialGradient id="ha-sun" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ffd66b" /><stop offset="1" stopColor="#f4a922" />
        </radialGradient>
        <linearGradient id="ha-panel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2b6cb0" /><stop offset="1" stopColor="#163e73" />
        </linearGradient>
        <linearGradient id="ha-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7fd3ff" /><stop offset="1" stopColor="#2aa1e0" />
        </linearGradient>
      </defs>
      <circle cx="120" cy="110" r="80" fill="rgba(244,185,66,0.18)" />
      <circle cx="120" cy="110" r="46" fill="url(#ha-sun)" />
      {/* hills */}
      <path d="M0 250 Q160 200 320 235 T640 225 V300 H0Z" fill="#2f8a4e" />
      <path d="M0 270 Q200 235 380 262 T640 255 V300 H0Z" fill="#3fa35d" />
      <path d="M0 292 Q320 268 640 288 V300 H0Z" fill="#f4b942" />
      {/* solar panel */}
      <g>
        <rect x="130" y="196" width="8" height="50" fill="#9fb3c2" />
        <rect x="232" y="186" width="8" height="58" fill="#9fb3c2" />
        <polygon points="70,212 200,150 312,180 186,248" fill="#dfe7ee" />
        <polygon points="78,211 201,155 303,181 186,242" fill="url(#ha-panel)" />
        <g stroke="#9cc3ea" strokeWidth="1.4" opacity="0.8">
          <line x1="119" y1="192" x2="220" y2="218" /><line x1="160" y1="173" x2="261" y2="199" />
          <line x1="106" y1="217" x2="227" y2="162" /><line x1="140" y1="225" x2="257" y2="170" /><line x1="172" y1="234" x2="283" y2="176" />
        </g>
      </g>
      {/* CCTV pole + camera */}
      <g>
        <rect x="352" y="96" width="9" height="150" fill="#b9c6d1" />
        <rect x="340" y="100" width="30" height="12" rx="3" fill="#d7e0e7" />
        <g transform="rotate(14 380 86)">
          <rect x="330" y="68" width="88" height="34" rx="9" fill="#f4f7fa" />
          <rect x="330" y="68" width="88" height="10" rx="5" fill="#dbe4ec" />
          <circle cx="418" cy="85" r="15" fill="#1d2b38" />
          <circle cx="418" cy="85" r="8" fill="#3a8fd6" />
          <circle cx="421" cy="82" r="2.5" fill="#cfe9ff" />
        </g>
      </g>
      {/* borehole pump + water */}
      <g>
        <rect x="430" y="196" width="36" height="52" rx="4" fill="#2c5f7c" />
        <rect x="438" y="140" width="16" height="60" fill="#3d7ea3" />
        <path d="M446 142 Q446 120 470 120 H500 V136 H472 Q462 136 462 146 Z" fill="#3d7ea3" />
        <rect x="496" y="116" width="14" height="24" rx="3" fill="#2c5f7c" />
        <path d="M503 140 Q500 190 520 240 L540 240 Q514 190 510 140 Z" fill="url(#ha-water)" />
        <ellipse cx="530" cy="245" rx="34" ry="7" fill="#7fd3ff" opacity="0.7" />
      </g>
      {/* alarm shield */}
      <g transform="translate(548 70)">
        <path d="M40 0 L78 14 V48 Q78 82 40 100 Q2 82 2 48 V14 Z" fill="#1f6b4f" stroke="#f4b942" strokeWidth="5" />
        <path d="M40 26 Q54 26 54 44 V58 L60 64 H20 L26 58 V44 Q26 26 40 26 Z" fill="#f4b942" />
        <circle cx="40" cy="70" r="5" fill="#f4b942" />
      </g>
      {/* leaves */}
      <g fill="#58c27a">
        <path d="M20 250 Q30 215 52 205 Q46 235 20 250Z" /><path d="M600 236 Q606 205 630 196 Q626 226 600 236Z" />
        <path d="M410 246 Q416 222 434 214 Q430 236 410 246Z" />
      </g>
    </svg>
  );
}

/** Public landing page with the sign-in / register card (mode = 'login' | 'signup'). */
export default function AuthPage({ mode }) {
  const isSignup = mode === 'signup';
  const { login, signup } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({ company_name: '', name: '', phone: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [trade, setTrade] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const active = TRADES.find((t) => t.key === trade);

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

  const go = (path) => { setMenuOpen(false); navigate(path); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  return (
    <div className="lp">
      {/* ---------- Top bar ---------- */}
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-inner">
          <Brand to="/" />
          <nav className={`lp-links${menuOpen ? ' open' : ''}`}>
            <a href="#industries" onClick={() => setMenuOpen(false)}>Industries</a>
            <a href="#features" onClick={() => setMenuOpen(false)}>Features</a>
            <a href="#benefits" onClick={() => setMenuOpen(false)}>Benefits</a>
            <a href="#how" onClick={() => setMenuOpen(false)}>How it works</a>
            <button type="button" className="btn btn-outline-light btn-sm px-3" onClick={() => go('/login')}>Sign in</button>
          </nav>
          <button type="button" className="btn lp-cta btn-sm px-3" onClick={() => go('/signup')}>Get started</button>
          <button type="button" className="lp-burger" aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>
            <i className={`fas ${menuOpen ? 'fa-xmark' : 'fa-bars'}`} />
          </button>
        </div>
      </header>

      {/* ---------- Hero + auth card ---------- */}
      <section className="lp-hero">
        <div className="lp-wrap lp-hero-grid">
          <div className="lp-hero-copy">
            <div className="lp-eyebrow">For solar, CCTV, borehole &amp; alarm installers</div>
            <h1>Built for installers.<span>Designed for growth.</span></h1>
            <p className="lead">
              Manage quotes, stock, installations and payments for your{' '}
              <strong>{active ? active.noun : 'installation'}</strong> business in one workspace.
            </p>
            <div className="lp-chips" role="group" aria-label="Choose your trade">
              {TRADES.map((t) => (
                <button key={t.key} type="button" className={`lp-chip${trade === t.key ? ' active' : ''}`}
                  aria-pressed={trade === t.key} onClick={() => setTrade(trade === t.key ? null : t.key)}>
                  <i className={`fas ${t.icon}`} />{t.label}
                </button>
              ))}
            </div>
            <HeroArt />
          </div>

          <div className="card lp-auth">
            <div className="card-body p-4">
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
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Industries ---------- */}
      <section id="industries" className="lp-section">
        <div className="lp-wrap">
          <h2 className="lp-h2">A complete business system for installation companies</h2>
          <p className="lp-sub">Run your solar, security, water or alarm business with the tools you need to win jobs, manage work, get paid and grow.</p>
          <div className="lp-grid lp-grid-4">
            {TRADES.map((t) => (
              <div key={t.key} className={`lp-trade tone-${t.tone}${trade === t.key ? ' active' : ''}`}>
                <span className="lp-ico"><i className={`fas ${t.icon}`} /></span>
                <h3>{t.title}</h3>
                <p>{t.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Features ---------- */}
      <section id="features" className="lp-section lp-alt">
        <div className="lp-wrap">
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

          <div className="lp-compare">
            <div className="lp-col before">
              <h3><i className="fas fa-circle-xmark" />Without {PRODUCT_NAME}</h3>
              <ul>{BEFORE.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div className="lp-col after">
              <h3><i className="fas fa-circle-check" />With {PRODUCT_NAME}</h3>
              <ul>{AFTER.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section id="how" className="lp-section lp-alt">
        <div className="lp-wrap">
          <h2 className="lp-h2">Up and running today</h2>
          <p className="lp-sub">No installation, no training course. If you can use WhatsApp, you can use {PRODUCT_NAME}.</p>
          <div className="lp-grid lp-grid-3">
            {STEPS.map((s, i) => (
              <div key={s.title} className="lp-step">
                <span className="lp-num">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Final call to action ---------- */}
      <section className="lp-final">
        <div className="lp-wrap text-center">
          <h2>Ready to run your installation business properly?</h2>
          <p>One place for every quote, job, stock item and payment, for solar, CCTV, borehole and alarm companies.</p>
          <div className="d-flex gap-2 justify-content-center flex-wrap">
            <button type="button" className="btn lp-cta btn-lg px-4" onClick={() => go('/signup')}>Create your account</button>
            <button type="button" className="btn btn-outline-light btn-lg px-4" onClick={() => go('/login')}>Sign in</button>
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-wrap">© {new Date().getFullYear()} {PRODUCT_NAME} · Installation business management · Built for installers across Zimbabwe and beyond.</div>
      </footer>
    </div>
  );
}
