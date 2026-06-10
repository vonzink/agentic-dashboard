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

export function createProvider(
  config: AppConfig,
  mockFor: (workflowName: string, input: WorkflowInput) => Record<string, unknown>,
): ModelProvider {
  if (config.modelProvider === 'anthropic') {
    if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is required');
    return new AnthropicModelProvider(config.anthropicApiKey, config.anthropicModel);
  }
  return new MockModelProvider(mockFor);
}
