import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, pdfUrl } from '../api.js';
import { BarChart, DoughnutChart, PALETTE, TrendChart } from '../components/Charts.jsx';
import FormFields from '../components/FormFields.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { EmptyRow, ErrorBox, IconButton, Loading, PageHeader, StatCard, StatusBadge } from '../components/ui.jsx';
import { date, money, today } from '../format.js';
import { useApi } from '../hooks.js';
import { useEnum } from '../meta.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function Financial() {
  const notify = useToast();
  const confirm = useConfirm();
  const types = useEnum('financial_type');
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [record, setRecord] = useState(null);
  const { data, loading, error, reload } = useApi(`/financial/summary?month=${month}&year=${year}`);
  const { data: categories } = useApi('/financial-categories', []);

  const years = Array.from({ length: 7 }, (_, i) => now.getFullYear() - 5 + i);
  const period = `month=${month}&year=${year}`;

  const categoryOptions = (categories || [])
    .filter((c) => c.is_active !== false && (!record?.type || c.type === record.type))
    .map((c) => ({ value: c.name, label: c.name }));

  const saveRecord = async (e) => {
    e.preventDefault();
    try {
      await api.post('/financial-records', record);
      notify('Financial record added');
      setRecord(null);
      reload();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const removeRecord = async (r) => {
    if (!(await confirm(`Delete "${r.description || r.category}" (${money(r.amount)})?`))) return;
    try {
      await api.del(`/financial-records/${r.id}`);
      notify('Record deleted');
      reload();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const k = data?.kpis;

  return (
    <>
      <PageHeader title="Financial Overview" icon="fa-chart-line" subtitle="Accrual basis — revenue is counted when invoiced">
        <select className="form-select w-auto" value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month">
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select className="form-select w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
          {years.map((y) => <option key={y}>{y}</option>)}
        </select>
        <div className="btn-group">
          <a className="btn btn-outline-secondary" href={pdfUrl(`/financial/income-statement.pdf?${period}`)}><i className="fas fa-file-pdf me-2" />Income statement</a>
          <a className="btn btn-outline-secondary" href={pdfUrl(`/financial/balance-sheet.pdf?${period}`)}><i className="fas fa-file-pdf me-2" />Balance sheet</a>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setRecord({ type: 'EXPENSE', date: today() })}>
          <i className="fas fa-plus me-2" />Add record
        </button>
      </PageHeader>

      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="row g-3 mb-4">
            <div className="col-sm-6 col-xl-3"><StatCard label="Revenue (invoiced)" value={money(k.revenue)} icon="fa-file-invoice-dollar" color="primary" hint={`${money(k.collected)} collected`} /></div>
            <div className="col-sm-6 col-xl-3"><StatCard label="Gross profit" value={money(k.gross_profit)} icon="fa-scale-balanced" color="info" hint={`COGS ${money(k.cogs)}`} /></div>
            <div className="col-sm-6 col-xl-3"><StatCard label="Expenses" value={money(k.expenses)} icon="fa-arrow-trend-down" color="danger" hint={`Other income ${money(k.other_income)}`} /></div>
            <div className="col-sm-6 col-xl-3"><StatCard label="Net profit" value={money(k.net_profit)} icon="fa-sack-dollar" color={k.net_profit >= 0 ? 'success' : 'danger'} /></div>
          </div>

          <div className="row g-3 mb-4">
            <div className="col-lg-8">
              <div className="card h-100">
                <div className="card-header">Revenue vs expenses — {year}</div>
                <div className="card-body">
                  <TrendChart labels={data.monthly_trend.map((m) => m.month)} series={[
                    { label: 'Revenue', data: data.monthly_trend.map((m) => m.revenue), color: PALETTE[0] },
                    { label: 'Expenses', data: data.monthly_trend.map((m) => m.expenses), color: PALETTE[7] },
                  ]} />
                </div>
              </div>
            </div>
            <div className="col-lg-4">
              <div className="card h-100">
                <div className="card-header">Income by source</div>
                <div className="card-body"><DoughnutChart items={data.income_by_source} isMoney /></div>
              </div>
            </div>
          </div>

          <div className="row g-3 mb-4">
            <div className="col-lg-4">
              <div className="card h-100">
                <div className="card-header">Income by activity</div>
                <div className="card-body"><DoughnutChart items={data.income_by_activity} isMoney /></div>
              </div>
            </div>
            <div className="col-lg-4">
              <div className="card h-100">
                <div className="card-header">Expense breakdown</div>
                <div className="card-body"><DoughnutChart items={data.expense_breakdown} isMoney /></div>
              </div>
            </div>
            <div className="col-lg-4">
              <div className="card h-100">
                <div className="card-header">Top selling items</div>
                <div className="card-body"><BarChart items={data.top_items} label="Revenue" horizontal /></div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header d-flex justify-content-between align-items-center">
              Income & expense records — {MONTHS[month - 1]} {year}
              <Link to="/financial-categories" className="small">Manage categories</Link>
            </div>
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th>Vendor</th><th className="text-end">Amount</th><th /></tr></thead>
                <tbody>
                  {data.recent_records.length === 0 && <EmptyRow colSpan={7} text="No records for this month." />}
                  {data.recent_records.map((r) => (
                    <tr key={r.id}>
                      <td>{date(r.date)}</td>
                      <td><StatusBadge value={r.type} /></td>
                      <td>{r.category || '—'}</td>
                      <td>{r.description || '—'}</td>
                      <td>{r.vendor_supplier || '—'}</td>
                      <td className={`text-end fw-semibold ${r.type === 'EXPENSE' ? 'text-danger' : 'text-success'}`}>
                        {r.type === 'EXPENSE' ? '-' : '+'}{money(r.amount)}
                      </td>
                      <td className="text-end"><IconButton icon="fa-trash" title="Delete" variant="outline-danger" onClick={() => removeRecord(r)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {record && (
        <Modal title="Add financial record" onClose={() => setRecord(null)}>
          <form id="fin-form" onSubmit={saveRecord}>
            <FormFields values={record} onChange={setRecord} fields={[
              { name: 'type', label: 'Type', type: 'select', options: types, required: true },
              { name: 'date', label: 'Date', type: 'date', required: true },
              categoryOptions.length
                ? { name: 'category', label: 'Category', type: 'select', options: categoryOptions, required: true, help: 'Not listed? Add it under Settings → Financial Categories.' }
                : { name: 'category', label: 'Category', required: true, help: 'Tip: define reusable categories under Settings → Financial Categories' },
              { name: 'amount', label: 'Amount', type: 'number', min: 0, step: 0.01, required: true },
              { name: 'description', label: 'Description', col: 12, required: true },
              { name: 'vendor_supplier', label: 'Vendor / payee' },
              { name: 'receipt_number', label: 'Receipt number' },
              { name: 'notes', label: 'Notes', type: 'textarea', col: 12, rows: 2 },
            ]} />
          </form>
          <div className="d-flex justify-content-end gap-2 mt-4">
            <button type="button" className="btn btn-light" onClick={() => setRecord(null)}>Cancel</button>
            <button type="submit" form="fin-form" className="btn btn-primary">Save</button>
          </div>
        </Modal>
      )}
    </>
  );
}
