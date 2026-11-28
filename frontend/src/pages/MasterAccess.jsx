// The platform owner's own door: /master to sign in, /master/setup to create the master account the first time.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

function Shell({ title, subtitle, children }) {
  return (
    <div className="ma-page">
      <div className="ma-card">
        <div className="ma-badge"><i className="fas fa-user-shield" /></div>
        <h1>{title}</h1>
        <p className="ma-sub">{subtitle}</p>
        {children}
        <div className="ma-foot"><Link to="/">Back to the main site</Link></div>
      </div>
    </div>
  );
}

function Field({ id, label, ...props }) {
  return (
    <div className="mb-3">
      <label className="form-label small fw-semibold" htmlFor={id}>{label}</label>
      <input id={id} className="form-control form-control-lg fs-6" {...props} />
    </div>
  );
}

/** Master sign-in. Only accounts listed as platform owners get through; anyone else is signed straight back out. */
export function MasterLogin() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [canSetup, setCanSetup] = useState(false);

  useEffect(() => { api.get('/master/setup-status').then((r) => setCanSetup(!!r.available)).catch(() => {}); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // Check the account BEFORE the app treats it as signed in (that would swap the page away from under us).
      const session = await api.post('/auth/login', values);
      if (!session?.features?.operator) {
        await api.post('/auth/logout').catch(() => {});
        setError('This account is not a master account. Company accounts sign in on the main page.');
        setBusy(false);
        return;
      }
      await refresh();
      navigate('/master/companies', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Shell title="Master admin" subtitle="Sign in to manage companies, subscriptions and shops.">
      {error && <div className="alert alert-danger py-2 small" role="alert">{error}</div>}
      <form onSubmit={submit}>
        <Field id="ma-email" label="Email" type="email" required autoFocus autoComplete="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} />
        <Field id="ma-password" label="Password" type="password" required autoComplete="current-password" value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} />
        <button type="submit" className="btn btn-primary btn-lg fs-6 w-100" disabled={busy}>
          {busy && <span className="spinner-border spinner-border-sm me-2" />}Sign in<i className="fas fa-arrow-right ms-2" />
        </button>
      </form>
      {canSetup && <div className="ma-setup">First time here? <Link to="/master/setup" className="fw-semibold">Create the master account</Link></div>}
    </Shell>
  );
}

/** One-time creation of the master account. Needs the setup code that is stored in the hosting settings. */
export function MasterSetup() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({ code: '', name: '', email: '', password: '', again: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(null);
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  useEffect(() => { api.get('/master/setup-status').then((r) => setAvailable(!!r.available)).catch(() => setAvailable(false)); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (values.password !== values.again) { setError('The two passwords are different.'); return; }
    setBusy(true);
    setError('');
    try {
      await api.post('/master/setup', { code: values.code, name: values.name, email: values.email, password: values.password });
      await refresh();
      navigate('/master/companies', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (available === false) {
    return (
      <Shell title="Master account" subtitle="Setup is closed.">
        <p className="small text-muted">The master account already exists, or no setup code has been set. <Link to="/master">Sign in</Link> instead.</p>
      </Shell>
    );
  }
  return (
    <Shell title="Create the master account" subtitle="This works once. You need the setup code from your hosting settings (MASTER_SETUP_CODE).">
      {error && <div className="alert alert-danger py-2 small" role="alert">{error}</div>}
      <form onSubmit={submit}>
        <Field id="ms-code" label="Setup code" type="password" required autoComplete="off" value={values.code} onChange={set('code')} />
        <Field id="ms-name" label="Your name" required maxLength={100} autoComplete="name" value={values.name} onChange={set('name')} />
        <Field id="ms-email" label="Your email (the owner email)" type="email" required autoComplete="email" value={values.email} onChange={set('email')} />
        <Field id="ms-pw" label="Choose a password" type="password" required minLength={8} autoComplete="new-password" value={values.password} onChange={set('password')} />
        <Field id="ms-pw2" label="Type it again" type="password" required minLength={8} autoComplete="new-password" value={values.again} onChange={set('again')} />
        <button type="submit" className="btn btn-primary btn-lg fs-6 w-100" disabled={busy || available === null}>
          {busy && <span className="spinner-border spinner-border-sm me-2" />}Create master account
        </button>
      </form>
    </Shell>
  );
}
