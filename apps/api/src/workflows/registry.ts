import type { ConfidenceLabel } from '../types/statuses';
import type { TaskType } from '../types/statuses';
import {
  borrowerEmailSchema,
  conditionResponseSchema,
  documentChecklistSchema,
  fileReviewSchema,
  renderSources,
  sopLookupSchema,
  websiteQaSchema,
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

/**
 * File-review agents (Phase 2). All share the same structured shape and
 * the same hard constraint: they review and recommend — they never decide.
 * `focus` differentiates the prompt and the mock output.
 */
function makeFileReviewAgent(opts: {
  name: string;
  taskType: TaskType;
  description: string;
  focus: string;
  mockFinding: string;
  mockMissing: string;
}): WorkflowDefinition {
  return {
    name: opts.name,
    taskType: opts.taskType,
    description: opts.description,
    outputType: 'summary',
    outputSchema: fileReviewSchema,
    buildUserContext: (input) => renderSources(input.sources),
    mainContent: (s) => {
      const lines = [str(s.summary)];
      const list = (label: string, items: unknown) => {
        if (Array.isArray(items) && items.length) {
          lines.push(`\n${label}:`, ...items.map((i) => `- ${String(i)}`));
        }
      };
      list('Findings', s.findings);
      list('Red flags', s.red_flags);
      list('Missing items', s.missing_items);
      return lines.join('\n');
    },
    mockOutput: (input) => ({
      summary: `${opts.focus} review of the provided file context: ${input.primary_text.slice(0, 100) || '(no context)'} (mock).`,
      findings: [opts.mockFinding],
      red_flags: [],
      missing_items: [opts.mockMissing],
      recommended_next_steps: ['Verify against the actual loan file before relying on this review (mock)'],
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
          `No source documents were provided — this ${opts.focus.toLowerCase()} review is based only on the task description and must be verified against the loan file.`,
        );
        confidence = capConfidence(confidence, 'LOW');
      }
      warnings.push(
        'AI file review is advisory only. All underwriting and lending decisions are made by licensed staff.',
      );
      return { warnings, confidence };
    },
  };
}

export const incomeReview = makeFileReviewAgent({
  name: 'income_review',
  taskType: 'income_review',
  description: 'Reviews income documentation for completeness, consistency, and red flags (advisory only)',
  focus: 'Income',
  mockFinding: 'Base salary on paystub is consistent across the provided periods (mock)',
  mockMissing: 'Most recent W-2 (mock)',
});

export const assetReview = makeFileReviewAgent({
  name: 'asset_review',
  taskType: 'asset_review',
  description: 'Reviews asset/bank statements for funds-to-close, large deposits, and sourcing gaps (advisory only)',
  focus: 'Asset',
  mockFinding: 'Ending balance covers estimated cash-to-close (mock)',
  mockMissing: 'Letter of explanation for the large deposit on the statement (mock)',
});

export const creditReview = makeFileReviewAgent({
  name: 'credit_review',
  taskType: 'credit_review',
  description: 'Reviews credit report context for disputes, inquiries, and undisclosed debts (advisory only)',
  focus: 'Credit',
  mockFinding: 'No disputed accounts referenced in the provided context (mock)',
  mockMissing: 'Inquiry explanation letter for recent credit pulls (mock)',
});

export const titleInsuranceReview = makeFileReviewAgent({
  name: 'title_insurance_review',
  taskType: 'title_insurance_review',
  description: 'Reviews title commitment / insurance docs for vesting, liens, and coverage gaps (advisory only)',
  focus: 'Title/Insurance',
  mockFinding: 'Proposed insured matches the loan amount in the provided context (mock)',
  mockMissing: 'Updated homeowner insurance declaration page (mock)',
});

const PUBLIC_DISCLAIMER =
  'This is general information, not a loan offer, approval, or rate quote. Rates and program availability change; please speak with a licensed MSFG loan officer for guidance specific to your situation.';

/** Detects commitment-style wording a public answer must never contain. */
const COMMITMENT_WORDING =
  /\b(you (are|'re) (approved|denied)|guaranteed|we guarantee|locked? rate|your rate (is|will be)|\d+(\.\d+)?\s?% (apr|rate))\b/i;

export const websiteQa: WorkflowDefinition = {
  name: 'website_qa',
  taskType: 'website_qa',
  description:
    'Drafts public-facing answers to website mortgage questions from approved content, with citations and a mandatory disclaimer (human-published only)',
  outputType: 'answer',
  outputSchema: websiteQaSchema,
  buildUserContext: (input) => renderSources(input.sources),
  mainContent: (s) => `${str(s.answer)}\n\n${str(s.disclaimer)}`,
  mockOutput: (input) => ({
    summary: input.primary_text.slice(0, 120) || 'Website question (mock)',
    answer: input.sources.length
      ? `Great question! Per our published guidance (${input.sources[0]!.source_label}): ${input.sources[0]!.content.slice(0, 160)} [MOCK ANSWER]`
      : 'We do not have published content that answers this yet. [MOCK ANSWER]',
    disclaimer: PUBLIC_DISCLAIMER,
    suggested_followups: ['What documents do I need to get pre-approved? (mock)'],
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
        'No approved website/SOP content was provided or retrieved — this public answer cannot be verified and must not be published.',
      );
      confidence = 'LOW';
    } else if (!(Array.isArray(s.citations) && s.citations.length)) {
      warnings.push('Public answer cites no approved sources — treat as unverified.');
      confidence = capConfidence(confidence, 'LOW');
    }
    if (COMMITMENT_WORDING.test(str(s.answer))) {
      warnings.push(
        'Answer appears to state a rate, approval, or guarantee — public answers must never make commitments. Review carefully.',
      );
      confidence = capConfidence(confidence, 'LOW');
    }
    if (!str(s.disclaimer).trim()) {
      warnings.push('Mandatory consumer disclaimer is missing.');
      confidence = capConfidence(confidence, 'LOW');
    }
    warnings.push('Public-facing content: a human must review and publish; nothing is posted automatically.');
    return { warnings, confidence };
  },
};

/** Implemented workflows, by name. */
export const WORKFLOWS: Record<string, WorkflowDefinition> = Object.fromEntries(
  [
    conditionResponseDraft,
    borrowerEmailDraft,
    documentChecklistBuilder,
    sopLookupAnswer,
    incomeReview,
    assetReview,
    creditReview,
    titleInsuranceReview,
    websiteQa,
  ].map((w) => [w.name, w]),
);

/** Agents planned but not yet implemented (none — full PRD roster shipped). */
export const PLANNED_WORKFLOWS: {
  workflow_name: string;
  task_type: TaskType;
  description: string;
}[] = [];

export function mockOutputFor(workflowName: string, input: WorkflowInput): Record<string, unknown> {
  const def = WORKFLOWS[workflowName];
  if (!def) throw new Error(`No mock output for unknown workflow ${workflowName}`);
  return def.mockOutput(input);
}
