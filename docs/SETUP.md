# Local Development Setup

## Prerequisites

- Node.js 22+
- Docker (only if you want Postgres persistence; optional)

## 1. Configure environment

```bash
cp .env.example .env        # defaults work out of the box; no secrets needed
```

Defaults: dev auth (header identity), mock model provider (no API key),
in-memory store (no database), action execution disabled.

## 2. Run the API (apps/api, port 4000)

```bash
cd apps/api
npm install
npm run dev
```

DB-less mode prints a warning that data is not persisted — fine for UI work.

### With Postgres (persistent)

```bash
docker compose up -d postgres
# in .env:
# DATABASE_URL=postgres://agentic:agentic_dev_password@localhost:5432/agentic_dashboard
cd apps/api
npm run db:migrate   # applies migrations/ (12 ai_* tables + triggers)
npm run db:seed      # workflow configs + v1 prompt templates (idempotent)
npm run dev
```

### With the real model provider

```bash
# in .env:
# MODEL_PROVIDER=anthropic
# ANTHROPIC_API_KEY=<your key>        # never commit this
```

## 3. Run the web UI (apps/web, port 5173)

```bash
cd apps/web
npm install
npm run dev
```

Open http://localhost:5173 — `/api` is proxied to :4000. Pick your role via
the top-right dev identity menu (operator to create/run, reviewer to
approve, admin for the Admin page).

## 4. Tests and checks

```bash
cd apps/api && npm test          # 24 tests incl. compliance guardrails
cd apps/api && npm run typecheck
cd apps/web && npm run typecheck && npm run build
```

## 5. Try the flow (curl)

```bash
H='content-type: application/json'
OP='x-user-role: operator'; RV='x-user-role: reviewer'

# create task + condition text
TASK=$(curl -s -X POST :4000/api/ai/tasks -H "$H" -H "$OP" \
  -d '{"title":"Paystub condition","task_type":"condition_response"}' | jq -r .id)
curl -s -X POST :4000/api/ai/tasks/$TASK/inputs -H "$H" -H "$OP" \
  -d '{"input_type":"condition_text","content":"Provide most recent 30 days of paystubs."}'

# run the workflow (mock provider — deterministic draft)
OUT=$(curl -s -X POST :4000/api/ai/tasks/$TASK/runs -H "$H" -H "$OP" \
  -d '{"workflow_name":"condition_response_draft"}' | jq -r '.outputs[0].id')

# review: approve with edits, then finalize
curl -s -X POST :4000/api/ai/outputs/$OUT/approve -H "$H" -H "$RV" \
  -d '{"edited_final_content":"Final human-edited response."}'
curl -s -X POST :4000/api/ai/outputs/$OUT/finalize -H "$RV"

# the audit trail
curl -s :4000/api/ai/tasks/$TASK/audit -H 'x-user-role: viewer' | jq '.items[].event_type'
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `APP_ENV` | `local` | local / dev / staging / production (production forbids dev auth) |
| `PORT` | `4000` | API port |
| `AUTH_MODE` | `dev` | `dev` (header identity) or `cognito` (fail-closed until Phase 2) |
| `DATABASE_URL` | _(unset)_ | Postgres connection; unset = in-memory store |
| `MODEL_PROVIDER` | `mock` | `mock` or `anthropic` |
| `ANTHROPIC_API_KEY` | _(unset)_ | required for `anthropic` provider — env only, never code |
| `ANTHROPIC_MODEL` | `claude-opus-4-8` | model id used for runs |
| `COST_PER_MTOK_IN/OUT` | `5` / `25` | USD per 1M tokens for `estimated_cost` |
| `REQUIRE_DIFFERENT_REVIEWER` | `false` | forbid self-review (enable outside local) |
| `INTEGRATION_EXECUTION_ENABLED` | `false` | master switch; false = propose-only |
| `VITE_ENV` | `local` | web env badge |
| `VITE_USE_MOCKS` | `false` | web mock data layer |
