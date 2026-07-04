-- Code-level import graph (the "Obsidian brain" view): file nodes + import
-- edges, parsed deterministically from source files fetched via the
-- read-only GitHub token. Facts, not AI.
ALTER TABLE ai_projects ADD COLUMN import_graph_json jsonb;
