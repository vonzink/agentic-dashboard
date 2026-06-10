-- Embeddings for retrieval. Stored as jsonb so no Postgres extension is
-- required; similarity is computed in the app layer. When pgvector is
-- enabled on RDS, a later migration can add a vector column + index and
-- backfill from these values (embedding_model records which model wrote
-- each vector, so mixed-model corpora reindex cleanly).
ALTER TABLE ai_source_chunks
  ADD COLUMN IF NOT EXISTS embedding_json jsonb,
  ADD COLUMN IF NOT EXISTS embedding_model text;

CREATE INDEX IF NOT EXISTS idx_ai_source_chunks_embedding_model
  ON ai_source_chunks (embedding_model)
  WHERE embedding_json IS NOT NULL;
