import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { as, buildTestApp, taskWithOutput } from './helpers';

/**
 * Compliance guardrail tests — docs/AI_COMPLIANCE_GUARDRAILS.md.
 * These verify that NO external action can occur without an approved,
 * finalized human review, and that every refusal is audited.
 */

async function proposeAction(app: Express, taskId: string, approvalId?: string) {
  const res = await request(app)
    .post(`/api/ai/tasks/${taskId}/actions`)
    .set(as.operator)
    .send({
      action_type: 'send_email',
      target_system: 'noop',
      request_payload_json: { to: 'test-borrower@example.com' },
      ...(approvalId ? { approval_id: approvalId } : {}),
    });
  expect(res.status).toBe(201);
  expect(res.body.status).toBe('proposed');
  return res.body;
}

describe('compliance guardrails: no action without approval', () => {
  it('refuses to execute an action with no approval, and audits the refusal', async () => {
    const { app } = await buildTestApp({ integrationExecutionEnabled: true });
    const { task } = await taskWithOutput(app);
    const action = await proposeAction(app, task.id);

    const res = await request(app).post(`/api/ai/actions/${action.id}/execute`).set(as.reviewer);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('APPROVAL_REQUIRED');

    const audit = await request(app).get(`/api/ai/tasks/${task.id}/audit`).set(as.viewer);
    const blocked = audit.body.items.find(
      (e: { event_type: string }) => e.event_type === 'action.blocked',
    );
    expect(blocked).toBeTruthy();
    expect(blocked.event_payload_json.reason).toBe('APPROVAL_REQUIRED');
  });

  it('refuses to execute when the referenced review was a rejection', async () => {
    const { app } = await buildTestApp({ integrationExecutionEnabled: true });
    const { task, output } = await taskWithOutput(app);
    const rejection = await request(app)
      .post(`/api/ai/outputs/${output.id}/reject`)
      .set(as.reviewer)
      .send({ reviewer_notes: 'No.' });
    const action = await proposeAction(app, task.id, rejection.body.approval.id);

    const res = await request(app).post(`/api/ai/actions/${action.id}/execute`).set(as.reviewer);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('APPROVAL_REQUIRED'); // decision != approved
  });

  it('refuses to execute when the output was rejected after approval', async () => {
    const { app } = await buildTestApp({ integrationExecutionEnabled: true });
    const { task, output } = await taskWithOutput(app);
    const approval = await request(app)
      .post(`/api/ai/outputs/${output.id}/approve`)
      .set(as.reviewer)
      .send({});
    // Output later rejected (APPROVED → REJECTED is allowed).
    await request(app)
      .post(`/api/ai/outputs/${output.id}/reject`)
      .set(as.reviewer)
      .send({ reviewer_notes: 'Reversing the approval' });

    const action = await proposeAction(app, task.id, approval.body.approval.id);
    const res = await request(app).post(`/api/ai/actions/${action.id}/execute`).set(as.reviewer);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('OUTPUT_REJECTED');
  });

  it('requires the output to be FINALIZED, not merely approved', async () => {
    const { app } = await buildTestApp({ integrationExecutionEnabled: true });
    const { task, output } = await taskWithOutput(app);
    const approval = await request(app)
      .post(`/api/ai/outputs/${output.id}/approve`)
      .set(as.reviewer)
      .send({});
    const action = await proposeAction(app, task.id, approval.body.approval.id);
    const res = await request(app).post(`/api/ai/actions/${action.id}/execute`).set(as.reviewer);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('OUTPUT_NOT_FINALIZED');
  });

  it('blocks execution globally when INTEGRATION_EXECUTION_ENABLED is off (propose-only mode)', async () => {
    const { app } = await buildTestApp(); // execution disabled by default
    const { task, output } = await taskWithOutput(app);
    const approval = await request(app)
      .post(`/api/ai/outputs/${output.id}/approve`)
      .set(as.reviewer)
      .send({});
    await request(app).post(`/api/ai/outputs/${output.id}/finalize`).set(as.reviewer);

    const action = await proposeAction(app, task.id, approval.body.approval.id);
    const res = await request(app).post(`/api/ai/actions/${action.id}/execute`).set(as.reviewer);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EXECUTION_DISABLED');
  });

  it('executes (simulated noop) only after approve + finalize, and completes the status flow', async () => {
    const { app } = await buildTestApp({ integrationExecutionEnabled: true });
    const { task, output } = await taskWithOutput(app);
    const approval = await request(app)
      .post(`/api/ai/outputs/${output.id}/approve`)
      .set(as.reviewer)
      .send({ edited_final_content: 'Human-approved final text.' });
    await request(app).post(`/api/ai/outputs/${output.id}/finalize`).set(as.reviewer);

    const action = await proposeAction(app, task.id, approval.body.approval.id);
    const res = await request(app).post(`/api/ai/actions/${action.id}/execute`).set(as.reviewer);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('executed');
    expect(res.body.response_payload_json.simulated).toBe(true);

    const detail = await request(app).get(`/api/ai/outputs/${output.id}`).set(as.viewer);
    expect(detail.body.review_status).toBe('ACTION_COMPLETED');

    const audit = await request(app).get(`/api/ai/tasks/${task.id}/audit`).set(as.viewer);
    const executed = audit.body.items.find(
      (e: { event_type: string }) => e.event_type === 'action.executed',
    );
    expect(executed.event_payload_json.approval_id).toBe(approval.body.approval.id);
  });

  it('operators cannot execute actions at all', async () => {
    const { app } = await buildTestApp({ integrationExecutionEnabled: true });
    const { task } = await taskWithOutput(app);
    const action = await proposeAction(app, task.id);
    const res = await request(app).post(`/api/ai/actions/${action.id}/execute`).set(as.operator);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
  });

  it('audit log has no update/delete surface (append-only by construction)', async () => {
    const { store } = await buildTestApp();
    // The Store interface exposes only append/list — verify at runtime too.
    expect(Object.keys(store.audit).sort()).toEqual(['append', 'list', 'listByTask']);
  });
});
