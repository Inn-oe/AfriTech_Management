// Master admin portal (platform owner only): companies and their subscriptions, the plans you sell, and the
// shops and sellers you source products from.
import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import Modal from '../components/Modal.jsx';
import { SHOP_TRADES } from '../components/PublicSite.jsx';
import { useToast } from '../components/Toast.jsx';
import { ErrorBox, Loading, PageHeader, SearchBox, StatCard } from '../components/ui.jsx';
import { date, money } from '../format.js';
import { useApi } from '../hooks.js';

const STATUS = {
  active: ['success', 'Active'], renews_soon: ['info', 'Renews soon'], overdue: ['danger', 'Overdue'],
  suspended: ['dark', 'Suspended'], no_plan: ['secondary', 'No plan'],
};
const METHODS = [['CASH', 'Cash'], ['ECOCASH', 'EcoCash'], ['TRANSFER', 'Bank transfer'], ['OTHER', 'Other']];
const tradeLabel = (k) => SHOP_TRADES.find((t) => t.key === k)?.label || k;
const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- Companies & subscriptions
export function MasterCompanies() {
  const overview = useApi('/master/overview');
  const { data, loading, error, reload } = useApi('/master/companies');
  const [tab, setTab] = useState('');
  const [q, setQ] = useState('');
  const [managing, setManaging] = useState(null);
  const [paying, setPaying] = useState(null);
  const notify = useToast();
  const confirm = useConfirm();

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.companies || []).filter((c) => (!tab || c.status === tab || (tab === 'active' && c.status === 'renews_soon'))
      && (!term || [c.name, c.owner_email, c.plan_name].some((v) => String(v || '').toLowerCase().includes(term))));
  }, [data, tab, q]);

  const refresh = () => { reload(); overview.reload(); };
  const setActive = async (c, active) => {
    const ok = active || await confirm(`Suspend ${c.name}? Nobody in the company can sign in until you reactivate it. Their data is kept.`, { title: 'Suspend company', confirmLabel: 'Suspend', tone: 'danger' });
    if (!ok) return;
    try {
      await api.patch(`/master/companies/${c.id}`, { is_active: active });
      notify(active ? `${c.name} reactivated` : `${c.name} suspended`);
      refresh();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const o = overview.data;
  const tabs = [['', 'All'], ['active', 'Active'], ['overdue', 'Overdue'], ['no_plan', 'No plan'], ['suspended', 'Suspended']];
  return (
    <>
      <PageHeader title="Companies & subscriptions" icon="fa-building-user" subtitle="Every company using the platform, its plan, when it renews, and who is overdue." />
      {o && (
        <div className="row g-3 mb-3">
          <div className="col-6 col-xl-2"><StatCard label="Companies" value={o.companies} icon="fa-building" /></div>
          <div className="col-6 col-xl-2"><StatCard label="Active" value={o.active} icon="fa-circle-check" color="success" /></div>
          <div className="col-6 col-xl-2"><StatCard label="Overdue" value={o.overdue} icon="fa-clock" color="danger" tone={o.overdue ? 'bad' : ''} /></div>
          <div className="col-6 col-xl-2"><StatCard label="No plan" value={o.no_plan} icon="fa-circle-question" color="secondary" /></div>
          <div className="col-6 col-xl-2"><StatCard label="Monthly income" value={money(o.monthly_recurring)} icon="fa-rotate" /></div>
          <div className="col-6 col-xl-2"><StatCard label="Collected this month" value={money(o.collected_this_month)} icon="fa-money-bill-wave" color="info" /></div>
        </div>
      )}
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        {tabs.map(([key, name]) => (
          <button key={key || 'all'} type="button" className={`btn btn-sm ${tab === key ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setTab(key)}>{name}</button>
        ))}
        <div className="ms-auto" style={{ minWidth: 240 }}><SearchBox value={q} onChange={setQ} placeholder="Search company, email or plan" /></div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : (
        <div className="card"><div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead><tr><th>Company</th><th>Plan</th><th>Renews</th><th>Status</th><th>Last payment</th><th /></tr></thead>
            <tbody>
              {rows.map((c) => {
                const [cls, label] = STATUS[c.status] || ['secondary', c.status];
                return (
                  <tr key={c.id} className={c.is_active ? '' : 'opacity-75'}>
                    <td><strong>{c.name}</strong><div className="small text-muted">{c.owner_email || 'no owner'} · {c.users} user{c.users === 1 ? '' : 's'}{c.max_users ? ` of ${c.max_users}` : ''}</div></td>
                    <td>{c.plan_name ? <>{c.plan_name}<div className="small text-muted">{money(c.monthly_price)} / month</div></> : <span className="text-muted">None</span>}</td>
                    <td>{c.renews_on ? date(c.renews_on) : '—'}</td>
                    <td><span className={`badge text-bg-${cls}`}>{label}{c.status === 'overdue' ? ` ${c.days_overdue} day${c.days_overdue === 1 ? '' : 's'}` : ''}</span></td>
                    <td className="small">{c.last_payment ? <>{money(c.last_payment.amount)}<div className="text-muted">{date(c.last_payment.paid_on)}</div></> : '—'}</td>
                    <td className="text-end text-nowrap">
                      <button type="button" className="btn btn-sm btn-success me-1" onClick={() => setPaying(c)} disabled={!c.plan_id} title={c.plan_id ? 'Record a payment' : 'Choose a plan first'}><i className="fas fa-money-bill-wave me-1" />Payment</button>
                      <button type="button" className="btn btn-sm btn-outline-primary me-1" onClick={() => setManaging(c)}><i className="fas fa-sliders me-1" />Manage</button>
                      {c.is_active
                        ? <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setActive(c, false)} title="Suspend"><i className="fas fa-ban" /></button>
                        : <button type="button" className="btn btn-sm btn-outline-success" onClick={() => setActive(c, true)} title="Reactivate"><i className="fas fa-rotate-left" /></button>}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan="6" className="text-center text-muted py-4">No companies match.</td></tr>}
            </tbody>
          </table>
        </div></div>
      )}
      {managing && <ManageCompany company={managing} plans={data?.plans || []} onClose={() => setManaging(null)} onSaved={() => { setManaging(null); refresh(); }} />}
      {paying && <RecordPayment company={paying} onClose={() => setPaying(null)} onSaved={() => { setPaying(null); refresh(); }} />}
    </>
  );
}

function ManageCompany({ company, plans, onClose, onSaved }) {
  const notify = useToast();
  const history = useApi(`/master/companies/${company.id}/payments`);
  const [v, setV] = useState({ plan_id: company.plan_id ?? '', renews_on: company.renews_on || '', notes: company.notes || '' });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/master/companies/${company.id}`, { plan_id: v.plan_id === '' ? null : Number(v.plan_id), renews_on: v.renews_on || null, notes: v.notes });
      notify('Saved');
      onSaved();
    } catch (err) {
      notify(err.message, 'error');
      setBusy(false);
    }
  };
  return (
    <Modal title={company.name} size="lg" onClose={onClose}>
      <form onSubmit={save} className="row g-3">
        <div className="col-sm-6">
          <label className="form-label small fw-semibold" htmlFor="mc-plan">Plan</label>
          <select id="mc-plan" className="form-select" value={v.plan_id} onChange={(e) => setV({ ...v, plan_id: e.target.value })}>
            <option value="">No plan</option>
            {plans.filter((p) => p.is_active || p.id === company.plan_id).map((p) => <option key={p.id} value={p.id}>{p.name} ({money(p.monthly_price)}/month)</option>)}
          </select>
        </div>
        <div className="col-sm-6">
          <label className="form-label small fw-semibold" htmlFor="mc-renew">Paid up to (renewal date)</label>
          <input id="mc-renew" type="date" className="form-control" value={v.renews_on} onChange={(e) => setV({ ...v, renews_on: e.target.value })} />
        </div>
        <div className="col-12">
          <label className="form-label small fw-semibold" htmlFor="mc-notes">Notes (only you see these)</label>
          <textarea id="mc-notes" rows="2" className="form-control" maxLength={500} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} placeholder="e.g. Agreed a discount until March" />
        </div>
        <div className="col-12 text-end"><button type="submit" className="btn btn-primary" disabled={busy}>Save</button></div>
      </form>
      <h3 className="h6 mt-4">Payments received</h3>
      {history.loading && !history.data ? <Loading /> : (
        <table className="table table-sm">
          <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th className="text-end">Months</th><th className="text-end">Amount</th></tr></thead>
          <tbody>
            {(history.data?.payments || []).map((p) => <tr key={p.id}><td>{date(p.paid_on)}</td><td>{p.method}</td><td>{p.reference || '—'}</td><td className="text-end">{p.months}</td><td className="text-end">{money(p.amount)}</td></tr>)}
            {!history.data?.payments?.length && <tr><td colSpan="5" className="text-muted text-center py-2">No payments yet.</td></tr>}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

function RecordPayment({ company, onClose, onSaved }) {
  const notify = useToast();
  const [v, setV] = useState({ months: 1, amount: company.monthly_price || '', method: 'CASH', reference: '', paid_on: today(), notes: '', reactivate: !company.is_active });
  const [busy, setBusy] = useState(false);
  const setMonths = (months) => setV((x) => ({ ...x, months, amount: company.monthly_price ? Math.round(company.monthly_price * (Number(months) || 1) * 100) / 100 : x.amount }));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post(`/master/companies/${company.id}/payments`, { ...v, months: Number(v.months), amount: Number(v.amount) });
      notify(`Payment recorded. ${company.name} is paid up to ${date(res.renews_on)}.`);
      onSaved();
    } catch (err) {
      notify(err.message, 'error');
      setBusy(false);
    }
  };
  return (
    <Modal title={`Record payment: ${company.name}`} onClose={onClose}>
      <form onSubmit={save} className="row g-3">
        <div className="col-12 small text-muted">Plan: <strong>{company.plan_name}</strong> ({money(company.monthly_price)} a month). Paid up to {company.renews_on ? date(company.renews_on) : 'nothing yet'}.</div>
        <div className="col-sm-4">
          <label className="form-label small fw-semibold" htmlFor="rp-months">Months paid</label>
          <input id="rp-months" type="number" min="1" max="60" className="form-control" required value={v.months} onChange={(e) => setMonths(e.target.value)} />
        </div>
        <div className="col-sm-4">
          <label className="form-label small fw-semibold" htmlFor="rp-amount">Amount ($)</label>
          <input id="rp-amount" type="number" min="0.01" step="0.01" className="form-control" required value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        </div>
        <div className="col-sm-4">
          <label className="form-label small fw-semibold" htmlFor="rp-date">Date received</label>
          <input id="rp-date" type="date" className="form-control" required value={v.paid_on} onChange={(e) => setV({ ...v, paid_on: e.target.value })} />
        </div>
        <div className="col-sm-6">
          <label className="form-label small fw-semibold" htmlFor="rp-method">Paid by</label>
          <select id="rp-method" className="form-select" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </div>
        <div className="col-sm-6">
          <label className="form-label small fw-semibold" htmlFor="rp-ref">Reference</label>
          <input id="rp-ref" className="form-control" maxLength={100} value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} placeholder="EcoCash or bank reference" />
        </div>
        {!company.is_active && (
          <div className="col-12 form-check ms-2"><input id="rp-react" className="form-check-input" type="checkbox" checked={v.reactivate} onChange={(e) => setV({ ...v, reactivate: e.target.checked })} /><label className="form-check-label" htmlFor="rp-react">Reactivate this company (it is suspended)</label></div>
        )}
        <div className="col-12 d-flex justify-content-end gap-2">
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-success" disabled={busy}>Record payment</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Plans
export function MasterPlans() {
  const { data, loading, error, reload } = useApi('/master/plans');
  const notify = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(null);

  const remove = async (p) => {
    if (!(await confirm(`Delete the ${p.name} plan?`, { tone: 'danger', confirmLabel: 'Delete' }))) return;
    try {
      await api.del(`/master/plans/${p.id}`);
      reload();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  const toggle = async (p) => { await api.patch(`/master/plans/${p.id}`, { is_active: !p.is_active }); reload(); };

  return (
    <>
      <PageHeader title="Plans" icon="fa-tags" subtitle="The plans you sell. A plan sets the monthly price and how many team members a company can add.">
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ name: '', monthly_price: '', max_users: '', notes: '' })}><i className="fas fa-plus me-2" />New plan</button>
      </PageHeader>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : (
        <div className="card"><div className="table-responsive">
          <table className="table align-middle mb-0">
            <thead><tr><th>Plan</th><th className="text-end">Per month</th><th className="text-end">Team members</th><th className="text-end">Companies</th><th>Notes</th><th /></tr></thead>
            <tbody>
              {(data?.plans || []).map((p) => (
                <tr key={p.id} className={p.is_active ? '' : 'opacity-50'}>
                  <td><strong>{p.name}</strong>{!p.is_active && <span className="badge text-bg-secondary ms-2">Off</span>}</td>
                  <td className="text-end">{money(p.monthly_price)}</td>
                  <td className="text-end">{p.max_users || 'No limit'}</td>
                  <td className="text-end">{p.companies}</td>
                  <td className="small text-muted">{p.notes}</td>
                  <td className="text-end text-nowrap">
                    <button type="button" className="btn btn-sm btn-link" onClick={() => setEditing({ ...p, max_users: p.max_users ?? '' })} title="Edit"><i className="fas fa-pen" /></button>
                    <button type="button" className="btn btn-sm btn-link" onClick={() => toggle(p)} title={p.is_active ? 'Switch off' : 'Switch on'}><i className={`fas ${p.is_active ? 'fa-eye-slash' : 'fa-eye'}`} /></button>
                    <button type="button" className="btn btn-sm btn-link text-danger" onClick={() => remove(p)} title="Delete"><i className="fas fa-trash" /></button>
                  </td>
                </tr>
              ))}
              {!data?.plans?.length && <tr><td colSpan="6" className="text-center text-muted py-4">No plans yet. Add one, then give it to a company.</td></tr>}
            </tbody>
          </table>
        </div></div>
      )}
      {editing && <PlanForm plan={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function PlanForm({ plan, onClose, onSaved }) {
  const notify = useToast();
  const [v, setV] = useState(plan);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = { name: v.name, monthly_price: Number(v.monthly_price || 0), max_users: v.max_users === '' ? null : Number(v.max_users), notes: v.notes || '' };
    try {
      if (plan.id) await api.patch(`/master/plans/${plan.id}`, body);
      else await api.post('/master/plans', body);
      onSaved();
    } catch (err) {
      notify(err.message, 'error');
      setBusy(false);
    }
  };
  return (
    <Modal title={plan.id ? 'Edit plan' : 'New plan'} onClose={onClose}>
      <form onSubmit={save} className="row g-3">
        <div className="col-12"><label className="form-label small fw-semibold" htmlFor="pl-name">Plan name</label><input id="pl-name" className="form-control" required maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Starter" /></div>
        <div className="col-sm-6"><label className="form-label small fw-semibold" htmlFor="pl-price">Price per month ($)</label><input id="pl-price" type="number" min="0" step="0.01" className="form-control" required value={v.monthly_price} onChange={(e) => setV({ ...v, monthly_price: e.target.value })} /></div>
        <div className="col-sm-6"><label className="form-label small fw-semibold" htmlFor="pl-users">Team members allowed</label><input id="pl-users" type="number" min="1" className="form-control" value={v.max_users} placeholder="No limit" onChange={(e) => setV({ ...v, max_users: e.target.value })} /></div>
        <div className="col-12"><label className="form-label small fw-semibold" htmlFor="pl-notes">Notes</label><input id="pl-notes" className="form-control" maxLength={300} value={v.notes || ''} onChange={(e) => setV({ ...v, notes: e.target.value })} /></div>
        <div className="col-12 d-flex justify-content-end gap-2"><button type="button" className="btn btn-light" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Supplier shops
export function MasterSuppliers() {
  const { data, loading, error, reload } = useApi('/master/suppliers');
  const notify = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.suppliers || []).filter((s) => !term || [s.name, s.contact, s.town, s.phone, s.notes, ...s.supplies.map(tradeLabel)].some((v) => String(v || '').toLowerCase().includes(term)));
  }, [data, q]);

  const toggleStar = async (s) => { await api.patch(`/master/suppliers/${s.id}`, { recommended: !s.recommended }); reload(); };
  const remove = async (s) => {
    if (!(await confirm(`Delete ${s.name} from your suppliers?`, { tone: 'danger', confirmLabel: 'Delete' }))) return;
    try {
      await api.del(`/master/suppliers/${s.id}`);
      reload();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <>
      <PageHeader title="Supplier shops" icon="fa-shop" subtitle="The shops and sellers you source products from. Mark the ones you recommend. Use their names when you add a seller's price to a product.">
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ name: '', contact: '', phone: '', email: '', town: '', website: '', supplies: [], notes: '', recommended: false })}><i className="fas fa-plus me-2" />Add a supplier</button>
      </PageHeader>
      <div className="mb-3" style={{ maxWidth: 320 }}><SearchBox value={q} onChange={setQ} placeholder="Search suppliers" /></div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : (
        <div className="card"><div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead><tr><th style={{ width: 40 }} /><th>Shop or seller</th><th>Contact</th><th>Supplies</th><th>Notes</th><th /></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={s.is_active ? '' : 'opacity-50'}>
                  <td><button type="button" className="btn btn-sm btn-link" onClick={() => toggleStar(s)} title={s.recommended ? 'Stop recommending' : 'Recommend'}><i className={`${s.recommended ? 'fas text-warning' : 'far text-muted'} fa-star`} /></button></td>
                  <td><strong>{s.name}</strong><div className="small text-muted">{s.town}{s.website && <>{s.town ? ' · ' : ''}<a href={s.website} target="_blank" rel="noreferrer">website</a></>}</div></td>
                  <td className="small">{s.contact && <div>{s.contact}</div>}{s.phone && <div><a href={`tel:${s.phone}`}>{s.phone}</a></div>}{s.email && <div>{s.email}</div>}</td>
                  <td>{s.supplies.map((t) => <span key={t} className="badge text-bg-light border me-1">{tradeLabel(t)}</span>)}</td>
                  <td className="small text-muted">{s.notes}</td>
                  <td className="text-end text-nowrap">
                    <button type="button" className="btn btn-sm btn-link" onClick={() => setEditing(s)} title="Edit"><i className="fas fa-pen" /></button>
                    <button type="button" className="btn btn-sm btn-link text-danger" onClick={() => remove(s)} title="Delete"><i className="fas fa-trash" /></button>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan="6" className="text-center text-muted py-4">{data?.suppliers?.length ? 'No suppliers match.' : 'No suppliers yet. Add the shops and sellers you buy from.'}</td></tr>}
            </tbody>
          </table>
        </div></div>
      )}
      {editing && <SupplierForm supplier={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function SupplierForm({ supplier, onClose, onSaved }) {
  const notify = useToast();
  const [v, setV] = useState(supplier);
  const [busy, setBusy] = useState(false);
  const toggleTrade = (key) => setV((x) => ({ ...x, supplies: x.supplies.includes(key) ? x.supplies.filter((t) => t !== key) : [...x.supplies, key] }));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { id, is_active: _a, ...body } = v;
    try {
      if (id) await api.patch(`/master/suppliers/${id}`, body);
      else await api.post('/master/suppliers', body);
      onSaved();
    } catch (err) {
      notify(err.message, 'error');
      setBusy(false);
    }
  };
  const field = (k, label, props = {}) => (
    <div className={props.col || 'col-12'}>
      <label className="form-label small fw-semibold" htmlFor={`su-${k}`}>{label}</label>
      <input id={`su-${k}`} className="form-control" value={v[k] || ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} {...{ ...props, col: undefined }} />
    </div>
  );
  return (
    <Modal title={supplier.id ? 'Edit supplier' : 'Add a supplier'} size="lg" onClose={onClose}>
      <form onSubmit={save} className="row g-3">
        {field('name', 'Shop or seller name', { required: true, maxLength: 120, placeholder: 'e.g. Electrosales or Mr Dube (Harare)' })}
        {field('contact', 'Contact person', { col: 'col-sm-6', maxLength: 100 })}
        {field('phone', 'Phone / WhatsApp', { col: 'col-sm-6', maxLength: 60 })}
        {field('email', 'Email', { col: 'col-sm-6', type: 'email', maxLength: 120 })}
        {field('town', 'Town', { col: 'col-sm-6', maxLength: 80 })}
        {field('website', 'Website (optional)', { type: 'url', maxLength: 300, placeholder: 'https://' })}
        <div className="col-12">
          <div className="form-label small fw-semibold mb-1">What they supply</div>
          <div className="d-flex flex-wrap gap-2">
            {SHOP_TRADES.map((t) => (
              <label key={t.key} className={`btn btn-sm ${v.supplies.includes(t.key) ? 'btn-primary' : 'btn-outline-secondary'} mb-0`}>
                <input type="checkbox" hidden checked={v.supplies.includes(t.key)} onChange={() => toggleTrade(t.key)} />{t.label}
              </label>
            ))}
          </div>
        </div>
        <div className="col-12"><label className="form-label small fw-semibold" htmlFor="su-notes">Notes</label><textarea id="su-notes" rows="2" className="form-control" maxLength={500} value={v.notes || ''} onChange={(e) => setV({ ...v, notes: e.target.value })} placeholder="Prices, delivery, how reliable they are" /></div>
        <div className="col-12 form-check ms-2"><input id="su-rec" className="form-check-input" type="checkbox" checked={!!v.recommended} onChange={(e) => setV({ ...v, recommended: e.target.checked })} /><label className="form-check-label" htmlFor="su-rec">We recommend this supplier</label></div>
        <div className="col-12 d-flex justify-content-end gap-2"><button type="button" className="btn btn-light" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}
