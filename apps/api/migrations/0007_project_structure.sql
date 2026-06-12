-- Deterministic repo scan results (Layer 1 of project mapping): languages,
-- detected stack, and classified top-level directories. Parsed from the
-- GitHub tree + manifests on sync — facts, not AI interpretation.
ALTER TABLE ai_projects ADD COLUMN structure_json jsonb;
