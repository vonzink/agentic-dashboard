import { randomUUID } from 'node:crypto';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { ConfidenceLabel } from '../types/statuses';
import type { ModelProvider } from './providers';
import type { WorkflowCitation, WorkflowDefinition, WorkflowInput, WorkflowResult } from './types';
import { renderTemplate } from './prompts';
import { renderSources } from './types';

/** Thrown when the model's output cannot be parsed/validated. The run fails;
 * nothing is surfaced to a reviewer as if it were a valid draft. */
export class WorkflowOutputError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message);
  }
}

const RunState = Annotation.Root({
  input: Annotation<WorkflowInput>,
  system: Annotation<string>,
  user: Annotation<string>,
  rawText: Annotation<string>,
  structured: Annotation<Record<string, unknown>>,
  warnings: Annotation<string[]>,
  confidence: Annotation<ConfidenceLabel>,
  inputTokens: Annotation<number>,
  outputTokens: Annotation<number>,
});

/**
 * Builds the LangGraph for one workflow: generate → parse_validate → assess.
 *
 * Deliberately linear and tool-free: graphs can only draft. Anything that
 * touches the outside world lives behind the approval gate in the service
 * layer, not in here.
 */
function buildGraph(def: WorkflowDefinition, provider: ModelProvider) {
  return new StateGraph(RunState)
    .addNode('generate', async (state) => {
      const response = await provider.complete({
        system: state.system,
        user: state.user,
        workflowName: def.name,
        input: state.input,
      });
      return {
        rawText: response.text,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
      };
    })
    .addNode('parse_validate', async (state) => {
      // Tolerate a fenced code block, then require strict JSON + schema match.
      const text = state.rawText.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new WorkflowOutputError('Model did not return valid JSON', state.rawText);
      }
      const result = def.outputSchema.safeParse(parsed);
      if (!result.success) {
        throw new WorkflowOutputError(
          `Model output failed schema validation: ${result.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`,
          state.rawText,
        );
      }
      // Compliance invariant: nothing a workflow produces skips human review.
      return { structured: { ...result.data, requires_human_review: true } };
    })
    .addNode('assess', async (state) => {
      const { warnings, confidence } = def.assess(state.structured, state.input);
      const modelWarnings = Array.isArray(state.structured.warnings)
        ? (state.structured.warnings as string[])
        : [];
      const allWarnings = [...modelWarnings, ...warnings];
      return {
        warnings: allWarnings,
        confidence,
        structured: {
          ...state.structured,
          warnings: allWarnings,
          confidence_label: confidence,
        },
      };
    })
    .addEdge(START, 'generate')
    .addEdge('generate', 'parse_validate')
    .addEdge('parse_validate', 'assess')
    .addEdge('assess', END)
    .compile();
}

export interface RenderedPrompt {
  system: string;
  user: string;
  /** e.g. 'condition_response_draft@1' — logged on the run for provenance. */
  version: string;
}

export function renderPrompt(
  template: { system_prompt: string; user_prompt_template: string; name: string; version: number },
  input: WorkflowInput,
): RenderedPrompt {
  const vars: Record<string, string> = {
    company: input.company_name || 'the client company',
    primary_text: input.primary_text,
    borrower_context: input.borrower_context ?? '(not provided)',
    scenario: input.scenario ?? '(not provided)',
    instructions: input.instructions ?? '(none)',
    sources: renderSources(input.sources),
    tone: input.options.tone ?? 'professional',
    loan_type: input.options.loan_type ?? '(not specified)',
    lender: input.options.lender ?? '(not specified)',
    employment_type: input.options.employment_type ?? '(not specified)',
    property_type: input.options.property_type ?? '(not specified)',
    occupancy: input.options.occupancy ?? '(not specified)',
    special_scenario: input.options.special_scenario ?? '(none)',
  };
  return {
    // Both halves are templates: the system preamble carries {{company}}.
    system: renderTemplate(template.system_prompt, vars),
    user: renderTemplate(template.user_prompt_template, vars),
    version: `${template.name}@${template.version}`,
  };
}

export async function runWorkflow(
  def: WorkflowDefinition,
  provider: ModelProvider,
  prompt: RenderedPrompt,
  input: WorkflowInput,
): Promise<WorkflowResult & { langgraphRunId: string }> {
  const graph = buildGraph(def, provider);
  const runId = randomUUID();
  const finalState = await graph.invoke(
    { input, system: prompt.system, user: prompt.user },
    { runId },
  );
  const structured = finalState.structured;
  return {
    structured,
    mainContent: def.mainContent(structured),
    citations: (structured.citations ?? []) as WorkflowCitation[],
    confidence: finalState.confidence,
    warnings: finalState.warnings ?? [],
    tokens: { input: finalState.inputTokens ?? 0, output: finalState.outputTokens ?? 0 },
    langgraphRunId: runId,
  };
}
