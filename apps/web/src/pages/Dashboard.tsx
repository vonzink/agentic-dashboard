import { Link, useNavigate } from 'react-router-dom';
import { useAuditLog, useHealth, useReviewQueue, useTasks, useUsage, useWorkflows } from '../api/hooks';
import { ErrorState, Loading } from '../components/States';
import { activeCompanyId } from '../lib/company';
import { fmtCost, fmtDate, titleCase } from '../lib/format';

export function DashboardPage() {
  const navigate = useNavigate();
  const openTasks = useTasks({ status: 'open', company_id: activeCompanyId() ?? undefined, pageSize: 1 });
  const reviewQueue = useReviewQueue({ review_status: 'NEEDS_REVIEW', pageSize: 5 });
  const recentAudit = useAuditLog({ pageSize: 8 });
  const health = useHealth();
  const workflows = useWorkflows();
  const usage = useUsage(30, activeCompanyId() ?? undefined);

  if (openTasks.isError) {
    return <ErrorState error={openTasks.error} onRetry={() => openTasks.refetch()} />;
  }

  const implemented = workflows.data?.items.filter((w) => w.implemented && w.is_active) ?? [];

  return (
    <div>
      <div className="stat-grid">
        <div className="stat">
          <div className="num">{openTasks.data?.total ?? '…'}</div>
          <div className="label">Open AI tasks</div>
        </div>
        <div className="stat">
          <div className="num">{reviewQueue.data?.total ?? '…'}</div>
          <div className="label">Awaiting human review</div>
        </div>
        <div className="stat">
          <div className="num">{health.data ? (health.data.db === 'down' ? '✕' : '✓') : '…'}</div>
          <div className="label">
            System health · provider: {health.data?.provider.name ?? '?'}
          </div>
        </div>
        <div className="stat">
          <div className="num">{implemented.length}</div>
          <div className="label">Active workflows</div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h2>Quick create</h2>
        {workflows.isPending && <Loading />}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {implemented.map((w) => (
            <button
              key={w.workflow_name}
              className="btn primary"
              onClick={() => navigate(`/tasks/new?task_type=${w.task_type}`)}
            >
              + {titleCase(w.workflow_name)}
            </button>
          ))}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h2>AI usage — last 30 days</h2>
        {usage.isPending && <Loading />}
        {usage.data && (
          <>
            <p className="muted">
              {usage.data.totals.runs} run(s) · {usage.data.totals.tokens_in.toLocaleString()} tokens in
              / {usage.data.totals.tokens_out.toLocaleString()} out · estimated spend{' '}
              <strong>{fmtCost(usage.data.totals.estimated_cost)}</strong>
            </p>
            {usage.data.by_workflow.length > 0 && (
              <table className="data">
                <thead>
                  <tr><th>Workflow</th><th>Runs</th><th>Tokens in / out</th><th>Est. cost</th></tr>
                </thead>
                <tbody>
                  {usage.data.by_workflow.map((w) => (
                    <tr key={w.workflow_name}>
                      <td>{titleCase(w.workflow_name)}</td>
                      <td>{w.runs}</td>
                      <td>{w.tokens_in.toLocaleString()} / {w.tokens_out.toLocaleString()}</td>
                      <td>{fmtCost(w.estimated_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <div className="panel grow">
          <h2>Waiting for approval</h2>
          {reviewQueue.isPending && <Loading />}
          {reviewQueue.data && reviewQueue.data.items.length === 0 && (
            <p className="muted">Nothing waiting — nice.</p>
          )}
          {reviewQueue.data?.items.map((o) => (
            <p key={o.id}>
              <Link to={`/approvals?output=${o.id}`}>{o.task_title || o.workflow_name}</Link>{' '}
              <span className="muted">
                {titleCase(o.workflow_name)} · {fmtDate(o.created_at)}
              </span>
            </p>
          ))}
          <Link to="/approvals">Open approval center →</Link>
        </div>

        <div className="panel grow">
          <h2>Recent activity</h2>
          {recentAudit.isPending && <Loading />}
          {recentAudit.data?.items.map((e) => (
            <p key={e.id}>
              <strong>{e.event_type}</strong>{' '}
              <span className="muted">
                {e.actor_user_id ?? 'system'} · {fmtDate(e.created_at)}
              </span>
            </p>
          ))}
          <Link to="/audit">Full audit log →</Link>
        </div>
      </div>
    </div>
  );
}
