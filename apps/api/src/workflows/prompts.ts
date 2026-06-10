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

const COMPLIANCE_PREAMBLE = `You are an AI assistant inside Mountain State Financial Group's internal mortgage operations dashboard. You DRAFT documents for licensed human staff to review — you never take final actions.

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
];

/** {{placeholder}} substitution; unknown placeholders render as ''. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}
