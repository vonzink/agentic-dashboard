import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { editRatio } from '../src/services/quality';
import { as, buildTestApp, taskWithOutput } from './helpers';

describe('editRatio', () => {
  it('is 0 for identical content and 1 for a full rewrite', () => {
    expect(editRatio('keep this draft as is', 'keep this draft as is')).toBe(0);
    expect(editRatio('alpha beta', 'gamma delta epsilon')).toBe(1);
  });

  it('reflects partial edits proportionally', () => {
    const ratio = editRatio('one two three four', 'one two three five');
    expect(ratio).toBeCloseTo(0.25, 5);
  });
});

describe('GET /api/ai/quality', () => {
  it('aggregates decisions, edits, and edit ratios per workflow', async () => {
    const { app } = await buildTestApp();

    // Approved untouched.
    const first = await taskWithOutput(app);
    await request(app)
      .post(`/api/ai/outputs/${first.output.id}/approve`)
      .set(as.reviewer)
      .send({})
      .expect(200);

    // Approved with a heavy edit.
    const second = await taskWithOutput(app);
    await request(app)
      .post(`/api/ai/outputs/${second.output.id}/approve`)
      .set(as.reviewer)
      .send({ edited_final_content: 'Completely rewritten by the reviewer.' })
      .expect(200);

    // Rejected.
    const third = await taskWithOutput(app);
    await request(app)
      .post(`/api/ai/outputs/${third.output.id}/reject`)
      .set(as.reviewer)
      .send({ reviewer_notes: 'Not usable.' })
      .expect(200);

    const res = await request(app).get('/api/ai/quality').set(as.viewer).expect(200);
    expect(res.body.totals).toMatchObject({
      decisions: 3,
      approved: 2,
      rejected: 1,
      changes_requested: 0,
      approved_with_edits: 1,
    });
    expect(res.body.totals.avg_edit_ratio).toBeGreaterThan(0);
    expect(res.body.totals.avg_edit_ratio).toBeLessThanOrEqual(1);

    const wf = res.body.by_workflow.find(
      (w: { workflow_name: string }) => w.workflow_name === 'condition_response_draft',
    );
    expect(wf).toMatchObject({ decisions: 3, approved: 2, approved_with_edits: 1 });
  });

  it('returns empty aggregates when nothing has been reviewed', async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get('/api/ai/quality').set(as.viewer).expect(200);
    expect(res.body.totals.decisions).toBe(0);
    expect(res.body.by_workflow).toEqual([]);
  });
});
