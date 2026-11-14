import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { toDateInput, toDateTimeInput } from '../format.js';
import { useApi } from '../hooks.js';
import FormFields from './FormFields.jsx';
import Modal from './Modal.jsx';
import { useToast } from './Toast.jsx';
import { useAuth } from '../auth.jsx';
import { EmptyRow, ErrorBox, IconButton, Loading, PageHeader, SearchBox } from './ui.jsx';

/*
 * Generic list + create/edit/delete page.
 *
 * config = {
 *   title, icon, endpoint, singular,
 *   idKey = 'id',
 *   columns: [{ key, label, render?(row), className? }],
 *   fields: [...] | (rows) => [...],   // see FormFields
 *   defaults: () => ({...}),           // initial values for a new record
 *   searchKeys: ['name', ...],
 *   summary?: (rows) => JSX,
 *   rowActions?: (row, reload) => JSX,
 *   canEdit = true,
 *   toPayload?: (values, editing) => body,
 * }
 */
export default function CrudPage({ config }) {
  const {
    title, icon, endpoint, singular, idKey = 'id', columns, searchKeys = [], summary, rowActions,
    canEdit = true, defaults = () => ({}), toPayload, subtitle, deleteWarning,
  } = config;
  const notify = useToast();
  const writable = useAuth().canWrite(endpoint);
  const { data: rows, loading, error, reload } = useApi(endpoint, []);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // null | { values, id? }
  const [saving, setSaving] = useState(false);

  const fields = typeof config.fields === 'function' ? config.fields(rows || []) : config.fields;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows || [];
    return (rows || []).filter((r) => searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(q)));
  }, [rows, search, searchKeys]);

  const openNew = () => setEditing({ values: defaults() });
  const openEdit = (row) => {
    const values = {};
    for (const f of fields) {
      const v = row[f.name];
      if (f.type === 'date') values[f.name] = toDateInput(v);
      else if (f.type === 'datetime-local') values[f.name] = toDateTimeInput(v);
      else if (f.type === 'checkbox') values[f.name] = !!v;
      else values[f.name] = v ?? '';
    }
    setEditing({ id: row[idKey], values });
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = toPayload
        ? toPayload(editing.values, editing.id !== undefined)
        : Object.fromEntries(Object.entries(editing.values).map(([k, v]) => [k, v === '' ? null : v]));
      if (editing.id !== undefined) {
        await api.put(`${endpoint}/${encodeURIComponent(editing.id)}`, body);
        notify(`${singular} updated successfully`);
      } else {
        await api.post(endpoint, body);
        notify(`${singular} added successfully`);
      }
      setEditing(null);
      reload();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    const msg = `Delete this ${singular.toLowerCase()}?${deleteWarning ? `\n\n${deleteWarning}` : ''}`;
    if (!window.confirm(msg)) return;
    try {
      await api.del(`${endpoint}/${encodeURIComponent(row[idKey])}`);
      notify(`${singular} deleted`);
      reload();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <>
      <PageHeader title={title} icon={icon} subtitle={subtitle}>
        {searchKeys.length > 0 && <SearchBox value={search} onChange={setSearch} />}
        {writable && (
          <button type="button" className="btn btn-primary" onClick={openNew}>
            <i className="fas fa-plus me-2" />Add {singular}
          </button>
        )}
      </PageHeader>

      {summary && rows && summary(rows)}
      <ErrorBox error={error} onRetry={reload} />

      <div className="card">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead>
              <tr>
                {columns.map((c) => <th key={c.key} className={c.className}>{c.label}</th>)}
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && !rows?.length ? (
                <tr><td colSpan={columns.length + 1}><Loading /></td></tr>
              ) : filtered.length === 0 ? (
                <EmptyRow colSpan={columns.length + 1} />
              ) : (
                filtered.map((row) => (
                  <tr key={row[idKey]}>
                    {columns.map((c) => (
                      <td key={c.key} className={c.className}>{c.render ? c.render(row) : (row[c.key] ?? '—')}</td>
                    ))}
                    <td className="text-end text-nowrap">
                      <div className="btn-group">
                        {rowActions?.(row, reload)}
                        {writable && canEdit && <IconButton icon="fa-pen" title="Edit" variant="outline-primary" onClick={() => openEdit(row)} />}
                        {writable && <IconButton icon="fa-trash" title="Delete" variant="outline-danger" onClick={() => remove(row)} />}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <Modal title={`${editing.id !== undefined ? 'Edit' : 'Add'} ${singular}`} onClose={() => setEditing(null)} size="lg">
          <form id="crud-form" onSubmit={save}>
            <FormFields
              fields={fields.map((f) => (f.lockOnEdit && editing.id !== undefined ? { ...f, disabled: true } : f))}
              values={editing.values}
              onChange={(values) => setEditing((e) => ({ ...e, values }))} />
          </form>
          <div className="d-flex justify-content-end gap-2 mt-4">
            <button type="button" className="btn btn-light" onClick={() => setEditing(null)}>Cancel</button>
            <button type="submit" form="crud-form" className="btn btn-primary" disabled={saving}>
              {saving && <span className="spinner-border spinner-border-sm me-2" />}Save
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
