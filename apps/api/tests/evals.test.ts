import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { as, buildTestApp } from './helpers';

async function createCase(
  app: Awaited<ReturnType<typeof buildTestApp>>['app'],
  body: Record<string, unknown> = {},
) {
  const res = await request(app)
    .post('/api/ai/evals/cases')
    .set(as.admin)
    .send({
      workflow_name: 'condition_response_draft',
      name: 'Paystub condition (synthetic)',
      primary_text: 'Provide most recent 30 days of paystubs for Test Borrower A.',
      contains: ['paystub'],
      ...body,
    });
  expect(res.status).toBe(201);
  return res.body;
}

describe('eval sets', () => {
  it('admin creates cases; everyone can list them', async () => {
    const { app } = await buildTestApp();
    const created = await createCase(app);
    expect(created.expectations_json.contains).toEqual(['paystub']);

    const list = await request(app)
      .get('/api/ai/evals/cases?workflow_name=condition_response_draft')
      .set(as.viewer)
      .expect(200);
    expect(list.body.items).toHaveLength(1);

    await request(app)
      .post('/api/ai/evals/cases')
      .set(as.operator)
      .send({ workflow_name: 'condition_response_draft', name: 'x', primary_text: 'y' })
      .expect(403);
  });

  it('runs the eval set and records pass/fail per expectation', async () => {
    const { app, store } = await buildTestApp();
    await createCase(app); // mock output mentions 'paystub' -> passes
    await createCase(app, {
      name: 'Impossible expectation',
      contains: ['unobtainium-string-the-mock-never-says'],
    });

    const run = await request(app)
      .post('/api/ai/evals/run')
      .set(as.admin)
      .send({ workflow_name: 'condition_response_draft' })
      .expect(201);

    expect(run.body.passed_count).toBe(1);
    expect(run.body.failed_count).toBe(1);
    expect(run.body.prompt_version).toMatch(/^condition_response_draft@\d+$/);
    expect(run.body.model_provider).toBe('mock');

    const failing = run.body.results_json.find(
      (r: { case_name: string }) => r.case_name === 'Impossible expectation',
    );
    expect(failing.passed).toBe(false);
    expect(failing.failures[0]).toContain('unobtainium');

    // Sandboxed: no tasks or review-queue entries were created.
    const tasks = await store.tasks.list({ page: 1, pageSize: 10 });
    expect(tasks.total).toBe(0);

    const runs = await request(app)
      .get('/api/ai/evals/runs?workflow_name=condition_response_draft')
      .set(as.viewer)
      .expect(200);
    expect(runs.body.items).toHaveLength(1);
  });

  it('enforces min_confidence expectations', async () => {
    const { app } = await buildTestApp();
    // Mock confidence is LOW without sources; require HIGH to force a failure.
    await createCase(app, { name: 'Needs HIGH', contains: [], min_confidence: 'HIGH' });
    const run = await request(app)
      .post('/api/ai/evals/run')
      .set(as.admin)
      .send({ workflow_name: 'condition_response_draft' })
      .expect(201);
    expect(run.body.failed_count).toBe(1);
    expect(run.body.results_json[0].failures[0]).toMatch(/confidence .* below required HIGH/);
  });

  it('deactivated cases are skipped; empty sets refuse to run', async () => {
    const { app } = await buildTestApp();
    const c = await createCase(app);
    await request(app)
      .patch(`/api/ai/evals/cases/${c.id}`)
      .set(as.admin)
      .send({ is_active: false })
      .expect(200);

    const res = await request(app)
      .post('/api/ai/evals/run')
      .set(as.admin)
      .send({ workflow_name: 'condition_response_draft' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_EVAL_CASES');
  });

  it('can target a specific (inactive) prompt version', async () => {
    const { app } = await buildTestApp();
    await createCase(app);
    // Draft v2 of the prompt, NOT activated.
    const v2 = await request(app)
      .post('/api/ai/prompts')
      .set(as.admin)
      .send({
        name: 'condition_response_draft',
        task_type: 'condition_response',
        system_prompt: 'You are a careful mortgage assistant. {{company}}',
        user_prompt_template: 'Condition: {{primary_text}}\nSources: {{sources}}',
      })
      .expect(201);

    const run = await request(app)
      .post('/api/ai/evals/run')
      .set(as.admin)
      .send({ workflow_name: 'condition_response_draft', prompt_id: v2.body.id })
      .expect(201);
    expect(run.body.prompt_version).toBe(`condition_response_draft@${v2.body.version}`);
  });
});
