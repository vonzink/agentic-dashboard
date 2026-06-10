import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { as, buildTestApp, createTask } from './helpers';

describe('tasks API', () => {
  it('creates a task and writes an audit event', async () => {
    const { app } = await buildTestApp();
    const task = await createTask(app, as.operator, { priority: 'high' });
    expect(task.status).toBe('open');
    expect(task.priority).toBe('high');
    expect(task.created_by).toBe('operator@test.local');

    const audit = await request(app).get(`/api/ai/tasks/${task.id}/audit`).set(as.viewer);
    expect(audit.status).toBe(200);
    expect(audit.body.items.map((e: { event_type: string }) => e.event_type)).toContain(
      'task.created',
    );
  });

  it('rejects invalid bodies with VALIDATION_ERROR', async () => {
    const { app } = await buildTestApp();
    const res = await request(app)
      .post('/api/ai/tasks')
      .set(as.operator)
      .send({ title: '', task_type: 'not_a_type' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('forbids viewers from creating tasks', async () => {
    const { app } = await buildTestApp();
    const res = await request(app)
      .post('/api/ai/tasks')
      .set(as.viewer)
      .send({ title: 'x', task_type: 'general' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
  });

  it('filters and paginates the task list', async () => {
    const { app } = await buildTestApp();
    await createTask(app, as.operator, { title: 'A', task_type: 'sop_lookup' });
    await createTask(app, as.operator, { title: 'B', task_type: 'general' });
    const res = await request(app)
      .get('/api/ai/tasks?task_type=sop_lookup&page=1&pageSize=10')
      .set(as.viewer);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].title).toBe('A');
  });

  it('archives instead of deleting', async () => {
    const { app } = await buildTestApp();
    const task = await createTask(app);
    const res = await request(app).post(`/api/ai/tasks/${task.id}/archive`).set(as.operator);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('archived');
    // Still readable — nothing is physically deleted.
    const detail = await request(app).get(`/api/ai/tasks/${task.id}`).set(as.viewer);
    expect(detail.status).toBe(200);
  });
});
