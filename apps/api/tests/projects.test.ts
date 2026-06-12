import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { MemoryStore } from '../src/repositories/memory';
import { buildApp } from '../src/app';
import { seedDefaults } from '../src/services/seed';
import type { GitHubClient } from '../src/services/github';
import type { GitHubRepoMeta } from '../src/types/domain';
import { as, buildTestApp, MemoryBlobStorage } from './helpers';

/** Deterministic GitHub double — tests never touch the network. */
class FakeGitHub implements GitHubClient {
  meta: GitHubRepoMeta = {
    description: 'MSFG mortgage calculator',
    default_branch: 'main',
    pushed_at: '2026-06-10T12:00:00Z',
    open_issues: 2,
    stars: 0,
    private: true,
    html_url: 'https://github.com/vonzink/msfg-calc',
  };
  readme: { content: string; sha: string } | null = {
    content: '# msfg-calc\n\nRate and payment calculators for MSFG.',
    sha: 'sha-v1',
  };
  async getRepo(ownerRepo: string): Promise<GitHubRepoMeta> {
    if (ownerRepo === 'vonzink/missing') {
      throw new Error(`GitHub repo '${ownerRepo}' not found or the token lacks access to it`);
    }
    return this.meta;
  }
  async getReadme(): Promise<{ content: string; sha: string } | null> {
    return this.readme;
  }
  tree = {
    entries: [
      { path: 'web', type: 'tree' as const },
      { path: 'web/package.json', type: 'blob' as const },
      { path: 'web/src/App.tsx', type: 'blob' as const },
      { path: 'web/src/styles.css', type: 'blob' as const },
      { path: 'server', type: 'tree' as const },
      { path: 'server/package.json', type: 'blob' as const },
      { path: 'server/index.ts', type: 'blob' as const },
      { path: 'migrations/0001_init.sql', type: 'blob' as const },
      { path: 'Dockerfile', type: 'blob' as const },
      { path: 'README.md', type: 'blob' as const },
    ],
    truncated: false,
  };
  async getTree() {
    return this.tree;
  }
  async getLanguages(): Promise<Record<string, number>> {
    return { TypeScript: 9000, CSS: 800 };
  }
  async getFile(_repo: string, path: string): Promise<string | null> {
    if (path === 'web/package.json') {
      return JSON.stringify({ dependencies: { react: '^18', vite: '^5' } });
    }
    if (path === 'server/package.json') {
      return JSON.stringify({ dependencies: { express: '^4', pg: '^8' } });
    }
    return null;
  }
}

async function buildProjectApp() {
  const config = loadConfig({
    env: 'local',
    authMode: 'dev',
    databaseUrl: null,
    modelProvider: 'mock',
    smtp: null,
    appBaseUrl: null,
    githubToken: 'fake-token-not-real',
  });
  const store = new MemoryStore();
  await seedDefaults(store);
  const github = new FakeGitHub();
  const { app, services } = buildApp(store, config, {
    storage: new MemoryBlobStorage(),
    github,
  });
  return { app, store, services, github };
}

const createProject = (app: Parameters<typeof request>[0], body: object = {}) =>
  request(app)
    .post('/api/ai/projects')
    .set(as.admin)
    .send({ name: 'msfg-calc', github_repo: 'vonzink/msfg-calc', ...body });

describe('projects registry', () => {
  it('admin creates a project; viewers can list it', async () => {
    const { app } = await buildProjectApp();
    const created = await createProject(app, { live_url: 'https://calc.msfgco.com' });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('active');

    const list = await request(app).get('/api/ai/projects').set(as.viewer).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].github_repo).toBe('vonzink/msfg-calc');

    await request(app).post('/api/ai/projects').set(as.operator).send({ name: 'x' }).expect(403);
  });

  it('rejects malformed github_repo values', async () => {
    const { app } = await buildProjectApp();
    const res = await createProject(app, { github_repo: 'https://github.com/vonzink/msfg-calc.git' });
    expect(res.status).toBe(400);
  });

  it('sync caches repo metadata and imports the README into the document library', async () => {
    const { app, store } = await buildProjectApp();
    const { body: project } = await createProject(app);

    const synced = await request(app)
      .post(`/api/ai/projects/${project.id}/sync`)
      .set(as.operator)
      .expect(200);
    expect(synced.body.github_meta_json.open_issues).toBe(2);
    expect(synced.body.github_meta_json.private).toBe(true);
    expect(synced.body.github_synced_at).toBeTruthy();
    expect(synced.body.readme_document_id).toBeTruthy();

    // README became a chunked, searchable document in the company library.
    const doc = (await store.documents.get(synced.body.readme_document_id))!;
    expect(doc.filename).toContain('README — msfg-calc');
    expect(doc.company_id).toBe(project.company_id);
    const chunks = await store.chunks.listByDocument(doc.id);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.content).toContain('msfg-calc');
  });

  it('sync stores the deterministic structure scan', async () => {
    const { app } = await buildProjectApp();
    const { body: project } = await createProject(app);
    const synced = await request(app)
      .post(`/api/ai/projects/${project.id}/sync`)
      .set(as.operator)
      .expect(200);

    const structure = synced.body.structure_json;
    expect(structure.total_files).toBe(8);
    expect(structure.languages.TypeScript).toBe(9000);
    expect(structure.stack).toEqual(
      expect.arrayContaining(['React', 'Vite', 'Express', 'Postgres (pg)', 'Node.js', 'Docker', 'SQL migrations']),
    );
    const roles = Object.fromEntries(
      structure.directories.map((d: { path: string; role: string }) => [d.path, d.role]),
    );
    expect(roles.web).toBe('frontend');
    expect(roles.server).toBe('backend');
    expect(roles.migrations).toBe('database');
  });

  it('re-sync skips README import when the sha is unchanged, re-imports on change', async () => {
    const { app, github } = await buildProjectApp();
    const { body: project } = await createProject(app);

    const first = await request(app).post(`/api/ai/projects/${project.id}/sync`).set(as.operator);
    const second = await request(app).post(`/api/ai/projects/${project.id}/sync`).set(as.operator);
    expect(second.body.readme_document_id).toBe(first.body.readme_document_id);

    github.readme = { content: '# msfg-calc v2', sha: 'sha-v2' };
    const third = await request(app).post(`/api/ai/projects/${project.id}/sync`).set(as.operator);
    expect(third.body.readme_document_id).not.toBe(first.body.readme_document_id);
    expect(third.body.github_readme_sha).toBe('sha-v2');
  });

  it('sync failures surface clearly and change nothing', async () => {
    const { app } = await buildProjectApp();
    const { body: project } = await createProject(app, {
      name: 'ghost',
      github_repo: 'vonzink/missing',
    });
    const res = await request(app).post(`/api/ai/projects/${project.id}/sync`).set(as.operator);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_SYNC_FAILED');
    expect(res.body.error.message).toContain('not found or the token lacks access');
  });

  it('tasks link to projects and filter by them — same company only', async () => {
    const { app, store } = await buildProjectApp();
    const { body: project } = await createProject(app);

    const task = await request(app)
      .post('/api/ai/tasks')
      .set(as.operator)
      .send({ title: 'Calc copy review', task_type: 'general', project_id: project.id })
      .expect(201);
    expect(task.body.project_id).toBe(project.id);

    const filtered = await request(app)
      .get(`/api/ai/tasks?project_id=${project.id}`)
      .set(as.viewer)
      .expect(200);
    expect(filtered.body.total).toBe(1);

    // A project from another company cannot be attached.
    const acme = await store.companies.create({
      name: 'Acme', slug: 'acme', is_active: true, monthly_budget: null,
    });
    const foreign = await store.projects.create({
      company_id: acme.id, name: 'acme-site', description: null, github_repo: null,
      live_url: null, status: 'active', notes: null, github_meta_json: null,
      structure_json: null, github_synced_at: null, github_readme_sha: null,
      readme_document_id: null, created_by: 'admin@test.local',
    });
    await request(app)
      .post('/api/ai/tasks')
      .set(as.operator)
      .send({ title: 'cross-company', task_type: 'general', project_id: foreign.id })
      .expect(400);
  });

  it('sync without GITHUB_TOKEN explains itself', async () => {
    const { app, store } = await buildTestApp();
    const msfg = (await store.companies.getBySlug('msfg'))!;
    const project = await store.projects.create({
      company_id: msfg.id, name: 'p', description: null, github_repo: 'vonzink/p',
      live_url: null, status: 'active', notes: null, github_meta_json: null,
      structure_json: null, github_synced_at: null, github_readme_sha: null,
      readme_document_id: null, created_by: 'admin@test.local',
    });
    const res = await request(app).post(`/api/ai/projects/${project.id}/sync`).set(as.operator);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('GITHUB_TOKEN unset');
  });
});
