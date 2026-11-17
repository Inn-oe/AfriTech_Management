import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toast.jsx';
import { ErrorBox, Loading, PageHeader, StatCard } from '../components/ui.jsx';
import { dateTime } from '../format.js';
import { useApi } from '../hooks.js';
import { initials } from '../nav.js';

const TEMP = {
  hot: { label: 'Hot', cls: 'danger' },
  warm: { label: 'Warm', cls: 'warning' },
  cold: { label: 'Cold', cls: 'secondary' },
};

export const ago = (iso) => {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 0)} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
};

export const label = (c) => c.name || (c.who.startsWith('web:') ? `Website visitor ${c.who.slice(4, 10)}` : `+${c.who}`);
const Temp = ({ t }) => <span className={`badge text-bg-${TEMP[t].cls}`}>{TEMP[t].label}</span>;

// Ready-made starting points for common replies; staff edit them before sending.
function quickReplies(c, me) {
  const first = (c.name || '').split(' ')[0];
  const hi = first ? `Hi ${first}, ` : 'Hi, ';
  const s = c.signals || {};
  const want = s.need || s.recommended || s.package;
  const asked = (s.unanswered || []).slice(-1)[0];
  return [
    asked && { label: 'Answer question', text: `${hi}this is ${me}. Thanks for your question about "${asked}". ` },
    { label: 'Book site visit', text: `${hi}this is ${me}. To give you an accurate price${want ? ` for ${want}` : ''}, we offer a free site visit. Which day and time suits you this week${s.location ? ` in ${s.location}` : ''}?` },
    { label: 'Quote is ready', text: `${hi}your quotation${want ? ` for ${want}` : ''} is ready. Can I send it here? It includes all equipment, installation and warranty details.` },
    { label: 'Follow up', text: `${hi}just checking in on the solar quotation we sent. Do you have any questions, or would you like to book the installation?` },
    { label: 'Ask budget', text: `${hi}this is ${me}. So we can recommend the right system, roughly what budget do you have in mind, and which appliances matter most during power cuts?` },
  ].filter(Boolean);
}

function ReplyBox({ c, who, onSent }) {
  const notify = useToast();
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const me = (user?.name || '').split(' ')[0] || 'the team';

  if (!c.is_whatsapp) return <div className="text-muted small mt-2">Website visitor: contact them on the number they gave{c.signals.contact ? ` (${c.signals.contact})` : ''}.</div>;
  if (!c.window_open) {
    return (
      <div className="alert alert-warning small mt-2 mb-0">
        Their last message is over 24 hours old, so WhatsApp only allows approved template messages. Call them, or use <b>Open in WhatsApp</b> from the business phone.
      </div>
    );
  }
  const send = async () => {
    setSending(true);
    try {
      await api.post(`/whatsapp/clients/${encodeURIComponent(who)}/reply`, { text });
      setText('');
      notify('Sent on WhatsApp');
      onSent();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="mt-2">
      <div className="d-flex flex-wrap gap-1 mb-2">
        {quickReplies(c, me).map((q) => (
          <button key={q.label} type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setText(q.text)}>{q.label}</button>
        ))}
      </div>
      <textarea className="form-control" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)}
        placeholder="Write a reply. It is sent from your business WhatsApp number." aria-label="Reply" />
      <div className="d-flex justify-content-between align-items-center mt-2 gap-2 flex-wrap">
        <span className="text-muted small">Pause the bot above while you are chatting, so it does not answer for you.</span>
        <button type="button" className="btn btn-primary" onClick={send} disabled={sending || !text.trim()}>
          {sending ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="fab fa-whatsapp me-2" />}Send
        </button>
      </div>
    </div>
  );
}

export function Detail({ who, stages, canEdit, onSaved }) {
  const notify = useToast();
  const { data, loading, error, reload } = useApi(`/whatsapp/clients/${encodeURIComponent(who)}`);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const c = data?.client;

  useEffect(() => {
    if (c) setForm({ stage: c.stage, follow_up: c.follow_up, assigned: c.assigned, notes: c.notes, bot_paused: c.bot_paused });
  }, [c]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!c || !form) return null;
  const digits = c.is_whatsapp ? c.who.replace(/\D/g, '') : String(c.signals.contact || '').replace(/\D/g, '');

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/whatsapp/clients/${encodeURIComponent(who)}`, form);
      notify('Saved');
      onSaved();
      reload();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  return (
    <>
      <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
        <div className="d-flex align-items-center gap-3">
          <span className="avatar soft" style={{ width: 44, height: 44 }}>{initials(label(c))}</span>
          <div>
            <h2 className="panel-title">{label(c)}</h2>
            <div className="panel-sub">{c.is_whatsapp ? `WhatsApp +${c.who}` : 'Website chat'} · {c.inbound_count} messages · first seen {dateTime(c.first_seen)}</div>
          </div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <Temp t={c.temperature} /><span className="badge text-bg-secondary">score {c.score}</span>
          {digits && <a className="btn btn-sm btn-outline-primary" href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer"><i className="fas fa-up-right-from-square me-1" />Open in WhatsApp</a>}
        </div>
      </div>

      <div className="note-bar mt-3"><i className="fas fa-bolt" /><span><b>What to do next:</b> {c.next_action}</span></div>

      <div className="row g-3 mt-1">
        <div className="col-md-6">
          <div className="fw-semibold small mb-1">Why this rating</div>
          {c.reasons.length === 0 ? <div className="text-muted small">No buying signals yet.</div> : (
            <ul className="small ps-3 mb-0">{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          )}
        </div>
        <div className="col-md-6">
          <div className="fw-semibold small mb-1">Quote requests</div>
          {data.requests.length === 0 ? <div className="text-muted small">None yet.</div> : (
            <ul className="small ps-3 mb-0">
              {data.requests.map((r) => (
                <li key={r.created + r.kind}>{dateTime(r.created)}: {r.kind === 'callback' ? 'asked for a call' : (r.need || 'quote')}{r.location ? ` in ${r.location}` : ''}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-sm-6">
          <label className="form-label small fw-semibold" htmlFor="wa-stage">Stage</label>
          <select id="wa-stage" className="form-select" value={form.stage} onChange={set('stage')} disabled={!canEdit}>
            {stages.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="col-sm-6">
          <label className="form-label small fw-semibold" htmlFor="wa-follow">Follow-up date</label>
          <input id="wa-follow" type="date" className="form-control" value={form.follow_up} onChange={set('follow_up')} disabled={!canEdit} />
        </div>
        <div className="col-12">
          <label className="form-label small fw-semibold" htmlFor="wa-owner">Handled by</label>
          <input id="wa-owner" className="form-control" value={form.assigned} onChange={set('assigned')} placeholder="Who is handling this?" disabled={!canEdit} />
        </div>
        <div className="col-12">
          <label className="form-label small fw-semibold" htmlFor="wa-notes">Notes</label>
          <textarea id="wa-notes" rows={3} className="form-control" value={form.notes} onChange={set('notes')} placeholder="e.g. Wants 5kW, budget $3,000, call after 5pm" disabled={!canEdit} />
        </div>
        <div className="col-12 d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div className="form-check form-switch">
            <input className="form-check-input" type="checkbox" id="wa-pause" checked={form.bot_paused} onChange={set('bot_paused')} disabled={!canEdit} />
            <label className="form-check-label small" htmlFor="wa-pause">Pause the bot (a person is handling this chat)</label>
          </div>
          {canEdit && <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving && <span className="spinner-border spinner-border-sm me-2" />}Save</button>}
        </div>
      </div>

      <h3 className="h6 mt-4">Conversation</h3>
      <div className="border rounded-3 p-2" style={{ maxHeight: 340, overflowY: 'auto', background: '#f8fafb' }}>
        {data.messages.length === 0 && <div className="text-muted small p-2">No messages stored.</div>}
        {data.messages.map((m, i) => (
          <div key={i} className={`d-flex ${m.direction === 'in' ? '' : 'justify-content-end'}`}>
            <div className="my-1 px-3 py-2 rounded-3 small" style={{ maxWidth: '82%', whiteSpace: 'pre-wrap', background: m.direction === 'in' ? '#e9edf1' : m.sender === 'staff' ? '#dfeefb' : '#dcf3e8' }}>
              <div className="text-muted" style={{ fontSize: '0.68rem' }}>{m.direction === 'in' ? 'Client' : m.sender === 'staff' ? 'Staff' : 'Bot'} · {dateTime(m.created)}</div>
              {m.text}
            </div>
          </div>
        ))}
      </div>
      {canEdit && <ReplyBox c={c} who={who} onSent={() => { reload(); onSaved(); }} />}
    </>
  );
}

/** People who chatted with the WhatsApp bot, rated hot / warm / cold with advice on what to do next. */
export default function WhatsApp() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useApi('/whatsapp/clients');
  const [search, setSearch] = useState('');
  const [temp, setTemp] = useState('');
  const [stage, setStage] = useState('');
  const [dueOnly, setDueOnly] = useState(false);
  const [open, setOpen] = useState(null);

  const clients = data?.clients || [];
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => (!temp || c.temperature === temp) && (!stage || c.stage === stage) && (!dueOnly || c.follow_up_due)
      && (!q || [c.name, c.who, c.signals.need, c.signals.location, c.signals.recommended, c.notes].some((v) => String(v || '').toLowerCase().includes(q))));
  }, [clients, search, temp, stage, dueOnly]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const live = clients.filter((c) => !['won', 'lost'].includes(c.stage));
  const count = (t) => live.filter((c) => c.temperature === t).length;

  return (
    <>
      <PageHeader title="WhatsApp Potential Clients" subtitle="Everyone who chatted with your WhatsApp bot, rated by what they did, with advice on how to handle them.">
        <button type="button" className="btn btn-outline-secondary" onClick={reload}><i className="fas fa-rotate me-2" />Refresh</button>
      </PageHeader>

      <div className="row g-3 mb-4">
        <div className="col-sm-6 col-xl-3"><StatCard label="People chatted" value={clients.length} icon="fa-comments" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Hot leads" value={count('hot')} icon="fa-fire" color="danger" hint={count('hot') ? 'Contact them first' : undefined} tone="bad" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Warm leads" value={count('warm')} icon="fa-sun" color="warning" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Follow-ups due" value={clients.filter((c) => c.follow_up_due).length} icon="fa-bell" color="info" /></div>
      </div>

      {data && !data.connected && (
        <div className="alert alert-info">No chats have been stored yet. Once someone messages your WhatsApp number, they appear here.</div>
      )}

      <div className="d-flex flex-wrap gap-2 mb-3">
        <input className="form-control" style={{ maxWidth: 280 }} placeholder="Search name, number, need…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        <select className="form-select w-auto" value={temp} onChange={(e) => setTemp(e.target.value)} aria-label="Temperature">
          <option value="">All temperatures</option><option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
        </select>
        <select className="form-select w-auto" value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">
          <option value="">All stages</option>{(data?.stages || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="form-check d-flex align-items-center gap-2 ms-1">
          <input className="form-check-input mt-0" type="checkbox" id="due" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} />
          <label className="form-check-label small" htmlFor="due">Follow-ups due</label>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-5">
          <div className="card"><div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            {rows.length === 0 && <div className="text-muted text-center py-5 small">{clients.length ? 'No clients match the filters.' : 'No one has chatted yet.'}</div>}
            {rows.map((c) => (
              <button key={c.who} type="button" onClick={() => setOpen(c.who)}
                className={`d-block w-100 text-start border-0 border-bottom p-3 ${open === c.who ? 'bg-light' : 'bg-white'}`}>
                <div className="d-flex justify-content-between align-items-center gap-2">
                  <span className="d-flex align-items-center gap-2 min-w-0">
                    <span className="avatar soft" style={{ width: 32, height: 32, fontSize: '0.7rem' }}>{initials(label(c))}</span>
                    <b className="text-truncate">{label(c)}</b>
                  </span>
                  <Temp t={c.temperature} />
                </div>
                <div className="small text-muted mt-1">{c.stage} · score {c.score} · last message {ago(c.last_inbound)}{c.bot_paused ? ' · bot paused' : ''}</div>
                <div className="progress mt-1"><div className="progress-bar" style={{ width: `${c.score}%` }} /></div>
                {c.follow_up_due && <div className="small text-danger fw-semibold mt-1">Follow-up due {c.follow_up}</div>}
                <div className="small mt-1">{c.next_action.split(' Note:')[0]}</div>
              </button>
            ))}
          </div></div>
        </div>
        <div className="col-lg-7">
          <div className="card"><div className="card-body">
            {open ? <Detail key={open} who={open} stages={data?.stages || []} canEdit={can('customers', 'write')} onSaved={reload} />
              : <div className="text-muted text-center py-5">Select a client to see why they are rated, what to do next, and their chat.</div>}
          </div></div>
        </div>
      </div>
    </>
  );
}
