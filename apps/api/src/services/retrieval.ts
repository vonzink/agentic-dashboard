import type { Store } from '../repositories/interfaces';
import { cosine, type EmbeddingProvider } from './embeddings';

export interface RetrievalHit {
  chunk_id: string;
  document_id: string;
  source_label: string;
  content: string;
  page_number: number | null;
  score: number;
}

/**
 * Similarity search over embedded document chunks. Vectors live as jsonb
 * in Postgres and similarity is computed here in the app — deliberately
 * boring and extension-free at internal-library scale. When the corpus
 * outgrows this (≳50k chunks), enable pgvector on RDS, add a vector
 * column migration, and push the ranking into SQL; this interface stays.
 */
export class RetrievalService {
  constructor(
    private store: Store,
    private embedder: EmbeddingProvider,
  ) {}

  /** `companyId` scopes the candidate set to one client's documents. */
  async search(query: string, k = 5, companyId?: string): Promise<RetrievalHit[]> {
    const [queryVec] = await this.embedder.embed([query]);
    const rows = await this.store.chunks.listEmbedded(this.embedder.model, companyId);
    const scored = rows
      .map((r) => ({ row: r, score: cosine(queryVec!, r.embedding) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    const docNames = new Map<string, string>();
    const hits: RetrievalHit[] = [];
    for (const { row, score } of scored) {
      if (!docNames.has(row.document_id)) {
        const doc = await this.store.documents.get(row.document_id);
        docNames.set(row.document_id, doc?.filename ?? 'Document');
      }
      hits.push({
        chunk_id: row.chunk_id,
        document_id: row.document_id,
        source_label: row.section_label
          ? `${docNames.get(row.document_id)} — ${row.section_label}`
          : docNames.get(row.document_id)!,
        content: row.content,
        page_number: row.page_number,
        score: Number(score.toFixed(4)),
      });
    }
    return hits;
  }
}
