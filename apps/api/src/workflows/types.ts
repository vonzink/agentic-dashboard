import { z } from 'zod';
import type { ConfidenceLabel, OutputType, TaskType } from '../types/statuses';

/** A source snippet available to a workflow (manual snippet or document chunk). */
export interface SourceSnippet {
  document_id: string | null;
  chunk_id: string | null;
  source_label: string;
  content: string;
  page_number: number | null;
}

/** Assembled input handed to every workflow run; snapshotted onto the run row. */
export interface WorkflowInput {
  task_title: string;
  task_type: TaskType;
  /** Primary text (condition text, question, request...) from task inputs. */
  primary_text: string;
  borrower_context: string | null;
  scenario: string | null;
  instructions: string | null;
  sources: SourceSnippet[];
  options: {
    tone?: string;
    loan_type?: string;
    lender?: string;
    employment_type?: string;
    property_type?: string;
    occupancy?: string;
    special_scenario?: string;
  };
}

export const citationSchema = z.object({
  source_label: z.string(),
  citation_text: z.string(),
  page_number: z.number().int().nullish(),
});
export type WorkflowCitation = z.infer<typeof citationSchema>;

const common = {
  citations: z.array(citationSchema).default([]),
  confidence_label: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  requires_human_review: z.literal(true).default(true),
  warnings: z.array(z.string()).default([]),
};

/** condition_response_draft — exact shape from the Sprint 2 spec. */
export const conditionResponseSchema = z.object({
  summary: z.string(),
  missing_items: z.array(z.string()).default([]),
  recommended_next_steps: z.array(z.string()).default([]),
  draft_response: z.string(),
  ...common,
});

export const borrowerEmailSchema = z.object({
  summary: z.string(),
  email_subject: z.string(),
  email_body: z.string(),
  checklist: z.array(z.string()).default([]),
  caveats: z.array(z.string()).default([]),
  ...common,
});

export const documentChecklistSchema = z.object({
  summary: z.string(),
  documents: z
    .array(
      z.object({
        name: z.string(),
        reason: z.string(),
        when_needed: z.string(),
        required: z.boolean(),
      }),
    )
    .default([]),
  recommended_next_steps: z.array(z.string()).default([]),
  ...common,
});

export const sopLookupSchema = z.object({
  summary: z.string(),
  answer: z.string(),
  ...common,
});

/** Shared shape for the file-review agents (income/asset/credit/title). */
export const fileReviewSchema = z.object({
  summary: z.string(),
  findings: z.array(z.string()).default([]),
  red_flags: z.array(z.string()).default([]),
  missing_items: z.array(z.string()).default([]),
  recommended_next_steps: z.array(z.string()).default([]),
  ...common,
});

export interface WorkflowResult {
  /** Validated structured output (one of the schemas above). */
  structured: Record<string, unknown>;
  /** Main human-readable text for ai_outputs.content. */
  mainContent: string;
  citations: WorkflowCitation[];
  confidence: ConfidenceLabel;
  warnings: string[];
  tokens: { input: number; output: number };
}

/**
 * A workflow definition. Workflows can only DRAFT — they receive text in and
 * return structured JSON out. They have no repositories, no network access
 * beyond the model provider, and therefore no ability to cause side effects.
 */
export interface WorkflowDefinition {
  name: string;
  taskType: TaskType;
  description: string;
  outputType: OutputType;
  outputSchema: z.ZodType<Record<string, unknown>>;
  /** Renders the user prompt body from the assembled input. */
  buildUserContext(input: WorkflowInput): string;
  /** Main text extraction for ai_outputs.content. */
  mainContent(structured: Record<string, unknown>): string;
  /** Deterministic output for MODEL_PROVIDER=mock (local dev / tests). */
  mockOutput(input: WorkflowInput): Record<string, unknown>;
  /** Post-generation checks: appends warnings / downgrades confidence. */
  assess(structured: Record<string, unknown>, input: WorkflowInput): {
    warnings: string[];
    confidence: ConfidenceLabel;
  };
}

/** Renders source snippets into a prompt block. */
export function renderSources(sources: SourceSnippet[]): string {
  if (!sources.length) return '(no source documents provided)';
  return sources
    .map(
      (s, i) =>
        `[Source ${i + 1}: ${s.source_label}${s.page_number ? `, p.${s.page_number}` : ''}]\n${s.content}`,
    )
    .join('\n\n');
}
