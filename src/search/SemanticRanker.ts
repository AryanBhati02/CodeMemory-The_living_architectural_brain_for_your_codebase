export class SemanticRanker {
  private index: Array<{ id: string; vec: Float32Array }> = [];

  updateIndex(nodes: Array<{ id: string; embedding: Float32Array }>): void {
    this.index = nodes.map(n => ({ id: n.id, vec: n.embedding }));
  }

  rank(queryVec: Float32Array, topK = 10): Array<{ id: string; score: number }> {
    if (!this.index.length || !queryVec || !queryVec.length) return [];
    return this.index
      .map(entry => ({ id: entry.id, score: this.cosine(queryVec, entry.vec) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  cosine(a: Float32Array, b: Float32Array): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot   += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
  }

  get size(): number { return this.index.length; }
}
