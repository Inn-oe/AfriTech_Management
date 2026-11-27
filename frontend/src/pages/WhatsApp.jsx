import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
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

const PAGE_SIZE = 20;

const dayLabel = (iso) => {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

/** The chat: opens at the newest message, shows the latest 20 and loads 20 earlier ones on request. */
function Conversation({ messages }) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const box = useRef(null);
  const total = messages.length;
  const shown = messages.slice(Math.max(0, total - visible));
  const earlier = total - shown.length;

  // Jump to the newest message when the chat opens or a new message arrives (not when older ones are revealed).
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [total]);

  return (
    <div ref={box} className="border rounded-3 p-2" style={{ maxHeight: 'min(60vh, 520px)', overflowY: 'auto', background: '#f8fafb' }}>
      {total === 0 && <div className="text-muted small p-2">No messages stored.</div>}
      {earlier > 0 && (
        <div className="text-center my-2">
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
            <i className="fas fa-clock-rotate-left me-1" />Show {Math.min(PAGE_SIZE, earlier)} earlier messages ({earlier} not shown)
          </button>
        </div>
      )}
      {shown.map((m, i) => {
        const newDay = i === 0 || new Date(shown[i - 1].created).toDateString() !== new Date(m.created).toDateString();
        return (
          <Fragment key={`${m.created}-${i}`}>
            {newDay && <div className="text-center my-2"><span className="badge text-bg-light border text-muted fw-normal">{dayLabel(m.created)}</span></div>}
            <div className={`d-flex ${m.direction === 'in' ? '' : 'justify-content-end'}`}>
              <div className="my-1 px-3 py-2 rounded-3 small" style={{ maxWidth: '82%', whiteSpace: 'pre-wrap', background: m.direction === 'in' ? '#e9edf1' : m.sender === 'staff' ? '#dfeefb' : '#dcf3e8' }}>
                <div className="text-muted" style={{ fontSize: '0.68rem' }}>{m.direction === 'in' ? 'Client' : m.sender === 'staff' ? 'Staff' : 'Bot'} · {dateTime(m.created)}</div>
                {m.text}
              </div>
            </div>
          </Fragment>
        );
      })}
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

      <h3 className="h6 mt-3">Conversation <span className="text-muted fw-normal small">({data.messages.length} message{data.messages.length === 1 ? '' : 's'})</span></h3>
      <Conversation messages={data.messages} />
      {canEdit && <ReplyBox c={c} who={who} onSent={() => { reload(); onSaved(); }} />}


      <div className="row g-3 mt-3">
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

    </>
  );
}

const SORTS = [['attention', 'Needs attention first'], ['newest', 'Newest message first'], ['name', 'Name A to Z']];

/** People who chatted with the WhatsApp bot, rated hot / warm / cold with advice on what to do next. */
export default function WhatsApp() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useApi('/whatsapp/clients');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('');            // '' = everyone, hot / warm / cold, or 'due' = follow-ups due
  const [stage, setStage] = useState('');
  const [sort, setSort] = useState('attention');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [open, setOpen] = useState(null);

  const clients = data?.clients || [];
  const live = clients.filter((c) => !['won', 'lost'].includes(c.stage));
  const count = (t) => live.filter((c) => c.temperature === t).length;
  const dueCount = clients.filter((c) => c.follow_up_due).length;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = clients.filter((c) => (!tab || (tab === 'due' ? c.follow_up_due : c.temperature === tab)) && (!stage || c.stage === stage)
      && (!q || [c.name, c.who, c.signals.need, c.signals.location, c.signals.recommended, c.notes].some((v) => String(v || '').toLowerCase().includes(q))));
    if (sort === 'newest') return [...list].sort((a, b) => String(b.last_inbound || '').localeCompare(String(a.last_inbound || '')));
    if (sort === 'name') return [...list].sort((a, b) => label(a).localeCompare(label(b)));
    return list;                                  // the server already puts follow-ups due and the hottest first
  }, [clients, search, tab, stage, sort]);

  useEffect(() => setShown(PAGE_SIZE), [search, tab, stage, sort]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const tabs = [['', 'All', clients.length], ['hot', 'Hot', count('hot')], ['warm', 'Warm', count('warm')], ['cold', 'Cold', count('cold')], ['due', 'Follow-ups due', dueCount]];
  const visibleRows = rows.slice(0, shown);

  return (
    <>
      <PageHeader title="WhatsApp Potential Clients" subtitle="Everyone who chatted with your WhatsApp bot, rated by what they did, with advice on how to handle them.">
        <button type="button" className="btn btn-outline-secondary" onClick={reload}><i className="fas fa-rotate me-2" />Refresh</button>
      </PageHeader>

      <div className="row g-3 mb-4">
        <div className="col-sm-6 col-xl-3"><StatCard label="People chatted" value={clients.length} icon="fa-comments" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Hot leads" value={count('hot')} icon="fa-fire" color="danger" hint={count('hot') ? 'Contact them first' : undefined} tone="bad" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Warm leads" value={count('warm')} icon="fa-sun" color="warning" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Follow-ups due" value={dueCount} icon="fa-bell" color="info" /></div>
      </div>

      {data && !data.connected && (
        <div className="alert alert-info">No chats have been stored yet. Once someone messages your WhatsApp number, they appear here.</div>
      )}

      <div className="row g-3">
        <div className={`col-lg-5 ${open ? 'd-none d-lg-block' : ''}`}>
          <div className="card">
            <div className="card-body pb-2">
              <div className="d-flex flex-wrap gap-1 mb-2" role="tablist" aria-label="Show">
                {tabs.map(([key, name, n]) => (
                  <button key={key || 'all'} type="button" role="tab" aria-selected={tab === key}
                    className={`btn btn-sm ${tab === key ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setTab(key)}>
                    {name} <span className={`badge ${tab === key ? 'text-bg-light' : 'text-bg-secondary'} ms-1`}>{n}</span>
                  </button>
                ))}
              </div>
              <input className="form-control mb-2" placeholder="Search name, number, need…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
              <div className="d-flex gap-2">
                <select className="form-select form-select-sm" value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">
                  <option value="">All stages</option>{(data?.stages || []).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="form-select form-select-sm" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
                  {SORTS.map(([k, name]) => <option key={k} value={k}>{name}</option>)}
                </select>
              </div>
              <div className="small text-muted mt-2">{rows.length ? `Showing ${visibleRows.length} of ${rows.length}` : ''}</div>
            </div>
            <div style={{ maxHeight: '62vh', overflowY: 'auto', borderTop: '1px solid var(--line)' }}>
              {rows.length === 0 && <div className="text-muted text-center py-5 small">{clients.length ? 'No clients match the filters.' : 'No one has chatted yet.'}</div>}
              {visibleRows.map((c) => (
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
              {rows.length > shown && (
                <div className="p-3 text-center">
                  <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => setShown((n) => n + PAGE_SIZE)}>
                    Show {Math.min(PAGE_SIZE, rows.length - shown)} more ({rows.length - shown} not shown)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className={`col-lg-7 ${open ? '' : 'd-none d-lg-block'}`}>
          <div className="card"><div className="card-body">
            {open && <button type="button" className="btn btn-sm btn-light mb-3 d-lg-none" onClick={() => setOpen(null)}><i className="fas fa-arrow-left me-2" />All clients</button>}
            {open ? <Detail key={open} who={open} stages={data?.stages || []} canEdit={can('customers', 'write')} onSaved={reload} />
              : <div className="text-muted text-center py-5">Select a client to see why they are rated, what to do next, and their chat.</div>}
          </div></div>
        </div>
      </div>
    </>
  );
}
