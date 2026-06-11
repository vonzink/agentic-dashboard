import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useCreateProject,
  useProjects,
  useSyncProject,
  useUpdateProject,
} from '../api/hooks';
import type { Project, ProjectStatus } from '../api/types';
import { ErrorState, Loading } from '../components/States';
import { activeCompanyId } from '../lib/company';
import { currentIdentity } from '../lib/identity';
import { fmtDate } from '../lib/format';

const STATUS_BADGE: Record<ProjectStatus, string> = {
  active: 'green',
  paused: 'amber',
  archived: 'neutral',
};

function ProjectCard({ project, isAdmin }: { project: Project; isAdmin: boolean }) {
  const sync = useSyncProject();
  const update = useUpdateProject();
  const meta = project.github_meta_json;

  return (
    <div className="panel">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 15 }}>{project.name}</strong>
        <span className={`badge ${STATUS_BADGE[project.status]}`}>{project.status}</span>
        {meta?.private && <span className="badge dark">private repo</span>}
        <span className="grow" />
        {isAdmin && (
          <select
            value={project.status}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ id: project.id, status: e.target.value as ProjectStatus })}
          >
            <option value="active">active</option>
            <option value="paused">paused</option>
            <option value="archived">archived</option>
          </select>
        )}
        {project.github_repo && (
          <button className="btn sm" disabled={sync.isPending} onClick={() => sync.mutate(project.id)}>
            {sync.isPending ? 'Syncing…' : 'Sync from GitHub'}
          </button>
        )}
      </div>

      {(project.description ?? meta?.description) && (
        <p className="muted" style={{ margin: '8px 0 0' }}>{project.description ?? meta?.description}</p>
      )}

      <p style={{ margin: '8px 0 0', fontSize: 12 }} className="muted">
        {project.github_repo && (
          <>
            <a href={meta?.html_url ?? `https://github.com/${project.github_repo}`} target="_blank" rel="noreferrer">
              {project.github_repo}
            </a>
            {' · '}
          </>
        )}
        {project.live_url && (
          <>
            <a href={project.live_url} target="_blank" rel="noreferrer">live site</a>
            {' · '}
          </>
        )}
        {meta?.pushed_at && <>last pushed {fmtDate(meta.pushed_at)} · </>}
        {meta != null && <>{meta.open_issues} open issue(s) · </>}
        {project.github_synced_at ? (
          <>synced {fmtDate(project.github_synced_at)}</>
        ) : (
          <>never synced</>
        )}
        {project.readme_document_id && (
          <> · <Link to="/documents">README in library</Link></>
        )}
      </p>

      <p style={{ margin: '8px 0 0', fontSize: 12 }}>
        <Link to={`/tasks?project=${project.id}`}>AI tasks for this project →</Link>
      </p>

      {sync.isError && <ErrorState error={sync.error} />}
      {update.isError && <ErrorState error={update.error} />}
    </div>
  );
}

export function ProjectsPage() {
  const isAdmin = currentIdentity().role === 'admin';
  const projects = useProjects(activeCompanyId() ?? undefined);
  const create = useCreateProject();
  const [form, setForm] = useState({ name: '', github_repo: '', live_url: '', description: '' });

  if (projects.isPending) return <Loading />;
  if (projects.isError) return <ErrorState error={projects.error} onRetry={() => projects.refetch()} />;

  return (
    <div>
      <div className="panel">
        <h2>Projects</h2>
        <p className="muted" style={{ margin: 0 }}>
          The codebases and products tracked by this workspace, linked read-only to their
          GitHub repos (repos stay private). Sync pulls fresh repo info and imports the
          README into the document library, so the SOP-lookup workflow can answer
          questions about any project — with citations.
        </p>
      </div>

      {projects.data.items.length === 0 && (
        <div className="panel">
          <p className="muted">No projects yet — add the first one below.</p>
        </div>
      )}
      {projects.data.items.map((p) => (
        <ProjectCard key={p.id} project={p} isAdmin={isAdmin} />
      ))}

      {isAdmin && (
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name.trim()) return;
            create.mutate(
              {
                name: form.name.trim(),
                company_id: activeCompanyId() ?? undefined,
                github_repo: form.github_repo.trim() || undefined,
                live_url: form.live_url.trim() || undefined,
                description: form.description.trim() || undefined,
              },
              { onSuccess: () => setForm({ name: '', github_repo: '', live_url: '', description: '' }) },
            );
          }}
        >
          <h2>Add project</h2>
          <div className="row">
            <label className="field grow">
              Name *
              <input type="text" value={form.name} placeholder="msfg-calc"
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field grow">
              GitHub repo <span className="hint">owner/name — not the full URL</span>
              <input type="text" value={form.github_repo} placeholder="vonzink/msfg-calc"
                onChange={(e) => setForm({ ...form, github_repo: e.target.value })} />
            </label>
          </div>
          <div className="row">
            <label className="field grow">
              Live URL
              <input type="text" value={form.live_url} placeholder="https://calc.msfgco.com"
                onChange={(e) => setForm({ ...form, live_url: e.target.value })} />
            </label>
            <label className="field grow">
              Description
              <input type="text" value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
          </div>
          {create.isError && <ErrorState error={create.error} />}
          <button className="btn primary" disabled={create.isPending || !form.name.trim()}>
            Add project
          </button>
        </form>
      )}
    </div>
  );
}
