import type { TaskType } from '../types/statuses';

/**
 * Built-in v1 prompt templates. These are seeded into ai_prompt_templates by
 * `npm run db:seed` (and auto-seeded into the in-memory store), after which
 * the DATABASE rows are authoritative — admins create new versions via the
 * API and activate them; runs always log the exact `name@version` used.
 *
 * Placeholders use {{name}} and are substituted by renderTemplate().
 */
export interface DefaultPrompt {
  name: string;
  task_type: TaskType;
  system_prompt: string;
  user_prompt_template: string;
}

const COMPLIANCE_PREAMBLE = `You are an AI assistant inside the internal AI operations dashboard that ZVZ Solutions operates for {{company}}. You DRAFT documents for licensed human staff to review — you never take final actions.

Hard rules you must always follow:
- You draft, summarize, classify, and suggest. You do NOT make lending decisions, approve or deny borrowers, or quote final rates/terms unless those exact figures appear in the provided sources.
- Never invent guideline, regulatory, or program requirements. If you are not certain and the sources do not support a claim, say so explicitly instead of guessing.
- When sources are provided, cite them. When no sources support an answer, state that clearly.
- Disclose uncertainty plainly. Overconfidence is a compliance defect.
- Every output you produce will be reviewed by a human before any use. Write so a reviewer can verify your work quickly.

You must respond with ONLY a single valid JSON object matching the schema described in the task — no markdown fences, no commentary outside the JSON.`;

export const DEFAULT_PROMPTS: DefaultPrompt[] = [
  {
    name: 'condition_response_draft',
    task_type: 'condition_response',
    system_prompt: COMPLIANCE_PREAMBLE,
    user_prompt_template: `An underwriter issued the following condition on a mortgage loan file. Draft a response package for the processor/loan officer to review.

CONDITION TEXT:
{{primary_text}}

BORROWER CONTEXT (may be empty):
{{borrower_context}}

LOAN TYPE: {{loan_type}}
LENDER/INVESTOR: {{lender}}
TONE: {{tone}}

SOURCE SNIPPETS (cite these when used):
{{sources}}

Respond with JSON exactly matching:
{
  "summary": "plain-English summary of what the condition is asking for",
  "missing_items": ["items/documents still needed from borrower or file"],
  "recommended_next_steps": ["concrete next steps for staff"],
  "draft_response": "professional draft response to the underwriter",
  "citations": [{"source_label": "...", "citation_text": "exact text relied on", "page_number": null}],
  "confidence_label": "HIGH|MEDIUM|LOW",
  "requires_human_review": true,
  "warnings": ["any caveats, gaps, or uncertainty a reviewer must check"]
}`,
  },
  {
    name: 'borrower_email_draft',
    task_type: 'borrower_email',
    system_prompt: COMPLIANCE_PREAMBLE,
    user_prompt_template: `Draft a borrower-friendly email requesting the documents/items below. The email will be reviewed and sent by a human — never imply it is automated. Do not state or imply loan approval, denial, or final terms.

REQUESTED ITEMS / CONTEXT:
{{primary_text}}

BORROWER CONTEXT (may be empty):
{{borrower_context}}

TONE: {{tone}}

SOURCE SNIPPETS (may be empty):
{{sources}}

Respond with JSON exactly matching:
{
  "summary": "one-paragraph summary of what is being requested and why",
  "email_subject": "...",
  "email_body": "friendly, plain-language email body",
  "checklist": ["bulleted list of items the borrower must provide"],
  "caveats": ["anything staff should verify before sending"],
  "citations": [],
  "confidence_label": "HIGH|MEDIUM|LOW",
  "requires_human_review": true,
  "warnings": ["..."]
}`,
  },
  {
    name: 'document_checklist_builder',
    task_type: 'document_checklist',
    system_prompt: COMPLIANCE_PREAMBLE,
    user_prompt_template: `Build an initial document checklist for the loan scenario below. Base it on standard industry documentation practices; where a requirement depends on lender/investor overlays you do not have, flag it in warnings rather than guessing.

SCENARIO / NOTES:
{{primary_text}}

LOAN TYPE: {{loan_type}}
EMPLOYMENT TYPE: {{employment_type}}
PROPERTY TYPE: {{property_type}}
OCCUPANCY: {{occupancy}}
SPECIAL SCENARIO: {{special_scenario}}

SOURCE SNIPPETS (cite if provided):
{{sources}}

Respond with JSON exactly matching:
{
  "summary": "short description of the scenario and approach",
  "documents": [{"name": "...", "reason": "why it is needed", "when_needed": "at application | before submission | before closing", "required": true}],
  "recommended_next_steps": ["..."],
  "citations": [],
  "confidence_label": "HIGH|MEDIUM|LOW",
  "requires_human_review": true,
  "warnings": ["..."]
}`,
  },
  {
    name: 'sop_lookup_answer',
    task_type: 'sop_lookup',
    system_prompt: COMPLIANCE_PREAMBLE,
    user_prompt_template: `Answer the internal SOP/guideline question below USING ONLY the provided source snippets. If the sources do not contain the answer, say so — do not answer from general knowledge. Every claim must cite a source.

QUESTION:
{{primary_text}}

SOURCE SNIPPETS:
{{sources}}

Respond with JSON exactly matching:
{
  "summary": "one-line restatement of the question",
  "answer": "the answer, grounded in the sources, with inline [Source N] references",
  "citations": [{"source_label": "...", "citation_text": "exact supporting text", "page_number": null}],
  "confidence_label": "HIGH|MEDIUM|LOW",
  "requires_human_review": true,
  "warnings": ["state clearly if sources are weak, missing, or conflicting"]
}`,
  },
  {
    name: 'project_architecture_map',
    task_type: 'general',
    system_prompt: COMPLIANCE_PREAMBLE,
    user_prompt_template: `Draft an architecture map of the software project described below, for a technical reviewer to verify and approve. The sources contain (a) a DETERMINISTIC REPO SCAN — detected stack, languages, and classified directories parsed from the repository tree — and (b) the project README.

Hard grounding rule: every component you list must be evidenced by the repo scan or the README. If you suspect a component exists but cannot point to evidence, put it in open_questions instead of components.

PROJECT:
{{primary_text}}

INSTRUCTIONS (may be empty):
{{instructions}}

SOURCES (repo scan + README — cite these):
{{sources}}

Respond with JSON exactly matching:
{
  "summary": "2-4 sentences: what this project is and how the pieces fit together",
  "components": [
    {
      "name": "short component name",
      "kind": "frontend|api|backend|database|infra|external_service|other",
      "tech": "main technology, e.g. React + Vite",
      "purpose": "one sentence: what it does",
      "talks_to": ["names of other components it communicates with"]
    }
  ],
  "open_questions": ["things the sources do not establish that a reviewer should confirm"],
  "citations": [{"source_label": "...", "citation_text": "exact supporting text", "page_number": null}],
  "confidence_label": "HIGH|MEDIUM|LOW",
  "requires_human_review": true,
  "warnings": ["caveats a reviewer must check before approving the map"]
}`,
  },
];

/** Shared user-prompt template for the file-review agents. */
function fileReviewTemplate(focus: string, focusInstructions: string): string {
  return `Perform an advisory ${focus} review of the loan-file context below. You review and recommend — you NEVER approve, deny, or decide. Base every finding strictly on the provided context and sources; if something cannot be verified from them, list it under missing_items or warnings instead of assuming.

${focusInstructions}

FILE CONTEXT / NOTES:
{{primary_text}}

BORROWER CONTEXT (may be empty):
{{borrower_context}}

LOAN TYPE: {{loan_type}}
SOURCE SNIPPETS (cite these when used):
{{sources}}

Respond with JSON exactly matching:
{
  "summary": "concise overview of what was reviewed and the overall picture",
  "findings": ["specific, verifiable observations grounded in the context"],
  "red_flags": ["items needing scrutiny — inconsistencies, gaps, anomalies"],
  "missing_items": ["documents or explanations still needed"],
  "recommended_next_steps": ["concrete next steps for staff"],
  "citations": [{"source_label": "...", "citation_text": "exact text relied on", "page_number": null}],
  "confidence_label": "HIGH|MEDIUM|LOW",
  "requires_human_review": true,
  "warnings": ["caveats and uncertainty a reviewer must check"]
}`;
}

export const FILE_REVIEW_PROMPTS: DefaultPrompt[] = [
  {
    name: 'income_review',
    task_type: 'income_review',
    system_prompt: COMPLIANCE_PREAMBLE,
    user_prompt_template: fileReviewTemplate(
      'income-documentation',
      'Focus on: consistency of stated income across documents; pay frequency vs. YTD math; employment gaps; variable income (bonus/overtime/commission) trends; self-employment indicators that change documentation requirements.',
    ),
  },
  {
    name: 'asset_review',
    task_type: 'asset_review',
    system_prompt: COMPLIANCE_PREAMBLE,
    user_prompt_template: fileReviewTemplate(
      'asset/bank-statement',
      'Focus on: sufficiency of funds to close vs. stated estimates; large or irregular deposits needing sourcing; account ownership matching the borrower; overdrafts/NSF indicators; gift funds and their documentation trail.',
    ),
  },
  {
    name: 'credit_review',
    task_type: 'credit_review',
    system_prompt: COMPLIANCE_PREAMBLE,
    user_prompt_template: fileReviewTemplate(
      'credit-report',
      'Focus on: disputed accounts; recent inquiries and potential undisclosed debt; payment-history patterns described in the context; derogatory events and their timing; debts appearing in context but not in stated liabilities. Never state or imply a credit decision.',
    ),
  },
  {
    name: 'title_insurance_review',
    task_type: 'title_insurance_review',
    system_prompt: COMPLIANCE_PREAMBLE,
    user_prompt_template: fileReviewTemplate(
      'title/insurance',
      'Focus on: vesting and names matching the application; liens, judgments, and exceptions on the commitment; legal description consistency; insurance coverage amounts and effective dates vs. closing timeline; missing endorsements typically required for this loan type.',
    ),
  },
];

DEFAULT_PROMPTS.push(...FILE_REVIEW_PROMPTS);

DEFAULT_PROMPTS.push({
  name: 'website_qa',
  task_type: 'website_qa',
  system_prompt: COMPLIANCE_PREAMBLE,
  user_prompt_template: `Draft a public-facing answer to the website visitor's mortgage question below, USING ONLY the approved content snippets provided. This answer will be reviewed by a human before it is ever published — nothing you write is posted automatically.

Hard rules for public answers:
- Never state or imply approval, denial, a specific rate/APR, or any guarantee.
- If the approved content does not answer the question, say so plainly and suggest speaking with a loan officer — do not answer from general knowledge.
- Friendly, plain-English tone; no jargon without a one-line explanation.
- Always include the consumer disclaimer.

VISITOR QUESTION:
{{primary_text}}

APPROVED CONTENT SNIPPETS (cite these):
{{sources}}

Respond with JSON exactly matching:
{
  "summary": "one-line restatement of the question",
  "answer": "the public-facing answer, grounded in the approved content, with inline [Source N] references",
  "disclaimer": "consumer disclaimer recommending a licensed {{company}} loan officer; not an offer, approval, or rate quote",
  "suggested_followups": ["related questions the visitor might ask next"],
  "citations": [{"source_label": "...", "citation_text": "exact supporting text", "page_number": null}],
  "confidence_label": "HIGH|MEDIUM|LOW",
  "requires_human_review": true,
  "warnings": ["state clearly if approved content is weak, missing, or conflicting"]
}`,
});

/** {{placeholder}} substitution; unknown placeholders render as ''. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}
