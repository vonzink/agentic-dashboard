import type { Express } from 'express';
import request from 'supertest';
import { expect } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig, type AppConfig } from '../src/config';
import { MemoryStore } from '../src/repositories/memory';
import { seedDefaults } from '../src/services/seed';

/**
 * Test harness: in-memory store + mock model provider + dev auth.
 * All fixture data is synthetic — never borrower production data.
 */
export async function buildTestApp(overrides: Partial<AppConfig> = {}) {
  const config = loadConfig({
    env: 'local',
    authMode: 'dev',
    databaseUrl: null,
    modelProvider: 'mock',
    anthropicApiKey: null,
    requireDifferentReviewer: false,
    integrationExecutionEnabled: false,
    ...overrides,
  });
  const store = new MemoryStore();
  await seedDefaults(store);
  const { app, services } = buildApp(store, config);
  return { app, store, services, config };
}

export const as = {
  viewer: { 'x-user-email': 'viewer@test.local', 'x-user-role': 'viewer' },
  operator: { 'x-user-email': 'operator@test.local', 'x-user-role': 'operator' },
  reviewer: { 'x-user-email': 'reviewer@test.local', 'x-user-role': 'reviewer' },
  admin: { 'x-user-email': 'admin@test.local', 'x-user-role': 'admin' },
} as const;

type Headers = (typeof as)[keyof typeof as];

export async function createTask(app: Express, headers: Headers = as.operator, body: object = {}) {
  const res = await request(app)
    .post('/api/ai/tasks')
    .set(headers)
    .send({ title: 'Test condition task', task_type: 'condition_response', ...body });
  expect(res.status).toBe(201);
  return res.body;
}

export async function addInput(
  app: Express,
  taskId: string,
  input: { input_type: string; content: string; source_document_id?: string },
) {
  const res = await request(app).post(`/api/ai/tasks/${taskId}/inputs`).set(as.operator).send(input);
  expect(res.status).toBe(201);
  return res.body;
}

export async function runWorkflow(
  app: Express,
  taskId: string,
  workflow = 'condition_response_draft',
  options: object = {},
) {
  const res = await request(app)
    .post(`/api/ai/tasks/${taskId}/runs`)
    .set(as.operator)
    .send({ workflow_name: workflow, options });
  expect(res.status).toBe(201);
  return res.body as { run: { id: string }; outputs: { id: string }[] };
}

/** Full happy path up to an output id, with one condition_text input. */
export async function taskWithOutput(app: Express) {
  const task = await createTask(app);
  await addInput(app, task.id, {
    input_type: 'condition_text',
    content: 'Provide most recent 30 days of paystubs for Test Borrower A.',
  });
  const { run, outputs } = await runWorkflow(app, task.id);
  return { task, run, output: outputs[0]! };
}
