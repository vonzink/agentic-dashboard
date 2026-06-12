import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { as } from './helpers';

// Shared fake-GitHub harness — no network.
import { buildProjectApp, createProject } from './projectHarness';

describe('project architecture map', () => {
  it('generates a draft map through the standard task/run/review pipeline', async () => {
    const { app } = await buildProjectApp();
    const { body: project } = await createProject(app);
    await request(app).post(`/api/ai/projects/${project.id}/sync`).set(as.operator).expect(200);

    const res = await request(app)
      .post(`/api/ai/projects/${project.id}/map`)
      .set(as.operator)
      .expect(201);

    // A real task, linked to the project, with the draft awaiting review.
    expect(res.body.task.project_id).toBe(project.id);
    expect(res.body.task.task_type).toBe('general');
    const output = res.body.outputs[0];
    expect(output.review_status).toBe('NEEDS_REVIEW');
    expect(output.structured_json.components.length).toBeGreaterThan(0);
    expect(output.structured_json.components[0]).toHaveProperty('kind');
    expect(output.structured_json.components[0]).toHaveProperty('talks_to');

    // The run was grounded in the scan + README sources.
    const runRow = await request(app)
      .get(`/api/ai/runs/${res.body.run.id}`)
      .set(as.viewer)
      .expect(200);
    const snapshot = runRow.body.input_snapshot_json.input;
    expect(snapshot.sources.length).toBeGreaterThan(0);
    expect(
      snapshot.sources.some((s: { content: string }) =>
        s.content.includes('DETERMINISTIC REPO SCAN'),
      ),
    ).toBe(true);
  });

  it('GET /projects/:id/map returns the latest draft and reflects approval', async () => {
    const { app } = await buildProjectApp();
    const { body: project } = await createProject(app);
    await request(app).post(`/api/ai/projects/${project.id}/sync`).set(as.operator).expect(200);

    const empty = await request(app)
      .get(`/api/ai/projects/${project.id}/map`)
      .set(as.viewer)
      .expect(200);
    expect(empty.body.output).toBeNull();

    const generated = await request(app)
      .post(`/api/ai/projects/${project.id}/map`)
      .set(as.operator)
      .expect(201);
    const outputId = generated.body.outputs[0].id;

    const draft = await request(app)
      .get(`/api/ai/projects/${project.id}/map`)
      .set(as.viewer)
      .expect(200);
    expect(draft.body.output.id).toBe(outputId);
    expect(draft.body.output.review_status).toBe('NEEDS_REVIEW');

    await request(app)
      .post(`/api/ai/outputs/${outputId}/approve`)
      .set(as.reviewer)
      .send({ reviewer_notes: 'Map verified against the repo.' })
      .expect(200);

    const approved = await request(app)
      .get(`/api/ai/projects/${project.id}/map`)
      .set(as.viewer)
      .expect(200);
    expect(approved.body.output.review_status).toBe('APPROVED');
  });

  it('refuses to map a project that has never been synced', async () => {
    const { app } = await buildProjectApp();
    const { body: project } = await createProject(app, { name: 'unsynced' });
    const res = await request(app)
      .post(`/api/ai/projects/${project.id}/map`)
      .set(as.operator);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NEEDS_SYNC');
  });
});
