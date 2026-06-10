# MSFG Agentic AI Dashboard — Product Requirements Document

Internal, compliance-first AI operations dashboard for Mountain State Financial Group (MSFG).
The dashboard lets mortgage operations staff run AI workflows (drafting, summarizing, classifying, looking up SOPs/guidelines) under a strict human-approval model. **AI never takes an external action without a recorded human approval.**

- **Stack:** `apps/api` (Node.js 22 + TypeScript + Express, LangGraph.js in-process), `apps/web` (React + TypeScript + Vite SPA), Postgres, S3, Cognito.
- **API surface:** REST under `/api/ai/*` (tasks, inputs, runs, outputs, approvals, documents, chunks, prompts, audit, health, workflows, integrations/status).

---

## 1. Goals

1. Give MSFG staff a single queue for AI-assisted mortgage operations tasks (conditions, borrower emails, document checklists, SOP questions).
2. Enforce human review on every AI output before it is finalized or causes any external effect.
3. Produce a complete, immutable audit trail for every AI run: who, when, inputs, sources, model, prompt version, raw output, human decision, final output, action taken.
4. Ground guideline/SOP answers in cited source documents.
5. Establish the platform (tables, workflows, approval gating) that later review agents and integrations plug into without re-architecture.

## 2. Non-Goals

- AI making or influencing **final lending decisions** in any automated way.
- Automated borrower/realtor/lender communication (no auto-send, ever).
- Direct write access to external systems (Monday.com, LendingPad, Go High Level, email) without an approval record.
- A general-purpose chatbot. All AI use flows through typed workflows with structured outputs.
- LOS replacement, pricing engines, AUS, or credit pulls.
- Multi-tenant / external-customer use. This is an internal MSFG tool.
- A `users` table or user-management UI in MVP (identity is the Cognito sub/email stored as text).

## 3. User Roles

Roles are ordered: `viewer < operator < reviewer < admin`. Cognito groups map 1:1 to roles; locally a dev-mode header supplies the identity and role.

| Role | Typical MSFG staff | Can do | Cannot do |
|---|---|---|---|
| `viewer` | New hires, auditors, leadership read-only | View tasks, outputs, audit log, system status | Create tasks, run AI, approve, edit settings |
| `operator` | LOAs, processors, marketing coordinators | Everything viewer can; create tasks, attach documents, run workflows, edit drafts, submit for review | Approve/reject outputs, execute integration actions |
| `reviewer` | Senior processors, underwriter-adjacent staff, team leads, licensed LOs reviewing their own files | Everything operator can; approve/reject/request changes on outputs, approve proposed integration actions | Edit prompts, workflow configs, provider settings |
| `admin` | Ops manager, IT/engineering | Everything reviewer can; manage prompt templates, workflow configs, model/provider settings, approval requirements, role mappings | Bypass approval gating (not possible at any role — enforced server-side) |

Separation-of-duties note: the API rejects approval of an output by the same identity that ran it when the workflow config requires independent review (default on for borrower-facing drafts).

## 4. Modules

### 4.1 AI Task Queue
- Create a task: select task type (maps to a workflow), title/description, attach context (free text inputs and/or documents), set priority (`low | normal | high | urgent`).
- Task list with filters: status, type, priority, assignee, created-by, date.
- Task statuses derive from the run/output lifecycle; tasks show latest run and latest output review status.
- Backed by `ai_tasks`, `ai_task_inputs`, `ai_task_runs`.

### 4.2 Human Approval Center
- Review queue of outputs in `NEEDS_REVIEW`, sorted by priority/age.
- Side-by-side view: AI raw output (immutable) vs. editable final output, with retrieved sources and citations inline.
- Actions: **Approve**, **Reject**, **Request changes** (each requires the reviewer role and writes an `ai_approvals` row + audit event).
- Edited final output is stored separately from the raw output; the raw output is never mutated.
- Finalizing an output that proposes an external effect creates/links an `ai_integration_actions` row, which itself requires an approved `ai_approvals` record before the execute path will run. The execute path is **blocked server-side** without it.

**Output review status flow:**

```
DRAFT → AI_GENERATED → NEEDS_REVIEW → (APPROVED | REJECTED | CHANGES_REQUESTED) → FINALIZED → ACTION_SENT → ACTION_COMPLETED
```

`REJECTED` is terminal for that output; `CHANGES_REQUESTED` returns it to the operator for edits/re-run.

### 4.3 Mortgage Workflow Agents
All workflows run in LangGraph.js, embedded in-process in the API. All return structured JSON. All are `requires_human_review = true` by default. Provider abstraction supports `MODEL_PROVIDER=mock` for local dev; Anthropic is the initial real provider. Prompts are versioned in `ai_prompt_templates`.

| Agent | Purpose | Status |
|---|---|---|
| Conditions Agent (`condition_response_draft`) | Draft responses to underwriting conditions from file context | **MVP** |
| Borrower Email Drafting Agent (`borrower_email_draft`) | Draft borrower-facing emails (never sent without approval) | **MVP** |
| Document Checklist Builder (`document_checklist_builder`) | Build needed-docs checklist from loan scenario | **MVP** |
| Internal SOP Lookup Agent (`sop_lookup_answer`) | Answer SOP/guideline questions with citations | **MVP** |
| Income Review Agent | Summarize/flag income docs (paystubs, W-2s, tax returns) | Phase 2 |
| Asset Review Agent | Summarize/flag asset statements, large deposits | Phase 2 |
| Credit Review Agent | Summarize credit report findings, inquiry letters needed | Phase 2 |
| Title/Insurance Agent | Review title commitments / HOI for required items | Phase 2 |
| Website Mortgage Q&A Agent | Public-site mortgage Q&A (cited, disclaimed) | Phase 3 |

Phase 2/3 agents ship as `ai_workflow_configs` rows (disabled) in MVP so configuration, review rules, and routing are defined ahead of implementation.

### 4.4 Audit Log
- `ai_audit_events` is **append-only** (no UPDATE/DELETE; enforced by DB grants/trigger).
- Events are written **transactionally with the state change they describe** — a state change without its audit event cannot commit.
- Every AI run logs: user, timestamp, input, workflow, retrieved sources, provider/model, prompt version, raw output, approval status, final edited output, action taken.
- UI: filter by entity, event type, actor, date range; event detail shows full payload; export to CSV (admin/reviewer).

### 4.5 Document / Source Panel
- Upload documents (S3-backed; local dev uses a local/minio-style stub), view S3 key, extracted text, classification (e.g., paystub, bank statement, SOP, guideline).
- Source chunks (`ai_source_chunks`) viewable per document; citations (`ai_citations`) link output spans to chunks.
- Citation review: from any output, click a citation to see the exact source chunk and parent document.

### 4.6 System Status
- `/api/ai/health` aggregates: AI provider health (mock/Anthropic reachability), RAG status (chunk counts, embedding backlog — Phase 2), database status, queue status (pending tasks/runs, oldest pending), integration status (`/api/ai/integrations/status`, per-integration configured/connected/last-error).
- Visible to all roles (read-only).

### 4.7 Admin Settings
- Prompt templates: create new versions (versions are immutable once used by a run), set active version per workflow.
- Workflow configuration: enable/disable workflows, review requirements (`requires_human_review` cannot be set to false for borrower-facing or external-effect workflows), independent-reviewer requirement.
- Model/provider settings: provider, model, temperature/max tokens per workflow.
- Approval requirements: which roles may approve which workflow outputs and integration action types.
- Role permissions: view Cognito-group → role mapping (mapping itself managed in Cognito).

## 5. Main Workflows (User Journeys)

### 5.1 Create task → run AI → review → approve → finalize
1. **Operator** creates a task: type = Conditions Agent, priority = high, pastes condition text, attaches the relevant doc. (`ai_tasks`, `ai_task_inputs` rows; `task.created` audit event.)
2. Operator clicks **Run**. API creates `ai_task_runs` (user, timestamp, workflow, prompt version, provider/model), executes the LangGraph workflow, stores retrieved sources and raw structured output in `ai_outputs` with status `AI_GENERATED`, then `NEEDS_REVIEW`. Audit events: `run.started`, `run.completed`, `output.created`.
3. **Reviewer** opens the Approval Center, sees the draft with citations, edits the final text (stored separately from raw output), and clicks **Approve**. `ai_approvals` row written; output → `APPROVED`; audit events `output.edited`, `approval.recorded`.
4. Reviewer (or operator, per workflow config) marks the output `FINALIZED`. If the output implies an external effect (e.g., send email), an `ai_integration_actions` row is created in `proposed` status — execution remains blocked until that action also has an approved `ai_approvals` record. Status then progresses `ACTION_SENT → ACTION_COMPLETED` as the action executes (Phase 3 for real execution).

### 5.2 SOP question with citations
1. Operator creates a `sop_lookup_answer` task: "What is our process for re-disclosing after a rate lock extension?"
2. Run retrieves relevant `ai_source_chunks` from indexed SOP documents (keyword retrieval in MVP; pgvector RAG in Phase 2), generates a structured answer with `ai_citations` linking each claim to chunks, and discloses uncertainty when sources are thin ("Not found in SOPs" rather than guessing).
3. Reviewer verifies each citation against the source chunk in the Document/Source Panel, then approves. Uncited claims are grounds for `CHANGES_REQUESTED`.

### 5.3 Document attach + citation review
1. Operator uploads a PDF to a task; API stores it in S3, records `ai_source_documents` (S3 key, classification, extraction status), and (Phase 2) extracts text into `ai_source_chunks`.
2. Operator runs the workflow; the run records exactly which chunks were retrieved.
3. Reviewer opens the output, clicks any citation, and sees the highlighted chunk plus a link to the parent document before deciding.

## 6. Data Entities

| Table | Purpose |
|---|---|
| `ai_tasks` | Task queue: type, title, priority, status, created_by (Cognito sub/email as text), assignee |
| `ai_task_inputs` | Context attached to a task: free text, structured fields, document references |
| `ai_task_runs` | One AI execution: user, timestamp, workflow, prompt template version, provider/model, token counts, status, error |
| `ai_outputs` | Structured raw output (immutable) + separately stored final edited output + review status |
| `ai_approvals` | Human decisions: approver identity, decision (approve/reject/changes), comment, timestamp; required for finalization and for executing any integration action |
| `ai_audit_events` | Append-only event log; written in the same transaction as the state change |
| `ai_source_documents` | Uploaded docs: S3 key, classification, extraction status, uploader |
| `ai_source_chunks` | Extracted/segmented text chunks for retrieval |
| `ai_citations` | Links output claims to source chunks |
| `ai_prompt_templates` | Versioned prompts per workflow; versions immutable once used |
| `ai_workflow_configs` | Per-workflow settings: enabled, review requirements, model settings |
| `ai_integration_actions` | Proposed external actions (the only path to external effects); FK to required `ai_approvals` record |

User identity is stored as text (Cognito sub/email) throughout; no `users` table in MVP.

## 7. Security Rules

1. All API routes require authentication (Cognito JWT in deployed envs; dev-mode header auth locally only, disabled outside local).
2. Role checks enforced **server-side** on every route; UI hiding is cosmetic only.
3. The integration execute path verifies an approved `ai_approvals` record exists for the `ai_integration_actions` row inside the same transaction; otherwise it returns 403 and writes an `action.execute.blocked` audit event.
4. Raw AI outputs are immutable; edits write to the separate final-output field.
5. `ai_audit_events` is append-only at the database level.
6. No secrets in the repo: env vars locally (`.env`, gitignored); AWS Secrets Manager/SSM in AWS.
7. S3 buckets private; access via signed URLs only.
8. No production borrower data in tests; test fixtures are synthetic.

## 8. Mortgage Compliance Principles

These principles are binding on all workflows and enforced in code (review gating, blocked execute paths) — not just policy text:

- AI can draft, summarize, classify, and suggest.
- AI cannot make final lending decisions.
- AI cannot issue approvals/denials.
- AI cannot send borrower/lender/realtor communications without human approval.
- AI must cite sources when answering guideline/SOP questions.
- AI must disclose uncertainty.
- All final decisions belong to licensed/human staff.

## 9. Compliance Requirements

1. Every AI run is fully reconstructable from the database: input, prompt version, sources retrieved, model/provider, raw output, reviewer identity and decision, final output, action result.
2. Approval records identify a specific human (Cognito sub/email) and timestamp; approvals cannot be created by the system itself.
3. Borrower-facing drafts carry `requires_human_review = true` and cannot be configured otherwise.
4. Guideline/SOP answers without citations are flagged in the review UI.
5. Audit events are retained indefinitely (no TTL in MVP); export available for compliance review.
6. Phase 3 website Q&A must display "not a loan commitment / talk to a licensed loan officer" disclaimers and never collect application data through the AI surface.

## 10. Scope by Phase

### MVP
- Task Queue, Approval Center, Audit Log, System Status, Admin Settings (prompts + workflow configs).
- Workflows: `condition_response_draft`, `borrower_email_draft`, `document_checklist_builder`, `sop_lookup_answer`.
- Mock provider mode + Anthropic provider; prompt versioning; full audit pipeline; approval gating including `ai_integration_actions` schema and blocked execute path (no real external execution yet).
- Document upload metadata + manual text input; keyword-based source retrieval for SOP lookup.
- Dev-mode header auth locally; plain SQL migrations; Docker Postgres locally.

### Phase 2
- Real Cognito (user pool, groups → roles, SPA PKCE).
- S3 uploads with text extraction pipeline; document classification.
- RAG with pgvector (embeddings over `ai_source_chunks`).
- Remaining review agents: Income, Asset, Credit, Title/Insurance.
- First **read-only** integrations (Monday.com items, LendingPad loan data, GHL contacts) feeding task context.

### Phase 3
- Approved-action execution: Monday.com updates and email sends driven from approved `ai_integration_actions` rows.
- Website Mortgage Q&A widget (cited, disclaimed, rate-limited).
- OCR pipeline for scanned documents.
- Cost dashboards from token counts in `ai_task_runs`.

## 11. Acceptance Criteria

Numbered, testable, per module. All API-level criteria verified with automated tests using synthetic data only.

**Task Queue**
1. An operator can create a task with type, title, priority, and at least one input; the task appears in the queue with status reflecting its latest run/output.
2. A viewer receives 403 on `POST /api/ai/tasks`.
3. Task list filters by status, type, priority, and creator return correct subsets.

**Approval Center**
4. Running a workflow produces an `ai_outputs` row in `NEEDS_REVIEW` with the raw structured output stored.
5. A reviewer approving an output creates an `ai_approvals` row and moves the output to `APPROVED`; an operator attempting the same gets 403.
6. Editing the final output never modifies the stored raw output (verified byte-for-byte).
7. `POST .../integration-actions/:id/execute` without an approved `ai_approvals` record returns 403 and writes an `action.execute.blocked` audit event; with one, it proceeds.
8. Status transitions outside the defined flow (e.g., `DRAFT → FINALIZED`) are rejected with 422.

**Workflow Agents**
9. Each MVP workflow returns JSON matching its declared schema in mock mode and Anthropic mode.
10. Every run records provider, model, and prompt template version; re-running after a prompt version bump records the new version.
11. With `MODEL_PROVIDER=mock`, the full create→run→review→approve flow completes with no network calls.
12. `sop_lookup_answer` outputs include citations referencing existing `ai_source_chunks`, or an explicit "insufficient sources" flag.

**Audit Log**
13. Every state change (task created, run started/completed, output created/edited, approval recorded, action proposed/approved/executed/blocked) has exactly one corresponding audit event committed in the same transaction.
14. `UPDATE` or `DELETE` on `ai_audit_events` fails at the database level.
15. A single run is fully reconstructable (input → prompt version → sources → raw output → decision → final output → action) from audit + entity rows.

**Document/Source Panel**
16. Uploading a document creates an `ai_source_documents` row with an S3 key; the file is retrievable only via a signed URL.
17. Clicking a citation in an output displays the exact source chunk text and parent document.

**System Status**
18. `/api/ai/health` reports provider, database, queue, and integration status; a stopped database yields a degraded (non-200-healthy) response.

**Admin Settings**
19. Only admins can create prompt template versions; a version used by any run can no longer be edited.
20. Setting `requires_human_review = false` on a borrower-facing or external-effect workflow is rejected server-side.
