# MSFG Agentic AI Dashboard — Integrations Roadmap

How the dashboard connects to MSFG's existing systems, and the rules every integration must follow.

## Ground Rules (apply to every integration)

1. **MVP integrations are read-only or proposed-action-only.** No integration writes to an external system in MVP.
2. **No automatic borrower communication, ever.** Every borrower/realtor/lender message requires a human approval record before send — in every phase.
3. **No CRM/LOS updates without approval.** Monday.com, LendingPad, and Go High Level writes only execute from an approved `ai_integration_actions` row.
4. **Action-queue design over direct automation.** All external effects are rows in `ai_integration_actions` (status: `proposed → approved → executed | failed | rejected`). The execute path is blocked server-side unless an approved `ai_approvals` record is linked. Inbound data prefers webhooks into a receiver that enqueues — never AI agents calling external APIs directly mid-run.
5. **All credentials in AWS Secrets Manager** (one secret per integration), referenced by ARN; never in repo, images, or logs. Local dev uses `.env` (gitignored).
6. **Every lifecycle transition writes an audit event** (`ai_audit_events`, append-only, transactional with the state change).

Audit event naming convention: `integration.{system}.{action}.{phase}` where phase ∈ `proposed | approved | rejected | executed | failed`, plus `.fetched` for read paths.

---

## Integrations

### Monday.com (pipeline/board tracking)

| Field | Detail |
|---|---|
| Purpose | Pull loan pipeline items/statuses for task context; later, propose item status/column updates and updates_log notes |
| Credentials | Monday.com API token (scoped account) — Secrets Manager `agentic-dashboard/{env}/monday` |
| Data pulled | Board items, columns (loan stage, assignee, dates), item updates |
| Data pushed | Proposed only: column value changes, item updates/notes — via `ai_integration_actions` |
| Approval | Required for every write; reads allowed without approval |
| Risks | Wrong-item updates corrupting pipeline truth; token over-scoped; board schema drift breaking column mappings; rate limits |
| Audit events | `integration.monday.boards.fetched`, `integration.monday.item_update.proposed / .approved / .rejected / .executed / .failed` |
| Priority | Phase 2 (read-only) → Phase 3 (approved writes) |

### LendingPad (LOS)

| Field | Detail |
|---|---|
| Purpose | Pull loan file data (conditions, milestones, contacts) to ground Conditions/Review agents in real file context |
| Credentials | LendingPad API credentials/OAuth — Secrets Manager `agentic-dashboard/{env}/lendingpad` |
| Data pulled | Loan summary, condition lists, milestone status, document index (subject to LendingPad API capabilities) |
| Data pushed | **None planned.** LOS is the system of record for lending; the dashboard does not write to it until a dedicated compliance review approves a specific, narrow write path |
| Approval | N/A for reads; any future write would require approval gating plus separate compliance sign-off |
| Risks | Borrower PII in transit/storage (encrypt, minimize fields pulled); stale cache misleading reviewers; API availability; vendor API contract changes |
| Audit events | `integration.lendingpad.loan.fetched`, `integration.lendingpad.conditions.fetched`, `integration.lendingpad.fetch.failed` |
| Priority | Phase 2 (read-only) |

### Go High Level (CRM/marketing)

| Field | Detail |
|---|---|
| Purpose | Pull contact/opportunity context; later, propose contact notes and tags (internal CRM hygiene, not borrower messaging) |
| Credentials | GHL API key / OAuth per location — Secrets Manager `agentic-dashboard/{env}/ghl` |
| Data pulled | Contacts, opportunities, pipelines, tags |
| Data pushed | Proposed only: contact notes, tags. **Never SMS/email sends through GHL from AI** — GHL messaging campaigns stay human-operated |
| Approval | Required for every write |
| Risks | GHL can send borrower communications — the integration must be scoped so the dashboard cannot trigger campaigns/messages; duplicate-contact mismatches; tag sprawl |
| Audit events | `integration.ghl.contact.fetched`, `integration.ghl.contact_note.proposed / .approved / .rejected / .executed / .failed` |
| Priority | Phase 2 (read-only) → Phase 3 (approved notes/tags) |

### Zapier

| Field | Detail |
|---|---|
| Purpose | Bridge to systems without first-class integrations; receive inbound triggers (e.g., new Monday item → create dashboard task) |
| Credentials | Zapier webhook URLs + shared-secret header — Secrets Manager `agentic-dashboard/{env}/zapier` |
| Data pulled | Inbound webhook payloads (task-creation triggers) |
| Data pushed | Outbound webhooks **only for approved actions** — Zapier is a delivery mechanism for already-approved `ai_integration_actions`, never a bypass |
| Approval | Inbound: creates `proposed` tasks only. Outbound: approved actions only |
| Risks | Easiest path to uncontrolled automation — a Zap chained off our webhook could act without approval; mitigate by sending only approved-action payloads and documenting that Zaps must not fan out to borrower comms; webhook auth spoofing |
| Audit events | `integration.zapier.webhook.received`, `integration.zapier.dispatch.executed / .failed` |
| Priority | Phase 3 |

### Make (Integromat)

| Field | Detail |
|---|---|
| Purpose | Same bridge role as Zapier; choose **one** of Zapier/Make/n8n as the standard bridge to avoid parallel automation stacks |
| Credentials | Make webhook URLs + signature secret — Secrets Manager `agentic-dashboard/{env}/make` |
| Data pulled | Inbound scenario webhooks |
| Data pushed | Approved-action payloads only |
| Approval | Same as Zapier |
| Risks | Same as Zapier; scenario sprawl with no code review |
| Audit events | `integration.make.webhook.received`, `integration.make.dispatch.executed / .failed` |
| Priority | Phase 3 (only if chosen as the bridge) |

### n8n

| Field | Detail |
|---|---|
| Purpose | Self-hosted alternative bridge — better audit/control than Zapier/Make if MSFG wants automation logic in-house |
| Credentials | n8n webhook URLs + API key — Secrets Manager `agentic-dashboard/{env}/n8n` |
| Data pulled | Inbound workflow webhooks |
| Data pushed | Approved-action payloads only |
| Approval | Same as Zapier |
| Risks | Self-hosting burden (patching, uptime); same bypass risk as any automation bridge |
| Audit events | `integration.n8n.webhook.received`, `integration.n8n.dispatch.executed / .failed` |
| Priority | Phase 3 (only if chosen as the bridge) |

### Gmail

| Field | Detail |
|---|---|
| Purpose | Send **approved** borrower/realtor/lender emails drafted by the Borrower Email agent; optionally read specific threads for context |
| Credentials | Google Workspace service account with domain-wide delegation (narrow scopes: `gmail.send`, optionally `gmail.readonly`) — Secrets Manager `agentic-dashboard/{env}/gmail` |
| Data pulled | (Optional, Phase 3) specific thread content for reply context |
| Data pushed | Email sends — **only** from approved `ai_integration_actions` rows; send executes from the human-edited final output, never the raw AI output |
| Approval | **Always required. No exceptions.** This is the highest-sensitivity action in the system |
| Risks | Mis-sent borrower communication (wrong recipient, wrong file) — mitigate with recipient confirmation in the approval UI; RESPA/marketing compliance of content; over-scoped delegation |
| Audit events | `integration.gmail.email_send.proposed / .approved / .rejected / .executed / .failed`, `integration.gmail.thread.fetched` |
| Priority | Phase 3 |

### Outlook / Microsoft 365

| Field | Detail |
|---|---|
| Purpose | Same as Gmail for staff on Microsoft 365 (Graph API). Implement whichever matches MSFG's actual mail platform first; keep a common `email_send` action shape so the approval flow is provider-agnostic |
| Credentials | Entra ID app registration, `Mail.Send` (application or delegated) — Secrets Manager `agentic-dashboard/{env}/outlook` |
| Data pulled | (Optional) message/thread context via Graph |
| Data pushed | Approved email sends only |
| Approval | Always required, same as Gmail |
| Risks | Same as Gmail; tenant-wide `Mail.Send` application permission is broad — prefer delegated or restrict with an application access policy |
| Audit events | `integration.outlook.email_send.proposed / .approved / .rejected / .executed / .failed`, `integration.outlook.message.fetched` |
| Priority | Phase 3 |

### S3 (document storage)

| Field | Detail |
|---|---|
| Purpose | Store source documents, extracted text, and exports backing `ai_source_documents` and the Document/Source Panel |
| Credentials | None stored — IAM task role on the ECS service (no static keys); local dev uses local stub or scoped dev keys in `.env` |
| Data pulled | Document bytes via signed URLs; extracted text |
| Data pushed | Uploaded documents, extraction outputs, exports |
| Approval | Not an approval-gated integration — internal infrastructure. Access control via roles + signed URLs |
| Risks | PII exposure via leaked signed URLs (short expiry, audit issuance); public-access misconfiguration (Block Public Access enforced) |
| Audit events | `document.uploaded`, `document.url.issued`, `document.deleted` |
| Priority | **MVP** (metadata + upload), Phase 2 (extraction pipeline) |

### Cognito (auth)

| Field | Detail |
|---|---|
| Purpose | Authentication and group → role mapping (`viewer < operator < reviewer < admin`) for all dashboard access |
| Credentials | None secret in the app — pool ID / app client ID are non-secret config in SSM Parameter Store; JWT verification via JWKS |
| Data pulled | ID/access tokens, `cognito:groups`, sub/email (stored as text identity on rows) |
| Data pushed | None (group management done in Cognito console/IaC, not by the app) |
| Approval | N/A — infrastructure |
| Risks | Group misassignment granting reviewer/admin rights; dev-mode header auth accidentally enabled in AWS (must be hard-disabled outside local) |
| Audit events | `auth.login.succeeded`, `auth.login.failed`, `auth.role.denied` |
| Priority | MVP (dev-mode header locally) → **Phase 2** (real Cognito) |

### RDS / Postgres (system of record)

| Field | Detail |
|---|---|
| Purpose | All application state: tasks, runs, outputs, approvals, append-only audit, prompt versions, integration action queue |
| Credentials | DB user/password — Secrets Manager `agentic-dashboard/{env}/db` (RDS-managed rotation where possible) |
| Data pulled / pushed | All `ai_*` table reads/writes from the API only; no other system connects directly |
| Approval | N/A — infrastructure; it is the mechanism that *enforces* approval gating (FK from executed actions to `ai_approvals`) |
| Risks | This DB is the compliance record — loss or tampering is the worst-case incident; mitigations: multi-AZ, backups, snapshot-before-migration, append-only grants on `ai_audit_events` |
| Audit events | N/A (it stores the audit events); operational alarms instead |
| Priority | **MVP** |

### Existing MSFG websites

| Field | Detail |
|---|---|
| Purpose | Phase 3: embed the Website Mortgage Q&A widget; ingest site content (program pages, FAQs) into the RAG corpus |
| Credentials | Widget API key per site + origin allowlist — Secrets Manager `agentic-dashboard/{env}/web-widget` |
| Data pulled | Site content for indexing (crawl/export); visitor questions via the widget |
| Data pushed | Cited, disclaimed Q&A answers to anonymous visitors — **informational only, never application advice, rate quotes, or approvals**; persistent disclaimer + "talk to a licensed loan officer" handoff |
| Approval | Public answers cannot be human-approved per message; instead: constrained to an approved/cited corpus, mandatory disclaimers, refusal on out-of-scope questions, and sampled human review of transcripts |
| Risks | Public-facing compliance (advertising rules, fair-lending phrasing); prompt injection from visitors; cost abuse — rate limiting + spend caps required |
| Audit events | `integration.website.qa.answered`, `integration.website.qa.refused`, `integration.website.content.indexed` |
| Priority | Phase 3 |

### RAG "mortgage brain"

| Field | Detail |
|---|---|
| Purpose | Retrieval layer over SOPs, investor guidelines, and program docs (`ai_source_documents` / `ai_source_chunks` + pgvector embeddings) powering `sop_lookup_answer` and grounding all agents with citations |
| Credentials | Embedding provider API key (Anthropic/other) — Secrets Manager `agentic-dashboard/{env}/anthropic` (shared with generation) |
| Data pulled | Document chunks + embeddings at query time |
| Data pushed | None external — internal subsystem |
| Approval | N/A for retrieval; **corpus curation is admin-controlled** (only classified, admin-ingested documents enter the brain) |
| Risks | Outdated guidelines confidently cited — mitigate with document effective-dates, re-index cadence, and "must disclose uncertainty" behavior; retrieval misses producing uncited claims (flagged at review) |
| Audit events | `rag.query.executed`, `rag.index.updated`, `rag.document.ingested` |
| Priority | MVP (keyword retrieval) → **Phase 2** (pgvector RAG) |

### Document OCR / extraction service

| Field | Detail |
|---|---|
| Purpose | Extract text from uploaded PDFs/images (paystubs, bank statements, title commitments) into `ai_source_chunks` for the review agents; AWS Textract is the default candidate |
| Credentials | None if Textract (IAM task role); vendor API key in Secrets Manager `agentic-dashboard/{env}/ocr` if a third-party service is chosen |
| Data pulled | Extracted text, key-value pairs, confidence scores |
| Data pushed | Document bytes to the OCR service (borrower PII — service must be DPA-covered; Textract keeps data in-region) |
| Approval | N/A — internal processing; extraction results feed AI drafts which are themselves review-gated. Low-confidence extractions flagged in the Document Panel |
| Risks | OCR errors silently propagating into income/asset summaries — surface confidence scores and require reviewers to verify figures against the source image; per-page cost on large statements |
| Audit events | `document.extraction.started`, `document.extraction.completed`, `document.extraction.failed` |
| Priority | Phase 2 (text-PDF extraction) → **Phase 3** (full OCR pipeline) |

---

## Example `ai_integration_actions` Records

Lifecycle: `proposed → approved → executed` (or `rejected` / `failed`). `approval_id` **must** reference an approved `ai_approvals` row before the execute endpoint will run; the server blocks execution otherwise and writes an `action.execute.blocked` audit event.

### 1. Proposed Monday.com status update

```json
{
  "id": "act_01J9MNDY3K",
  "integration": "monday",
  "action_type": "item_update",
  "task_id": "task_01J9MND001",
  "output_id": "out_01J9MND777",
  "payload": {
    "board_id": 4821973650,
    "item_id": 9912834401,
    "column_id": "status",
    "value": "Conditions Submitted",
    "note": "AI-drafted condition responses approved and sent to UW 2026-06-10."
  },
  "status": "proposed",
  "approval_id": null,
  "proposed_by": "loa.smith@msfg.example",
  "proposed_at": "2026-06-10T15:04:11Z",
  "executed_at": null,
  "result": null
}
```

After review and execution:

```json
{
  "id": "act_01J9MNDY3K",
  "status": "executed",
  "approval_id": "apr_01J9MNE220",
  "approved_by": "reviewer.jones@msfg.example",
  "approved_at": "2026-06-10T15:32:40Z",
  "executed_at": "2026-06-10T15:32:44Z",
  "result": { "monday_mutation_id": "mut_88231", "http_status": 200 }
}
```

### 2. Proposed borrower email via Gmail

```json
{
  "id": "act_01J9MNF8RQ",
  "integration": "gmail",
  "action_type": "email_send",
  "task_id": "task_01J9MNF100",
  "output_id": "out_01J9MNF315",
  "payload": {
    "to": ["borrower@example.com"],
    "from": "loa.smith@msfg.example",
    "subject": "Documents needed to keep your loan on track",
    "body_source": "final_edited_output",
    "body_ref": "out_01J9MNF315.final_output"
  },
  "status": "proposed",
  "approval_id": null,
  "proposed_by": "loa.smith@msfg.example",
  "proposed_at": "2026-06-10T16:10:02Z"
}
```

```json
{
  "id": "act_01J9MNF8RQ",
  "status": "executed",
  "approval_id": "apr_01J9MNG440",
  "approved_by": "reviewer.jones@msfg.example",
  "approved_at": "2026-06-10T16:25:18Z",
  "executed_at": "2026-06-10T16:25:21Z",
  "result": { "gmail_message_id": "18f2ac9912de" }
}
```

Note `body_source: "final_edited_output"` — the send always uses the human-edited final output, never the raw AI draft.

### 3. Proposed Go High Level contact note

```json
{
  "id": "act_01J9MNH2VW",
  "integration": "ghl",
  "action_type": "contact_note",
  "task_id": "task_01J9MNH050",
  "output_id": "out_01J9MNH199",
  "payload": {
    "contact_id": "ghl_ct_77AbQ2",
    "note": "06/10: Conditions list sent to borrower; awaiting updated bank statements and 2024 W-2.",
    "tags_add": ["awaiting-docs"]
  },
  "status": "proposed",
  "approval_id": null,
  "proposed_by": "processor.lee@msfg.example",
  "proposed_at": "2026-06-10T17:02:45Z"
}
```

```json
{
  "id": "act_01J9MNH2VW",
  "status": "executed",
  "approval_id": "apr_01J9MNJ010",
  "approved_by": "reviewer.jones@msfg.example",
  "approved_at": "2026-06-10T17:20:09Z",
  "executed_at": "2026-06-10T17:20:12Z",
  "result": { "ghl_note_id": "note_5521ab" }
}
```

Each transition above also produces its audit event (`integration.ghl.contact_note.proposed`, `.approved`, `.executed`) written transactionally with the status change.

---

## Priority Summary

| Integration | MVP | Phase 2 | Phase 3 |
|---|---|---|---|
| RDS/Postgres | System of record | — | — |
| S3 | Document storage (metadata + upload) | Extraction pipeline | — |
| Cognito | Dev-mode header locally | Real pool, groups → roles | — |
| RAG "mortgage brain" | Keyword retrieval | pgvector RAG | Corpus growth, website corpus |
| LendingPad | — | Read-only loan/condition data | — |
| Monday.com | — | Read-only boards | Approved item updates |
| Go High Level | — | Read-only contacts | Approved notes/tags |
| Document OCR/extraction | — | Text-PDF extraction | Full OCR pipeline |
| Gmail | — | — | Approved email sends |
| Outlook | — | — | Approved email sends (if M365) |
| Existing MSFG websites | — | — | Q&A widget + content ingestion |
| Zapier / Make / n8n | — | — | One chosen as bridge, approved dispatch only |
