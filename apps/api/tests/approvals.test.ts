import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { as, buildTestApp, taskWithOutput } from './helpers';

describe('human approval flow', () => {
  it('approve stores the decision, preserves edited final content separately, and audits it', async () => {
    const { app } = await buildTestApp();
    const { task, output } = await taskWithOutput(app);

    const edited = 'Final, human-edited response text.';
    const res = await request(app)
      .post(`/api/ai/outputs/${output.id}/approve`)
      .set(as.reviewer)
      .send({ reviewer_notes: 'Looks right after edits', edited_final_content: edited });
    expect(res.status).toBe(200);
    expect(res.body.output.review_status).toBe('APPROVED');
    expect(res.body.approval.decision).toBe('approved');
    expect(res.body.approval.reviewed_by).toBe('reviewer@test.local');

    // Edited final content preserved on the approval; raw AI output untouched.
    const detail = await request(app).get(`/api/ai/outputs/${output.id}`).set(as.viewer);
    expect(detail.body.approvals[0].edited_final_content).toBe(edited);
    expect(detail.body.content).not.toBe(edited);
    expect(detail.body.content).toContain('MOCK DRAFT');

    // Approval writes an audit event that includes the prompt version.
    const audit = await request(app).get(`/api/ai/tasks/${task.id}/audit`).set(as.viewer);
    const approvedEvent = audit.body.items.find(
      (e: { event_type: string }) => e.event_type === 'output.approved',
    );
    expect(approvedEvent).toBeTruthy();
    expect(approvedEvent.event_payload_json.prompt_version).toBe('condition_response_draft@1');
    expect(approvedEvent.event_payload_json.was_edited).toBe(true);
  });

  it('reject is terminal: a rejected output cannot be re-approved', async () => {
    const { app } = await buildTestApp();
    const { output } = await taskWithOutput(app);
    const reject = await request(app)
      .post(`/api/ai/outputs/${output.id}/reject`)
      .set(as.reviewer)
      .send({ reviewer_notes: 'Wrong guideline cited' });
    expect(reject.status).toBe(200);
    expect(reject.body.output.review_status).toBe('REJECTED');

    const reApprove = await request(app)
      .post(`/api/ai/outputs/${output.id}/approve`)
      .set(as.reviewer)
      .send({});
    expect(reApprove.status).toBe(409);
    expect(reApprove.body.error.code).toBe('INVALID_REVIEW_TRANSITION');
  });

  it('request-changes moves output and task into changes_requested', async () => {
    const { app } = await buildTestApp();
    const { task, output } = await taskWithOutput(app);
    const res = await request(app)
      .post(`/api/ai/outputs/${output.id}/request-changes`)
      .set(as.reviewer)
      .send({ reviewer_notes: 'Please add the LOX request' });
    expect(res.status).toBe(200);
    expect(res.body.output.review_status).toBe('CHANGES_REQUESTED');
    const taskDetail = await request(app).get(`/api/ai/tasks/${task.id}`).set(as.viewer);
    expect(taskDetail.body.status).toBe('changes_requested');
  });

  it('operators cannot approve (reviewer role required)', async () => {
    const { app } = await buildTestApp();
    const { output } = await taskWithOutput(app);
    const res = await request(app)
      .post(`/api/ai/outputs/${output.id}/approve`)
      .set(as.operator)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
  });

  it('finalize requires a prior approved review', async () => {
    const { app } = await buildTestApp();
    const { output } = await taskWithOutput(app);

    // NEEDS_REVIEW → FINALIZED is not a legal transition.
    const early = await request(app)
      .post(`/api/ai/outputs/${output.id}/finalize`)
      .set(as.reviewer);
    expect(early.status).toBe(409);

    await request(app).post(`/api/ai/outputs/${output.id}/approve`).set(as.reviewer).send({});
    const final = await request(app)
      .post(`/api/ai/outputs/${output.id}/finalize`)
      .set(as.reviewer);
    expect(final.status).toBe(200);
    expect(final.body.output.review_status).toBe('FINALIZED');
  });

  it('blocks self-review when REQUIRE_DIFFERENT_REVIEWER is on', async () => {
    const { app } = await buildTestApp({ requireDifferentReviewer: true });
    const { output } = await taskWithOutput(app);
    // Same email as the run requester, but with reviewer role.
    const res = await request(app)
      .post(`/api/ai/outputs/${output.id}/approve`)
      .set({ 'x-user-email': 'operator@test.local', 'x-user-role': 'reviewer' })
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELF_REVIEW_FORBIDDEN');
  });
});
