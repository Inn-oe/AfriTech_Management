import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Brand, PanelArt, SunMark } from '../components/Brand.jsx';

/** Log in, or register a new solar company (mode = 'login' | 'signup'). */
export default function AuthPage({ mode }) {
  const isSignup = mode === 'signup';
  const { login, signup } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({ company_name: '', name: '', phone: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const field = (name, label, props = {}) => (
    <div className="mb-3">
      <label className="form-label small fw-semibold" htmlFor={`a-${name}`}>{label}</label>
      <input id={`a-${name}`} className="form-control form-control-lg fs-6" value={values[name]}
        onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))} {...props} />
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

  return (
    <div className="auth-split">
      <section className="auth-hero">
        <Brand />
        <div className="eyebrow" style={{ color: 'rgba(255,255,255,0.7)', letterSpacing: '0.2em' }}>The complete solar business platform</div>
        <h1>Power your business.<span>Not just your panels.</span></h1>
        <p className="lead">From first enquiry to final installation, manage sales, customers, inventory and finances in one smart workspace.</p>
        <ul>
          <li><i className="fas fa-check" />Sell smarter with quotes and CRM</li>
          <li><i className="fas fa-check" />Stay in control of stock and projects</li>
          <li><i className="fas fa-check" />Track revenue and grow with confidence</li>
        </ul>
        <div className="glow" />
        <PanelArt />
        <div className="foot">Built for solar businesses across Zimbabwe and beyond.</div>
      </section>

      <section className="auth-form-side">
        <div className="card auth-card">
          <div className="card-body p-4 p-md-5">
            <div className="auth-mark"><SunMark size={32} /></div>
            <div className="eyebrow">{isSignup ? 'Get started' : 'Welcome back'}</div>
            <h2 className="h3 mt-1 mb-1">{isSignup ? 'Register your solar company' : 'Sign in to your account'}</h2>
            <p className="text-muted small mb-4">{isSignup ? 'Create a workspace for your company and its team.' : 'Access your solar business workspace.'}</p>

            {error && <div className="alert alert-danger py-2 small" role="alert">{error}</div>}

            <form onSubmit={submit}>
              {isSignup && field('company_name', 'Company name', { required: true, maxLength: 150, autoFocus: true })}
              {isSignup && field('name', 'Your name', { required: true, maxLength: 100, autoComplete: 'name' })}
              {isSignup && field('phone', 'Company phone (optional)', { type: 'tel', maxLength: 100 })}
              {field('email', 'Work email address', { type: 'email', required: true, autoComplete: 'email', autoFocus: !isSignup })}
              {field('password', 'Password', {
                type: 'password', required: true, minLength: isSignup ? 8 : undefined,
                autoComplete: isSignup ? 'new-password' : 'current-password',
              })}
              {isSignup && <div className="form-text mb-3">Use at least 8 characters for the password.</div>}
              <button type="submit" className="btn btn-primary btn-lg fs-6 w-100 mt-2" disabled={busy}>
                {busy && <span className="spinner-border spinner-border-sm me-2" />}
                {isSignup ? 'Create company account' : 'Sign in securely'}
                {!busy && <i className="fas fa-arrow-right ms-2" />}
              </button>
            </form>

            <div className="text-center small mt-4">
              {isSignup
                ? <>Already registered? <Link to="/login" className="fw-semibold">Sign in</Link></>
                : <>New solar company? <Link to="/signup" className="fw-semibold">Create an account</Link></>}
            </div>
            <div className="text-center text-muted mt-3" style={{ fontSize: '0.75rem' }}>
              <i className="fas fa-lock me-1" />Your company data stays private and secure
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
