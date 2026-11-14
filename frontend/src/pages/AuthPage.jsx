import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

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
      <label className="form-label" htmlFor={`a-${name}`}>{label}</label>
      <input id={`a-${name}`} className="form-control" value={values[name]}
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
    <div className="auth-page">
      <div className="card auth-card">
        <div className="card-body p-4">
          <div className="text-center mb-4">
            <i className="fas fa-solar-panel fa-2x text-warning mb-2" />
            <h1 className="h4 fw-semibold mb-1">{isSignup ? 'Register your solar company' : 'Log in'}</h1>
            <div className="text-muted small">
              {isSignup ? 'Stock, sales, invoices and finances in one place.' : 'Welcome back.'}
            </div>
          </div>

          {error && <div className="alert alert-danger py-2" role="alert">{error}</div>}

          <form onSubmit={submit}>
            {isSignup && field('company_name', 'Company name', { required: true, maxLength: 150, autoFocus: true })}
            {isSignup && field('name', 'Your name', { required: true, maxLength: 100, autoComplete: 'name' })}
            {isSignup && field('phone', 'Company phone (optional)', { type: 'tel', maxLength: 100 })}
            {field('email', 'Email', { type: 'email', required: true, autoComplete: 'email', autoFocus: !isSignup })}
            {field('password', 'Password', {
              type: 'password', required: true, minLength: isSignup ? 8 : undefined,
              autoComplete: isSignup ? 'new-password' : 'current-password',
            })}
            {isSignup && <div className="form-text mb-3">Use at least 8 characters for the password.</div>}
            <button type="submit" className="btn btn-primary w-100" disabled={busy}>
              {busy && <span className="spinner-border spinner-border-sm me-2" />}
              {isSignup ? 'Create company account' : 'Log in'}
            </button>
          </form>

          <div className="text-center small mt-3">
            {isSignup
              ? <>Already registered? <Link to="/login">Log in</Link></>
              : <>New solar company? <Link to="/signup">Create an account</Link></>}
          </div>
        </div>
      </div>
    </div>
  );
}
