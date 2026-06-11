import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { as, buildTestApp, taskWithOutput } from './helpers';

describe('company budgets', () => {
  it('admin can set and clear a monthly budget', async () => {
    const { app, store } = await buildTestApp();
    const msfg = (await store.companies.getBySlug('msfg'))!;

    const set = await request(app)
      .patch(`/api/ai/companies/${msfg.id}`)
      .set(as.admin)
      .send({ monthly_budget: 150 })
      .expect(200);
    expect(set.body.monthly_budget).toBe('150.00');

    const cleared = await request(app)
      .patch(`/api/ai/companies/${msfg.id}`)
      .set(as.admin)
      .send({ monthly_budget: null })
      .expect(200);
    expect(cleared.body.monthly_budget).toBeNull();
  });

  it('GET /budget reports month-to-date spend against the budget', async () => {
    const { app, store } = await buildTestApp();
    const msfg = (await store.companies.getBySlug('msfg'))!;
    await request(app)
      .patch(`/api/ai/companies/${msfg.id}`)
      .set(as.admin)
      .send({ monthly_budget: 100 })
      .expect(200);

    // Mock-provider runs cost $0; backfill a cost to simulate real spend.
    const { run } = await taskWithOutput(app);
    await store.runs.update(run.id, { estimated_cost: '85.000000' });

    const res = await request(app).get('/api/ai/budget').set(as.viewer).expect(200);
    expect(res.body.company_id).toBe(msfg.id);
    expect(res.body.monthly_budget).toBe('100.00');
    expect(Number(res.body.month_to_date)).toBeCloseTo(85, 5);
    expect(res.body.ratio).toBeCloseTo(0.85, 4);
  });

  it('ratio is null when no budget is set', async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get('/api/ai/budget').set(as.viewer).expect(200);
    expect(res.body.monthly_budget).toBeNull();
    expect(res.body.ratio).toBeNull();
  });

  it('non-admins cannot change budgets', async () => {
    const { app, store } = await buildTestApp();
    const msfg = (await store.companies.getBySlug('msfg'))!;
    await request(app)
      .patch(`/api/ai/companies/${msfg.id}`)
      .set(as.reviewer)
      .send({ monthly_budget: 5 })
      .expect(403);
  });
});
