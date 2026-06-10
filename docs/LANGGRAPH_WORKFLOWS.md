# LangGraph Workflows

How AI workflows are built, executed, and constrained in the MSFG Agentic AI
Dashboard. Code lives in `apps/api/src/workflows/`.

## Where LangGraph lives (and why)

LangGraph.js runs **in-process inside the API service**, not as a separate
service. Rationale: the repo is greenfield, so a sidecar would add IPC,
deployment, and audit-consistency overhead for zero benefit at this scale;
runs must be persisted in the same transaction scope as tasks/outputs; and
the workflow module is isolated behind `src/workflows/` so it *can* be
extracted into its own service later if workflow volume demands it. The
decision is recorded in docs/ADR-AGENTIC-AI-DASHBOARD.md.

## The shape of every workflow

```
            ┌──────────┐    ┌────────────────┐    ┌─────────┐
  input ──▶ │ generate │ ─▶ │ parse_validate │ ─▶ │ assess  │ ─▶ structured JSON
            └──────────┘    └────────────────┘    └─────────┘
             model call      strict JSON +          warnings +
             (provider       zod schema;            confidence cap;
             abstraction)    forces                 source-quality
                             requires_human_        checks
                             review=true
```

Key properties:

- **Draft-only by construction.** Graphs have no tools, no repository
  access, no network access beyond the model provider. They literally
  cannot send email, update a CRM, or touch a loan file. External effects
  exist only as `ai_integration_actions` rows gated by human approval.
- **Structured output.** Every workflow returns JSON validated against a
  zod schema (`src/workflows/types.ts`). Invalid model output fails the
  run (persisted as `failed` + audited) — it is never shown as a draft.
- **`requires_human_review` is forced to `true`** in the
  `parse_validate` node regardless of what the model returns.
- **Full provenance.** Each run row records provider, exact model id,
  `prompt_version` (`name@version`), token counts, estimated cost, the
  LangGraph run id, and an `input_snapshot_json` of exactly what the
  model saw (including source snippets).

## Implemented workflows

| Workflow | Task type | Output | Notes |
|---|---|---|---|
| `condition_response_draft` | condition_response | summary, missing_items, recommended_next_steps, draft_response, citations, confidence, warnings | Warns + caps confidence at MEDIUM when no sources provided |
| `borrower_email_draft` | borrower_email | summary, email_subject, email_body, checklist, caveats | Post-check flags approval/denial/rate-commitment wording |
| `document_checklist_builder` | document_checklist | summary, documents[{name, reason, when_needed, required}], next steps | Flags unverified lender overlays |
| `sop_lookup_answer` | sop_lookup | summary, answer, citations | Answers ONLY from provided sources; no sources ⇒ LOW confidence + warning; weak/uncited sources ⇒ warning |
| `income_review` | income_review | summary, findings, red_flags, missing_items, next steps | Advisory only; no sources ⇒ LOW confidence; always warns that licensed staff decide |
| `asset_review` | asset_review | (same shape) | Funds-to-close, large deposits, sourcing gaps |
| `credit_review` | credit_review | (same shape) | Disputes, inquiries, undisclosed debts; never implies a credit decision |
| `title_insurance_review` | title_insurance_review | (same shape) | Vesting, liens, coverage gaps |

Planned agents (config exists, `is_active=false`, no implementation):
website_qa (Phase 3).

## Adding a workflow

1. Define schemas + `WorkflowDefinition` (name, taskType, outputType,
   `outputSchema`, `mainContent`, `mockOutput`, `assess`) in
   `src/workflows/registry.ts` (or a new file exported from it).
2. Add a v1 prompt to `src/workflows/prompts.ts` (`DEFAULT_PROMPTS`) —
   seeded by `npm run db:seed`; subsequent versions are managed in Admin.
3. Add the registry entry; the run endpoint, persistence, approval flow,
   and UI rendering pick it up automatically.
4. Add a test in `apps/api/tests/` covering its output schema and any
   `assess` rules.

## Retrieval (RAG)

Runs accept `options.retrieve: true` (the UI defaults it on for SOP
lookups): the run service embeds the task's primary text, ranks all
embedded library chunks by cosine similarity, and merges the top 5 into
the workflow's sources before prompting. Provenance is preserved — the
run's `input_snapshot_json.retrieval` records every retrieved chunk id and
score, and citations resolve back to those chunks. `GET /api/ai/search?q=`
exposes the same ranking for the UI.

Embeddings (`src/services/embeddings.ts`) default to `local-hash-v1`, a
deterministic lexical hashing embedder — no API key, hermetic CI, honest
about being a lexical (not semantic) proxy. Swap in a real embedding
service by implementing `EmbeddingProvider`; vectors are stored per-model
(`ai_source_chunks.embedding_model`), so reindexing is just re-embedding.
Similarity is computed in the app over jsonb vectors; when the corpus
outgrows that (≳50k chunks), enable pgvector on RDS and push ranking into
SQL behind the same `RetrievalService` interface.

## Model/provider abstraction

`src/workflows/providers.ts` is the only file allowed to import an LLM SDK.

- `MockModelProvider` (default, `MODEL_PROVIDER=mock`): returns each
  workflow's deterministic `mockOutput`, so the entire pipeline — parsing,
  validation, persistence, approvals, UI — runs locally with no API key
  and zero cost. Tests use it exclusively.
- `AnthropicModelProvider` (`MODEL_PROVIDER=anthropic` +
  `ANTHROPIC_API_KEY`): official `@anthropic-ai/sdk`, default model
  `claude-opus-4-8` (override with `ANTHROPIC_MODEL`). Token usage from the
  API response feeds `estimated_cost`
  (`COST_PER_MTOK_IN`/`COST_PER_MTOK_OUT`).

Mock and real providers flow through the same schema validation, so their
output shapes cannot drift apart silently.

## Prompt templates

Prompts are versioned rows in `ai_prompt_templates` (`{{placeholder}}`
substitution; rendering in `src/workflows/runner.ts#renderPrompt`). One
active version per name (DB-enforced). Runs record `name@version`, so any
historical output can be traced to the exact prompt text that produced it.
All four v1 prompts share a compliance preamble: draft-only role, no
lending decisions, cite sources, disclose uncertainty, JSON-only output.

## Testing

`apps/api/tests/runs.test.ts` covers: valid structured JSON for all four
workflows, run/output persistence, prompt-version logging, citation
persistence to provided sources, and the weak-source warning path.
`guardrails.test.ts` proves no workflow output can cause an external action
without an approved, finalized human review.
