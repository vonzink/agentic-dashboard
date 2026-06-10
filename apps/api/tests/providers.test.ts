import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { createProvider, OpenAICompatibleProvider } from '../src/workflows/providers';
import { mockOutputFor } from '../src/workflows/registry';

function fakeFetch(response: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(response), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { impl, calls };
}

describe('OpenAICompatibleProvider', () => {
  const completion = {
    choices: [{ message: { content: '{"summary":"ok"}' } }],
    usage: { prompt_tokens: 120, completion_tokens: 45 },
  };

  it('sends the chat-completions request shape and maps usage', async () => {
    const { impl, calls } = fakeFetch(completion);
    const provider = new OpenAICompatibleProvider(
      'deepseek', 'https://api.deepseek.com/v1', 'test-key', 'deepseek-chat', impl,
    );
    const result = await provider.complete({
      system: 'SYSTEM PROMPT',
      user: 'USER PROMPT',
      workflowName: 'x',
      input: {} as never,
    });

    expect(result).toEqual({ text: '{"summary":"ok"}', inputTokens: 120, outputTokens: 45 });
    expect(calls[0]!.url).toBe('https://api.deepseek.com/v1/chat/completions');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.model).toBe('deepseek-chat');
    expect(body.messages).toEqual([
      { role: 'system', content: 'SYSTEM PROMPT' },
      { role: 'user', content: 'USER PROMPT' },
    ]);
  });

  it('throws on HTTP errors without leaking the key', async () => {
    const { impl } = fakeFetch({ error: { message: 'rate limited' } }, 429);
    const provider = new OpenAICompatibleProvider('openai', 'https://api.openai.com/v1', 'sk-secret', 'gpt-5', impl);
    await expect(
      provider.complete({ system: 's', user: 'u', workflowName: 'x', input: {} as never }),
    ).rejects.toThrow(/openai API error 429/);
    await expect(
      provider.complete({ system: 's', user: 'u', workflowName: 'x', input: {} as never }),
    ).rejects.not.toThrow(/sk-secret/);
  });

  it('throws on empty completions instead of producing an empty draft', async () => {
    const { impl } = fakeFetch({ choices: [], usage: {} });
    const provider = new OpenAICompatibleProvider('openai', 'https://api.openai.com/v1', 'k', 'gpt-5', impl);
    await expect(
      provider.complete({ system: 's', user: 'u', workflowName: 'x', input: {} as never }),
    ).rejects.toThrow(/empty completion/);
  });
});

describe('provider selection', () => {
  it('builds each provider and enforces its key', () => {
    const base = { env: 'local' as const, databaseUrl: null };
    expect(createProvider(loadConfig({ ...base, modelProvider: 'mock' }), mockOutputFor).name).toBe('mock');
    expect(
      createProvider(loadConfig({ ...base, modelProvider: 'openai', openaiApiKey: 'k' }), mockOutputFor),
    ).toMatchObject({ name: 'openai', model: 'gpt-5' });
    expect(
      createProvider(loadConfig({ ...base, modelProvider: 'deepseek', deepseekApiKey: 'k' }), mockOutputFor),
    ).toMatchObject({ name: 'deepseek', model: 'deepseek-chat' });

    expect(() => loadConfig({ ...base, modelProvider: 'openai', openaiApiKey: null })).toThrow(/OPENAI_API_KEY/);
    expect(() => loadConfig({ ...base, modelProvider: 'deepseek', deepseekApiKey: null })).toThrow(/DEEPSEEK_API_KEY/);
    expect(() => loadConfig({ ...base, modelProvider: 'anthropic', anthropicApiKey: null })).toThrow(/ANTHROPIC_API_KEY/);
  });
});
