import { useState } from 'react';
import { useCreatePrompt, usePrompts, useSetPromptActive, useWorkflows } from '../api/hooks';
import type { PromptTemplate } from '../api/types';
import { Badge } from '../components/Badge';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { loadDevUser } from '../lib/devUser';
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

export function AdminPage() {
  const role = loadDevUser().role;
  const prompts = usePrompts();
  const workflows = useWorkflows();
  const [tab, setTab] = useState<'prompts' | 'workflows'>('prompts');

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
      </div>

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
                <tr><th>Workflow</th><th>Task type</th><th>Requires approval</th><th>Active</th><th>Implemented</th></tr>
              </thead>
              <tbody>
                {workflows.data.items.map((w) => (
                  <tr key={w.id}>
                    <td><strong>{titleCase(w.workflow_name)}</strong><div className="muted">{w.description}</div></td>
                    <td>{titleCase(w.task_type)}</td>
                    <td>{w.requires_approval ? <Badge value="APPROVED" prefix="" /> : <Badge value="REJECTED" prefix="" />}</td>
                    <td>{w.is_active ? 'yes' : 'no'}</td>
                    <td>{w.implemented ? 'yes' : 'planned'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted">
            Approval requirements are enforced server-side regardless of this display; in the MVP
            every output requires human review.
          </p>
        </div>
      )}
    </div>
  );
}
