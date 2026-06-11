-- Eval sets: saved test inputs per workflow, run against a prompt version
-- BEFORE activating it. Eval runs never create tasks/outputs and never
-- enter the review queue — they are a prompt-engineering safety net.

CREATE TABLE ai_eval_cases (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_name      text NOT NULL,
  name               text NOT NULL,
  -- { primary_text, source_text?, options? } — synthetic content only, no borrower data
  input_json         jsonb NOT NULL,
  -- { contains?: string[], min_confidence?: 'HIGH'|'MEDIUM'|'LOW' }
  expectations_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active          boolean NOT NULL DEFAULT true,
  created_by         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_eval_cases_workflow ON ai_eval_cases (workflow_name);

CREATE TABLE ai_eval_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_name   text NOT NULL,
  prompt_version  text NOT NULL,
  model_provider  text NOT NULL,
  model_name      text NOT NULL,
  passed_count    int NOT NULL,
  failed_count    int NOT NULL,
  -- per-case results: { case_id, case_name, passed, failures[], confidence, content_preview }
  results_json    jsonb NOT NULL,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_eval_runs_workflow ON ai_eval_runs (workflow_name, created_at DESC);
