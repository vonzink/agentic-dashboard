import { useState } from 'react';
import { useCompanies, useCreateCompany, useCreateEvalCase, useCreatePrompt, useEvalCases, useEvalRuns, usePrompts, useRunEvals, useSetEvalCaseActive, useSetPromptActive, useUpdateCompany, useUpdateWorkflow, useWorkflows } from '../api/hooks';
import type { PromptTemplate, WorkflowInfo } from '../api/types';
import { Badge } from '../components/Badge';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { currentIdentity } from '../lib/identity';
import { fmtDate, titleCase } from '../lib/format';

function PromptGroup({ name, versions }: { name: string; versions: PromptTemplate[] }) {
  const [open, setOpen] = useState(false);
  const setActive = useSetPromptActive();
  const active = versions.find((v) => v.is_active);
  return (
    <div className="panel">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <strong style={{ flex: 1 }}>{titleCase(name)}</strong>
        {active ? (
          <span className="badge green">active: v{active.version}</span>
        ) : (
          <span className="badge red">no active version</span>
        )}
        <button className="btn sm ghost" onClick={() => setOpen(!open)}>{open ? 'collapse' : 'versions'}</button>
      </div>
      {open && (
        <table className="data" style={{ marginTop: 10 }}>
          <thead><tr><th>v</th><th>Task type</th><th>Created</th><th>By</th><th></th></tr></thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <td>v{v.version} {v.is_active && <Badge value="APPROVED" prefix="" />}</td>
                <td>{titleCase(v.task_type)}</td>
                <td>{fmtDate(v.created_at)}</td>
                <td>{v.created_by}</td>
                <td>
                  {!v.is_active && (
                    <button className="btn sm" disabled={setActive.isPending}
                      onClick={() => setActive.mutate({ id: v.id, is_active: true })}>
                      Activate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {setActive.isError && <ErrorState error={setActive.error} />}
    </div>
  );
}

function NewPromptVersionForm({ existing }: { existing: PromptTemplate[] }) {
  const create = useCreatePrompt();
  const names = [...new Set(existing.map((p) => p.name))];
  const [form, setForm] = useState({ name: names[0] ?? '', system_prompt: '', user_prompt_template: '', activate: false });
  const base = existing.filter((p) => p.name === form.name).sort((a, b) => b.version - a.version)[0];

  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (!base || !form.system_prompt.trim() || !form.user_prompt_template.trim()) return;
        create.mutate(
          {
            name: form.name,
            task_type: base.task_type,
            system_prompt: form.system_prompt,
            user_prompt_template: form.user_prompt_template,
            activate: form.activate,
          },
          { onSuccess: () => setForm({ ...form, system_prompt: '', user_prompt_template: '' }) },
        );
      }}
    >
      <h2>New prompt version</h2>
      <p className="muted">
        Versions are immutable; activating one deactivates the previous version. Every run logs the
        exact version used.
      </p>
      <label className="field">
        Prompt
        <select value={form.name} onChange={(e) => {
          setForm({ ...form, name: e.target.value, system_prompt: '', user_prompt_template: '' });
        }}>
          {names.map((n) => <option key={n} value={n}>{titleCase(n)}</option>)}
        </select>
      </label>
      <button type="button" className="btn sm ghost" disabled={!base}
        onClick={() => base && setForm({ ...form, system_prompt: base.system_prompt, user_prompt_template: base.user_prompt_template })}>
        Load latest version as starting point
      </button>
      <label className="field" style={{ marginTop: 10 }}>
        System prompt
        <textarea style={{ minHeight: 140 }} value={form.system_prompt}
          onChange={(e) => setForm({ ...form, system_prompt: e.target.value })} />
      </label>
      <label className="field">
        User prompt template ({'{{placeholders}}'})
        <textarea style={{ minHeight: 180 }} value={form.user_prompt_template}
          onChange={(e) => setForm({ ...form, user_prompt_template: e.target.value })} />
      </label>
      <label style={{ display: 'block', marginBottom: 10 }}>
        <input type="checkbox" checked={form.activate}
          onChange={(e) => setForm({ ...form, activate: e.target.checked })} /> Activate immediately
      </label>
      {create.isError && <ErrorState error={create.error} />}
      <button className="btn primary" disabled={create.isPending || !form.system_prompt.trim() || !form.user_prompt_template.trim()}>
        Create version
      </button>
    </form>
  );
}

function CompaniesTab() {
  const companies = useCompanies();
  const create = useCreateCompany();
  const update = useUpdateCompany();
  const [form, setForm] = useState({ name: '', slug: '' });

  return (
    <div>
      <div className="panel">
        <h2>Client companies</h2>
        <p className="muted">
          Every task and document belongs to a company; retrieval never crosses companies.
          Companies deactivate rather than delete, preserving audit history.
        </p>
        {companies.isPending && <Loading />}
        {companies.data && (
          <table className="data">
            <thead><tr><th>Name</th><th>Slug</th><th>Status</th><th>Monthly AI budget</th><th></th></tr></thead>
            <tbody>
              {companies.data.items.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong></td>
                  <td className="mono">{c.slug}</td>
                  <td>{c.is_active ? <span className="badge green">active</span> : <span className="badge neutral">inactive</span>}</td>
                  <td>
                    {c.monthly_budget === null ? <span className="muted">none</span> : `$${c.monthly_budget}`}{' '}
                    <button className="btn sm ghost" disabled={update.isPending}
                      onClick={() => {
                        const raw = window.prompt(
                          `Monthly AI budget for ${c.name} (USD, blank to remove):`,
                          c.monthly_budget ?? '',
                        );
                        if (raw === null) return;
                        const value = raw.trim() === '' ? null : Number(raw);
                        if (value !== null && (!Number.isFinite(value) || value < 0)) return;
                        update.mutate({ id: c.id, monthly_budget: value });
                      }}>
                      Set
                    </button>
                  </td>
                  <td>
                    <button className="btn sm ghost" disabled={update.isPending}
                      onClick={() => update.mutate({ id: c.id, is_active: !c.is_active })}>
                      {c.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {update.isError && <ErrorState error={update.error} />}
      </div>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.name.trim() || !form.slug.trim()) return;
          create.mutate(
            { name: form.name.trim(), slug: form.slug.trim() },
            { onSuccess: () => setForm({ name: '', slug: '' }) },
          );
        }}
      >
        <h2>Add company</h2>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field grow">
            Name
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field">
            Slug
            <input type="text" value={form.slug} placeholder="acme"
              onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} />
          </label>
          <button className="btn primary" disabled={create.isPending || !form.name.trim() || !form.slug.trim()}>
            Add
          </button>
        </div>
        {create.isError && <ErrorState error={create.error} />}
      </form>
    </div>
  );
}

function EvalsTab({ workflows }: { workflows: WorkflowInfo[] }) {
  const implemented = workflows.filter((w) => w.implemented);
  const [workflow, setWorkflow] = useState(implemented[0]?.workflow_name ?? '');
  const cases = useEvalCases(workflow || undefined);
  const runs = useEvalRuns(workflow || undefined);
  const createCase = useCreateEvalCase();
  const setActive = useSetEvalCaseActive();
  const runEvals = useRunEvals();
  const [form, setForm] = useState({ name: '', primary_text: '', contains: '', min_confidence: '' });
  const lastRun = runs.data?.items[0];

  return (
    <div>
      <div className="panel">
        <h2>Eval sets</h2>
        <p className="muted">
          Saved test inputs per workflow — run them against a prompt version <em>before</em>{' '}
          activating it, so prompt changes ship with evidence. Eval runs are sandboxed: no
          tasks, no outputs, nothing enters the review queue. Synthetic content only — never
          borrower data.
        </p>
        <div className="filter-bar">
          <select value={workflow} onChange={(e) => setWorkflow(e.target.value)}>
            {implemented.map((w) => (
              <option key={w.workflow_name} value={w.workflow_name}>{titleCase(w.workflow_name)}</option>
            ))}
          </select>
          <button
            className="btn primary"
            disabled={runEvals.isPending || !(cases.data?.items.some((c) => c.is_active) ?? false)}
            onClick={() => runEvals.mutate({ workflow_name: workflow })}
          >
            {runEvals.isPending ? 'Running…' : 'Run evals (active prompt)'}
          </button>
        </div>
        {runEvals.isError && <ErrorState error={runEvals.error} />}

        {cases.isPending && <Loading />}
        {cases.data && cases.data.items.length === 0 && (
          <p className="muted">No eval cases yet for this workflow — add the first one below.</p>
        )}
        {cases.data && cases.data.items.length > 0 && (
          <table className="data">
            <thead>
              <tr><th>Case</th><th>Input</th><th>Expectations</th><th>Active</th><th></th></tr>
            </thead>
            <tbody>
              {cases.data.items.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong></td>
                  <td className="muted" style={{ maxWidth: 320 }}>{c.input_json.primary_text.slice(0, 120)}</td>
                  <td>
                    {(c.expectations_json.contains ?? []).map((s) => (
                      <span key={s} className="badge neutral" style={{ marginRight: 4 }}>contains "{s}"</span>
                    ))}
                    {c.expectations_json.min_confidence && (
                      <span className="badge teal">≥ {c.expectations_json.min_confidence}</span>
                    )}
                  </td>
                  <td>{c.is_active ? 'yes' : 'no'}</td>
                  <td>
                    <button className="btn sm ghost" disabled={setActive.isPending}
                      onClick={() => setActive.mutate({ id: c.id, is_active: !c.is_active })}>
                      {c.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {lastRun && (
        <div className="panel">
          <h2>
            Latest run — {lastRun.passed_count}/{lastRun.passed_count + lastRun.failed_count} passed
          </h2>
          <p className="muted">
            {lastRun.prompt_version} · {lastRun.model_provider}/{lastRun.model_name} ·{' '}
            {fmtDate(lastRun.created_at)} · by {lastRun.created_by}
          </p>
          <table className="data">
            <thead><tr><th>Case</th><th>Result</th><th>Confidence</th><th>Details</th></tr></thead>
            <tbody>
              {lastRun.results_json.map((r) => (
                <tr key={r.case_id}>
                  <td>{r.case_name}</td>
                  <td>{r.passed ? <span className="badge green">pass</span> : <span className="badge red">fail</span>}</td>
                  <td>{r.confidence ?? '—'}</td>
                  <td className="muted" style={{ maxWidth: 380 }}>
                    {r.passed ? r.content_preview.slice(0, 140) : r.failures.join('; ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(runs.data?.items.length ?? 0) > 1 && (
            <p className="muted">
              History:{' '}
              {runs.data!.items.slice(1, 6).map((r) => (
                <span key={r.id} style={{ marginRight: 10 }}>
                  {r.prompt_version}: {r.passed_count}/{r.passed_count + r.failed_count} ({fmtDate(r.created_at)})
                </span>
              ))}
            </p>
          )}
        </div>
      )}

      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.name.trim() || !form.primary_text.trim()) return;
          createCase.mutate(
            {
              workflow_name: workflow,
              name: form.name.trim(),
              primary_text: form.primary_text.trim(),
              contains: form.contains.split(',').map((s) => s.trim()).filter(Boolean),
              ...(form.min_confidence && {
                min_confidence: form.min_confidence as 'HIGH' | 'MEDIUM' | 'LOW',
              }),
            },
            { onSuccess: () => setForm({ name: '', primary_text: '', contains: '', min_confidence: '' }) },
          );
        }}
      >
        <h2>Add eval case — {titleCase(workflow)}</h2>
        <label className="field">
          Case name
          <input type="text" value={form.name} placeholder="Paystub condition (synthetic)"
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="field">
          Input text <span className="hint">What an operator would type — synthetic content only, no borrower data.</span>
          <textarea value={form.primary_text}
            onChange={(e) => setForm({ ...form, primary_text: e.target.value })} />
        </label>
        <div className="row">
          <label className="field grow">
            Output must contain <span className="hint">Comma-separated phrases, e.g. "paystub, 30 days"</span>
            <input type="text" value={form.contains}
              onChange={(e) => setForm({ ...form, contains: e.target.value })} />
          </label>
          <label className="field">
            Min confidence
            <select value={form.min_confidence}
              onChange={(e) => setForm({ ...form, min_confidence: e.target.value })}>
              <option value="">none</option>
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
            </select>
          </label>
        </div>
        {createCase.isError && <ErrorState error={createCase.error} />}
        <button className="btn primary" disabled={createCase.isPending || !form.name.trim() || !form.primary_text.trim()}>
          Add case
        </button>
      </form>
    </div>
  );
}

type RoutedProvider = 'mock' | 'anthropic' | 'openai' | 'deepseek';

function ModelRoutingCell({ workflow }: { workflow: WorkflowInfo }) {
  const update = useUpdateWorkflow();
  const mc = (workflow.model_config_json ?? {}) as { provider?: RoutedProvider; model?: string };
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select
        value={mc.provider ?? ''}
        disabled={update.isPending}
        onChange={(e) => {
          const provider = e.target.value as RoutedProvider | '';
          update.mutate({
            name: workflow.workflow_name,
            model_config_json: provider ? { provider } : {},
          });
        }}
      >
        <option value="">default</option>
        <option value="mock">mock (free)</option>
        <option value="anthropic">Claude</option>
        <option value="openai">ChatGPT</option>
        <option value="deepseek">DeepSeek</option>
      </select>
      {mc.provider && (
        <button
          className="btn sm ghost"
          disabled={update.isPending}
          title="Set a specific model id (blank = the provider's default)"
          onClick={() => {
            const raw = window.prompt(
              `Model id for ${mc.provider} (blank = provider default):`,
              mc.model ?? '',
            );
            if (raw === null) return;
            update.mutate({
              name: workflow.workflow_name,
              model_config_json: {
                provider: mc.provider,
                ...(raw.trim() ? { model: raw.trim() } : {}),
              },
            });
          }}
        >
          {mc.model ?? 'default model'}
        </button>
      )}
      {update.isError && <ErrorState error={update.error} />}
    </div>
  );
}

export function AdminPage() {
  const role = currentIdentity().role;
  const prompts = usePrompts();
  const workflows = useWorkflows();
  const [tab, setTab] = useState<'prompts' | 'workflows' | 'evals' | 'companies'>('prompts');

  if (role !== 'admin') {
    return (
      <EmptyState message="Admin settings require the admin role. Switch your identity in the top-right menu." />
    );
  }

  const grouped = new Map<string, PromptTemplate[]>();
  for (const p of prompts.data?.items ?? []) {
    grouped.set(p.name, [...(grouped.get(p.name) ?? []), p]);
  }

  return (
    <div>
      <div className="filter-bar">
        <button className={`btn sm ${tab === 'prompts' ? 'dark' : 'ghost'}`} onClick={() => setTab('prompts')}>
          Prompt templates
        </button>
        <button className={`btn sm ${tab === 'workflows' ? 'dark' : 'ghost'}`} onClick={() => setTab('workflows')}>
          Workflow configs
        </button>
        <button className={`btn sm ${tab === 'evals' ? 'dark' : 'ghost'}`} onClick={() => setTab('evals')}>
          Evals
        </button>
        <button className={`btn sm ${tab === 'companies' ? 'dark' : 'ghost'}`} onClick={() => setTab('companies')}>
          Companies
        </button>
      </div>

      {tab === 'companies' && <CompaniesTab />}
      {tab === 'evals' && <EvalsTab workflows={workflows.data?.items ?? []} />}

      {tab === 'prompts' && (
        <>
          {prompts.isPending && <Loading />}
          {prompts.isError && <ErrorState error={prompts.error} onRetry={() => prompts.refetch()} />}
          {[...grouped.entries()].map(([name, versions]) => (
            <PromptGroup key={name} name={name} versions={versions} />
          ))}
          {prompts.data && <NewPromptVersionForm existing={prompts.data.items} />}
        </>
      )}

      {tab === 'workflows' && (
        <div className="panel">
          <h2>Workflow configurations</h2>
          {workflows.isPending && <Loading />}
          {workflows.data && (
            <table className="data">
              <thead>
                <tr><th>Workflow</th><th>Task type</th><th>Requires approval</th><th>Active</th><th>Model</th></tr>
              </thead>
              <tbody>
                {workflows.data.items.map((w) => (
                  <tr key={w.id}>
                    <td><strong>{titleCase(w.workflow_name)}</strong><div className="muted">{w.description}</div></td>
                    <td>{titleCase(w.task_type)}</td>
                    <td>{w.requires_approval ? <Badge value="APPROVED" prefix="" /> : <Badge value="REJECTED" prefix="" />}</td>
                    <td>{w.is_active ? 'yes' : 'no'}</td>
                    <td><ModelRoutingCell workflow={w} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted">
            Approval requirements are enforced server-side regardless of this display; in the MVP
            every output requires human review. "Model" routes a workflow to a specific provider —
            e.g. a cheap model for checklists, Claude for drafting — overriding the deployment
            default. Runs against a provider with no API key configured fail loudly.
          </p>
        </div>
      )}
    </div>
  );
}
