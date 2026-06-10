import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { conditionResponseSchema } from '../src/workflows/types';
import { addInput, as, buildTestApp, createTask, runWorkflow, taskWithOutput } from './helpers';

describe('workflow runs', () => {
  it('persists run + output with full provenance and valid structured JSON', async () => {
    const { app } = await buildTestApp();
    const { task, run, output } = await taskWithOutput(app);

    const runDetail = await request(app).get(`/api/ai/runs/${run.id}`).set(as.viewer);
    expect(runDetail.status).toBe(200);
    expect(runDetail.body.status).toBe('succeeded');
    expect(runDetail.body.model_provider).toBe('mock');
    expect(runDetail.body.prompt_version).toBe('condition_response_draft@1'); // prompt version logged
    expect(runDetail.body.langgraph_run_id).toBeTruthy();
    expect(runDetail.body.input_snapshot_json.input.primary_text).toContain('paystubs');

    const outputDetail = await request(app).get(`/api/ai/outputs/${output.id}`).set(as.viewer);
    expect(outputDetail.status).toBe(200);
    expect(outputDetail.body.review_status).toBe('NEEDS_REVIEW');
    expect(outputDetail.body.requires_human_review).toBe(true);
    // Structured output validates against the contract schema.
    expect(() => conditionResponseSchema.parse(outputDetail.body.structured_json)).not.toThrow();

    const audit = await request(app).get(`/api/ai/tasks/${task.id}/audit`).set(as.viewer);
    const types = audit.body.items.map((e: { event_type: string }) => e.event_type);
    expect(types).toContain('run.requested');
    expect(types).toContain('run.completed');
    expect(types).toContain('output.created');
  });

  it('warns and caps confidence when no sources are provided', async () => {
    const { app } = await buildTestApp();
    const { output } = await taskWithOutput(app);
    const detail = await request(app).get(`/api/ai/outputs/${output.id}`).set(as.viewer);
    const structured = detail.body.structured_json;
    expect(structured.warnings.join(' ')).toMatch(/no source documents/i);
    expect(['LOW', 'MEDIUM']).toContain(structured.confidence_label);
  });

  it('persists citations linked to provided sources', async () => {
    const { app } = await buildTestApp();
    // Synthetic SOP document with a manual snippet (chunk 0).
    const doc = await request(app).post('/api/ai/documents').set(as.operator).send({
      filename: 'TEST-SOP-VOE.md',
      document_type: 'sop',
      classification: 'internal',
      content: 'Synthetic SOP: verbal VOE must be completed within 10 business days of closing.',
    });
    expect(doc.status).toBe(201);

    const task = await createTask(app, as.operator, {
      title: 'VOE question',
      task_type: 'sop_lookup',
    });
    await addInput(app, task.id, {
      input_type: 'question',
      content: 'When must the verbal VOE be completed?',
    });
    await addInput(app, task.id, {
      input_type: 'document_reference',
      content: 'TEST-SOP-VOE.md',
      source_document_id: doc.body.id,
    });

    const { outputs } = await runWorkflow(app, task.id, 'sop_lookup_answer');
    const detail = await request(app).get(`/api/ai/outputs/${outputs[0]!.id}`).set(as.viewer);
    expect(detail.body.citations.length).toBeGreaterThan(0);
    expect(detail.body.citations[0].document_id).toBe(doc.body.id);
    expect(detail.body.citations[0].citation_text).toContain('Synthetic SOP');
  });

  it('rejects unknown workflows', async () => {
    const { app } = await buildTestApp();
    const task = await createTask(app);
    const res = await request(app)
      .post(`/api/ai/tasks/${task.id}/runs`)
      .set(as.operator)
      .send({ workflow_name: 'does_not_exist' });
    expect(res.status).toBe(400);
  });

  it('runs all four implemented workflows end to end', async () => {
    const { app } = await buildTestApp();
    for (const [workflow, taskType] of [
      ['condition_response_draft', 'condition_response'],
      ['borrower_email_draft', 'borrower_email'],
      ['document_checklist_builder', 'document_checklist'],
      ['sop_lookup_answer', 'sop_lookup'],
    ] as const) {
      const task = await createTask(app, as.operator, { title: workflow, task_type: taskType });
      await addInput(app, task.id, { input_type: 'other', content: 'Synthetic test context.' });
      const { run, outputs } = await runWorkflow(app, task.id, workflow);
      expect(run.id).toBeTruthy();
      expect(outputs).toHaveLength(1);
      expect(outputs[0]!).toHaveProperty('review_status', 'NEEDS_REVIEW');
    }
  });
});
