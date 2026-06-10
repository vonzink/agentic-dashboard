# AI Compliance Guardrails

The rules this system enforces, and exactly where each one is enforced in
code. **Changes to anything referenced here require explicit human sign-off**
(see docs/AGENTIC_DASHBOARD_CODEBASE_MAP.md §7).

## 1. What the AI may do

- Summarize, classify, and draft (condition responses, borrower emails,
  document checklists)
- Recommend next steps and identify missing documents
- Prepare **proposed** actions (never executed without approval)
- Answer internal SOP/guideline questions **with citations to provided
  sources**

## 2. What the AI may not do — and what stops it

| Prohibition | Enforcement |
|---|---|
| Send emails / contact borrowers, realtors, or lenders | No send capability exists anywhere in the codebase. The only outbound path is `ai_integration_actions`, gated below. |
| Update Monday.com / GHL / LendingPad | Same gate; no adapters exist in MVP (`TARGET_NOT_IMPLEMENTED`), and execution is globally off by default (`INTEGRATION_EXECUTION_ENABLED=false`). |
| Make lending decisions / approve or deny borrowers | Workflows are draft-only graphs with no tools (docs/LANGGRAPH_WORKFLOWS.md); prompts prohibit it; every output forces `requires_human_review=true` in code, not prompt. |
| Quote final rates/terms without reviewed sources | Prompt rules + `borrower_email_draft.assess()` flags approval/denial/rate wording + human review is mandatory before anything leaves the system. |
| Make unsupported guideline claims | `sop_lookup_answer` answers only from provided sources; no sources ⇒ confidence forced LOW + explicit warning; uncited answers warned. |
| Hide uncertainty | Confidence labels are server-assessed (`assess()`), can only be capped down, never up; warnings are merged into the stored output and rendered in the UI. |

## 3. Everything is reviewed

Every output that could affect a borrower, loan, realtor, lender, or
compliance matter requires approval. In the MVP this is simplified to:
**every workflow output requires human review, period** —
`RunService` creates all outputs in `NEEDS_REVIEW` with
`requires_human_review=true` regardless of workflow config.

## 4. Review status flow

```
DRAFT → AI_GENERATED → NEEDS_REVIEW ─┬─→ APPROVED → FINALIZED → ACTION_SENT → ACTION_COMPLETED
                                     ├─→ REJECTED (terminal)
                                     └─→ CHANGES_REQUESTED → (re-review)
```

Encoded in `apps/api/src/types/statuses.ts#REVIEW_TRANSITIONS`; any other
transition returns `409 INVALID_REVIEW_TRANSITION`
(`ApprovalService.assertTransition`). `APPROVED → REJECTED` is allowed so a
human can reverse an approval before finalization/action.

## 5. UI warnings (apps/web/src/components/OutputCard.tsx)

Rendered on **every** AI output, unconditionally:

- “⚠ AI draft — human review required” — always
- “Do not rely on this without verifying source documents” — whenever the
  output has no citations or confidence is LOW
- “No external action has been taken” — until the status is actually
  ACTION_SENT/ACTION_COMPLETED

## 6. Backend enforcement (the parts that matter under audit)

1. **Action gate** — `ActionService.execute()` refuses unless: the action
   references an `ai_approvals` row, its `decision='approved'`, the
   reviewed output is not REJECTED, the output is FINALIZED, and
   execution is globally enabled. Every refusal writes an
   `action.blocked` audit event with the reason.
2. **Defense in depth** — the database trigger `enforce_action_approval`
   (migration 0001) independently refuses to move an
   `ai_integration_actions` row beyond `proposed`/`cancelled` unless its
   approval is `approved`. A future buggy endpoint cannot bypass the gate.
3. **Raw vs final content** — `ai_outputs.content` (raw AI output) is
   never mutated; the reviewer's `edited_final_content` lives on
   `ai_approvals`. Both are permanent.
4. **Append-only audit** — `ai_audit_events` rejects UPDATE/DELETE via
   trigger; the repository layer exposes only `append`; approval,
   rejection, finalization, and every action transition write events.
   Decisions, finalization, run persistence, and action execution couple
   the state change and its audit event in one DB transaction
   (`Store.withTransaction`); execution also takes a `FOR UPDATE` row
   lock so a double-click or concurrent request cannot double-send.
5. **Provenance** — every run logs user, timestamps, workflow,
   provider/model, `prompt_version`, the full input snapshot (including
   retrieved sources), tokens, and cost.
6. **Roles** — approve/reject/request-changes/finalize/execute require
   `reviewer`+; prompt/workflow admin requires `admin`
   (`requireRole`, `apps/api/src/middleware/auth.ts`). Optional
   `REQUIRE_DIFFERENT_REVIEWER=true` forbids reviewing your own run
   (recommended outside local dev).

## 7. Tests (apps/api/tests/guardrails.test.ts and approvals.test.ts)

| Required test | Where |
|---|---|
| Cannot perform action without approval | guardrails: 403 `APPROVAL_REQUIRED` + `action.blocked` audited |
| Approval writes audit event | approvals: `output.approved` event incl. prompt_version |
| Rejected output cannot be sent | guardrails: rejection decision blocked; post-approval rejection blocked (`OUTPUT_REJECTED`) |
| Final edited content is preserved | approvals: `edited_final_content` stored separately, raw output unchanged |
| Prompt version is logged | runs + approvals: `prompt_version` on run row and in approval audit payload |
| (extra) Approval alone is not enough | guardrails: `OUTPUT_NOT_FINALIZED` |
| (extra) Global kill-switch | guardrails: 409 `EXECUTION_DISABLED` |
| (extra) Role enforcement | approvals + guardrails: 403 `INSUFFICIENT_ROLE` |
| (extra) DB triggers hold under raw SQL; double-execute refused; tx rollback | pg.integration (real Postgres, run in CI) |

Run them: `cd apps/api && npm test` (set `TEST_DATABASE_URL` to include the
Postgres integration suite; CI always runs it).

## 8. Data rules

- No borrower production data in tests or seeds — synthetic fixtures only
  ("Test Borrower A").
- Task `borrower_reference`/`loan_reference` are opaque identifiers; the UI
  labels them "reference ID only — no borrower PII".
- Documents carry a `classification` (`public` / `internal` /
  `borrower_pii`) surfaced as a red badge in the UI.
- Nothing is hard-deleted in MVP; tasks archive, audit is append-only.
