import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { as, buildTestApp } from './helpers';
import { buildProjectApp, createProject } from './projectHarness';

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
      structure_json: null, import_graph_json: null, github_synced_at: null, github_readme_sha: null,
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
      structure_json: null, import_graph_json: null, github_synced_at: null, github_readme_sha: null,
      readme_document_id: null, created_by: 'admin@test.local',
    });
    const res = await request(app).post(`/api/ai/projects/${project.id}/sync`).set(as.operator);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('GITHUB_TOKEN unset');
  });
});
