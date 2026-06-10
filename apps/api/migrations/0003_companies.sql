-- Multi-company support: the dashboard is operated by ZVZ Solutions for
-- multiple client companies. Tasks and source documents are owned by a
-- company; runs/outputs/approvals/actions inherit through the task, and
-- chunks/citations inherit through the document. Retrieval is scoped by
-- company so one client's documents can never ground another's answers.

CREATE TABLE ai_companies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  slug       text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- First client; existing rows are backfilled to it.
INSERT INTO ai_companies (name, slug)
VALUES ('Mountain State Financial Group', 'msfg');

ALTER TABLE ai_tasks ADD COLUMN company_id uuid REFERENCES ai_companies (id);
UPDATE ai_tasks SET company_id = (SELECT id FROM ai_companies WHERE slug = 'msfg');
ALTER TABLE ai_tasks ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX idx_ai_tasks_company ON ai_tasks (company_id);

ALTER TABLE ai_source_documents ADD COLUMN company_id uuid REFERENCES ai_companies (id);
UPDATE ai_source_documents SET company_id = (SELECT id FROM ai_companies WHERE slug = 'msfg');
ALTER TABLE ai_source_documents ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX idx_ai_source_documents_company ON ai_source_documents (company_id);

-- Nullable on audit (system events have no company); no backfill — the
-- audit table is append-only and historical rows stay as written.
ALTER TABLE ai_audit_events ADD COLUMN company_id uuid REFERENCES ai_companies (id) ON DELETE SET NULL;
CREATE INDEX idx_ai_audit_events_company ON ai_audit_events (company_id);
