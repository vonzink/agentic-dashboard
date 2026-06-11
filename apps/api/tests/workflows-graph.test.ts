import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { WORKFLOWS } from '../src/workflows/registry';
import { as, buildTestApp } from './helpers';

describe('GET /api/ai/workflows/graph', () => {
  it('describes every implemented workflow from its live definition', async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get('/api/ai/workflows/graph').set(as.viewer);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(Object.keys(WORKFLOWS).length);

    const names = res.body.items.map((i: { workflow_name: string }) => i.workflow_name);
    expect(names).toEqual(expect.arrayContaining(Object.keys(WORKFLOWS)));
  });

  it('extracts the LangGraph topology in execution order', async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get('/api/ai/workflows/graph').set(as.viewer);
    const item = res.body.items.find(
      (i: { workflow_name: string }) => i.workflow_name === 'condition_response_draft',
    );
    const ids: string[] = item.stages.map((s: { id: string }) => s.id);

    // The three graph nodes appear, in order, between prompt render and persist.
    expect(ids.indexOf('render_prompt')).toBeLessThan(ids.indexOf('generate'));
    expect(ids.indexOf('generate')).toBeLessThan(ids.indexOf('parse_validate'));
    expect(ids.indexOf('parse_validate')).toBeLessThan(ids.indexOf('assess'));
    expect(ids.indexOf('assess')).toBeLessThan(ids.indexOf('persist_draft'));

    const graphStages = item.stages.filter(
      (s: { source: string }) => s.source === 'langgraph',
    );
    expect(graphStages.map((s: { id: string }) => s.id)).toEqual([
      'generate',
      'parse_validate',
      'assess',
    ]);
  });

  it('every workflow ends at the human review gate and declares guardrails', async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get('/api/ai/workflows/graph').set(as.viewer);
    for (const item of res.body.items) {
      const ids = item.stages.map((s: { id: string }) => s.id);
      expect(ids).toContain('human_review');
      expect(ids.indexOf('persist_draft')).toBeLessThan(ids.indexOf('human_review'));
      expect(item.guardrails.length).toBeGreaterThan(0);
      expect(item.requires_approval).toBe(true);
    }
  });

  it('derives output fields from the zod schema', async () => {
    const { app } = await buildTestApp();
    const res = await request(app).get('/api/ai/workflows/graph').set(as.viewer);
    const item = res.body.items.find(
      (i: { workflow_name: string }) => i.workflow_name === 'condition_response_draft',
    );
    const fields = Object.fromEntries(
      item.output_fields.map((f: { name: string; type: string }) => [f.name, f.type]),
    );
    expect(fields).toMatchObject({
      summary: 'string',
      draft_response: 'string',
      missing_items: 'list of string',
      confidence_label: 'HIGH | MEDIUM | LOW',
      requires_human_review: 'always true',
    });
  });
});
