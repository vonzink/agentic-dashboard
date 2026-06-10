import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { runMigrations } from '../src/db/migrate';
import { createPool, type Pool } from '../src/db/pool';
import { PgStore } from '../src/repositories/pg';
import { seedDefaults } from '../src/services/seed';
import { as } from './helpers';

/**
 * Integration tests against a REAL Postgres (migrations, triggers,
 * transactions). Skipped unless TEST_DATABASE_URL is set; CI provides a
 * postgres service container. Synthetic data only.
 *
 *   TEST_DATABASE_URL=postgres://agentic@localhost:5432/agentic_dashboard npm test
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('Postgres integration', () => {
  let pool: Pool;
  let store: PgStore;
  let app: ReturnType<typeof buildApp>['app'];

  beforeAll(async () => {
    await runMigrations(url!);
    pool = createPool(url!);
    // Clean slate (audit is delete-protected by trigger; disable just for test reset).
    await pool.query(`
      ALTER TABLE ai_audit_events DISABLE TRIGGER trg_ai_audit_events_append_only;
      TRUNCATE ai_tasks, ai_audit_events, ai_source_documents,
               ai_prompt_templates, ai_workflow_configs RESTART IDENTITY CASCADE;
      ALTER TABLE ai_audit_events ENABLE TRIGGER trg_ai_audit_events_append_only;
    `);
    store = new PgStore(pool);
    await seedDefaults(store);
    const config = loadConfig({
      env: 'local',
      authMode: 'dev',
      modelProvider: 'mock',
      integrationExecutionEnabled: true,
      requireDifferentReviewer: false,
    });
    app = buildApp(store, config).app;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('runs the full flow end-to-end on Postgres (task → run → approve → finalize → execute)', async () => {
    const task = (
      await request(app)
        .post('/api/ai/tasks')
        .set(as.operator)
        .send({ title: 'PG e2e', task_type: 'condition_response' })
    ).body;
    await request(app)
      .post(`/api/ai/tasks/${task.id}/inputs`)
      .set(as.operator)
      .send({ input_type: 'condition_text', content: 'Synthetic condition for Test Borrower A.' });

    const runRes = await request(app)
      .post(`/api/ai/tasks/${task.id}/runs`)
      .set(as.operator)
      .send({ workflow_name: 'condition_response_draft' });
    expect(runRes.status).toBe(201);
    const outputId = runRes.body.outputs[0].id;
    expect(runRes.body.run.prompt_version).toBe('condition_response_draft@1');

    const approve = await request(app)
      .post(`/api/ai/outputs/${outputId}/approve`)
      .set(as.reviewer)
      .send({ edited_final_content: 'PG final text.' });
    expect(approve.status).toBe(200);
    await request(app).post(`/api/ai/outputs/${outputId}/finalize`).set(as.reviewer).expect(200);

    const action = (
      await request(app)
        .post(`/api/ai/tasks/${task.id}/actions`)
        .set(as.operator)
        .send({
          action_type: 'send_email',
          target_system: 'noop',
          request_payload_json: {},
          approval_id: approve.body.approval.id,
        })
    ).body;
    const exec = await request(app).post(`/api/ai/actions/${action.id}/execute`).set(as.reviewer);
    expect(exec.status).toBe(200);
    expect(exec.body.status).toBe('executed');

    // Second execute of the same action must refuse (already executed).
    const again = await request(app).post(`/api/ai/actions/${action.id}/execute`).set(as.reviewer);
    expect(again.status).toBe(409);

    const audit = await request(app).get(`/api/ai/tasks/${task.id}/audit`).set(as.viewer);
    const types = audit.body.items.map((e: { event_type: string }) => e.event_type);
    for (const expected of [
      'task.created', 'input.added', 'run.requested', 'run.completed',
      'output.created', 'output.approved', 'output.finalized', 'action.proposed', 'action.executed',
    ]) {
      expect(types).toContain(expected);
    }
  });

  it('database trigger refuses unapproved action execution even via raw SQL', async () => {
    const task = await store.tasks.create({
      title: 'trigger test', task_type: 'general', status: 'open', priority: 'normal',
      created_by: 't@test.local', assigned_to: null, borrower_reference: null,
      loan_reference: null, due_at: null, metadata_json: {},
    });
    await expect(
      pool.query(
        `INSERT INTO ai_integration_actions (task_id, action_type, target_system, status)
         VALUES ($1, 'send_email', 'noop', 'executed')`,
        [task.id],
      ),
    ).rejects.toThrow(/requires an approval/);
  });

  it('database trigger keeps the audit log append-only even via raw SQL', async () => {
    await store.audit.append({
      task_id: null, actor_user_id: 'trigger@test.local',
      event_type: 'integration.test', event_payload_json: {},
    });
    await expect(
      pool.query(`UPDATE ai_audit_events SET event_type = 'tampered' WHERE event_type = 'integration.test'`),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query(`DELETE FROM ai_audit_events WHERE event_type = 'integration.test'`),
    ).rejects.toThrow(/append-only/);
  });

  it('withTransaction rolls back partial writes on failure', async () => {
    const before = await pool.query(`SELECT count(*)::int AS n FROM ai_tasks`);
    await expect(
      store.withTransaction(async (tx) => {
        await tx.tasks.create({
          title: 'will be rolled back', task_type: 'general', status: 'open', priority: 'normal',
          created_by: 'tx@test.local', assigned_to: null, borrower_reference: null,
          loan_reference: null, due_at: null, metadata_json: {},
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const after = await pool.query(`SELECT count(*)::int AS n FROM ai_tasks`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
