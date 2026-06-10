-- ============================================================================
-- MSFG Agentic AI Dashboard — Postgres schema (proposed, v1)
-- Target: PostgreSQL 14+ (gen_random_uuid() built in)
--
-- Runnable copy of docs/sql/agentic_dashboard_schema.sql (transaction handled by the migration runner). Keep the two files in sync.
--
-- Conventions:
--   * UUID primary keys (except ai_audit_events: bigint identity, append-only)
--   * created_at/updated_at are timestamptz
--   * user identity is stored as TEXT (Cognito sub or email) for MVP;
--     a users table arrives with full Cognito integration (Phase 2)
--   * CHECK constraints instead of Postgres ENUM types so values can be
--     extended with a plain ALTER
-- ============================================================================


-- ---------------------------------------------------------------------------
-- updated_at trigger function (shared)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 1. ai_tasks — unit of work a human creates for the AI to assist with
-- ---------------------------------------------------------------------------
CREATE TABLE ai_tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text NOT NULL,
  task_type           text NOT NULL CHECK (task_type IN (
                        'condition_response', 'borrower_email',
                        'document_checklist', 'sop_lookup',
                        'income_review', 'asset_review', 'credit_review',
                        'title_insurance_review', 'website_qa', 'general')),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN (
                        'open', 'in_progress', 'waiting_review',
                        'changes_requested', 'completed', 'archived',
                        'cancelled')),
  priority            text NOT NULL DEFAULT 'normal' CHECK (priority IN (
                        'low', 'normal', 'high', 'urgent')),
  created_by          text NOT NULL,            -- Cognito sub/email
  assigned_to         text,
  borrower_reference  text,                     -- opaque reference only; never PII payloads
  loan_reference      text,
  due_at              timestamptz,
  metadata_json       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_tasks_status      ON ai_tasks (status);
CREATE INDEX idx_ai_tasks_type        ON ai_tasks (task_type);
CREATE INDEX idx_ai_tasks_assigned_to ON ai_tasks (assigned_to);
CREATE INDEX idx_ai_tasks_created_by  ON ai_tasks (created_by);
CREATE INDEX idx_ai_tasks_created_at  ON ai_tasks (created_at DESC);

CREATE TRIGGER trg_ai_tasks_updated_at
  BEFORE UPDATE ON ai_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. ai_task_inputs — context attached to a task (text, snippets, doc refs)
-- ---------------------------------------------------------------------------
CREATE TABLE ai_task_inputs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id             uuid NOT NULL REFERENCES ai_tasks (id) ON DELETE CASCADE,
  input_type          text NOT NULL CHECK (input_type IN (
                        'condition_text', 'borrower_context', 'question',
                        'source_snippet', 'document_reference',
                        'scenario', 'instruction', 'other')),
  content             text NOT NULL,
  source_document_id  uuid,                     -- FK added after ai_source_documents
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_task_inputs_task ON ai_task_inputs (task_id);

-- ---------------------------------------------------------------------------
-- 3. ai_task_runs — one row per AI workflow invocation (provenance log)
-- ---------------------------------------------------------------------------
CREATE TABLE ai_task_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id             uuid NOT NULL REFERENCES ai_tasks (id) ON DELETE CASCADE,
  workflow_name       text NOT NULL,
  langgraph_run_id    text,                     -- LangGraph thread/run id, if any
  model_provider      text NOT NULL,            -- 'mock' | 'anthropic' | ...
  model_name          text NOT NULL,            -- exact model id used
  prompt_version      text NOT NULL,            -- e.g. 'condition_response_draft@3'
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending', 'running', 'succeeded', 'failed',
                        'cancelled')),
  requested_by        text NOT NULL,
  started_at          timestamptz,
  completed_at        timestamptz,
  error_message       text,
  token_input_count   integer,
  token_output_count  integer,
  estimated_cost      numeric(10, 6),           -- USD
  input_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb, -- exact workflow input incl. source snippets
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_task_runs_task    ON ai_task_runs (task_id);
CREATE INDEX idx_ai_task_runs_status  ON ai_task_runs (status);
CREATE INDEX idx_ai_task_runs_created ON ai_task_runs (created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. ai_outputs — structured results of a run; raw AI text is immutable here
-- ---------------------------------------------------------------------------
CREATE TABLE ai_outputs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_run_id            uuid NOT NULL REFERENCES ai_task_runs (id) ON DELETE CASCADE,
  output_type            text NOT NULL CHECK (output_type IN (
                           'draft_response', 'email_draft', 'checklist',
                           'answer', 'summary', 'classification',
                           'proposed_action', 'other')),
  content                text NOT NULL,         -- raw AI output (never edited in place)
  structured_json        jsonb,                 -- full structured workflow output
  confidence_label       text NOT NULL DEFAULT 'LOW' CHECK (confidence_label IN (
                           'HIGH', 'MEDIUM', 'LOW')),
  requires_human_review  boolean NOT NULL DEFAULT true,
  review_status          text NOT NULL DEFAULT 'AI_GENERATED' CHECK (review_status IN (
                           'DRAFT', 'AI_GENERATED', 'NEEDS_REVIEW',
                           'APPROVED', 'REJECTED', 'CHANGES_REQUESTED',
                           'FINALIZED', 'ACTION_SENT', 'ACTION_COMPLETED')),
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_outputs_run           ON ai_outputs (task_run_id);
CREATE INDEX idx_ai_outputs_review_status ON ai_outputs (review_status);

-- ---------------------------------------------------------------------------
-- 5. ai_approvals — the human decision; final edited content lives here,
--    separate from the raw AI output (compliance requirement)
-- ---------------------------------------------------------------------------
CREATE TABLE ai_approvals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id               uuid NOT NULL REFERENCES ai_tasks (id) ON DELETE CASCADE,
  output_id             uuid NOT NULL REFERENCES ai_outputs (id) ON DELETE CASCADE,
  reviewed_by           text NOT NULL,
  decision              text NOT NULL CHECK (decision IN (
                          'approved', 'rejected', 'changes_requested')),
  reviewer_notes        text,
  edited_final_content  text,                   -- reviewer's final version, if edited
  reviewed_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_approvals_task   ON ai_approvals (task_id);
CREATE INDEX idx_ai_approvals_output ON ai_approvals (output_id);

-- ---------------------------------------------------------------------------
-- 6. ai_audit_events — APPEND-ONLY event log. UPDATE/DELETE are blocked by
--    trigger; the application role should additionally lack those grants.
-- ---------------------------------------------------------------------------
CREATE TABLE ai_audit_events (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id             uuid REFERENCES ai_tasks (id) ON DELETE SET NULL,
  actor_user_id       text,                     -- null for system events
  event_type          text NOT NULL,            -- e.g. 'task.created', 'run.completed',
                                                -- 'output.approved', 'action.executed'
  event_payload_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_audit_events_task    ON ai_audit_events (task_id);
CREATE INDEX idx_ai_audit_events_type    ON ai_audit_events (event_type);
CREATE INDEX idx_ai_audit_events_created ON ai_audit_events (created_at DESC);

CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ai_audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ai_audit_events_append_only
  BEFORE UPDATE OR DELETE ON ai_audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();

-- ---------------------------------------------------------------------------
-- 7. ai_source_documents — metadata for documents (bytes live in S3, never here)
-- ---------------------------------------------------------------------------
CREATE TABLE ai_source_documents (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename                text NOT NULL,
  file_type               text,                 -- mime type or extension
  s3_bucket               text,                 -- nullable: manual snippets have no S3 object
  s3_key                  text,
  text_extraction_status  text NOT NULL DEFAULT 'pending' CHECK (text_extraction_status IN (
                            'pending', 'not_applicable', 'succeeded',
                            'failed', 'manual')),
  document_type           text NOT NULL DEFAULT 'other' CHECK (document_type IN (
                            'sop', 'guideline', 'condition_sheet', 'paystub',
                            'bank_statement', 'tax_return', 'credit_report',
                            'title_doc', 'insurance_doc', 'correspondence',
                            'manual_snippet', 'other')),
  classification          text NOT NULL DEFAULT 'internal' CHECK (classification IN (
                            'public', 'internal', 'borrower_pii')),
  created_by              text NOT NULL,
  metadata_json           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (s3_bucket, s3_key)
);

CREATE INDEX idx_ai_source_documents_type ON ai_source_documents (document_type);

-- deferred FK from ai_task_inputs now that the table exists
ALTER TABLE ai_task_inputs
  ADD CONSTRAINT fk_ai_task_inputs_document
  FOREIGN KEY (source_document_id) REFERENCES ai_source_documents (id)
  ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 8. ai_source_chunks — retrievable/citable pieces of a document
-- ---------------------------------------------------------------------------
CREATE TABLE ai_source_chunks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    uuid NOT NULL REFERENCES ai_source_documents (id) ON DELETE CASCADE,
  chunk_index    integer NOT NULL,
  content        text NOT NULL,
  page_number    integer,
  section_label  text,
  embedding_id   text,                          -- pgvector row / external id (Phase 2)
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX idx_ai_source_chunks_document ON ai_source_chunks (document_id);

-- ---------------------------------------------------------------------------
-- 9. ai_citations — links an output's claims back to sources
-- ---------------------------------------------------------------------------
CREATE TABLE ai_citations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  output_id      uuid NOT NULL REFERENCES ai_outputs (id) ON DELETE CASCADE,
  document_id    uuid REFERENCES ai_source_documents (id) ON DELETE SET NULL,
  chunk_id       uuid REFERENCES ai_source_chunks (id) ON DELETE SET NULL,
  citation_text  text NOT NULL,                 -- quoted/para text the answer relied on
  source_label   text NOT NULL,                 -- human-readable label, e.g. 'FNMA B3-3.1, p.4'
  page_number    integer,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_citations_output ON ai_citations (output_id);

-- ---------------------------------------------------------------------------
-- 10. ai_prompt_templates — versioned prompts; runs record name@version
-- ---------------------------------------------------------------------------
CREATE TABLE ai_prompt_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  version               integer NOT NULL,
  task_type             text NOT NULL,
  system_prompt         text NOT NULL,
  user_prompt_template  text NOT NULL,          -- {{placeholder}} substitution
  is_active             boolean NOT NULL DEFAULT false,
  created_by            text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);

-- at most one active version per prompt name
CREATE UNIQUE INDEX idx_ai_prompt_templates_one_active
  ON ai_prompt_templates (name) WHERE is_active;

-- ---------------------------------------------------------------------------
-- 11. ai_workflow_configs — per-workflow settings incl. approval requirement
-- ---------------------------------------------------------------------------
CREATE TABLE ai_workflow_configs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_name      text NOT NULL UNIQUE,
  task_type          text NOT NULL,
  requires_approval  boolean NOT NULL DEFAULT true,
  allowed_tools_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_config_json  jsonb NOT NULL DEFAULT '{}'::jsonb, -- provider/model/temp overrides
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_ai_workflow_configs_updated_at
  BEFORE UPDATE ON ai_workflow_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 12. ai_integration_actions — proposed/approved external effects.
--     COMPLIANCE GATE: approval_id is NOT NULL and a trigger verifies the
--     referenced approval decision is 'approved' before any non-proposed
--     status can be written. The service layer enforces this too; the
--     trigger is defense in depth.
-- ---------------------------------------------------------------------------
CREATE TABLE ai_integration_actions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id               uuid NOT NULL REFERENCES ai_tasks (id) ON DELETE CASCADE,
  approval_id           uuid REFERENCES ai_approvals (id) ON DELETE RESTRICT,
  action_type           text NOT NULL,          -- 'send_email', 'monday_update', ...
  target_system         text NOT NULL,          -- 'gmail', 'outlook', 'monday', 'ghl', ...
  status                text NOT NULL DEFAULT 'proposed' CHECK (status IN (
                          'proposed', 'approved', 'executing', 'executed',
                          'failed', 'cancelled')),
  request_payload_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload_json jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz
);

CREATE INDEX idx_ai_integration_actions_task   ON ai_integration_actions (task_id);
CREATE INDEX idx_ai_integration_actions_status ON ai_integration_actions (status);

CREATE OR REPLACE FUNCTION enforce_action_approval() RETURNS trigger AS $$
DECLARE
  v_decision text;
BEGIN
  -- 'proposed' and 'cancelled' rows may exist without an approval;
  -- every other status requires an approval row with decision = 'approved'.
  IF NEW.status NOT IN ('proposed', 'cancelled') THEN
    IF NEW.approval_id IS NULL THEN
      RAISE EXCEPTION 'integration action % requires an approval before status %',
        NEW.id, NEW.status;
    END IF;
    SELECT decision INTO v_decision FROM ai_approvals WHERE id = NEW.approval_id;
    IF v_decision IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'integration action % approval % is not approved (decision=%)',
        NEW.id, NEW.approval_id, COALESCE(v_decision, 'missing');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ai_integration_actions_gate
  BEFORE INSERT OR UPDATE ON ai_integration_actions
  FOR EACH ROW EXECUTE FUNCTION enforce_action_approval();


-- ============================================================================
-- Seed data (safe, non-borrower): default workflow configs + prompt v1 rows
-- are inserted by "npm run db:seed" (src/db/seed.ts), not by migrations.
-- ============================================================================
