import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTasks } from '../api/hooks';
import { activeCompanyId } from '../lib/company';
import { Badge } from '../components/Badge';
import { Pager } from '../components/Pager';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { fmtDate, titleCase } from '../lib/format';

const TASK_TYPES = [
  'condition_response', 'borrower_email', 'document_checklist', 'sop_lookup',
  'income_review', 'asset_review', 'credit_review', 'title_insurance_review',
  'website_qa', 'general',
];
const STATUSES = ['open', 'in_progress', 'waiting_review', 'changes_requested', 'completed', 'archived', 'cancelled'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export function TasksPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const projectId = params.get('project') ?? undefined;
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ status: '', task_type: '', priority: '', assigned_to: '', search: '' });
  const query = useTasks({
    ...filters,
    company_id: activeCompanyId() ?? undefined,
    project_id: projectId,
    page,
    pageSize: 20,
  });

  const set = (key: keyof typeof filters) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };

  return (
    <div>
      <div className="filter-bar">
        <select value={filters.status} onChange={set('status')}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
        </select>
        <select value={filters.task_type} onChange={set('task_type')}>
          <option value="">All types</option>
          {TASK_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </select>
        <select value={filters.priority} onChange={set('priority')}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
        </select>
        <input type="text" placeholder="Assigned to (email)" value={filters.assigned_to} onChange={set('assigned_to')} />
        <input type="text" placeholder="Search title / refs…" value={filters.search} onChange={set('search')} />
        <span className="grow" />
        <Link className="btn primary" to="/tasks/new">+ New Task</Link>
      </div>

      {query.isPending && <Loading />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          message="No tasks match these filters."
          action={<Link className="btn primary" to="/tasks/new">Create the first task</Link>}
        />
      )}
      {query.data && query.data.items.length > 0 && (
        <>
          <table className="data">
            <thead>
              <tr>
                <th>Title</th><th>Type</th><th>Status</th><th>Priority</th>
                <th>Assigned</th><th>Created</th><th>Due</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((t) => (
                <tr key={t.id} className="clickable" onClick={() => navigate(`/tasks/${t.id}`)}>
                  <td><strong>{t.title}</strong>{t.loan_reference && <div className="muted mono">{t.loan_reference}</div>}</td>
                  <td>{titleCase(t.task_type)}</td>
                  <td><Badge value={t.status} /></td>
                  <td><Badge value={t.priority} /></td>
                  <td>{t.assigned_to ?? '—'}</td>
                  <td>{fmtDate(t.created_at)}</td>
                  <td>{fmtDate(t.due_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
