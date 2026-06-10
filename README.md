# MSFG Agentic AI Dashboard

Internal, compliance-first AI operations dashboard for Mountain State
Financial Group. AI **drafts** — condition responses, borrower emails,
document checklists, SOP answers — and licensed humans **review, edit,
approve, and act**. Every run, decision, and refusal is recorded in an
append-only audit log.

**Hard rule:** no external action (email, CRM/LOS update, borrower contact)
ever happens without a recorded human approval. This is enforced in the
service layer *and* by a database trigger, and execution is additionally
disabled by default. See [docs/AI_COMPLIANCE_GUARDRAILS.md](docs/AI_COMPLIANCE_GUARDRAILS.md).

## Stack

| Layer | Tech |
|---|---|
| Web UI | React 18 + TypeScript + Vite (`apps/web`) |
| API | Node 22 + TypeScript + Express (`apps/api`) |
| AI workflows | LangGraph.js, in-process, draft-only; mock provider for dev, Anthropic for real runs |
| Data | Postgres (RDS in prod; in-memory mode for DB-less dev), S3 for documents |
| Auth | Cognito (JWT verification + hosted-UI PKCE login) or dev-header identity locally; roles viewer/operator/reviewer/admin |

## Quickstart

```bash
cp .env.example .env
(cd apps/api && npm install && npm run dev)   # API on :4000 (mock AI, in-memory DB)
(cd apps/web && npm install && npm run dev)   # UI on :5173
```

Full instructions (Postgres, real model provider, curl walkthrough):
[docs/SETUP.md](docs/SETUP.md). Tests: `cd apps/api && npm test`.

## Documentation

| Doc | What |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture plan, milestones, risks |
| [docs/AGENTIC_AI_DASHBOARD_PRD.md](docs/AGENTIC_AI_DASHBOARD_PRD.md) | Product requirements, roles, acceptance criteria |
| [docs/ADR-AGENTIC-AI-DASHBOARD.md](docs/ADR-AGENTIC-AI-DASHBOARD.md) | Platform decision record (options compared) |
| [docs/AGENTIC_DASHBOARD_DATABASE.md](docs/AGENTIC_DASHBOARD_DATABASE.md) + [docs/sql/](docs/sql/) | Schema design + DDL |
| [docs/LANGGRAPH_WORKFLOWS.md](docs/LANGGRAPH_WORKFLOWS.md) | Workflow architecture, adding workflows |
| [docs/AI_COMPLIANCE_GUARDRAILS.md](docs/AI_COMPLIANCE_GUARDRAILS.md) | The rules and where each is enforced |
| [docs/AGENTIC_DASHBOARD_AWS_DEPLOYMENT.md](docs/AGENTIC_DASHBOARD_AWS_DEPLOYMENT.md) | AWS deployment plan, costs, checklists |
| [docs/AGENTIC_DASHBOARD_INTEGRATIONS_ROADMAP.md](docs/AGENTIC_DASHBOARD_INTEGRATIONS_ROADMAP.md) | Monday/LendingPad/GHL/email roadmap |
| [docs/AGENTIC_DASHBOARD_CODEBASE_MAP.md](docs/AGENTIC_DASHBOARD_CODEBASE_MAP.md) | Component map, protected areas |
| [docs/SETUP.md](docs/SETUP.md) | Local dev setup + env vars |
| [infra/README.md](infra/README.md) + [infra/terraform/](infra/terraform/) | AWS bring-up (terraform-validated; not yet applied) |
