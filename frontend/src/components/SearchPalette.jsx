import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { money } from '../format.js';

/** Ctrl+K search across customers, quotations, invoices and products the user is allowed to see. */
export default function SearchPalette({ onClose }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState([]);
  const [cursor, setCursor] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    ref.current?.focus();
    const load = async (module, url, map) => (can(module) ? api.get(url).then((rows) => rows.map(map)).catch(() => []) : []);
    Promise.all([
      load('customers', '/customers', (c) => ({ kind: 'Customer', title: c.full_name, sub: [c.phone, c.address].filter(Boolean).join(' · '), to: '/customers', key: `${c.identification_number} ${c.full_name} ${c.phone || ''} ${c.email || ''}` })),
      load('sales', '/quotations', (q) => ({ kind: 'Quotation', title: q.quotation_number || `#${q.id}`, sub: `${q.customer?.name || ''} · ${money(q.total_amount)}`, to: `/quotations/${q.id}`, key: `${q.quotation_number} ${q.customer?.name || ''}` })),
      load('sales', '/invoices', (i) => ({ kind: 'Invoice', title: i.invoice_number || `#${i.id}`, sub: `${i.customer?.name || ''} · ${money(i.total_amount)}`, to: `/invoices/${i.id}`, key: `${i.invoice_number} ${i.customer?.name || ''}` })),
      load('inventory', '/inventory', (p) => ({ kind: 'Product', title: p.name, sub: `${p.category || ''} · ${p.quantity} in stock`, to: '/inventory', key: `${p.name} ${p.brand || ''} ${p.category || ''} ${p.specifications || ''}` })),
    ]).then((lists) => setIndex(lists.flat()));
  }, [can]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return index.slice(0, 8);
    return index.filter((r) => `${r.title} ${r.key}`.toLowerCase().includes(q)).slice(0, 20);
  }, [index, query]);

  useEffect(() => setCursor(0), [query]);

  const go = (r) => {
    onClose();
    navigate(r.to);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter' && results[cursor]) go(results[cursor]);
  };

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Search">
        <input ref={ref} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey}
          placeholder="Search customers, quotations, invoices, products…" aria-label="Search" />
        <div className="palette-list">
          {results.length === 0 && <div className="text-muted text-center py-4 small">No matches.</div>}
          {results.map((r, i) => (
            <button type="button" key={`${r.kind}-${r.to}-${r.title}-${i}`} className={`palette-item ${i === cursor ? 'on' : ''}`}
              onClick={() => go(r)} onMouseEnter={() => setCursor(i)}>
              <div className="min-w-0">
                <div className="fw-semibold text-truncate">{r.title}</div>
                <div className="text-muted small text-truncate">{r.sub}</div>
              </div>
              <span className="palette-kind">{r.kind}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
