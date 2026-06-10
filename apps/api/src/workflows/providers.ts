import Anthropic from '@anthropic-ai/sdk';
import type { AppConfig } from '../config';
import type { WorkflowInput } from './types';

export interface ModelRequest {
  system: string;
  user: string;
  workflowName: string;
  input: WorkflowInput;
}

export interface ModelResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/** The only abstraction allowed to talk to an LLM. */
export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  complete(req: ModelRequest): Promise<ModelResponse>;
}

/**
 * Deterministic provider for local development and tests. Returns the
 * workflow's own mock output so the rest of the pipeline (parsing,
 * validation, persistence, approval flow) runs exactly as in production.
 */
export class MockModelProvider implements ModelProvider {
  readonly name = 'mock';
  readonly model = 'mock-model-v1';

  constructor(
    private mockFor: (workflowName: string, input: WorkflowInput) => Record<string, unknown>,
  ) {}

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const text = JSON.stringify(this.mockFor(req.workflowName, req.input), null, 2);
    // Rough token estimate keeps cost reporting exercised in dev (cost = $0).
    return {
      text,
      inputTokens: Math.ceil((req.system.length + req.user.length) / 4),
      outputTokens: Math.ceil(text.length / 4),
    };
  }
}

/** Claude via the official SDK. Key comes from env only (see config.ts). */
export class AnthropicModelProvider implements ModelProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private client: Anthropic;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}

/**
 * OpenAI-compatible chat-completions provider — covers both OpenAI
 * (api.openai.com) and DeepSeek (api.deepseek.com, which implements the
 * same wire format). Raw fetch keeps the dependency surface flat; the
 * shared output-schema validation downstream means a misbehaving provider
 * fails a run rather than producing an unreviewable draft.
 */
export class OpenAICompatibleProvider implements ModelProvider {
  constructor(
    readonly name: string,
    private baseUrl: string,
    private apiKey: string,
    readonly model: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      }),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`${this.name} API error ${res.status}: ${detail}`);
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = body.choices?.[0]?.message?.content ?? '';
    if (!text) throw new Error(`${this.name} returned an empty completion`);
    return {
      text,
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
    };
  }
}

export function createProvider(
  config: AppConfig,
  mockFor: (workflowName: string, input: WorkflowInput) => Record<string, unknown>,
): ModelProvider {
  switch (config.modelProvider) {
    case 'anthropic':
      if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is required');
      return new AnthropicModelProvider(config.anthropicApiKey, config.anthropicModel);
    case 'openai':
      if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is required');
      return new OpenAICompatibleProvider(
        'openai', 'https://api.openai.com/v1', config.openaiApiKey, config.openaiModel,
      );
    case 'deepseek':
      if (!config.deepseekApiKey) throw new Error('DEEPSEEK_API_KEY is required');
      return new OpenAICompatibleProvider(
        'deepseek', 'https://api.deepseek.com/v1', config.deepseekApiKey, config.deepseekModel,
      );
    default:
      return new MockModelProvider(mockFor);
  }
}
