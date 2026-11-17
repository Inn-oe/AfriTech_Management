import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toast.jsx';
import { ErrorBox, Loading, PageHeader } from '../components/ui.jsx';
import { useApi } from '../hooks.js';

const CAT_LABEL = { purchase: 'Wants to buy', enquiry: 'Enquiry', maintenance: 'Maintenance', other: 'Chit-chat' };
const pct = (v) => `${Math.round((v || 0) * 100)}%`;

/** Status of the model plus the Train now button. Changes to examples only take effect after training. */
function ModelCard({ canEdit, dirty, onTrained }) {
  const notify = useToast();
  const { data, reload } = useApi('/whatsapp/training/status');
  const [busy, setBusy] = useState(false);
  const train = async () => {
    setBusy(true);
    try {
      const info = await api.post('/whatsapp/training/train');
      notify(info.trained ? `Trained on ${info.examples} phrases` : (info.reason || 'Could not train'), info.trained ? 'success' : 'error');
      reload();
      onTrained();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const info = data || {};
  return (
    <div className="card mb-3"><div className="card-body d-flex flex-wrap justify-content-between align-items-center gap-3">
      <div>
        <div className="fw-semibold">Language model {info.connected === false ? <span className="badge text-bg-danger ms-1">bot not reachable</span> : info.trained ? <span className="badge text-bg-success ms-1">trained</span> : <span className="badge text-bg-warning ms-1">not trained</span>}</div>
        <div className="small text-muted">
          {info.trained ? <>{info.model} · {info.backend} · {info.examples} phrases · {info.intents} intents{info.accuracy != null && <> · held-out accuracy <b>{pct(info.accuracy)}</b></>}</> : 'Add example phrases below, then press Train now.'}
          {info.note && <div className="text-warning-emphasis">{info.note}</div>}
        </div>
        {dirty && <div className="small text-warning-emphasis mt-1"><i className="fas fa-circle-exclamation me-1" />You changed examples: press Train now so the bot learns them.</div>}
      </div>
      {canEdit && <button type="button" className="btn btn-primary" onClick={train} disabled={busy}>{busy ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="fas fa-brain me-2" />}Train now</button>}
    </div></div>
  );
}

/** Type a customer message and see exactly how the bot reads it. */
function TryIt() {
  const notify = useToast();
  const [text, setText] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      setRes(await api.post('/whatsapp/training/test', { text }));
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const ents = res ? Object.entries(res.entities || {}) : [];
  return (
    <div className="card"><div className="card-body">
      <h2 className="h6">Test a message</h2>
      <p className="small text-muted">Type something a customer might write, in English, Shona or a mix, and see how the bot understands it.</p>
      <form className="d-flex gap-2" onSubmit={run}>
        <input className="form-control" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. my inverter keeps beeping and no lights" maxLength={500} aria-label="Message to test" />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>{busy ? <span className="spinner-border spinner-border-sm" /> : 'Test'}</button>
      </form>
      {res && (
        <div className="mt-3">
          <div className={`alert ${res.understood ? 'alert-success' : 'alert-warning'} py-2 mb-2`}>
            {res.understood
              ? <>Understood as <b>{res.intent}</b> ({pct(res.confidence)} sure). Category: <b>{CAT_LABEL[res.category]}</b>, priority: <b>{res.priority}</b>.</>
              : <>The bot is <b>not sure</b> (best guess: {res.guess || 'none'}, {pct(res.confidence)}). It would ask the customer to explain, and a second miss goes to your team. Add this message as an example below.</>}
          </div>
          {res.reasons?.length > 0 && <div className="small mb-2"><b>Priority reasons:</b> {res.reasons.join(' · ')}</div>}
          <div className="small mb-2"><b>Details found in the text:</b> {ents.length ? ents.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ') : 'none'}</div>
          <div className="small text-muted"><b>Other guesses:</b> {res.ranked.map(([n, p]) => `${n} ${pct(p)}`).join(', ')}{res.matched && <> · closest example: “{res.matched}”</>}</div>
        </div>
      )}
    </div></div>
  );
}

/** Messages the bot was unsure about. Pick what they meant; they become training examples. */
function Review({ intents, canEdit, onChanged }) {
  const notify = useToast();
  const { data, loading, error, reload } = useApi('/whatsapp/training/unmatched');
  const [choice, setChoice] = useState({});
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const items = data?.items || [];
  const send = async (item, intent) => {
    try {
      await api.post(`/whatsapp/training/unmatched/${item.id}`, { intent });
      notify(intent === 'ignore' ? 'Dismissed' : 'Added as an example. Press Train now to apply.');
      reload();
      onChanged();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  return (
    <div className="card"><div className="card-body">
      <h2 className="h6">Messages the bot was unsure about</h2>
      <p className="small text-muted">This is how the bot gets better. Say what each message meant and it learns from it.</p>
      {items.length === 0 && <div className="text-muted py-4 text-center">Nothing to review.</div>}
      {items.map((it) => (
        <div key={it.id} className="border rounded-3 p-3 mb-2">
          <div className="fw-semibold">“{it.text}”</div>
          <div className="small text-muted">Bot’s guess: {it.guess || 'none'} ({pct(it.confidence)})</div>
          {canEdit && (
            <div className="d-flex flex-wrap gap-2 mt-2">
              <select className="form-select form-select-sm w-auto" value={choice[it.id] || it.guess || ''} onChange={(e) => setChoice((c) => ({ ...c, [it.id]: e.target.value }))} aria-label="What it meant">
                <option value="">What did they mean?</option>
                {intents.map((i) => <option key={i.name} value={i.name}>{i.name} ({CAT_LABEL[i.category]})</option>)}
              </select>
              <button type="button" className="btn btn-sm btn-primary" disabled={!(choice[it.id] || it.guess)} onClick={() => send(it, choice[it.id] || it.guess)}>Save as example</button>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => send(it, 'ignore')}>Ignore</button>
            </div>
          )}
        </div>
      ))}
    </div></div>
  );
}

/** Edit one intent: how the bot reacts, its replies, and the example phrases it learns from. */
function IntentEditor({ intent, meta, canEdit, onSaved, onDeleted, onExamples }) {
  const notify = useToast();
  const isNew = !intent;
  const [form, setForm] = useState(null);
  const [examples, setExamples] = useState([]);
  const [newText, setNewText] = useState('');

  useEffect(() => {
    setForm(intent ? { name: intent.name, category: intent.category, priority: intent.priority, handler: intent.handler, replies: intent.replies.join('\n---\n'), enabled: intent.enabled }
      : { name: '', category: 'enquiry', priority: 'medium', handler: 'reply', replies: '', enabled: true });
    setExamples([]);
    setNewText('');
    if (intent) api.get(`/whatsapp/training/intents/${intent.name}/examples`).then((r) => setExamples(r.examples)).catch(() => {});
  }, [intent?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!form) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async () => {
    try {
      const replies = form.replies.split(/\n-{3,}\n/).map((x) => x.trim()).filter(Boolean);
      await api.put(`/whatsapp/training/intents/${form.name}`, { ...form, replies });
      notify('Saved. Press Train now to apply.');
      onSaved(form.name);
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${form.name}" and all its example phrases?`)) return;
    try {
      await api.del(`/whatsapp/training/intents/${form.name}`);
      onDeleted();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  const addExamples = async () => {
    try {
      const r = await api.post('/whatsapp/training/examples', { intent: form.name, text: newText });
      notify(`${r.added} added${r.skipped ? `, ${r.skipped} already there` : ''}. Press Train now to apply.`);
      setNewText('');
      setExamples((await api.get(`/whatsapp/training/intents/${form.name}/examples`)).examples);
      onExamples();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  const delExample = async (id) => {
    await api.del(`/whatsapp/training/examples/${id}`);
    setExamples((x) => x.filter((e) => e.id !== id));
    onExamples();
  };

  return (
    <div className="card"><div className="card-body">
      <h2 className="h6">{isNew ? 'New intent' : form.name}</h2>
      <div className="row g-2">
        <div className="col-sm-6"><label className="form-label small fw-semibold" htmlFor="in-name">Name</label>
          <input id="in-name" className="form-control" value={form.name} onChange={set('name')} disabled={!isNew || !canEdit} placeholder="e.g. battery_question" /></div>
        <div className="col-sm-3"><label className="form-label small fw-semibold" htmlFor="in-cat">Type</label>
          <select id="in-cat" className="form-select" value={form.category} onChange={set('category')} disabled={!canEdit}>{meta.categories.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}</select></div>
        <div className="col-sm-3"><label className="form-label small fw-semibold" htmlFor="in-pri">Priority</label>
          <select id="in-pri" className="form-select" value={form.priority} onChange={set('priority')} disabled={!canEdit}>{meta.priorities.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        <div className="col-12"><label className="form-label small fw-semibold" htmlFor="in-act">What the bot does</label>
          <select id="in-act" className="form-select" value={form.handler} onChange={set('handler')} disabled={!canEdit}>{Object.entries(meta.handlers).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="col-12"><label className="form-label small fw-semibold" htmlFor="in-rep">Replies {form.handler === 'reply' ? '(required)' : '(optional wording)'}</label>
          <textarea id="in-rep" className="form-control" rows={5} value={form.replies} onChange={set('replies')} disabled={!canEdit}
            placeholder={'Write what the bot should say. Add several versions separated by a line with ---  and it picks one at random so it sounds natural.\nYou can use {first_comma} (", Tendai"), {company}, {phone}, {hours}, {promise}.'} />
        </div>
        <div className="col-12 d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div className="form-check form-switch"><input className="form-check-input" type="checkbox" id="in-on" checked={form.enabled} onChange={set('enabled')} disabled={!canEdit} /><label className="form-check-label small" htmlFor="in-on">Enabled</label></div>
          {canEdit && <div className="d-flex gap-2">{!isNew && <button type="button" className="btn btn-outline-danger" onClick={remove}>Delete</button>}<button type="button" className="btn btn-primary" onClick={save}>Save intent</button></div>}
        </div>
      </div>

      {!isNew && (
        <>
          <hr />
          <h3 className="h6">Example phrases ({examples.length})</h3>
          <p className="small text-muted">The more different ways customers might say this, the better. Mix English, Shona and slang.</p>
          {canEdit && (
            <div className="mb-3">
              <textarea className="form-control" rows={3} value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="One phrase per line" aria-label="New example phrases" />
              <button type="button" className="btn btn-sm btn-primary mt-2" disabled={!newText.trim()} onClick={addExamples}>Add phrases</button>
            </div>
          )}
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {examples.map((e) => (
              <div key={e.id} className="d-flex justify-content-between align-items-center border-bottom py-1 small">
                <span>{e.text} {e.source !== 'seed' && <span className="badge text-bg-light border ms-1">{e.source === 'chat' ? 'from a chat' : e.source === 'csv' ? 'from the Q&A sheet' : 'added by staff'}</span>}</span>
                {canEdit && <button type="button" className="btn btn-sm btn-link text-danger py-0" onClick={() => delExample(e.id)} aria-label="Delete phrase"><i className="fas fa-xmark" /></button>}
              </div>
            ))}
          </div>
        </>
      )}
    </div></div>
  );
}

/** Teach the WhatsApp bot: what customers say, what it means, and how the bot should answer. */
export default function Training() {
  const { can, user } = useAuth();
  const notify = useToast();
  const { data, loading, error, reload } = useApi('/whatsapp/training');
  const [tab, setTab] = useState('intents');
  const [selected, setSelected] = useState(null); // intent name, or '' for a new one
  const [dirty, setDirty] = useState(false);
  const canEdit = can('customers', 'write') && ['owner', 'admin', 'manager'].includes(user?.role);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const intents = data.intents;
  const current = intents.find((i) => i.name === selected);
  const markDirty = () => { setDirty(true); reload(); };

  return (
    <>
      <PageHeader title="Train the bot" subtitle="Teach the WhatsApp assistant what customers mean and how to answer. It learns from the example phrases you give it." />
      {!canEdit && <div className="alert alert-info">You can look around, but only owners, admins and managers can change the bot’s training.</div>}
      <ModelCard canEdit={canEdit} dirty={dirty} onTrained={() => { setDirty(false); reload(); }} />

      <ul className="nav nav-tabs mb-3">
        {[['intents', `What the bot understands (${intents.length})`], ['review', `Review messages${data.unmatched ? ` (${data.unmatched})` : ''}`], ['test', 'Test a message']].map(([k, t]) => (
          <li key={k} className="nav-item"><button type="button" className={`nav-link ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{t}</button></li>
        ))}
      </ul>

      {tab === 'test' && <TryIt />}
      {tab === 'review' && <Review intents={intents} canEdit={canEdit} onChanged={markDirty} />}
      {tab === 'intents' && (
        <div className="row g-3">
          <div className="col-lg-5">
            <div className="card"><div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {canEdit && <button type="button" className="btn btn-outline-primary m-3" onClick={() => setSelected('')}><i className="fas fa-plus me-2" />New intent</button>}
              {intents.map((i) => (
                <button key={i.name} type="button" onClick={() => setSelected(i.name)} className={`d-block w-100 text-start border-0 border-top p-3 ${selected === i.name ? 'bg-light' : 'bg-white'}`}>
                  <div className="d-flex justify-content-between gap-2"><b className="text-truncate">{i.name}{!i.enabled && <span className="badge text-bg-secondary ms-2">off</span>}</b><span className="small text-muted">{i.examples} phrases</span></div>
                  <div className="small text-muted">{CAT_LABEL[i.category]} · {i.priority} priority · {data.handlers[i.handler] || i.handler}</div>
                </button>
              ))}
            </div></div>
          </div>
          <div className="col-lg-7">
            {selected === null ? <div className="card"><div className="card-body text-muted text-center py-5">Pick an intent to edit its replies and example phrases, or add a new one.</div></div>
              : <IntentEditor key={selected || 'new'} intent={current} meta={data} canEdit={canEdit}
                  onSaved={(name) => { setSelected(name); markDirty(); }} onDeleted={() => { setSelected(null); markDirty(); notify('Deleted'); }} onExamples={markDirty} />}
          </div>
        </div>
      )}
    </>
  );
}
