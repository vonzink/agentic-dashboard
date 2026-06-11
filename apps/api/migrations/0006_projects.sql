-- Projects registry: the codebases/products ZVZ runs per client, linked to
-- their GitHub repos (read-only token; repos stay private). The dashboard
-- caches repo metadata and imports READMEs into the document library so
-- RAG can answer questions about each project.

CREATE TABLE ai_projects (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES ai_companies(id),
  name                text NOT NULL,
  description         text,
  -- 'owner/name' (e.g. vonzink/msfg-calc); null = not linked to GitHub
  github_repo         text,
  live_url            text,
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'paused', 'archived')),
  notes               text,
  -- cached from the GitHub API on sync (pushed_at, open_issues, ...)
  github_meta_json    jsonb,
  github_synced_at    timestamptz,
  -- sha of the README last imported into the document library
  github_readme_sha   text,
  readme_document_id  uuid REFERENCES ai_source_documents(id),
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON ai_projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Tasks can belong to a project, so AI work is reportable per project.
ALTER TABLE ai_tasks ADD COLUMN project_id uuid REFERENCES ai_projects(id);
CREATE INDEX idx_tasks_project ON ai_tasks (project_id) WHERE project_id IS NOT NULL;
