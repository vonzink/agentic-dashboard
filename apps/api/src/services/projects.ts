import { ApiError } from '../middleware/error';
import type { Store } from '../repositories/interfaces';
import type { AiOutput, AuthUser, Project, ProjectStatus } from '../types/domain';
import type { AuditService } from './audit';
import type { CompanyService } from './companies';
import type { DocumentService } from './documents';
import { assertRepoFormat, type GitHubClient } from './github';
import { manifestPathsToFetch, scanRepo, type RepoStructure } from './repoScan';
import type { RunService } from './runs';
import type { TaskService } from './tasks';

const MAP_WORKFLOW = 'project_architecture_map';

/**
 * Projects registry: the codebases/products ZVZ runs, each optionally
 * linked to its (private) GitHub repo. Sync pulls repo metadata and
 * imports the README into the company's document library so retrieval
 * can answer questions about each project. GitHub is read-only here —
 * the dashboard never writes to a repo.
 */
export class ProjectService {
  constructor(
    private store: Store,
    private audit: AuditService,
    private companies: CompanyService,
    private documents: DocumentService,
    private tasks: TaskService,
    private runs: RunService,
    private github: GitHubClient,
  ) {}

  list(companyId?: string): Promise<Project[]> {
    return this.store.projects.list(companyId);
  }

  async get(id: string): Promise<Project> {
    const project = await this.store.projects.get(id);
    if (!project) throw ApiError.notFound('Project');
    return project;
  }

  async create(
    actor: AuthUser,
    body: {
      name: string;
      company_id?: string | null;
      description?: string | null;
      github_repo?: string | null;
      live_url?: string | null;
      notes?: string | null;
    },
  ): Promise<Project> {
    if (body.github_repo) assertGitHubRepo(body.github_repo);
    const company = await this.companies.resolve(body.company_id);
    const project = await this.store.projects.create({
      company_id: company.id,
      name: body.name,
      description: body.description ?? null,
      github_repo: body.github_repo ?? null,
      live_url: body.live_url ?? null,
      status: 'active',
      notes: body.notes ?? null,
      github_meta_json: null,
      structure_json: null,
      github_synced_at: null,
      github_readme_sha: null,
      readme_document_id: null,
      created_by: actor.email,
    });
    await this.audit.record('project.created', {
      actor: actor.email,
      companyId: company.id,
      payload: { project_id: project.id, name: project.name, github_repo: project.github_repo },
    });
    return project;
  }

  async update(
    actor: AuthUser,
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      github_repo?: string | null;
      live_url?: string | null;
      status?: ProjectStatus;
      notes?: string | null;
    },
  ): Promise<Project> {
    if (patch.github_repo) assertGitHubRepo(patch.github_repo);
    const updated = await this.store.projects.update(id, patch);
    if (!updated) throw ApiError.notFound('Project');
    await this.audit.record('project.updated', {
      actor: actor.email,
      companyId: updated.company_id,
      payload: { project_id: id, patch },
    });
    return updated;
  }

  /**
   * Refreshes cached repo metadata and, when the README changed, imports
   * it as a new document in the project's company library (old versions
   * remain — documents are never destroyed).
   */
  async sync(actor: AuthUser, id: string): Promise<Project> {
    const project = await this.get(id);
    if (!project.github_repo) {
      throw ApiError.conflict('NO_REPO', `Project '${project.name}' has no github_repo set`);
    }

    let meta;
    try {
      meta = await this.github.getRepo(project.github_repo);
    } catch (err) {
      throw ApiError.conflict(
        'GITHUB_SYNC_FAILED',
        err instanceof Error ? err.message : 'GitHub request failed',
      );
    }

    let readmeSha = project.github_readme_sha;
    let readmeDocumentId = project.readme_document_id;
    const readme = await this.github.getReadme(project.github_repo).catch(() => null);
    if (readme && readme.sha !== project.github_readme_sha) {
      const doc = await this.documents.create(actor, {
        filename: `README — ${project.name} @ ${readme.sha.slice(0, 7)}.md`,
        file_type: 'text/markdown',
        document_type: 'other',
        classification: 'internal',
        content: readme.content,
        company_id: project.company_id,
        metadata_json: {
          source: 'github_readme',
          project_id: project.id,
          repo: project.github_repo,
          sha: readme.sha,
        },
      });
      readmeSha = readme.sha;
      readmeDocumentId = doc.id;
    }

    // Layer-1 structure scan: parsed facts (tree + languages + manifests).
    // Best-effort — a scan failure keeps the previous structure and never
    // fails the sync.
    let structure: RepoStructure | null = project.structure_json;
    try {
      const tree = await this.github.getTree(project.github_repo, meta.default_branch);
      const languages = await this.github.getLanguages(project.github_repo);
      const manifests: Record<string, string> = {};
      for (const path of manifestPathsToFetch(tree.entries)) {
        const content = await this.github.getFile(project.github_repo, path);
        if (content) manifests[path] = content;
      }
      structure = scanRepo({
        default_branch: meta.default_branch,
        entries: tree.entries,
        truncated: tree.truncated,
        languages,
        manifests,
      });
    } catch {
      // keep previous structure
    }

    const updated = (await this.store.projects.update(id, {
      github_meta_json: meta,
      structure_json: structure,
      github_synced_at: new Date().toISOString(),
      github_readme_sha: readmeSha,
      readme_document_id: readmeDocumentId,
    }))!;
    await this.audit.record('project.synced', {
      actor: actor.email,
      companyId: updated.company_id,
      payload: {
        project_id: id,
        repo: project.github_repo,
        pushed_at: meta.pushed_at,
        readme_imported: readme !== null && readme.sha === readmeSha && readmeDocumentId !== project.readme_document_id,
      },
    });
    return updated;
  }

  /**
   * Layer 2: drafts the AI architecture map for a project. Creates a
   * regular task (so the run, draft, review, and audit trail all flow
   * through the standard pipeline) with the deterministic repo scan and
   * README as grounding sources. The draft lands in the Approval Center;
   * only an approved map is displayed.
   */
  async generateMap(actor: AuthUser, id: string) {
    const project = await this.get(id);
    if (!project.structure_json && !project.readme_document_id) {
      throw ApiError.conflict(
        'NEEDS_SYNC',
        `Project '${project.name}' has no repo scan or README yet — run Sync from GitHub first`,
      );
    }

    const task = await this.tasks.create(actor, {
      title: `Architecture map — ${project.name}`,
      task_type: 'general',
      priority: 'normal',
      company_id: project.company_id,
      project_id: project.id,
      metadata_json: { purpose: 'architecture_map', project_id: project.id },
    });
    await this.tasks.addInput(actor, task.id, {
      input_type: 'instruction',
      content:
        `Map the architecture of the project "${project.name}"` +
        (project.github_repo ? ` (repo ${project.github_repo})` : '') +
        '. Ground every component in the provided repo scan and README.',
    });
    if (project.structure_json) {
      await this.tasks.addInput(actor, task.id, {
        input_type: 'source_snippet',
        content: renderStructure(project.structure_json),
      });
    }
    if (project.readme_document_id) {
      const doc = await this.store.documents.get(project.readme_document_id);
      if (doc) {
        await this.tasks.addInput(actor, task.id, {
          input_type: 'document_reference',
          content: doc.filename,
          source_document_id: doc.id,
        });
      }
    }

    const result = await this.runs.run(actor, task.id, MAP_WORKFLOW);
    return { task, ...result };
  }

  /** Most recent architecture-map output for a project (any review state). */
  async latestMap(projectId: string): Promise<AiOutput | null> {
    await this.get(projectId);
    const tasks = await this.store.tasks.list({ project_id: projectId, page: 1, pageSize: 100 });
    for (const task of tasks.items) {
      const runs = await this.store.runs.listByTask(task.id);
      for (const run of runs) {
        if (run.workflow_name !== MAP_WORKFLOW || run.status !== 'succeeded') continue;
        const outputs = await this.store.outputs.listByRun(run.id);
        if (outputs.length) return outputs[0]!;
      }
    }
    return null;
  }
}

/** Renders the deterministic scan as a prompt-friendly fact sheet. */
function renderStructure(s: RepoStructure): string {
  const lines = [
    'DETERMINISTIC REPO SCAN (parsed from the repository tree — ground truth):',
    `Default branch: ${s.default_branch} · ${s.total_files} files${s.tree_truncated ? ' (tree truncated)' : ''}`,
    `Detected stack: ${s.stack.join(', ') || '(none detected)'}`,
    `Languages (bytes): ${Object.entries(s.languages)
      .sort((a, b) => b[1] - a[1])
      .map(([l, b]) => `${l}=${b}`)
      .join(', ') || '(unknown)'}`,
    'Directories:',
    ...s.directories.map(
      (d) =>
        `- ${d.path}/ — role: ${d.role}, ${d.file_count} files${d.signals.length ? ` (signals: ${d.signals.join(', ')})` : ''}`,
    ),
  ];
  return lines.join('\n');
}

function assertGitHubRepo(ownerRepo: string): void {
  try {
    assertRepoFormat(ownerRepo);
  } catch (err) {
    throw ApiError.badRequest(err instanceof Error ? err.message : 'invalid github_repo');
  }
}
