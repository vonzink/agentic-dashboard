# MSFG Agentic AI Dashboard — Architecture Plan

Status: DRAFT v1 (pre-implementation)
Date: 2026-06-10
Author: Architecture analysis pass (Claude Code session, reviewed by Z. Zink)

---

## 0. Repo Analysis

The repository `vonzink/agentic-dashboard` currently contains only a `README.md`
(one commit). There are **no** existing languages, frameworks, backend services,
frontend apps, auth integrations, deployment configs, or database setup in this
repo. Everything below is therefore a greenfield design, constrained by MSFG's
known estate (described to us, not yet verified in code):

| Area | Assumed existing state (UNVERIFIED) |
|---|---|
| Hosting | AWS: CloudFront + S3 for static sites; some EC2/ECS for services |
| Backend | Java/Spring Boot services exist elsewhere in the org |
| Auth | Cognito available or adoptable; possibly an existing user pool |
| Database | RDS Postgres is an approved pattern |
| Storage | S3 approved for document storage |
| Integrations | Monday.com, LendingPad, Go High Level, Zapier/Make/n8n, Gmail/Outlook — future |

**Action item:** before Milestone 2, confirm the Cognito user pool, VPC/RDS
patterns, and whether any Spring Boot service should front loan data. None of
Milestone 1 depends on these answers (documented in §7 Assumptions).

### Risks identified

1. **Greenfield risk** — no in-repo patterns to inherit; mitigated by keeping
   the stack deliberately boring and small.
2. **PII/compliance risk** — mortgage data is GLBA-sensitive. Mitigated by:
   audit-first design, human approval gates, no production borrower data in
   tests (synthetic fixtures only), S3 SSE + least-privilege IAM, and a
   `classification` field on every stored document.
3. **Autonomy risk** — an agent taking real actions. Mitigated structurally:
   the `actions` table can only be written from an `approvals` row in
   `approved` state; no code path executes external side effects pre-approval.
4. **Prompt/model drift risk** — outputs unexplainable later. Mitigated by
   versioned prompts (content-hashed) and full run logging (§4 schema).
5. **Framework churn risk** — LangGraph moves fast. Mitigated by pinning
   versions and isolating all LangGraph code behind a thin internal interface
   (`apps/api/src/workflows/`), so graphs are swappable.
6. **Auth unknowns** — Cognito pool details unconfirmed. Mitigated by a
   pluggable auth dependency: JWT (Cognito JWKS) verification in prod, an
   explicit `AUTH_MODE=dev` bypass for local dev only (refuses to start if
   `ENV=production`).
7. **Vendor lock-in (LLM provider)** — mitigated by a single `llm_client`
   module that records `provider` + `model` on every run and is the only
   place SDKs are imported.

---

## 1. Recommended Architecture

Boring, three-tier, single deployable backend to start (modular monolith);
split into services only when a seam proves itself.

```
┌─────────────────────────────────────────────────────────────┐
│  React + TypeScript SPA  (apps/web)                          │
│  CloudFront + S3 in prod; Vite dev server locally            │
└───────────────▲─────────────────────────────────────────────┘
                │ HTTPS + Cognito JWT
┌───────────────┴─────────────────────────────────────────────┐
│  Node.js + TypeScript API (apps/api, Express)                │
│   ├─ routes/       REST endpoints (/api/ai/*)                │
│   ├─ workflows/    LangGraph.js graphs (draft-only, no       │
│   │                external side effects)                    │
│   ├─ services/     task/run/approval/audit business logic    │
│   ├─ repositories/ Postgres data access (+ in-memory test    │
│   │                implementations)                          │
│   └─ migrations/   plain SQL migrations                      │
└───────┬───────────────────────┬─────────────────────────────┘
        │                       │
┌───────▼───────┐       ┌───────▼───────┐
│ Postgres (RDS)│       │ S3            │
│ state, audit, │       │ documents,    │
│ approvals,    │       │ artifacts     │
│ run logs      │       │ (SSE, private)│
└───────────────┘       └───────────────┘
```

### Key decisions (and why)

- **Backend language: Node.js + TypeScript (Express) with LangGraph.js
  embedded in-process.** Rationale: this repo is greenfield (no existing
  Spring Boot app here to extend); a Java API would force LangGraph into a
  separate Python/Node sidecar service with IPC, deployment, and audit-
  consistency overhead; Node keeps one language across frontend and backend;
  and LangGraph.js is production-mature for the draft-only workflows we need.
  Existing MSFG Spring Boot services remain systems of record and integrate
  over authenticated REST later (§6). See docs/ADR-AGENTIC-AI-DASHBOARD.md.
- **Human-in-the-loop is structural, not procedural.** Workflows are
  LangGraph graphs that can only *draft* — they have no tools that touch
  external systems. External effects exist solely as `ai_integration_actions`
  rows, and the execute path refuses to run without an `approved`/`FINALIZED`
  approval record. The "act" code path is unreachable pre-approval.
- **Audit-first:** every state change writes its audit record synchronously
  in the same request (never fire-and-forget logging); wrapping each pair in
  a single DB transaction is a Sprint 4 hardening item. Required fields per
  the compliance spec: user, timestamp, input, workflow, retrieved sources,
  provider/model, prompt version, raw output, approval status, final edited
  output, action taken.
- **Auth: Cognito JWT** verified server-side against the pool's JWKS; roles
  via Cognito groups (`operator`, `reviewer`, `admin`) mapped to a local
  `users` row on first login. Reviewer ≠ requester enforcement is a config
  flag (`REQUIRE_SECOND_REVIEWER`) — on in prod, off in dev.
- **Frontend: React + TypeScript + Vite**, TanStack Query for server state,
  React Router. No state-management framework until needed. Deployed as
  static assets to S3/CloudFront per existing MSFG pattern.
- **Local dev:** `docker-compose` (Postgres 16 + optional MinIO for S3),
  `.env` from a documented `.env.example`, no secrets in the repo ever.
- **RAG (future, M3+):** pgvector extension in the same Postgres — no extra
  vector DB until scale demands it.

---

## 2. Proposed Folder Structure

```
agentic-dashboard/
├── README.md
├── docs/                      # architecture, PRD, ADR, schema, compliance,
│   └── sql/                   # proposed SQL schema (mirrors migrations)
├── apps/
│   ├── api/                   # Node 22 + TypeScript + Express
│   │   ├── package.json
│   │   ├── migrations/        # numbered .sql migrations + tiny runner
│   │   ├── src/
│   │   │   ├── index.ts       # server entry
│   │   │   ├── app.ts         # express app wiring (testable)
│   │   │   ├── config.ts      # env-driven config, no secrets in code
│   │   │   ├── middleware/    # auth (dev-mode + Cognito stub), errors
│   │   │   ├── routes/        # /api/ai/* endpoint handlers
│   │   │   ├── services/      # tasks, runs, approvals, audit, actions
│   │   │   ├── repositories/  # interfaces + pg + in-memory impls
│   │   │   ├── workflows/     # LangGraph.js graphs, registry, providers
│   │   │   └── types/         # DTOs, zod schemas, status enums
│   │   └── tests/             # vitest — synthetic data ONLY
│   └── web/                   # React + TS + Vite dashboard
│       ├── package.json
│       └── src/
│           ├── api/           # typed client + types
│           ├── pages/         # Dashboard, Tasks, TaskDetail, Approvals,
│           │                  # Documents, Admin, AuditLog
│           ├── components/
│           └── mocks/         # clearly isolated dev-only mock data
├── infra/                     # IaC (M2+: Terraform or CDK, match MSFG norm)
├── docker-compose.yml         # local Postgres
├── .env.example
├── .gitignore
└── .github/workflows/ci.yml   # lint + typecheck + tests on PR
```

---

## 3. Database Schema

The authoritative schema lives in `docs/sql/agentic_dashboard_schema.sql`
(mirrored by `apps/api/migrations/`), explained in
`docs/AGENTIC_DASHBOARD_DATABASE.md`. The draft below was the v0 sketch and
is retained for history; where they differ, the SQL file wins.

### v0 sketch (superseded)

All tables `created_at timestamptz default now()`. UUID PKs. `audit_events`
is append-only (no UPDATE/DELETE grants for the app role).

```sql
-- People (mirrored from Cognito on first login)
users (
  id uuid PK,
  external_sub text UNIQUE NOT NULL,      -- Cognito sub
  email text NOT NULL,
  display_name text,
  role text NOT NULL CHECK (role IN ('operator','reviewer','admin')),
  is_active boolean NOT NULL DEFAULT true
)

-- Registered workflow definitions (code-defined, mirrored to DB)
workflows (
  id uuid PK,
  key text UNIQUE NOT NULL,               -- e.g. 'doc_checklist_v1'
  name text NOT NULL,
  description text,
  is_enabled boolean NOT NULL DEFAULT true
)

-- Versioned, content-hashed prompts
prompt_versions (
  id uuid PK,
  workflow_id uuid FK -> workflows,
  version int NOT NULL,
  content text NOT NULL,
  content_sha256 text NOT NULL,
  created_by uuid FK -> users,
  UNIQUE (workflow_id, version)
)

-- One row per AI invocation. The compliance log.
agent_runs (
  id uuid PK,
  workflow_id uuid FK -> workflows NOT NULL,
  requested_by uuid FK -> users NOT NULL,
  prompt_version_id uuid FK -> prompt_versions,
  provider text NOT NULL,                 -- 'anthropic', ...
  model text NOT NULL,                    -- exact model id
  input jsonb NOT NULL,                   -- user input + parameters
  retrieved_sources jsonb,                -- [{uri, title, score, hash}, ...]
  raw_output text,
  status text NOT NULL CHECK (status IN
    ('queued','running','awaiting_approval','approved',
     'rejected','executed','failed','cancelled')),
  error text,
  langgraph_thread_id text,               -- joins to checkpointer state
  token_usage jsonb,
  started_at timestamptz,
  completed_at timestamptz
)

-- Human decision. Exactly the gate — actions reference this.
approvals (
  id uuid PK,
  run_id uuid FK -> agent_runs UNIQUE NOT NULL,
  reviewer_id uuid FK -> users,
  decision text CHECK (decision IN ('approved','rejected','edited')),
  final_output text,                      -- edited text if reviewer changed it
  notes text,
  decided_at timestamptz
)

-- External side effects. Only writable post-approval (enforced in code +
-- FK to approvals; DB CHECK can't see across rows, so service layer guards).
actions (
  id uuid PK,
  run_id uuid FK -> agent_runs NOT NULL,
  approval_id uuid FK -> approvals NOT NULL,
  action_type text NOT NULL,              -- 'send_email','update_monday',...
  payload jsonb NOT NULL,
  executed_by uuid FK -> users NOT NULL,
  executed_at timestamptz,
  result jsonb,
  status text NOT NULL CHECK (status IN ('pending','succeeded','failed'))
)

-- Append-only system-wide audit trail (beyond AI runs: logins, config, etc.)
audit_events (
  id bigint generated always as identity PK,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid FK -> users,
  event_type text NOT NULL,               -- 'run.created','approval.decided',...
  entity_type text, entity_id text,
  payload jsonb,
  request_ip inet,
  request_id text
)

-- Documents in S3 (metadata only; bytes never in Postgres)
documents (
  id uuid PK,
  s3_bucket text NOT NULL, s3_key text NOT NULL,
  sha256 text NOT NULL,
  filename text, content_type text, size_bytes bigint,
  classification text NOT NULL DEFAULT 'internal'
    CHECK (classification IN ('public','internal','borrower_pii')),
  uploaded_by uuid FK -> users,
  UNIQUE (s3_bucket, s3_key)
)

-- M3+: rag_collections / rag_chunks (pgvector), integration_credentials
-- (KMS-encrypted refs, never plaintext). LangGraph checkpoint tables are
-- created/managed by langgraph-checkpoint-postgres in their own schema.
```

---

## 4. Milestone Plan

**M1 — Foundation + one end-to-end HITL workflow (this milestone)**
Scaffolding, local dev environment, Cognito-ready auth with dev mode, the
run→review→approve pipeline with full audit logging, one deliberately
harmless demo workflow ("SOP Q&A draft" over a synthetic SOP snippet — no
retrieval infra yet, source text is provided inline), and the dashboard UI:
run list, run detail (full audit view), approval queue with approve /
edit-and-approve / reject. CI with lint + typecheck + tests.
**Explicitly out of scope for M1:** real RAG, document upload, any external
integration, any `actions` execution beyond recording the decision, IaC.

**M2 — Deploy + documents.** Terraform/CDK matching MSFG patterns, RDS +
S3 + CloudFront, real Cognito pool, document upload to S3 with metadata,
first document-centric workflow (borrower doc checklist) on synthetic data.

**M3 — RAG + integrations.** pgvector, SOP ingestion pipeline, website RAG
answers; first real integration (likely Monday.com) executed via the
`actions` gate.

**M4+ — Underwriting condition responses, monitoring, more automations.**

### M1 build order (each step is a small, commit-ready change)

1. Planning docs first: codebase map, PRD, ADR, database schema + ERD doc,
   AWS deployment plan, integrations roadmap (no code until these exist).
2. Repo skeleton: `.gitignore`, `.env.example`, `docker-compose.yml`.
3. `apps/api` scaffold: Express app, env config, health endpoint, request-id
   logging, error handling.
4. DB layer: SQL migrations for the 12 `ai_*` tables + migration runner;
   repository interfaces with Postgres and in-memory implementations.
5. Auth middleware: `AUTH_MODE=dev` header identity + Cognito JWT stub +
   role guard (viewer/operator/reviewer/admin).
6. Services: tasks, inputs, runs, outputs, approvals, documents, chunks,
   citations, prompts, integration actions — every state change writes an
   `ai_audit_events` row in the same transaction.
7. LangGraph.js workflows: registry, model/provider abstraction with mock
   mode, `condition_response_draft`, `borrower_email_draft`,
   `document_checklist_builder`, `sop_lookup_answer`.
8. REST API: full `/api/ai/*` contract (tasks, inputs, runs, outputs,
   approvals, documents, prompts, audit, system, integration actions).
9. Guardrail enforcement + tests: no action without approval, rejected
   output cannot be sent, edited final content preserved, prompt version
   logged, audit written on decisions.
10. `apps/web`: layout, dashboard home, task queue, create task, task
    detail, approval center, document library, prompt/workflow admin,
    audit log — MSFG palette, loading/error/empty states.
11. CI (lint + typecheck + tests), `docs/SETUP.md`, README; senior-architect
    review pass and high-priority fixes.

---

## 5. Planned Files for M1

The concrete file inventory is large; the authoritative layout is §2. In
summary: `docs/*` planning documents, `apps/api` (~40 TS source files:
config, middleware, routes, services, repositories, workflows, types,
migrations, tests), `apps/web` (~30 TS/TSX files: api client, pages,
components, styles), plus repo-root tooling (`docker-compose.yml`,
`.env.example`, CI workflow). Each commit lists its exact files.

---

## 6. Where Node.js and Spring Boot fit

- **Node.js:** is the core API language (see §1). Future webhook receivers /
  integration adapters (Monday.com, GHL, Zapier callbacks) can be thin
  modules or services that *only* enqueue proposed actions via the API,
  never bypassing the approval gate.
- **Spring Boot:** existing services remain systems of record. The dashboard
  calls them over authenticated REST; we do not replicate loan data into
  this system beyond run inputs/outputs needed for audit. If MSFG later
  standardizes durable business APIs on Spring Boot, the repository/service
  layers here are deliberately thin enough to port.

## 7. Assumptions (made to avoid blocking; please correct if wrong)

1. Anthropic (Claude) is the initial model provider; the `llm_client`
   abstraction keeps this swappable and every run records provider+model.
2. A Cognito user pool can be provisioned or shared; M1 ships with dev-mode
   auth so this doesn't block local development.
3. Postgres 16 locally via Docker mirrors the eventual RDS version closely
   enough for M1.
4. Terraform vs CDK choice deferred to M2 pending MSFG's existing IaC norm.
5. "Graphify" is used as an external analysis tool during development and
   imposes no runtime requirements on this codebase.
6. English-only UI, single tenant (MSFG internal), no mobile requirement.
