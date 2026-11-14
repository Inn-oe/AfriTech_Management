import { useEffect, useMemo, useRef, useState } from 'react';

// Searchable customer selector (name, surname, ID or phone).
export default function CustomerPicker({ customers, value, onChange, required }) {
  const selected = customers.find((c) => c.identification_number === value);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const close = (e) => boxRef.current && !boxRef.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? customers.filter((c) => [c.full_name, c.identification_number, c.phone, c.email]
        .some((v) => String(v ?? '').toLowerCase().includes(q)))
      : customers;
    return list.slice(0, 50);
  }, [customers, query]);

  if (selected && !open) {
    return (
      <div className="d-flex align-items-center gap-2 border rounded px-3 py-2 bg-light">
        <i className="fas fa-user text-primary" />
        <div className="flex-grow-1">
          <div className="fw-semibold">{selected.full_name}</div>
          <div className="small text-muted">ID {selected.identification_number}{selected.phone ? ` · ${selected.phone}` : ''}</div>
        </div>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { setQuery(''); setOpen(true); }}>Change</button>
      </div>
    );
  }

  return (
    <div className="position-relative" ref={boxRef}>
      <input className="form-control" placeholder="Search customer by name, ID or phone…" value={query} autoFocus={open}
        required={required && !selected} onFocus={() => setOpen(true)} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} />
      {open && (
        <div className="list-group position-absolute w-100 shadow mt-1 overflow-auto" style={{ zIndex: 20, maxHeight: 280 }}>
          {matches.length === 0 && <div className="list-group-item text-muted small">No customers match “{query}”.</div>}
          {matches.map((c) => (
            <button type="button" key={c.identification_number} className="list-group-item list-group-item-action"
              onClick={() => { onChange(c.identification_number); setOpen(false); }}>
              <div className="fw-semibold">{c.full_name}</div>
              <div className="small text-muted">ID {c.identification_number}{c.phone ? ` · ${c.phone}` : ''}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
