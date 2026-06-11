import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { guessTaskType } from '../src/routes/intake';
import { as, buildTestApp } from './helpers';

const email = {
  from: 'processor@msfg.example',
  subject: 'Underwriting condition: 30 days of paystubs',
  body: 'The underwriter is asking for the most recent 30 days of paystubs for Test Borrower A.',
};

describe('guessTaskType', () => {
  it('routes by keywords with a safe default', () => {
    expect(guessTaskType('Underwriting condition', 'x')).toBe('condition_response');
    expect(guessTaskType('What documents are needed?', 'checklist please')).toBe('document_checklist');
    expect(guessTaskType('FHA guideline question', 'per policy...')).toBe('sop_lookup');
    expect(guessTaskType('Lunch on Friday', 'no keywords here')).toBe('general');
  });
});

describe('POST /api/intake/email', () => {
  it('is disabled when INTAKE_TOKEN is unset', async () => {
    const { app } = await buildTestApp({ intakeToken: null });
    const res = await request(app).post('/api/intake/email').send(email);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('INTAKE_DISABLED');
  });

  it('rejects a missing or wrong token', async () => {
    const { app } = await buildTestApp({ intakeToken: 'right-token' });
    await request(app).post('/api/intake/email').send(email).expect(401);
    await request(app)
      .post('/api/intake/email')
      .set('x-intake-token', 'wrong-token')
      .send(email)
      .expect(401);
  });

  it('creates an open task with the email body as input, fully audited', async () => {
    const { app, store } = await buildTestApp({ intakeToken: 'right-token' });
    const res = await request(app)
      .post('/api/intake/email')
      .set('x-intake-token', 'right-token')
      .send(email)
      .expect(201);
    expect(res.body.task_type).toBe('condition_response');

    const task = (await store.tasks.get(res.body.task_id))!;
    expect(task.status).toBe('open');
    expect(task.title).toBe(email.subject);
    expect(task.created_by).toBe(`intake:${email.from}`);
    expect(task.metadata_json).toMatchObject({ intake: 'email', from: email.from });

    const inputs = await store.taskInputs.listByTask(task.id);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.input_type).toBe('condition_text');
    expect(inputs[0]!.content).toBe(email.body);

    // No AI ran — human initiation still required.
    expect(await store.runs.listByTask(task.id)).toHaveLength(0);

    const audit = await store.audit.listByTask(task.id);
    expect(audit.map((e) => e.event_type)).toEqual(
      expect.arrayContaining(['task.created', 'input.added']),
    );
  });

  it('honors an explicit company_slug and rejects unknown ones', async () => {
    const { app, services, store } = await buildTestApp({ intakeToken: 't' });
    const acme = await services.companies.create(
      { email: 'admin@test.local', role: 'admin' },
      { name: 'Acme Lending', slug: 'acme' },
    );

    const res = await request(app)
      .post('/api/intake/email')
      .set('x-intake-token', 't')
      .send({ ...email, company_slug: 'acme' })
      .expect(201);
    expect((await store.tasks.get(res.body.task_id))!.company_id).toBe(acme.id);

    await request(app)
      .post('/api/intake/email')
      .set('x-intake-token', 't')
      .send({ ...email, company_slug: 'nope' })
      .expect(400);
  });

  it('intake-created tasks appear in the normal task queue', async () => {
    const { app } = await buildTestApp({ intakeToken: 't' });
    await request(app).post('/api/intake/email').set('x-intake-token', 't').send(email).expect(201);
    const list = await request(app).get('/api/ai/tasks').set(as.viewer).expect(200);
    expect(list.body.total).toBe(1);
  });
});
