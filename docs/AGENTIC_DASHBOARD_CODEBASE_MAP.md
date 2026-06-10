# Agentic Dashboard — Codebase Map

Status: v1 — produced before any code was written, updated as the build lands.
Method: direct repository inspection (file tree, git history, dependency
manifests). Graphify is not available inside this execution environment, so
this map was produced by manual analysis; it should be regenerated with
Graphify against the working tree once the codebase is non-trivial.

---

## 1. System Overview

As of the initial analysis, `vonzink/agentic-dashboard` contained exactly one
file (`README.md`, one commit). **This is a greenfield repository.** There are
no pre-existing applications, services, infrastructure files, or data layers
in this repo to map or to break.

That finding drives the whole plan: nothing here constrains us, so the
constraints come from MSFG's wider estate (Java/Spring Boot services, AWS
S3/CloudFront/Cognito/RDS patterns, Monday.com/LendingPad/GHL tooling), which
lives in *other* repositories not visible from this one.

### Inventory at analysis time

| Category | Found in repo |
|---|---|
| Frontend apps | none |
| Backend apps / APIs | none |
| Admin dashboards | none |
| Static sites | none |
| Scripts | none |
| Infrastructure files (Docker, CI, IaC) | none |
| Frameworks (Spring Boot, Node/Express/Nest, React/Vite, Angular) | none |
| Database / migrations / entities / repositories / seed data | none |
| Auth (Cognito, JWT, sessions, roles, admin checks) | none |
| Secrets / config files | none (good — keep it that way) |
| AI/RAG/document-processing code (embeddings, vector DB, prompts, OCR, provider SDKs, n8n/Zapier/Make hooks) | none |

## 2. Planned Component Map (what this repo becomes)

```
apps/web (React+TS+Vite SPA)
  └─ src/api/client.ts ──HTTP──▶ apps/api (Node 22 + TS + Express)
                                   ├─ middleware/auth      (dev headers | Cognito JWT)
                                   ├─ routes/* ──▶ services/* ──▶ repositories/*
                                   │                  │               ├─ pg/*        ──▶ Postgres
                                   │                  │               └─ memory/*    (tests only)
                                   │                  └─ audit service (transactional, append-only)
                                   ├─ workflows/ (LangGraph.js)
                                   │    ├─ registry.ts
                                   │    ├─ graphs/{condition_response_draft, borrower_email_draft,
                                   │    │          document_checklist_builder, sop_lookup_answer}
                                   │    └─ providers/{mock, anthropic}   ◀─ MODEL_PROVIDER env
                                   └─ migrations/*.sql ──▶ Postgres (12 ai_* tables)
docker-compose.yml ──▶ local Postgres 16
.github/workflows/ci.yml ──▶ lint + typecheck + tests
docs/ ──▶ architecture, PRD, ADR, schema, compliance, deployment, integrations
```

Dependency direction is strictly: `routes → services → repositories → db`.
Workflows are invoked only by the run service; they have **no** repository or
network access of their own beyond the model provider, so they cannot cause
side effects.

## 3. Important Files (once built)

| File | Why it matters |
|---|---|
| `apps/api/src/types/statuses.ts` | single source of truth for task/run/output/action status enums |
| `apps/api/src/services/approvals.ts` | the human-approval gate; compliance-critical |
| `apps/api/src/services/integrationActions.ts` | refuses execution without approved approval; compliance-critical |
| `apps/api/src/services/audit.ts` | append-only audit writer used by every service |
| `apps/api/src/workflows/providers/*` | the only files allowed to import LLM SDKs |
| `apps/api/migrations/*.sql` | authoritative schema (mirrored in docs/sql) |
| `docs/AI_COMPLIANCE_GUARDRAILS.md` | the rules the code must enforce |

## 4. Risks

1. **No existing patterns to inherit** — every convention set here becomes
   precedent. Mitigation: boring stack, documented decisions (ADR).
2. **External-estate assumptions are unverified** — Cognito pool, RDS
   topology, and Spring Boot service contracts live outside this repo and
   were not inspectable. Mitigation: everything external is behind env
   config and thin interfaces; nothing in MVP hard-depends on them.
3. **Compliance logic concentrated in few files** — the approval gate must
   not be bypassable by a new route added later. Mitigation: gate lives in
   the service layer (not route layer) and is covered by dedicated tests.
4. **Mock-vs-real provider drift** — mock outputs must keep the same JSON
   shape as real model outputs. Mitigation: both go through the same zod
   output schema validation.

## 5. Reusable Components

Nothing exists in-repo to reuse. From the wider MSFG estate, the reusable
*patterns* (not code) are: S3+CloudFront static hosting, Cognito user pools,
RDS Postgres, and Dockerized services — all adopted in the deployment plan.

## 6. Recommended Integration Points

- **Inbound:** all external systems integrate via the REST API
  (`/api/ai/*`), never directly against Postgres.
- **Outbound:** all external effects go through `ai_integration_actions`
  (proposed → approved → executed). Future Monday.com/Gmail/GHL adapters
  consume that queue; see docs/AGENTIC_DASHBOARD_INTEGRATIONS_ROADMAP.md.
- **Spring Boot services:** called over authenticated REST from
  `apps/api/src/services/` when loan-data lookups are needed (Phase 2+).

## 7. Areas Not to Touch Without Approval

Once built, changes to these require explicit human sign-off (treat as
protected in review):

- `apps/api/src/services/approvals.ts`, `integrationActions.ts` (the gate)
- `apps/api/src/services/audit.ts` and the `ai_audit_events` migration
  (append-only guarantee)
- `apps/api/src/middleware/auth.ts` (role enforcement)
- Any migration that drops/alters audit, approval, or action tables
- `docs/AI_COMPLIANCE_GUARDRAILS.md` (the policy itself)

## 8. Assumptions

1. The empty state of this repo is intentional; the agentic dashboard is a
   new system, not a refactor of an existing one.
2. MSFG's existing Java/Node/static-site repos are out of scope for this
   map; Graphify should be run across those separately before Phase 2
   integrations are designed.
3. Local dev machines have Node 22+ and Docker available.
4. Anthropic is the initial model provider; mock mode is the default
   locally so no API key is required to develop.
