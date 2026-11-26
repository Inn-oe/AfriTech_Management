import { useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import { date, money } from '../format.js';

// Same day of the month `n` months later; a short month gives its last day (31 Jan + 1 month = 28 Feb).
function addMonths(d, n) {
  const total = d.getMonth() + n;
  const year = d.getFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(d.getDate(), last));
}

const toInput = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Equal monthly instalments of `balance`, the last one absorbing the rounding. Mirrors the server. */
export function schedule(balance, months, first) {
  const base = Math.floor((balance * 100) / months) / 100;
  return Array.from({ length: months }, (_, i) => ({
    due: addMonths(first, i),
    amount: i === months - 1 ? Math.round((balance - base * (months - 1)) * 100) / 100 : base,
  }));
}

/**
 * Asks how long the customer will take to pay what is still owed, in monthly instalments.
 *   balance: the amount still owed; onSave({ months, start_date }); onCancel() closes it (no plan).
 */
export default function PaymentPlanModal({ balance, hasPlan = false, onSave, onCancel, busy = false }) {
  const [months, setMonths] = useState('3');
  const [start, setStart] = useState(() => toInput(addMonths(new Date(), 1)));

  const rows = useMemo(() => {
    const n = Number(months);
    const first = new Date(`${start}T00:00:00`);
    if (!Number.isInteger(n) || n < 1 || n > 60 || Number.isNaN(first.getTime())) return [];
    return schedule(balance, n, first);
  }, [balance, months, start]);

  const submit = (e) => {
    e.preventDefault();
    if (rows.length) onSave({ months: Number(months), start_date: start });
  };

  return (
    <Modal title="Payment plan" onClose={busy ? () => {} : onCancel}>
      <form id="plan-form" onSubmit={submit}>
        <p className="mb-3">
          <strong>{money(balance)}</strong> is still owed. Over how many months will the customer pay it? It is split into equal monthly instalments, and
          the invoice is marked <strong>overdue</strong> if an instalment is missed.
        </p>
        <div className="d-flex flex-wrap gap-2 mb-3">
          {[2, 3, 4, 6, 12].map((m) => (
            <button key={m} type="button" className={`btn btn-sm ${Number(months) === m ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setMonths(String(m))}>
              {m} months
            </button>
          ))}
        </div>
        <div className="row g-3">
          <div className="col-sm-6">
            <label className="form-label" htmlFor="plan-months">Number of months</label>
            <input id="plan-months" type="number" min="1" max="60" step="1" className="form-control" required value={months} onChange={(e) => setMonths(e.target.value)} />
          </div>
          <div className="col-sm-6">
            <label className="form-label" htmlFor="plan-start">First instalment due</label>
            <input id="plan-start" type="date" className="form-control" required value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
        </div>

        {rows.length > 0 && (
          <div className="mt-3">
            <div className="small text-muted mb-1">{rows.length} monthly instalment{rows.length > 1 ? 's' : ''}, ending {date(rows[rows.length - 1].due)}</div>
            <div className="table-responsive" style={{ maxHeight: 220 }}>
              <table className="table table-sm mb-0">
                <thead><tr><th>#</th><th>Due date</th><th className="text-end">Amount</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => <tr key={i}><td>{i + 1}</td><td>{date(r.due)}</td><td className="text-end">{money(r.amount)}</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </form>
      <div className="d-flex justify-content-end gap-2 mt-4">
        <button type="button" className="btn btn-light" onClick={onCancel} disabled={busy}>{hasPlan ? 'Cancel' : 'Skip for now'}</button>
        <button type="submit" form="plan-form" className="btn btn-primary" disabled={busy || rows.length === 0}>
          {busy && <span className="spinner-border spinner-border-sm me-2" />}{hasPlan ? 'Save new plan' : 'Set payment plan'}
        </button>
      </div>
    </Modal>
  );
}
