import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { websiteQa } from '../src/workflows/registry';
import { addInput, as, buildTestApp, createTask, runWorkflow } from './helpers';

describe('website_qa agent', () => {
  it('runs end to end with retrieval and always carries the public disclaimer', async () => {
    const { app } = await buildTestApp();
    await request(app)
      .post('/api/ai/documents/upload')
      .set(as.operator)
      .field('document_type', 'guideline')
      .attach('file', Buffer.from('Approved site content: a pre-approval letter shows sellers you are a serious buyer.'), {
        filename: 'site-faq.txt',
        contentType: 'text/plain',
      });

    const task = await createTask(app, as.operator, {
      title: 'Visitor question',
      task_type: 'website_qa',
    });
    await addInput(app, task.id, {
      input_type: 'question',
      content: 'Why do I need a pre-approval letter before making an offer?',
    });
    const { outputs } = await runWorkflow(app, task.id, 'website_qa', { retrieve: true });

    const detail = await request(app).get(`/api/ai/outputs/${outputs[0]!.id}`).set(as.viewer);
    const s = detail.body.structured_json;
    expect(detail.body.review_status).toBe('NEEDS_REVIEW');
    expect(s.disclaimer).toMatch(/licensed/i);
    expect(s.warnings.join(' ')).toMatch(/human must review and publish/i);
    expect(detail.body.citations.length).toBeGreaterThan(0);
  });

  it('flags commitment wording and missing sources in public answers', () => {
    const noSources = websiteQa.assess(
      { answer: 'Yes you can refinance.', disclaimer: 'Talk to a licensed loan officer.', citations: [], confidence_label: 'HIGH' },
      { task_title: '', task_type: 'website_qa', primary_text: '', borrower_context: null, scenario: null, instructions: null, sources: [], options: {} },
    );
    expect(noSources.confidence).toBe('LOW');
    expect(noSources.warnings.join(' ')).toMatch(/must not be published/i);

    const committal = websiteQa.assess(
      {
        answer: 'You are approved! Your rate is 6.25% APR, guaranteed.',
        disclaimer: 'Talk to a licensed loan officer.',
        citations: [{ source_label: 'x', citation_text: 'y' }],
        confidence_label: 'HIGH',
      },
      {
        task_title: '', task_type: 'website_qa', primary_text: '', borrower_context: null,
        scenario: null, instructions: null,
        sources: [{ document_id: null, chunk_id: null, source_label: 'x', content: 'y', page_number: null }],
        options: {},
      },
    );
    expect(committal.confidence).toBe('LOW');
    expect(committal.warnings.join(' ')).toMatch(/never make commitments/i);
  });
});

describe('usage / cost reporting', () => {
  it('aggregates runs, tokens, and cost by workflow and day', async () => {
    const { app } = await buildTestApp();
    for (const [workflow, type] of [
      ['condition_response_draft', 'condition_response'],
      ['condition_response_draft', 'condition_response'],
      ['sop_lookup_answer', 'sop_lookup'],
    ] as const) {
      const task = await createTask(app, as.operator, { title: workflow, task_type: type });
      await addInput(app, task.id, { input_type: 'other', content: 'Synthetic context.' });
      await runWorkflow(app, task.id, workflow);
    }

    const res = await request(app).get('/api/ai/usage?days=7').set(as.viewer);
    expect(res.status).toBe(200);
    expect(res.body.days).toBe(7);
    expect(res.body.totals.runs).toBe(3);
    expect(res.body.totals.tokens_in).toBeGreaterThan(0);
    expect(Number(res.body.totals.estimated_cost)).toBe(0); // mock provider is free

    const byWorkflow = Object.fromEntries(
      res.body.by_workflow.map((w: { workflow_name: string; runs: number }) => [w.workflow_name, w.runs]),
    );
    expect(byWorkflow.condition_response_draft).toBe(2);
    expect(byWorkflow.sop_lookup_answer).toBe(1);
    expect(res.body.by_day).toHaveLength(1);
    expect(res.body.by_day[0].runs).toBe(3);
  });
});

describe('request-id correlation', () => {
  it('assigns an id and echoes a provided one', async () => {
    const { app } = await buildTestApp();
    const fresh = await request(app).get('/api/ai/tasks').set(as.viewer);
    expect(fresh.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);

    const echoed = await request(app)
      .get('/api/ai/tasks')
      .set(as.viewer)
      .set('x-request-id', 'alb-trace-12345');
    expect(echoed.headers['x-request-id']).toBe('alb-trace-12345');
  });
});
