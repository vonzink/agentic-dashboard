/**
 * Embeddings for chunk retrieval.
 *
 * The default LocalHashEmbedder is a deterministic, dependency-free
 * LEXICAL similarity proxy (token + character-trigram hashing into a
 * normalized vector). It needs no API key, which keeps local dev and CI
 * hermetic, and it retrieves well when queries share vocabulary with the
 * SOP/guideline text. It is NOT a semantic model: swap in a real
 * embedding service (e.g. Voyage or Bedrock Titan) by implementing
 * EmbeddingProvider — vectors are stored per-model, so reindexing is
 * just re-embedding with the new model name.
 */
export interface EmbeddingProvider {
  /** Stored with each vector; vectors from different models never mix. */
  readonly model: string;
  readonly dims: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** FNV-1a — stable, fast, good-enough dispersion for feature hashing. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class LocalHashEmbedder implements EmbeddingProvider {
  readonly model = 'local-hash-v1';
  readonly dims = 384;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.one(t));
  }

  private one(text: string): number[] {
    const v = new Array<number>(this.dims).fill(0);
    const add = (feature: string, weight: number) => {
      v[fnv1a(feature) % this.dims]! += weight;
    };
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const tok of tokens) {
      add(`t:${tok}`, 1);
      for (let i = 0; i <= tok.length - 3; i++) add(`g:${tok.slice(i, i + 3)}`, 0.4);
    }
    // L2-normalize so cosine reduces to a dot product.
    const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}

/** Cosine similarity; assumes normalized vectors, 0 on dimension mismatch. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}
