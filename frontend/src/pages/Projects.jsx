import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toast.jsx';
import { ErrorBox, Loading, PageHeader, SearchBox, StatCard } from '../components/ui.jsx';
import { date, money, today } from '../format.js';
import { useApi } from '../hooks.js';

const COLUMNS = [
  { status: 'SCHEDULED', title: 'Scheduled', color: '#9aa8b6', next: 'IN_PROGRESS', action: 'Start job' },
  { status: 'IN_PROGRESS', title: 'In progress', color: '#2c6fbb', next: 'COMPLETED', action: 'Mark complete' },
  { status: 'COMPLETED', title: 'Completed', color: '#0f7b5a' },
];

const weekBounds = () => {
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return [start, new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)];
};

/** Board of installation and service jobs, grouped by their real status. */
export default function Projects() {
  const notify = useToast();
  const { can } = useAuth();
  const { data, loading, error, reload } = useApi('/activities', []);
  const [search, setSearch] = useState('');
  const [tech, setTech] = useState('');

  const jobs = useMemo(() => (data || []).filter((j) => j.status !== 'CANCELLED'), [data]);
  const technicians = useMemo(() => [...new Set(jobs.map((j) => j.technician).filter(Boolean))].sort(), [jobs]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter((j) => (!tech || j.technician === tech)
      && (!q || [j.customer_name, j.description, j.activity_type_name, j.technician].some((v) => String(v ?? '').toLowerCase().includes(q))));
  }, [jobs, search, tech]);

  const [wStart, wEnd] = weekBounds();
  const thisWeek = jobs.filter((j) => j.date && new Date(j.date) >= wStart && new Date(j.date) < wEnd).length;
  const count = (status) => jobs.filter((j) => j.status === status).length;

  const move = async (job, status) => {
    try {
      await api.put(`/activities/${job.id}`, status === 'COMPLETED' ? { status, completed_date: today() } : { status });
      notify(status === 'COMPLETED' ? 'Job marked complete' : 'Job started');
      reload();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <>
      <PageHeader title="Projects & Installations" subtitle="Track every installation and service job from scheduling to completion.">
        <Link to="/activities" className="btn btn-outline-secondary"><i className="fas fa-list me-2" />All jobs</Link>
        {can('operations', 'write') && <Link to="/activities" className="btn btn-primary"><i className="fas fa-plus me-2" />New job</Link>}
      </PageHeader>

      <div className="row g-3 mb-4">
        <div className="col-sm-6 col-xl-3"><StatCard label="Active installations" value={count('IN_PROGRESS')} icon="fa-screwdriver-wrench" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Scheduled jobs" value={count('SCHEDULED')} icon="fa-calendar-days" color="info" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Completed jobs" value={count('COMPLETED')} icon="fa-circle-check" color="secondary" /></div>
        <div className="col-sm-6 col-xl-3"><StatCard label="Jobs this week" value={thisWeek} icon="fa-house" color="warning" /></div>
      </div>

      <div className="d-flex flex-wrap gap-2 mb-3">
        <SearchBox value={search} onChange={setSearch} placeholder="Search jobs…" />
        <select className="form-select w-auto" value={tech} onChange={(e) => setTech(e.target.value)} aria-label="Filter by technician">
          <option value="">All technicians</option>
          {technicians.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <ErrorBox error={error} onRetry={reload} />
      {loading && !data?.length ? <Loading /> : (
        <div className="board">
          {COLUMNS.map((col) => {
            const items = shown.filter((j) => j.status === col.status);
            return (
              <section key={col.status} className="board-col" aria-label={col.title}>
                <h3><span className="dot" style={{ background: col.color }} />{col.title}<span className="count">{items.length}</span></h3>
                {items.length === 0 && <div className="text-muted small text-center py-4">No jobs here.</div>}
                {items.map((j) => (
                  <article key={j.id} className="job-card">
                    <div className="d-flex justify-content-between align-items-start gap-2 mb-1">
                      <span className="badge text-bg-secondary">{j.activity_type_name || 'Job'}</span>
                      {j.date && <span className="job-meta">{col.status === 'COMPLETED' && j.completed_date ? `Done ${date(j.completed_date)}` : date(j.date)}</span>}
                    </div>
                    <div className="job-title">{j.customer_name || 'No customer'}</div>
                    {j.description && <div className="job-meta mb-2">{j.description}</div>}
                    <div className="job-meta"><i className="fas fa-user-gear me-1" />{j.technician || 'Unassigned'}{j.total_cost ? ` · ${money(j.total_cost, j.currency)}` : ''}</div>
                    {col.next && can('operations', 'write') && (
                      <button type="button" className="btn btn-sm btn-outline-primary mt-3 w-100" onClick={() => move(j, col.next)}>{col.action}</button>
                    )}
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
