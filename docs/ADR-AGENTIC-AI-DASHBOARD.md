# ADR-001: Platform Architecture for the MSFG Agentic AI Dashboard

- Status: **Accepted**
- Date: 2026-06-10
- Deciders: Z. Zink (MSFG) + architecture session
- Context docs: docs/ARCHITECTURE.md, docs/AGENTIC_AI_DASHBOARD_PRD.md

## Context

MSFG (a mortgage company) needs an internal AI operations dashboard for
document review support, underwriting condition responses, borrower document
checklists, SOP/guideline Q&A, and — eventually — controlled automation into
Monday.com, LendingPad, GHL, and email. Hard requirements:

- **Compliance-first:** AI drafts; licensed humans decide. No external action
  without a recorded human approval. Full audit trail per output (user, time,
  input, workflow, sources, provider/model, prompt version, raw output,
  decision, edited final output, action taken).
- **Auditable & durable:** queryable history that survives tool churn.
- **AWS-native:** S3/CloudFront/Cognito/RDS are existing MSFG patterns.
- **Maintainable by a small team** alongside existing Java and Node work.
- **Future RAG** over mortgage guidelines/SOPs and **multi-agent workflows**.

## Options Considered

### Option 1 — Fully custom app (no orchestration framework)
Hand-rolled pipeline code (call model, parse, save) inside a custom API.
- ✅ Maximum control, zero framework risk, simplest mental model.
- ❌ Multi-step/multi-agent workflows (retrieve → draft → critique → cite →
  gate) become ad-hoc state machines we maintain forever; re-inventing
  checkpointing, retries, and branching that LangGraph already provides.
- Verdict: viable fallback, but pays an increasing tax as workflows grow.

### Option 2 — Dify-style visual workflow tool (self-hosted low-code)
- ✅ Fast demos; non-engineers can edit flows.
- ❌ Audit trail, approval gating, and RBAC are whatever the tool exposes —
  not the granular, queryable, court-ready trail a mortgage company needs.
  Flows drift outside code review. Postgres schema is the tool's, not ours.
  Upgrades can break flows. Compliance logic in a GUI is unreviewable.
- Verdict: **rejected** — auditability and change control are the product
  here, and a visual tool makes both someone else's opaque feature.

### Option 3 — LangGraph backend + custom dashboard ✅ **(chosen)**
LangGraph (JS, embedded in a Node/TS API) for explicit, code-reviewed
workflow graphs; custom React dashboard; Postgres for state/audit; S3 for
documents; Cognito auth.
- ✅ Workflows are code: versioned, diffed, tested, reviewed.
- ✅ Human-in-the-loop is structural — graphs can only draft; the execute
  path is a separate, approval-gated service.
- ✅ Audit schema is ours, designed for examiner-grade questions.
- ✅ Boring AWS deployment (SPA on S3/CloudFront, API in a container, RDS).
- ❌ More upfront build than low-code; LangGraph API churn (mitigated by
  pinning + isolating it behind `src/workflows/`).

### Option 4 — n8n-only automation
- ✅ Great for simple triggers/glue; team may already use it.
- ❌ It is an automation tool, not a reviewed-AI-work product: no approval
  center UI, no per-output audit semantics, no citation model, and it
  *encourages* exactly the auto-acting behavior we must prevent. Credentials
  in n8n act with full power on every run.
- Verdict: **rejected as the platform**; retained on the roadmap as a
  *consumer* of approved `ai_integration_actions` (Phase 3).

### Option 5 — Fork an open-source agent dashboard from GitHub
- ✅ Head start on UI scaffolding.
- ❌ Inherit someone else's data model, auth, and assumptions, then fight
  them to add mortgage-specific approval/audit/citation semantics — the hard
  20% is still custom, but now inside unfamiliar code. Fork divergence means
  no upstream security updates. License review burden.
- Verdict: **rejected** — the differentiating requirements touch every layer.

### Option 6 — Obsidian-only knowledge system
- ✅ Cheap, excellent for SOP capture by humans.
- ❌ Not an application platform: no auth/RBAC, no database, no approval
  workflow, no audit log, no API. Solves knowledge storage, not AI
  operations.
- Verdict: **rejected as the platform**; Obsidian-style markdown SOPs are a
  fine *source corpus* for the Phase 2 RAG ingestion pipeline.

## Decision

**Custom dashboard (React/TS) + LangGraph.js workflows embedded in a Node/TS
Express API + Postgres (RDS) + S3, with Graphify-assisted codebase
understanding during development.**

Sub-decision — backend language: Node/TS over Java/Spring Boot for this
module because the repo is greenfield (no Spring app here to extend),
LangGraph integration is dramatically simpler in-process than via a Python/
Java sidecar, and one language spans frontend and backend. Existing Spring
Boot services remain systems of record, integrated over REST. The service/
repository layering is kept thin and conventional so durable business logic
could be ported to Spring later if MSFG standardizes there.

## Why this best serves each requirement

| Requirement | How the chosen architecture serves it |
|---|---|
| Mortgage compliance | Approval gating is server-side code we own and test; AI graphs physically lack tools to act externally |
| Auditability | Purpose-built `ai_audit_events` + per-run provenance columns in our Postgres schema; append-only; queryable for exams |
| Human approval | First-class `ai_approvals` table + Approval Center UI; status flow DRAFT→…→FINALIZED→ACTION_SENT enforced in one service |
| Long-term maintainability | Boring stack (Express, React, SQL migrations); no platform lock-in; workflows are plain reviewed code |
| AWS integration | SPA on S3+CloudFront, containerized API, RDS Postgres, Cognito, Secrets Manager — all existing MSFG patterns |
| Existing Java/Node projects | REST boundaries both ways; Node API speaks the same JSON conventions; Spring services stay systems of record |
| Future RAG | Postgres+pgvector slots into the same DB; `ai_source_chunks`/`ai_citations` tables are designed for it from day one |
| Multi-agent workflows | LangGraph graphs compose (nodes/subgraphs); registry + per-workflow config (`ai_workflow_configs`) already in schema |

## Consequences

- We own UI/UX build cost (accepted; scoped MVP keeps it small).
- LangGraph version pinning + an internal workflow interface are mandatory.
- Graphify is a development-time aid (mapping this and other MSFG repos
  before integration work), imposing no runtime dependency.
- Revisit triggers: if workflow count stays ≤2 forever, Option 1 simplicity
  wins — collapse LangGraph out. If MSFG adopts a vetted enterprise agent
  platform with examiner-grade audit, re-evaluate.
