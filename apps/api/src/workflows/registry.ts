import type { ConfidenceLabel } from '../types/statuses';
import {
  borrowerEmailSchema,
  conditionResponseSchema,
  documentChecklistSchema,
  renderSources,
  sopLookupSchema,
  type WorkflowDefinition,
  type WorkflowInput,
} from './types';

const capConfidence = (value: ConfidenceLabel, max: ConfidenceLabel): ConfidenceLabel => {
  const rank = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
  return rank[value] <= rank[max] ? value : max;
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const conf = (v: unknown): ConfidenceLabel =>
  v === 'HIGH' || v === 'MEDIUM' || v === 'LOW' ? v : 'LOW';

const mockCitations = (input: WorkflowInput) =>
  input.sources.slice(0, 2).map((s) => ({
    source_label: s.source_label,
    citation_text: s.content.slice(0, 160),
    page_number: s.page_number,
  }));

export const conditionResponseDraft: WorkflowDefinition = {
  name: 'condition_response_draft',
  taskType: 'condition_response',
  description: 'Summarizes an underwriting condition and drafts a response for review',
  outputType: 'draft_response',
  outputSchema: conditionResponseSchema,
  buildUserContext: (input) => renderSources(input.sources),
  mainContent: (s) => str(s.draft_response),
  mockOutput: (input) => ({
    summary: `The underwriter is asking for: ${input.primary_text.slice(0, 120) || 'the stated condition'}. (mock summary)`,
    missing_items: ['Most recent 30 days of paystubs (mock)', 'Letter of explanation for deposit (mock)'],
    recommended_next_steps: ['Request missing items from borrower', 'Re-upload to lender portal once received'],
    draft_response: `Dear Underwriting,\n\nIn response to the condition regarding "${input.primary_text.slice(0, 80)}", please find the requested documentation attached. [MOCK DRAFT — replace with real model output]\n\nThank you.`,
    citations: mockCitations(input),
    confidence_label: input.sources.length ? 'MEDIUM' : 'LOW',
    requires_human_review: true,
    warnings: [],
  }),
  assess: (s, input) => {
    const warnings: string[] = [];
    let confidence = conf(s.confidence_label);
    if (!input.sources.length) {
      warnings.push(
        'No source documents were provided — the draft is based only on the condition text and must be verified against the loan file.',
      );
      confidence = capConfidence(confidence, 'MEDIUM');
    } else if (!(Array.isArray(s.citations) && s.citations.length)) {
      warnings.push('Sources were provided but the draft cites none of them — verify manually.');
      confidence = capConfidence(confidence, 'MEDIUM');
    }
    return { warnings, confidence };
  },
};

export const borrowerEmailDraft: WorkflowDefinition = {
  name: 'borrower_email_draft',
  taskType: 'borrower_email',
  description: 'Drafts a borrower-friendly document-request email (never sent automatically)',
  outputType: 'email_draft',
  outputSchema: borrowerEmailSchema,
  buildUserContext: (input) => renderSources(input.sources),
  mainContent: (s) => `Subject: ${str(s.email_subject)}\n\n${str(s.email_body)}`,
  mockOutput: (input) => ({
    summary: `Email requesting: ${input.primary_text.slice(0, 100) || 'documents'} (mock).`,
    email_subject: 'Quick request: a few documents for your loan file',
    email_body: `Hi ${input.borrower_context ? 'there' : 'there'},\n\nTo keep your loan moving, could you send over the items below when you have a moment? [MOCK DRAFT]\n\nThank you!`,
    checklist: ['Most recent paystub', 'Most recent bank statement (all pages)'],
    caveats: ['Verify the requested items match the actual loan conditions before sending (mock)'],
    citations: [],
    confidence_label: 'MEDIUM',
    requires_human_review: true,
    warnings: [],
  }),
  assess: (s) => {
    const warnings: string[] = [];
    const body = str(s.email_body).toLowerCase();
    if (/approved|denied|guaranteed|locked rate/.test(body)) {
      warnings.push(
        'Draft may state or imply an approval/denial or rate commitment — review wording carefully.',
      );
    }
    return { warnings, confidence: conf(s.confidence_label) };
  },
};

export const documentChecklistBuilder: WorkflowDefinition = {
  name: 'document_checklist_builder',
  taskType: 'document_checklist',
  description: 'Builds an initial borrower document checklist for a loan scenario',
  outputType: 'checklist',
  outputSchema: documentChecklistSchema,
  buildUserContext: (input) => renderSources(input.sources),
  mainContent: (s) => {
    const docs = Array.isArray(s.documents) ? s.documents : [];
    return docs
      .map((d) => {
        const doc = d as Record<string, unknown>;
        return `${doc.required ? '[required]' : '[optional]'} ${str(doc.name)} — ${str(doc.reason)} (${str(doc.when_needed)})`;
      })
      .join('\n');
  },
  mockOutput: (input) => ({
    summary: `Checklist for a ${input.options.loan_type ?? 'conventional'} loan, ${input.options.employment_type ?? 'W-2'} borrower (mock).`,
    documents: [
      { name: 'Government-issued photo ID', reason: 'Identity verification', when_needed: 'at application', required: true },
      { name: '30 days of paystubs', reason: 'Income verification', when_needed: 'at application', required: true },
      { name: '2 years W-2s', reason: 'Income history', when_needed: 'before submission', required: true },
      { name: '2 months bank statements', reason: 'Asset/funds-to-close verification', when_needed: 'before submission', required: true },
    ],
    recommended_next_steps: ['Confirm lender overlays before sending to borrower (mock)'],
    citations: [],
    confidence_label: 'MEDIUM',
    requires_human_review: true,
    warnings: ['Lender/investor overlays not verified (mock)'],
  }),
  assess: (s) => ({
    warnings: [],
    confidence: conf(s.confidence_label),
  }),
};

export const sopLookupAnswer: WorkflowDefinition = {
  name: 'sop_lookup_answer',
  taskType: 'sop_lookup',
  description: 'Answers internal SOP/guideline questions strictly from provided sources, with citations',
  outputType: 'answer',
  outputSchema: sopLookupSchema,
  buildUserContext: (input) => renderSources(input.sources),
  mainContent: (s) => str(s.answer),
  mockOutput: (input) => ({
    summary: input.primary_text.slice(0, 120) || 'SOP question (mock)',
    answer: input.sources.length
      ? `Per [Source 1] (${input.sources[0]!.source_label}): ${input.sources[0]!.content.slice(0, 200)} [MOCK ANSWER]`
      : 'The provided sources do not contain enough information to answer this question. [MOCK ANSWER]',
    citations: mockCitations(input),
    confidence_label: input.sources.length ? 'MEDIUM' : 'LOW',
    requires_human_review: true,
    warnings: input.sources.length ? [] : ['No sources were provided.'],
  }),
  assess: (s, input) => {
    const warnings: string[] = [];
    let confidence = conf(s.confidence_label);
    if (!input.sources.length) {
      warnings.push(
        'No SOP/guideline sources were provided — this answer cannot be verified and must not be relied upon.',
      );
      confidence = 'LOW';
    } else if (!(Array.isArray(s.citations) && s.citations.length)) {
      warnings.push('Answer cites no sources — treat as unverified.');
      confidence = capConfidence(confidence, 'LOW');
    } else if (input.sources.length === 1 && input.sources[0]!.content.length < 200) {
      warnings.push('Source material is thin — verify against the full SOP/guideline document.');
      confidence = capConfidence(confidence, 'MEDIUM');
    }
    return { warnings, confidence };
  },
};

/** Implemented workflows, by name. */
export const WORKFLOWS: Record<string, WorkflowDefinition> = Object.fromEntries(
  [conditionResponseDraft, borrowerEmailDraft, documentChecklistBuilder, sopLookupAnswer].map(
    (w) => [w.name, w],
  ),
);

/** Planned agents that have configs but no implementation yet (Phase 2/3). */
export const PLANNED_WORKFLOWS = [
  { workflow_name: 'income_review', task_type: 'income_review', description: 'Income Review Agent (Phase 2)' },
  { workflow_name: 'asset_review', task_type: 'asset_review', description: 'Asset Review Agent (Phase 2)' },
  { workflow_name: 'credit_review', task_type: 'credit_review', description: 'Credit Review Agent (Phase 2)' },
  { workflow_name: 'title_insurance_review', task_type: 'title_insurance_review', description: 'Title/Insurance Agent (Phase 2)' },
  { workflow_name: 'website_qa', task_type: 'website_qa', description: 'Website Mortgage Q&A Agent (Phase 3)' },
] as const;

export function mockOutputFor(workflowName: string, input: WorkflowInput): Record<string, unknown> {
  const def = WORKFLOWS[workflowName];
  if (!def) throw new Error(`No mock output for unknown workflow ${workflowName}`);
  return def.mockOutput(input);
}
