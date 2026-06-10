# Agentic Dashboard — Database Design (Postgres)

Authoritative DDL: [`docs/sql/agentic_dashboard_schema.sql`](sql/agentic_dashboard_schema.sql),
mirrored by runnable migrations in `apps/api/migrations/`.

## ERD (text form)

```
ai_tasks 1 ──── * ai_task_inputs ──── 0..1 ai_source_documents
   │                                           │
   ├── 1 ──── * ai_task_runs                   └── 1 ──── * ai_source_chunks
   │              │                                             ▲
   │              └── 1 ──── * ai_outputs ──── * ai_citations ──┘ (chunk_id, optional)
   │                              │                  │
   │                              │                  └── 0..1 ai_source_documents
   ├── 1 ──── * ai_approvals ◀────┘ (output_id)
   │              ▲
   ├── 1 ──── * ai_integration_actions (approval_id — REQUIRED for execution)
   │
   └── 0..1 ◀── * ai_audit_events (append-only; also captures task-less events)

ai_prompt_templates (standalone; runs reference "name@version" as text)
ai_workflow_configs (standalone; one row per workflow)
```

## How the entities work together

1. A user creates an **ai_task** (type, priority, optional borrower/loan
   *references* — opaque identifiers only, never PII payloads).
2. Context is attached as **ai_task_inputs**: condition text, borrower
   scenario, manual source snippets, or references to
   **ai_source_documents** (whose bytes live in S3, never in Postgres, and
   whose citable pieces are **ai_source_chunks**).
3. Running a workflow creates an **ai_task_runs** row — the provenance
   record: workflow name, provider, exact model, `prompt_version`
   (`name@version` from **ai_prompt_templates**), the full
   `input_snapshot_json` (including the source snippets sent to the model),
   token counts, and cost.
4. The run produces one or more **ai_outputs**: the raw model content
   (immutable), the structured JSON, a confidence label, and a
   `review_status` that walks the compliance flow
   `DRAFT → AI_GENERATED → NEEDS_REVIEW → APPROVED/REJECTED/CHANGES_REQUESTED
   → FINALIZED → ACTION_SENT → ACTION_COMPLETED`.
   Source-grounded claims link back via **ai_citations**.
5. A reviewer records a decision in **ai_approvals**. The reviewer's
   `edited_final_content` is stored **separately** from the raw AI output —
   both survive forever, so audits can always compare what the AI said vs.
   what a human actually sent.
6. External effects only ever exist as **ai_integration_actions**. A row is
   born `proposed`; it cannot move to any executing/executed state unless
   its `approval_id` points at an approval with `decision = 'approved'` —
   enforced in the service layer **and** by a database trigger
   (`enforce_action_approval`), so even a buggy new endpoint cannot bypass
   the gate.
7. Every compliance-critical state change (run completion, approval
   decisions, finalization, action execution) writes its
   **ai_audit_events** row inside the same database transaction via
   `Store.withTransaction` — the change and its audit record commit or
   roll back together. The table is append-only: a trigger rejects
   UPDATE/DELETE, and the app's DB role should not be granted those
   privileges either. Action execution additionally takes a `FOR UPDATE`
   row lock, so concurrent execute calls cannot double-send.

## Design decisions worth knowing

| Decision | Rationale |
|---|---|
| CHECK constraints instead of Postgres ENUMs | values evolve with a plain `ALTER TABLE`; no enum migration pain |
| User identity as `text` (Cognito sub/email), no users table yet | matches MVP auth (dev-mode headers / Cognito later); a users table + FKs arrives with full Cognito integration, via additive migration |
| `prompt_version` stored as denormalized text on runs | the run log must remain meaningful even if a template row is edited/retired; `name@version` is stable and human-readable |
| Raw output (`ai_outputs.content`) vs final content (`ai_approvals.edited_final_content`) in separate tables | compliance requires proving what the model produced vs. what staff approved/sent |
| `input_snapshot_json` on runs | "what did the AI see?" must be answerable later, even if task inputs are edited afterward |
| Append-only audit enforced by trigger, not convention | examiners ask "could anyone have changed this?" — answer must be no |
| Action gate enforced by trigger *and* service layer | defense in depth: a future endpoint mistake cannot leak an unapproved action into an executing state |
| `ai_source_documents.s3_bucket/s3_key` nullable | manual text snippets (MVP) have no S3 object; uploads (Phase 2) do |
| One active prompt version per name (partial unique index) | unambiguous "current" prompt; activation is an explicit, audited admin act |
| `estimated_cost numeric(10,6)` + token counts on runs | AI spend reporting straight from SQL, no third-party metering needed |
| Soft delete via `ai_tasks.status='archived'` | nothing about an AI interaction is ever physically deleted in MVP |

## Index strategy

Hot paths are: task queue filtering (`status`, `task_type`, `assigned_to`,
`created_at DESC`), approval queue (`ai_outputs.review_status`), per-task
drill-down (FK indexes on every child table), and audit search
(`event_type`, `task_id`, `created_at DESC`). All covered by the indexes in
the DDL. pgvector indexes for `ai_source_chunks.embedding_id` arrive in
Phase 2 with RAG.

## Migration approach

Plain numbered SQL files in `apps/api/migrations/` executed by a small
transactional runner that records applied filenames in a `schema_migrations`
table. Rules: migrations are **additive and backward-compatible** within a
release; destructive changes (drops/renames) require their own reviewed
release after code stops referencing the old shape; audit/approval/action
tables are never dropped or rewritten.

Seed data (migration `0002`): the four MVP workflow configs and version-1
prompt templates. No borrower data, ever.
