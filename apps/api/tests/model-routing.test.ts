import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { createProviderFor, ProviderRegistry } from '../src/workflows/providers';
import { mockOutputFor } from '../src/workflows/registry';
import { addInput, as, buildTestApp, createTask, runWorkflow } from './helpers';

const baseConfig = () =>
  loadConfig({
    env: 'local',
    authMode: 'dev',
    databaseUrl: null,
    modelProvider: 'mock',
    anthropicApiKey: null,
    openaiApiKey: null,
    deepseekApiKey: null,
  });

describe('ProviderRegistry', () => {
  it('falls back to the default provider when no routing is configured', () => {
    const config = baseConfig();
    const fallback = createProviderFor(config, mockOutputFor, 'mock');
    const registry = new ProviderRegistry(config, mockOutputFor, fallback);
    expect(registry.resolve(null)).toBe(fallback);
    expect(registry.resolve({})).toBe(fallback);
    expect(registry.resolve({ model: 'only-model-no-provider' })).toBe(fallback);
  });

  it('builds and caches a provider with a model override', () => {
    const config = loadConfig({ ...baseConfig(), anthropicApiKey: 'test-key-not-real' });
    const fallback = createProviderFor(config, mockOutputFor, 'mock');
    const registry = new ProviderRegistry(config, mockOutputFor, fallback);
    const resolved = registry.resolve({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' });
    expect(resolved.name).toBe('anthropic');
    expect(resolved.model).toBe('claude-haiku-4-5-20251001');
    expect(registry.resolve({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' })).toBe(resolved);
  });

  it('throws for keyless or unknown providers instead of silently substituting', () => {
    const config = baseConfig();
    const fallback = createProviderFor(config, mockOutputFor, 'mock');
    const registry = new ProviderRegistry(config, mockOutputFor, fallback);
    expect(() => registry.resolve({ provider: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => registry.resolve({ provider: 'grok' })).toThrow(/Unknown provider/);
  });
});

describe('per-workflow model routing', () => {
  it('admin can set routing and runs record the routed provider/model', async () => {
    const { app } = await buildTestApp();

    const patched = await request(app)
      .patch('/api/ai/workflows/condition_response_draft')
      .set(as.admin)
      .send({ model_config_json: { provider: 'mock', model: 'mock-routed-model' } })
      .expect(200);
    expect(patched.body.model_config_json).toEqual({ provider: 'mock', model: 'mock-routed-model' });

    const task = await createTask(app);
    await addInput(app, task.id, { input_type: 'condition_text', content: 'Routing test condition.' });
    const { run } = await runWorkflow(app, task.id);
    const runRow = await request(app).get(`/api/ai/runs/${run.id}`).set(as.viewer).expect(200);
    expect(runRow.body.model_provider).toBe('mock');
  });

  it('a run against a keyless routed provider fails with PROVIDER_NOT_CONFIGURED', async () => {
    const { app } = await buildTestApp();
    await request(app)
      .patch('/api/ai/workflows/condition_response_draft')
      .set(as.admin)
      .send({ model_config_json: { provider: 'deepseek' } })
      .expect(200);

    const task = await createTask(app);
    await addInput(app, task.id, { input_type: 'condition_text', content: 'Keyless test.' });
    const res = await request(app)
      .post(`/api/ai/tasks/${task.id}/runs`)
      .set(as.operator)
      .send({ workflow_name: 'condition_response_draft' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROVIDER_NOT_CONFIGURED');
  });

  it('routing config is admin-only and validated', async () => {
    const { app } = await buildTestApp();
    await request(app)
      .patch('/api/ai/workflows/condition_response_draft')
      .set(as.reviewer)
      .send({ model_config_json: { provider: 'mock' } })
      .expect(403);
    await request(app)
      .patch('/api/ai/workflows/condition_response_draft')
      .set(as.admin)
      .send({ model_config_json: { provider: 'grok' } })
      .expect(400);
    await request(app)
      .patch('/api/ai/workflows/no_such_workflow')
      .set(as.admin)
      .send({ is_active: false })
      .expect(404);
  });
});
