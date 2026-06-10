import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  useAddTaskInput,
  useApproveOutput,
  useArchiveTask,
  useFinalizeOutput,
  useRejectOutput,
  useRequestChanges,
  useRunWorkflow,
  useTask,
  useTaskAudit,
  useUpdateTask,
  useWorkflows,
} from '../api/hooks';
import type { AiOutput, InputType, TaskDetail } from '../api/types';
import { AuditTimeline } from '../components/AuditTimeline';
import { Badge } from '../components/Badge';
import { copyFinalText, OutputCard } from '../components/OutputCard';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { currentIdentity } from '../lib/identity';
import { fmtCost, fmtDate, titleCase } from '../lib/format';

const INPUT_TYPES: InputType[] = [
  'condition_text', 'borrower_context', 'question', 'source_snippet',
  'scenario', 'instruction', 'other',
];

function MetaHeader({ task }: { task: TaskDetail }) {
  const update = useUpdateTask(task.id);
  const archive = useArchiveTask(task.id);
  return (
    <div className="panel">
      <div className="head" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, flex: 1 }}>{task.title}</h2>
        <Badge value={task.status} />
        <Badge value={task.priority} />
        <select
          value={task.priority}
          onChange={(e) => update.mutate({ priority: e.target.value as TaskDetail['priority'] })}
          style={{ width: 'auto' }}
        >
          {['low', 'normal', 'high', 'urgent'].map((p) => (
            <option key={p} value={p}>priority: {p}</option>
          ))}
        </select>
        {task.status !== 'archived' && (
          <button
            className="btn sm danger"
            onClick={() => { if (confirm('Archive this task?')) archive.mutate(); }}
          >
            Archive
          </button>
        )}
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>
        {titleCase(task.task_type)} · created by {task.created_by} {fmtDate(task.created_at)}
        {task.assigned_to && <> · assigned to {task.assigned_to}</>}
        {task.borrower_reference && <> · borrower ref <span className="mono">{task.borrower_reference}</span></>}
        {task.loan_reference && <> · loan ref <span className="mono">{task.loan_reference}</span></>}
        {task.due_at && <> · due {fmtDate(task.due_at)}</>}
      </p>
      {update.isError && <ErrorState error={update.error} />}
    </div>
  );
}

function AddInputForm({ taskId }: { taskId: string }) {
  const addInput = useAddTaskInput(taskId);
  const [type, setType] = useState<InputType>('borrower_context');
  const [content, setContent] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!content.trim()) return;
        addInput.mutate({ input_type: type, content: content.trim() }, { onSuccess: () => setContent('') });
      }}
    >
      <div className="row">
        <label className="field">
          Type
          <select value={type} onChange={(e) => setType(e.target.value as InputType)}>
            {INPUT_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </select>
        </label>
        <label className="field grow">
          Content
          <textarea value={content} style={{ minHeight: 60 }} onChange={(e) => setContent(e.target.value)} />
        </label>
      </div>
      <button className="btn sm" disabled={addInput.isPending || !content.trim()}>Add input</button>
      {addInput.isError && <ErrorState error={addInput.error} />}
    </form>
  );
}

function RunDialog({ task }: { task: TaskDetail }) {
  const workflows = useWorkflows();
  const run = useRunWorkflow(task.id);
  const implemented = workflows.data?.items.filter((w) => w.implemented && w.is_active) ?? [];
  const [workflow, setWorkflow] = useState('');
  const [tone, setTone] = useState('');
  const [retrieve, setRetrieve] = useState(task.task_type === 'sop_lookup' || task.task_type === 'website_qa');
  const selected = workflow || implemented.find((w) => w.task_type === task.task_type)?.workflow_name || '';

  return (
    <div className="panel">
      <h2>Run AI workflow</h2>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field grow">
          Workflow
          <select value={selected} onChange={(e) => setWorkflow(e.target.value)}>
            <option value="" disabled>Select a workflow…</option>
            {implemented.map((w) => (
              <option key={w.workflow_name} value={w.workflow_name}>
                {titleCase(w.workflow_name)} — {w.description}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Tone (optional)
          <input type="text" value={tone} placeholder="professional" onChange={(e) => setTone(e.target.value)} />
        </label>
        <button
          className="btn primary"
          disabled={!selected || run.isPending}
          onClick={() =>
            run.mutate({ workflow_name: selected, options: { ...(tone ? { tone } : {}), retrieve } })
          }
        >
          {run.isPending ? 'Running…' : 'Run workflow'}
        </button>
      </div>
      <label style={{ display: 'block', marginTop: 4 }}>
        <input type="checkbox" checked={retrieve} onChange={(e) => setRetrieve(e.target.checked)} />{' '}
        Auto-retrieve matching sources from the document library (citations stay traceable to each
        retrieved chunk)
      </label>
      {run.isPending && <p className="muted">Drafting… the output will require human review.</p>}
      {run.isError && <ErrorState error={run.error} />}
    </div>
  );
}

function OutputActions({ output, finalContent }: { output: AiOutput; finalContent?: string | null }) {
  const role = currentIdentity().role;
  const canReview = role === 'reviewer' || role === 'admin';
  const approve = useApproveOutput();
  const reject = useRejectOutput();
  const requestChanges = useRequestChanges();
  const finalize = useFinalizeOutput();
  const [notes, setNotes] = useState('');
  const reviewable = ['NEEDS_REVIEW', 'AI_GENERATED', 'CHANGES_REQUESTED'].includes(output.review_status);
  const err = approve.error ?? reject.error ?? requestChanges.error ?? finalize.error;

  return (
    <div>
      {canReview && reviewable && (
        <>
          <label className="field">
            Reviewer notes
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Required for reject / request changes" />
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={approve.isPending}
              onClick={() => approve.mutate({ outputId: output.id, body: { reviewer_notes: notes || undefined } })}>
              Approve
            </button>
            <button className="btn danger" disabled={reject.isPending || !notes.trim()}
              onClick={() => reject.mutate({ outputId: output.id, body: { reviewer_notes: notes } })}>
              Reject
            </button>
            <button className="btn" disabled={requestChanges.isPending || !notes.trim()}
              onClick={() => requestChanges.mutate({ outputId: output.id, body: { reviewer_notes: notes } })}>
              Request changes
            </button>
          </div>
          <p className="muted">Tip: use the Approval Center to edit the final response before approving.</p>
        </>
      )}
      {canReview && output.review_status === 'APPROVED' && (
        <button className="btn dark" disabled={finalize.isPending} onClick={() => finalize.mutate(output.id)}>
          Finalize
        </button>
      )}
      <button className="btn ghost sm" style={{ marginLeft: canReview ? 8 : 0 }}
        onClick={() => copyFinalText(output, finalContent)}>
        Copy {finalContent ? 'final (edited) ' : ''}response
      </button>
      {err != null && <ErrorState error={err} />}
    </div>
  );
}

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const task = useTask(id);
  const audit = useTaskAudit(id);

  if (task.isPending) return <Loading />;
  if (task.isError) return <ErrorState error={task.error} onRetry={() => task.refetch()} />;
  const t = task.data;

  return (
    <div>
      <MetaHeader task={t} />

      <div className="panel">
        <h2>Inputs & context</h2>
        {t.inputs.length === 0 && <p className="muted">No inputs yet — add the condition text, question, or context below.</p>}
        {t.inputs.map((i) => (
          <div key={i.id} style={{ marginBottom: 8 }}>
            <Badge value="internal" prefix="" /> <strong>{titleCase(i.input_type)}</strong>{' '}
            <span className="muted">{fmtDate(i.created_at)}</span>
            <div className="draft-panel" style={{ borderStyle: 'solid', marginTop: 4 }}>{i.content}</div>
          </div>
        ))}
        <AddInputForm taskId={t.id} />
      </div>

      <RunDialog task={t} />

      <div className="panel">
        <h2>Runs</h2>
        {t.runs.length === 0 && <p className="muted">No AI runs yet.</p>}
        {t.runs.length > 0 && (
          <table className="data">
            <thead>
              <tr><th>Workflow</th><th>Status</th><th>Provider / model</th><th>Prompt</th><th>Tokens</th><th>Cost</th><th>When</th></tr>
            </thead>
            <tbody>
              {t.runs.map((r) => (
                <tr key={r.id}>
                  <td>{titleCase(r.workflow_name)}</td>
                  <td><Badge value={r.status} />{r.error_message && <div className="banner error">{r.error_message}</div>}</td>
                  <td className="mono">{r.model_provider} / {r.model_name}</td>
                  <td className="mono">{r.prompt_version}</td>
                  <td>{r.token_input_count ?? '—'} / {r.token_output_count ?? '—'}</td>
                  <td>{fmtCost(r.estimated_cost)}</td>
                  <td>{fmtDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>AI outputs</h2>
        {t.outputs.length === 0 && <EmptyState message="Run a workflow to generate a draft for review." />}
        {t.outputs.map((o) => {
          // The reviewer's edited version (if any) is the real "final" text.
          const latestApproval = t.approvals.find((a) => a.output_id === o.id);
          return (
            <OutputCard key={o.id} output={o} citations={o.citations}
              actions={<OutputActions output={o} finalContent={latestApproval?.edited_final_content} />} />
          );
        })}
      </div>

      {t.actions.length > 0 && (
        <div className="panel">
          <h2>Proposed external actions</h2>
          <table className="data">
            <thead><tr><th>Action</th><th>Target</th><th>Status</th><th>Approval</th><th>Created</th></tr></thead>
            <tbody>
              {t.actions.map((a) => (
                <tr key={a.id}>
                  <td>{a.action_type}</td>
                  <td>{a.target_system}</td>
                  <td><Badge value={a.status} /></td>
                  <td className="mono">{a.approval_id ? a.approval_id.slice(0, 8) : 'none'}</td>
                  <td>{fmtDate(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Actions execute only after an approved, finalized review — and execution is disabled in this environment.</p>
        </div>
      )}

      <div className="panel">
        <h2>Audit timeline</h2>
        {audit.isPending ? <Loading /> : <AuditTimeline events={audit.data?.items ?? []} />}
      </div>
    </div>
  );
}
