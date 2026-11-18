// Company profile, team members and roles, activity log, and "my account".
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import CrudPage from '../components/CrudPage.jsx';
import FormFields from '../components/FormFields.jsx';
import { useToast } from '../components/Toast.jsx';
import { EmptyRow, ErrorBox, Loading, PageHeader } from '../components/ui.jsx';
import { dateTime } from '../format.js';
import { useApi } from '../hooks.js';

export function Team() {
  const { roles, user } = useAuth();
  return (
    <CrudPage config={{
      title: 'Team & Roles', singular: 'Team member', icon: 'fa-user-shield', endpoint: '/users',
      subtitle: 'Each person logs in with their own email and only sees what their role allows.',
      searchKeys: ['name', 'email', 'role_label'],
      defaults: () => ({ role: 'sales', is_active: true }),
      columns: [
        {
          key: 'name', label: 'Name',
          render: (r) => <span className="fw-semibold">{r.name}{r.id === user.id && <span className="text-muted fw-normal"> (you)</span>}</span>,
        },
        { key: 'email', label: 'Email' },
        { key: 'role_label', label: 'Role' },
        {
          key: 'is_active', label: 'Status',
          render: (r) => <span className={`badge text-bg-${r.is_active ? 'success' : 'secondary'}`}>{r.is_active ? 'Active' : 'Deactivated'}</span>,
        },
        { key: 'last_login', label: 'Last login', render: (r) => (r.last_login ? dateTime(r.last_login) : 'Never') },
      ],
      fields: [
        { name: 'name', label: 'Full name', required: true },
        { name: 'email', label: 'Email (used to log in)', type: 'email', required: true },
        { name: 'role', label: 'Role', type: 'select', required: true, options: roles },
        { name: 'password', label: 'Password', type: 'password', help: 'At least 8 characters. Leave blank to keep the current password.' },
        { name: 'is_active', label: 'Active (can log in)', type: 'checkbox' },
      ],
      toPayload: (v) => {
        const body = { ...v };
        if (!body.password) delete body.password;
        return body;
      },
    }} />
  );
}

const COMPANY_FIELDS = [
  { name: 'name', label: 'Company name', required: true, col: 12 },
  { name: 'phone', label: 'Phone number(s)' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'address', label: 'Address', type: 'textarea', col: 12, help: 'Printed on quotations, invoices and receipts.' },
  { name: 'banking_details', label: 'Banking details', type: 'textarea', rows: 4, col: 12, help: 'Printed at the bottom of quotations and invoices.' },
  { name: 'currency', label: 'Main currency', placeholder: 'USD' },
];

export function CompanySettings() {
  const { company, refresh } = useAuth();
  const notify = useToast();
  const [values, setValues] = useState(null);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);

  useEffect(() => {
    if (company) setValues(Object.fromEntries(COMPANY_FIELDS.map((f) => [f.name, company[f.name] ?? ''])));
  }, [company]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put('/company', values);
      await refresh();
      notify('Company profile saved');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const pickLogo = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) { notify('Please choose a PNG or JPEG image.', 'error'); return; }
    if (file.size > 1000000) { notify('The logo is too big (1 MB at most).', 'error'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      setLogoBusy(true);
      try {
        await api.put('/company/logo', { image: reader.result });
        await refresh();
        notify('Logo saved. It now appears on your quotations, invoices and receipts.');
      } catch (err) {
        notify(err.message, 'error');
      } finally {
        setLogoBusy(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const removeLogo = async () => {
    setLogoBusy(true);
    try {
      await api.del('/company/logo');
      await refresh();
      notify('Logo removed');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setLogoBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Company Profile" icon="fa-building" subtitle="These details appear on your documents." />
      <div className="card mb-3"><div className="card-body d-flex flex-wrap align-items-center gap-3">
        {company?.has_logo
          ? <img src={`/api/company/logo?v=${company.logo_v}`} alt="Company logo" style={{ height: 80, width: 80, objectFit: 'contain' }} />
          : <div className="d-flex align-items-center justify-content-center bg-light text-muted rounded" style={{ height: 80, width: 80 }}><i className="fas fa-image fa-lg" /></div>}
        <div className="flex-grow-1">
          <div className="fw-semibold">Company logo</div>
          <div className="small text-muted">PNG or JPEG, up to 1 MB. Printed at the top of quotations, invoices and receipts.</div>
        </div>
        <label className={`btn btn-outline-primary mb-0 ${logoBusy ? 'disabled' : ''}`}>
          {logoBusy ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="fas fa-upload me-2" />}
          {company?.has_logo ? 'Change logo' : 'Upload logo'}
          <input type="file" accept="image/png,image/jpeg" hidden onChange={pickLogo} disabled={logoBusy} />
        </label>
        {company?.has_logo && <button type="button" className="btn btn-outline-danger" onClick={removeLogo} disabled={logoBusy}>Remove</button>}
      </div></div>
      <div className="card"><div className="card-body">
        {!values ? <Loading /> : (
          <form onSubmit={save}>
            <FormFields fields={COMPANY_FIELDS} values={values} onChange={setValues} />
            <div className="text-end mt-4">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving && <span className="spinner-border spinner-border-sm me-2" />}Save
              </button>
            </div>
          </form>
        )}
      </div></div>
    </>
  );
}

const ACTIONS = { POST: ['Created / did', 'success'], PUT: ['Changed', 'primary'], PATCH: ['Changed', 'primary'], DELETE: ['Deleted', 'danger'] };

export function ActivityLog() {
  const { data: rows, loading, error, reload } = useApi('/audit-log', []);
  return (
    <>
      <PageHeader title="Activity Log" icon="fa-clock-rotate-left" subtitle="Every change made in your company account: who, what and when.">
        <button type="button" className="btn btn-outline-secondary" onClick={reload}><i className="fas fa-rotate me-2" />Refresh</button>
      </PageHeader>
      <ErrorBox error={error} onRetry={reload} />
      <div className="card"><div className="table-responsive">
        <table className="table table-hover align-middle mb-0">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th></tr></thead>
          <tbody>
            {loading && !rows?.length ? <tr><td colSpan={4}><Loading /></td></tr>
              : !rows?.length ? <EmptyRow colSpan={4} text="Nothing recorded yet." />
                : rows.map((r) => {
                  const [label, color] = ACTIONS[r.action] || [r.action, 'secondary'];
                  return (
                    <tr key={r.id}>
                      <td className="text-nowrap">{dateTime(r.date_created)}</td>
                      <td>{r.user_name}</td>
                      <td><span className={`badge text-bg-${color}`}>{label}</span></td>
                      <td><code>{r.path.replace(/^\/api\//, '')}</code></td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div></div>
    </>
  );
}

export function Account() {
  const { user, company } = useAuth();
  const notify = useToast();
  const [values, setValues] = useState({ current_password: '', password: '' });
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/auth/password', values);
      setValues({ current_password: '', password: '' });
      notify('Password changed. Other devices have been logged out.');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="My Account" icon="fa-user" />
      <div className="card mb-4"><div className="card-body">
        <div className="fw-semibold">{user.name}</div>
        <div className="text-muted">{user.email}</div>
        <div className="text-muted small mt-1">{user.role_label} at {company.name}</div>
      </div></div>
      <div className="card"><div className="card-body">
        <h2 className="h6 mb-3">Change password</h2>
        <form onSubmit={save}>
          <FormFields
            fields={[
              { name: 'current_password', label: 'Current password', type: 'password', required: true },
              { name: 'password', label: 'New password', type: 'password', required: true, help: 'At least 8 characters.' },
            ]}
            values={values} onChange={setValues} />
          <div className="text-end mt-4">
            <button type="submit" className="btn btn-primary" disabled={saving}>Change password</button>
          </div>
        </form>
      </div></div>
    </>
  );
}
