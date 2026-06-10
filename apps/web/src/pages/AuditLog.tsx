import { useState } from 'react';
import { useAuditLog } from '../api/hooks';
import { Pager } from '../components/Pager';
import { AuditTimeline } from '../components/AuditTimeline';
import { EmptyState, ErrorState, Loading } from '../components/States';

export function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ event_type: '', actor: '', task_id: '' });
  const query = useAuditLog({ ...filters, page, pageSize: 25 });

  const set = (key: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };

  return (
    <div>
      <div className="banner info">
        Append-only event log. Entries can never be edited or deleted — by anyone.
      </div>
      <div className="filter-bar">
        <input type="text" placeholder="event type (e.g. output.approved)" value={filters.event_type} onChange={set('event_type')} />
        <input type="text" placeholder="actor email" value={filters.actor} onChange={set('actor')} />
        <input type="text" placeholder="task id" value={filters.task_id} onChange={set('task_id')} className="mono" />
      </div>
      {query.isPending && <Loading />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {query.data && query.data.items.length === 0 && <EmptyState message="No audit events match." />}
      {query.data && query.data.items.length > 0 && (
        <div className="panel">
          <AuditTimeline events={query.data.items} />
          <Pager page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
