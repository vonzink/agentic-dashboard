import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useCreateDocument, useCreateTask, useWorkflows } from '../api/hooks';
import type { InputType, TaskType } from '../api/types';
import { ErrorState } from '../components/States';
import { titleCase } from '../lib/format';

const PRIMARY_INPUT: Partial<Record<TaskType, InputType>> = {
  condition_response: 'condition_text',
  sop_lookup: 'question',
  website_qa: 'question',
  borrower_email: 'instruction',
  document_checklist: 'scenario',
  income_review: 'scenario',
  asset_review: 'scenario',
  credit_review: 'scenario',
  title_insurance_review: 'scenario',
};

export function NewTaskPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const workflows = useWorkflows();
  const createTask = useCreateTask();
  const createDocument = useCreateDocument();

  const VALID_TYPES: TaskType[] = [
    'condition_response', 'borrower_email', 'document_checklist', 'sop_lookup',
    'income_review', 'asset_review', 'credit_review', 'title_insurance_review', 'website_qa', 'general',
  ];
  const requested = params.get('task_type');
  const [form, setForm] = useState({
    title: '',
    task_type: (VALID_TYPES as string[]).includes(requested ?? '')
      ? (requested as TaskType)
      : 'condition_response',
    priority: 'normal',
    borrower_reference: '',
    loan_reference: '',
    due_at: '',
    context: '',
    snippet_label: '',
    snippet_text: '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const matchingWorkflow = workflows.data?.items.find(
    (w) => w.task_type === form.task_type && w.implemented,
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return setError(new Error('Title is required.'));
    if (!form.context.trim()) return setError(new Error('Context / input text is required.'));
    setBusy(true);
    setError(null);
    try {
      const task = await createTask.mutateAsync({
        title: form.title.trim(),
        task_type: form.task_type,
        priority: form.priority,
        borrower_reference: form.borrower_reference.trim() || undefined,
        loan_reference: form.loan_reference.trim() || undefined,
        due_at: form.due_at ? new Date(form.due_at).toISOString() : undefined,
      });
      const primaryType: InputType = PRIMARY_INPUT[form.task_type] ?? 'other';
      await apiFetch(`/tasks/${task.id}/inputs`, {
        method: 'POST',
        body: { input_type: primaryType, content: form.context.trim() },
      });
      if (form.snippet_text.trim()) {
        const doc = await createDocument.mutateAsync({
          filename: form.snippet_label.trim() || `snippet-for-${task.id.slice(0, 8)}`,
          document_type: 'manual_snippet',
          classification: 'internal',
          content: form.snippet_text.trim(),
        });
        await apiFetch(`/tasks/${task.id}/inputs`, {
          method: 'POST',
          body: {
            input_type: 'document_reference',
            content: doc.filename,
            source_document_id: doc.id,
          },
        });
      }
      navigate(`/tasks/${task.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" style={{ maxWidth: 720 }} onSubmit={submit}>
      <h2>Create AI task</h2>
      {error != null && <ErrorState error={error} />}

      <label className="field">
        Title *
        <input type="text" value={form.title} maxLength={300}
          onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </label>

      <div className="row">
        <label className="field grow">
          Task type *
          <select value={form.task_type}
            onChange={(e) => setForm({ ...form, task_type: e.target.value as TaskType })}>
            {VALID_TYPES.map((t) => (
              <option key={t} value={t}>{titleCase(t)}</option>
            ))}
          </select>
          <span className="hint">
            Workflow: {matchingWorkflow ? titleCase(matchingWorkflow.workflow_name) : 'manual only (no implemented workflow)'}
          </span>
        </label>
        <label className="field grow">
          Priority
          <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
          </select>
        </label>
      </div>

      <div className="row">
        <label className="field grow">
          Borrower reference
          <input type="text" value={form.borrower_reference}
            onChange={(e) => setForm({ ...form, borrower_reference: e.target.value })} />
          <span className="hint">Reference ID only — never enter borrower PII here.</span>
        </label>
        <label className="field grow">
          Loan reference
          <input type="text" value={form.loan_reference}
            onChange={(e) => setForm({ ...form, loan_reference: e.target.value })} />
        </label>
        <label className="field">
          Due
          <input type="date" value={form.due_at} onChange={(e) => setForm({ ...form, due_at: e.target.value })} />
        </label>
      </div>

      <label className="field">
        Context / input text *
        <textarea
          value={form.context}
          placeholder={
            form.task_type === 'condition_response'
              ? 'Paste the underwriting condition text…'
              : form.task_type === 'sop_lookup'
                ? 'Ask the SOP/guideline question…'
                : 'Describe what the AI should draft…'
          }
          onChange={(e) => setForm({ ...form, context: e.target.value })}
        />
      </label>

      <h3>Optional source snippet</h3>
      <p className="muted">
        Paste guideline/SOP text the AI should ground its answer in. It is stored as a
        source document and cited in the output.
      </p>
      <label className="field">
        Snippet label
        <input type="text" value={form.snippet_label} placeholder="e.g. FNMA B3-3.1 excerpt"
          onChange={(e) => setForm({ ...form, snippet_label: e.target.value })} />
      </label>
      <label className="field">
        Snippet text
        <textarea value={form.snippet_text}
          onChange={(e) => setForm({ ...form, snippet_text: e.target.value })} />
      </label>

      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'Creating…' : 'Create task'}
      </button>
    </form>
  );
}
