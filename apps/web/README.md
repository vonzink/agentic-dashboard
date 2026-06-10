# MSFG Agentic AI Dashboard — Web UI

React 18 + TypeScript + Vite. Plain CSS with the MSFG palette
(`#8cc63e`, `#4b7b4d`, `#104547`, `#404041`). No component library.

## Run locally

```bash
# in apps/api (terminal 1) — backend on :4000
npm run dev

# in apps/web (terminal 2) — UI on :5173, /api proxied to :4000
npm install
npm run dev
```

Open http://localhost:5173. The top-right menu sets your **dev identity**
(email + role: viewer / operator / reviewer / admin) — these are sent as
`x-user-*` headers, which the API trusts only in `AUTH_MODE=dev`. Cognito
replaces this in Phase 2.

Scripts: `dev`, `build`, `preview`, `typecheck`.

## Mock mode

`VITE_USE_MOCKS=true` (in `apps/web/.env`) swaps the fetch layer for the
read-only synthetic fixtures in `src/mocks/` and shows an amber **MOCK DATA**
badge. Use it only when the backend is unavailable.

## Layout

- `src/api/` — typed client (`client.ts`), contract types (`types.ts`),
  react-query hooks (`hooks.ts`)
- `src/pages/` — Dashboard, Tasks, NewTask, TaskDetail, Approvals,
  Documents, AuditLog, Admin
- `src/components/` — OutputCard (structured AI output renderer +
  compliance banners), AuditTimeline, Badge, Pager, states, dev user menu
- `src/mocks/` — isolated mock data (never used unless explicitly enabled)

Compliance UI rules: every AI output renders "AI draft — human review
required", a source-verification warning when citations are missing or
confidence is LOW, and "No external action has been taken" until an
approved action actually executes.
