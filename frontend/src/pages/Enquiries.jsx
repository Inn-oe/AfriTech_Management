import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toast.jsx';
import { ErrorBox, Loading, PageHeader, StatCard } from '../components/ui.jsx';
import { useApi } from '../hooks.js';
import { initials } from '../nav.js';
import { Detail, ago, label } from './WhatsApp.jsx';

const PRIORITY = {
  urgent: { label: 'Urgent', cls: 'danger', rank: 3 },
  high: { label: 'High', cls: 'warning', rank: 2 },
  medium: { label: 'Medium', cls: 'primary', rank: 1 },
  low: { label: 'Low', cls: 'secondary', rank: 0 },
};
const CATEGORY = {
  purchase: { label: 'Wants to buy', icon: 'fa-cart-shopping', cls: 'success' },
  enquiry: { label: 'Enquiry', icon: 'fa-circle-question', cls: 'info' },
  maintenance: { label: 'Maintenance', icon: 'fa-screwdriver-wrench', cls: 'dark' },
};
const STAGES = ['new', 'contacted', 'quoted', 'survey booked', 'won', 'lost'];

const PriorityBadge = ({ p }) => <span className={`badge text-bg-${PRIORITY[p]?.cls || 'secondary'}`}>{PRIORITY[p]?.label || p}</span>;
const CategoryBadge = ({ c }) => (
  <span className={`badge text-bg-${CATEGORY[c]?.cls || 'secondary'}`}><i className={`fas ${CATEGORY[c]?.icon} me-1`} />{CATEGORY[c]?.label || c}</span>
);

/** One enquiry of the selected customer, with controls to re-rate it or mark it handled. */
function EnquiryCard({ e, canEdit, onChanged }) {
  const notify = useToast();
  const patch = async (changes) => {
    try {
      await api.patch(`/whatsapp/enquiries/${e.id}`, changes);
      onChanged();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  return (
    <div className={`border rounded-3 p-3 mb-2 ${e.status === 'handled' ? 'bg-light' : ''}`}>
      <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
        <div className="d-flex gap-2 flex-wrap align-items-center"><CategoryBadge c={e.category} /><PriorityBadge p={e.priority} />
          {e.existing_customer && <span className="badge text-bg-light border">Existing customer</span>}
          {e.status === 'handled' && <span className="badge text-bg-success">Handled{e.handled_by ? ` by ${e.handled_by}` : ''}</span>}</div>
        <span className="text-muted small">{ago(e.updated)} · {e.message_count} message{e.message_count === 1 ? '' : 's'}</span>
      </div>
      <div className="mt-2 fw-semibold">{e.summary || e.last_text}</div>
      {e.last_text && e.last_text !== e.summary && <div className="small text-muted mt-1">Last said: “{e.last_text}”</div>}
      {e.reasons.length > 0 && <div className="small mt-1"><b>Why this priority:</b> {e.reasons.join(' · ')}</div>}
      {canEdit && (
        <div className="d-flex gap-2 flex-wrap mt-2">
          <select className="form-select form-select-sm w-auto" value={e.priority} onChange={(ev) => patch({ priority: ev.target.value })} aria-label="Priority">
            {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label} priority</option>)}
          </select>
          <select className="form-select form-select-sm w-auto" value={e.category} onChange={(ev) => patch({ category: ev.target.value })} aria-label="Category">
            {Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          {e.status === 'open'
            ? <button type="button" className="btn btn-sm btn-success" onClick={() => patch({ status: 'handled' })}><i className="fas fa-check me-1" />Mark handled</button>
            : <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => patch({ status: 'open' })}>Reopen</button>}
        </div>
      )}
    </div>
  );
}

/** Customers who wrote to the bot, with what each one wants (buy / enquire / maintenance) and how urgent it is. */
export default function Enquiries() {
  const { can } = useAuth();
  const [status, setStatus] = useState('open');
  const { data, loading, error, reload } = useApi(`/whatsapp/enquiries?status=${status}`);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [open, setOpen] = useState(null);
  const canEdit = can('customers', 'write');

  // one row per customer: all their enquiries, most urgent first
  const customers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map();
    (data?.enquiries || []).forEach((e) => {
      if (category && e.category !== category) return;
      if (priority && e.priority !== priority) return;
      if (q && ![e.name, e.who, e.phone, e.summary, e.last_text].some((v) => String(v || '').toLowerCase().includes(q))) return;
      if (!map.has(e.who)) map.set(e.who, { who: e.who, name: e.name, phone: e.phone, is_whatsapp: e.is_whatsapp, existing: e.existing_customer, enquiries: [] });
      map.get(e.who).enquiries.push(e);
    });
    const list = [...map.values()].map((c) => ({
      ...c,
      top: Math.max(...c.enquiries.map((e) => PRIORITY[e.priority]?.rank ?? 0)),
      updated: c.enquiries.map((e) => e.updated).sort().slice(-1)[0],
    }));
    return list.sort((a, b) => b.top - a.top || String(b.updated).localeCompare(String(a.updated)));
  }, [data, search, category, priority]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const counts = data?.counts || {};
  const selected = customers.find((c) => c.who === open);

  return (
    <>
      <PageHeader title="Customer Enquiries" subtitle="What each customer wrote to your WhatsApp bot about: buying a system, asking a question or needing maintenance, most urgent first.">
        <button type="button" className="btn btn-outline-secondary" onClick={reload}><i className="fas fa-rotate me-2" />Refresh</button>
      </PageHeader>

      <div className="row g-3 mb-4">
        <div className="col-sm-6 col-xl-3"><StatCard label="Urgent" value={counts.urgent || 0} icon="fa-triangle-exclamation" color="danger" hint={counts.urgent ? 'Needs a call now' : undefined} tone="bad" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Want to buy" value={counts.purchase || 0} icon="fa-cart-shopping" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Maintenance" value={counts.maintenance || 0} icon="fa-screwdriver-wrench" color="warning" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="General enquiries" value={counts.enquiry || 0} icon="fa-circle-question" color="info" /></div>
      </div>

      {data && !data.connected && <div className="alert alert-info">No enquiries yet. They appear here as soon as customers message your WhatsApp number.</div>}

      <div className="d-flex flex-wrap gap-2 mb-3">
        <input className="form-control" style={{ maxWidth: 260 }} placeholder="Search customer or message…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        <select className="form-select w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All types</option>{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="form-select w-auto" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
          <option value="">All priorities</option>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="form-select w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setOpen(null); }} aria-label="Status">
          <option value="open">Open</option><option value="handled">Handled</option><option value="all">All</option>
        </select>
      </div>

      <div className="row g-3">
        <div className="col-lg-5">
          <div className="card"><div style={{ maxHeight: '72vh', overflowY: 'auto' }}>
            {customers.length === 0 && <div className="text-muted text-center py-5 small">Nothing here. {status === 'open' ? 'All caught up.' : ''}</div>}
            {customers.map((c) => (
              <button key={c.who} type="button" onClick={() => setOpen(c.who)}
                className={`d-block w-100 text-start border-0 border-bottom p-3 ${open === c.who ? 'bg-light' : 'bg-white'}`}>
                <div className="d-flex justify-content-between align-items-center gap-2">
                  <span className="d-flex align-items-center gap-2 min-w-0">
                    <span className="avatar soft" style={{ width: 32, height: 32, fontSize: '0.7rem' }}>{initials(label(c))}</span>
                    <b className="text-truncate">{label(c)}</b>
                    {c.existing && <span className="badge text-bg-light border">Customer</span>}
                  </span>
                  <PriorityBadge p={Object.keys(PRIORITY).find((k) => PRIORITY[k].rank === c.top)} />
                </div>
                {c.enquiries.map((e) => (
                  <div key={e.id} className="d-flex gap-2 align-items-start mt-2">
                    <CategoryBadge c={e.category} />
                    <span className="small flex-grow-1" style={{ opacity: e.status === 'handled' ? 0.55 : 1 }}>{e.summary || e.last_text}</span>
                    {e.priority !== Object.keys(PRIORITY).find((k) => PRIORITY[k].rank === c.top) && <PriorityBadge p={e.priority} />}
                  </div>
                ))}
                <div className="small text-muted mt-2">last activity {ago(c.updated)}</div>
              </button>
            ))}
          </div></div>
        </div>
        <div className="col-lg-7">
          <div className="card"><div className="card-body">
            {selected ? (
              <>
                <h2 className="h6 mb-3">Enquiries from {label(selected)}</h2>
                {selected.enquiries.map((e) => <EnquiryCard key={e.id} e={e} canEdit={canEdit} onChanged={reload} />)}
                <hr />
                <Detail key={selected.who} who={selected.who} stages={STAGES} canEdit={canEdit} onSaved={reload} />
              </>
            ) : <div className="text-muted text-center py-5">Select a customer to see what they want, why it is rated this way, and the whole chat. You can reply to them from here.</div>}
          </div></div>
        </div>
      </div>
    </>
  );
}
