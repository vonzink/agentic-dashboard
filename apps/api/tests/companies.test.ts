import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { addInput, as, buildTestApp, createTask } from './helpers';

async function createCompany(app: Express, name: string, slug: string) {
  const res = await request(app).post('/api/ai/companies').set(as.admin).send({ name, slug });
  expect(res.status).toBe(201);
  return res.body;
}

async function uploadFor(app: Express, companyId: string, filename: string, body: string) {
  const res = await request(app)
    .post('/api/ai/documents/upload')
    .set(as.operator)
    .field('document_type', 'sop')
    .field('company_id', companyId)
    .attach('file', Buffer.from(body), { filename, contentType: 'text/plain' });
  expect(res.status).toBe(201);
  return res.body;
}

describe('companies', () => {
  it('seeds MSFG as the default and uses it when no company is given', async () => {
    const { app } = await buildTestApp();
    const list = await request(app).get('/api/ai/companies').set(as.viewer);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].slug).toBe('msfg');

    const task = await createTask(app); // no company_id
    expect(task.company_id).toBe(list.body.items[0].id);
  });

  it('admin-only management; slugs are unique; deactivation blocks new work', async () => {
    const { app } = await buildTestApp();
    await request(app).post('/api/ai/companies').set(as.operator).send({ name: 'X', slug: 'x1' }).expect(403);
    const co = await createCompany(app, 'Acme Lending', 'acme');
    await request(app).post('/api/ai/companies').set(as.admin).send({ name: 'Other', slug: 'acme' }).expect(409);

    await request(app).patch(`/api/ai/companies/${co.id}`).set(as.admin).send({ is_active: false }).expect(200);
    const res = await request(app)
      .post('/api/ai/tasks')
      .set(as.operator)
      .send({ title: 'nope', task_type: 'general', company_id: co.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COMPANY_INACTIVE');
  });

  it('scopes task and document lists by company', async () => {
    const { app } = await buildTestApp();
    const acme = await createCompany(app, 'Acme Lending', 'acme');
    await createTask(app, as.operator, { title: 'MSFG task' });
    await createTask(app, as.operator, { title: 'Acme task', company_id: acme.id });

    const acmeTasks = await request(app).get(`/api/ai/tasks?company_id=${acme.id}`).set(as.viewer);
    expect(acmeTasks.body.total).toBe(1);
    expect(acmeTasks.body.items[0].title).toBe('Acme task');

    await uploadFor(app, acme.id, 'acme-sop.txt', 'Acme SOP text.');
    const msfgDocs = await request(app)
      .get(`/api/ai/documents?company_id=${(await request(app).get('/api/ai/companies').set(as.viewer)).body.items.find((c: { slug: string }) => c.slug === 'msfg').id}`)
      .set(as.viewer);
    expect(msfgDocs.body.total).toBe(0);
  });

  it("ISOLATION: one company's documents never ground another's answers", async () => {
    const { app } = await buildTestApp();
    const companies = (await request(app).get('/api/ai/companies').set(as.viewer)).body.items;
    const msfg = companies[0];
    const acme = await createCompany(app, 'Acme Lending', 'acme');

    // Same topic in both corpora, different content.
    await uploadFor(app, msfg.id, 'msfg-reserves.txt',
      'MSFG policy: reserves of two months PITI are required for second homes.');
    const acmeDoc = await uploadFor(app, acme.id, 'acme-reserves.txt',
      'Acme policy: reserves of six months PITI are required for second homes.');

    // /search scoped to Acme returns only Acme chunks.
    const search = await request(app)
      .get(`/api/ai/search?q=reserves required for second homes&company_id=${acme.id}`)
      .set(as.viewer);
    expect(search.body.items.length).toBeGreaterThan(0);
    for (const hit of search.body.items) expect(hit.document_id).toBe(acmeDoc.id);

    // A retrieval-grounded run on an Acme task cites only Acme documents.
    const task = await createTask(app, as.operator, {
      title: 'Acme reserves question', task_type: 'sop_lookup', company_id: acme.id,
    });
    await addInput(app, task.id, {
      input_type: 'question',
      content: 'How many months of PITI reserves are required for second homes?',
    });
    const run = await request(app)
      .post(`/api/ai/tasks/${task.id}/runs`)
      .set(as.operator)
      .send({ workflow_name: 'sop_lookup_answer', options: { retrieve: true } });
    expect(run.status).toBe(201);

    const snapshot = (await request(app).get(`/api/ai/runs/${run.body.run.id}`).set(as.viewer)).body
      .input_snapshot_json;
    expect(snapshot.retrieval.hits.length).toBeGreaterThan(0);
    for (const hit of snapshot.retrieval.hits) expect(hit.document_id).toBe(acmeDoc.id);
    for (const source of snapshot.input.sources) expect(source.document_id).toBe(acmeDoc.id);

    const output = await request(app)
      .get(`/api/ai/outputs/${run.body.outputs[0].id}`)
      .set(as.viewer);
    for (const c of output.body.citations) expect(c.document_id).toBe(acmeDoc.id);
  });

  it('injects the company name into rendered prompts and tags audit events', async () => {
    const { app } = await buildTestApp();
    const acme = await createCompany(app, 'Acme Lending', 'acme');
    const task = await createTask(app, as.operator, {
      title: 'Acme task', task_type: 'sop_lookup', company_id: acme.id,
    });
    await addInput(app, task.id, { input_type: 'question', content: 'Q?' });
    const run = await request(app)
      .post(`/api/ai/tasks/${task.id}/runs`)
      .set(as.operator)
      .send({ workflow_name: 'sop_lookup_answer' });
    const snapshot = (await request(app).get(`/api/ai/runs/${run.body.run.id}`).set(as.viewer)).body
      .input_snapshot_json;
    expect(snapshot.input.company_name).toBe('Acme Lending');

    const audit = await request(app).get(`/api/ai/audit?company_id=${acme.id}`).set(as.viewer);
    const types = audit.body.items.map((e: { event_type: string }) => e.event_type);
    expect(types).toContain('task.created');
    expect(types).toContain('run.completed');
    expect(audit.body.items.every((e: { company_id: string }) => e.company_id === acme.id)).toBe(true);
  });

  it('filters usage by company', async () => {
    const { app } = await buildTestApp();
    const acme = await createCompany(app, 'Acme Lending', 'acme');
    for (const companyId of [undefined, acme.id]) {
      const task = await createTask(app, as.operator, {
        title: 't', task_type: 'general', ...(companyId ? { company_id: companyId } : {}),
      });
      await addInput(app, task.id, { input_type: 'other', content: 'ctx' });
      await request(app)
        .post(`/api/ai/tasks/${task.id}/runs`)
        .set(as.operator)
        .send({ workflow_name: 'condition_response_draft' })
        .expect(201);
    }
    const all = await request(app).get('/api/ai/usage?days=7').set(as.viewer);
    const acmeOnly = await request(app).get(`/api/ai/usage?days=7&company_id=${acme.id}`).set(as.viewer);
    expect(all.body.totals.runs).toBe(2);
    expect(acmeOnly.body.totals.runs).toBe(1);
  });
});
