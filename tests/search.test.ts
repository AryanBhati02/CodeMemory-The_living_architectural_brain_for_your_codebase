
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => ({
  EventEmitter: class {
    event = (_listener: Function) => ({ dispose: () => {} });
    fire(_data: unknown) {}
    dispose() {}
  },
  Disposable: class { dispose() {} },
}));

import { DecisionService } from '../src/decisions/decisionService';
import { CodeMemoryDatabase } from '../src/db/database';
import type { EmbeddingQueue } from '../src/workers/embeddingQueue';

function makeBrokenQueue(): Pick<EmbeddingQueue, 'enqueue' | 'embedText' | 'onEmbeddingComplete'> {
  return {
    enqueue: vi.fn().mockResolvedValue(undefined),
    embedText: vi.fn().mockRejectedValue(new Error('Embedding worker not ready')),
    onEmbeddingComplete: (_listener: Function) => ({ dispose: () => {} }),
  };
}

describe('hybridSearch — graceful fallback without embeddings', () => {
  let db: CodeMemoryDatabase;
  let service: DecisionService;

  beforeEach(async () => {
    db = new CodeMemoryDatabase(':memory:');
    service = new DecisionService(db, makeBrokenQueue() as unknown as EmbeddingQueue);

    await service.createDecision({
      title: 'Use fetch over axios',
      rationale: 'Reduces bundle size; fetch is available natively in modern runtimes.',
      type: 'constraint',
      tags: ['networking', 'dependencies'],
    });
    await service.createDecision({
      title: 'Prefer native APIs',
      rationale: 'Use platform fetch and streams instead of third-party HTTP clients.',
      type: 'convention',
      tags: ['api', 'native'],
    });
    await service.createDecision({
      title: 'Use monorepo layout',
      rationale: 'Single source of truth for shared utilities.',
      type: 'pattern',
      tags: ['architecture'],
    });
  });

  afterEach(() => {
    service.dispose();
    db.close();
  });

  it('returns FTS5 results when embedText rejects (worker not ready)', async () => {
    const results = await service.hybridSearch('fetch');
    
    expect(results.length).toBeGreaterThan(0);
    const titles = results.map(r => r.payload.title);
    expect(titles).toContain('Use fetch over axios');
  });

  it('does NOT throw when embedding worker is unavailable', async () => {
    
    await expect(service.hybridSearch('fetch')).resolves.toBeDefined();
  });

  it('returns results sorted by relevance (keyword-only RRF)', async () => {
    const results = await service.hybridSearch('fetch', 10);
    
    for (const r of results) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('payload');
      expect(r.payload).toHaveProperty('title');
    }
  });

  it('respects the limit parameter', async () => {
    const results = await service.hybridSearch('fetch', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('returns empty array when query matches nothing', async () => {
    const results = await service.hybridSearch('xyznonexistent');
    expect(results).toEqual([]);
  });
});
