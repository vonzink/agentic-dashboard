import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  useApproveOutput,
  useFinalizeOutput,
  useOutput,
  useRejectOutput,
  useRequestChanges,
  useReviewQueue,
} from '../api/hooks';
import type { OutputDetail, ReviewStatus } from '../api/types';
import { Badge } from '../components/Badge';
import { OutputCard } from '../components/OutputCard';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { currentIdentity } from '../lib/identity';
import { fmtDate, titleCase } from '../lib/format';

/** Best initial value for the editable final response. */
function draftTextOf(output: OutputDetail): string {
  const s = (output.structured_json ?? {}) as Record<string, unknown>;
  for (const key of ['draft_response', 'email_body', 'answer']) {
    if (typeof s[key] === 'string') return s[key] as string;
  }
  return output.content;
}

function ReviewPane({ outputId, onDone }: { outputId: string; onDone: () => void }) {
  const detail = useOutput(outputId);
  const approve = useApproveOutput();
  const reject = useRejectOutput();
  const requestChanges = useRequestChanges();
  const finalize = useFinalizeOutput();
  const [finalText, setFinalText] = useState('');
  const [notes, setNotes] = useState('');
  const [toast, setToast] = useState('');
  const role = currentIdentity().role;
  const canReview = role === 'reviewer' || role === 'admin';

  useEffect(() => {
    if (detail.data) {
      setFinalText(draftTextOf(detail.data));
      setNotes('');
      setToast('');
    }
  }, [detail.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />;
  const output = detail.data;
  const original = draftTextOf(output);
  const edited = finalText.trim() !== original.trim();
  const reviewable = ['NEEDS_REVIEW', 'AI_GENERATED', 'CHANGES_REQUESTED'].includes(output.review_status);
  const err = approve.error ?? reject.error ?? requestChanges.error ?? finalize.error;

  const decide = (
    fn: typeof approve,
    body: { reviewer_notes?: string; edited_final_content?: string },
    label: string,
  ) =>
    fn.mutate(
      { outputId, body },
      {
        onSuccess: () => {
          setToast(`${label} recorded and audited.`);
          onDone();
        },
      },
    );

  return (
    <div className="row">
      <div className="grow">
        <OutputCard output={output} citations={output.citations} />
      </div>
      <div className="panel" style={{ width: 420, flexShrink: 0 }}>
        <h2>Final response</h2>
        {!canReview && (
          <div className="banner info">
            Your role ({role}) can view but not decide. Switch to a reviewer/admin identity.
          </div>
        )}
        <label className="field">
          Editable final content {edited && <span className="badge amber">edited</span>}
          <textarea style={{ minHeight: 220 }} value={finalText}
            onChange={(e) => setFinalText(e.target.value)} disabled={!canReview || !reviewable} />
        </label>
        <label className="field">
          Reviewer notes
          <textarea style={{ minHeight: 60 }} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Required for reject / request changes" disabled={!canReview} />
        </label>
        {toast && <div className="banner info">{toast}</div>}
        {err != null && <ErrorState error={err} />}
        {reviewable && canReview && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={approve.isPending}
              onClick={() =>
                decide(approve, {
                  reviewer_notes: notes || undefined,
                  edited_final_content: edited ? finalText : undefined,
                }, 'Approval')
              }>
              Approve{edited ? ' with edits' : ''}
            </button>
            <button className="btn danger" disabled={reject.isPending || !notes.trim()}
              onClick={() => decide(reject, { reviewer_notes: notes }, 'Rejection')}>
              Reject
            </button>
            <button className="btn" disabled={requestChanges.isPending || !notes.trim()}
              onClick={() => decide(requestChanges, { reviewer_notes: notes }, 'Change request')}>
              Request changes
            </button>
          </div>
        )}
        {output.review_status === 'APPROVED' && canReview && (
          <button className="btn dark" style={{ marginTop: 8 }} disabled={finalize.isPending}
            onClick={() => finalize.mutate(outputId, { onSuccess: () => setToast('Output finalized.') })}>
            Finalize
          </button>
        )}
        {output.approvals.length > 0 && (
          <>
            <h3>Decision history</h3>
            {output.approvals.map((a) => (
              <p key={a.id} className="muted">
                <Badge value={a.decision === 'approved' ? 'APPROVED' : a.decision === 'rejected' ? 'REJECTED' : 'CHANGES_REQUESTED'} />{' '}
                {a.reviewed_by} · {fmtDate(a.reviewed_at)}
                {a.reviewer_notes && <> — “{a.reviewer_notes}”</>}
              </p>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export function ApprovalsPage() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<ReviewStatus>('NEEDS_REVIEW');
  const queue = useReviewQueue({ review_status: status, page: 1, pageSize: 50 });
  const selected = params.get('output');

  return (
    <div>
      <div className="filter-bar">
        <select value={status} onChange={(e) => setStatus(e.target.value as ReviewStatus)}>
          {['NEEDS_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'FINALIZED'].map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <span className="muted">{queue.data?.total ?? '…'} output(s)</span>
      </div>

      {queue.isPending && <Loading />}
      {queue.isError && <ErrorState error={queue.error} onRetry={() => queue.refetch()} />}
      {queue.data && queue.data.items.length === 0 && !selected && (
        <EmptyState message={`No outputs with status ${status.replace(/_/g, ' ')}.`}
          action={<Link to="/tasks">Go to the task queue</Link>} />
      )}

      {queue.data && queue.data.items.length > 0 && (
        <table className="data" style={{ marginBottom: 16 }}>
          <thead>
            <tr><th>Task</th><th>Workflow</th><th>Confidence</th><th>Status</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            {queue.data.items.map((o) => (
              <tr key={o.id} className="clickable"
                onClick={() => setParams({ output: o.id })}
                style={selected === o.id ? { background: '#eef5e3' } : undefined}>
                <td><strong>{o.task_title || '(untitled)'}</strong></td>
                <td>{titleCase(o.workflow_name)}</td>
                <td><Badge value={o.confidence_label} /></td>
                <td><Badge value={o.review_status} /></td>
                <td>{fmtDate(o.created_at)}</td>
                <td><Link to={`/tasks/${o.task_id}`} onClick={(e) => e.stopPropagation()}>task →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && <ReviewPane outputId={selected} onDone={() => queue.refetch()} />}
    </div>
  );
}
