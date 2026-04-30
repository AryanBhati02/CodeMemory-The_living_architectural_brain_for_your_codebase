import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SemanticRanker } from '../src/search/SemanticRanker';
vi.mock('vscode', () => ({
  EventEmitter: class {
    event = (_listener: Function) => ({ dispose: () => {} });
    fire(_data: unknown) {}
    dispose() {}
  },
  Disposable: class { dispose() {} },
}));
import { ProviderManager }  from '../src/ai/providers/ProviderManager';
import { CacheEngine, computeGraphHash } from '../src/ai/cache/CacheEngine';
import { PromptBuilder }    from '../src/ai/pipeline/PromptBuilder';
import { AIProviderError }  from '../src/ai/providers/IAIProvider';
import { validatePayload }  from '../src/decisions/decisionService';
import type { DecisionNode } from '../src/graph/types';
function makeDecision(overrides: Partial<DecisionNode['payload']> = {}): DecisionNode {
  return {
    id: 'test-1',
    type: 'decision',
    payload: {
      title: 'Use fetch over axios',
      rationale: 'Reduces bundle size and is available natively.',
      type: 'constraint',
      status: 'accepted',
      filePaths: ['src/api/'],
      tags: ['networking', 'dependencies'],
      ...overrides,
    },
    embedding: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    authorName: 'Test User',
    authorEmail: 'test@example.com',
  };
}
describe('ProviderManager', () => {
  beforeEach(() => ProviderManager.resetInstance());
  it('registers 7 default providers', () => {
    const pm = ProviderManager.getInstance();
    expect(pm.listProviders().length).toBe(7);
    const ids = pm.listProviders().map(p => p.id);
    expect(ids).toContain('claude');
    expect(ids).toContain('openai');
    expect(ids).toContain('gemini');
  });
  it('defaults to claude as active provider', () => {
    const pm = ProviderManager.getInstance();
    expect(pm.getActiveProviderId()).toBe('claude');
  });
  it('switches active provider', () => {
    const pm = ProviderManager.getInstance();
    pm.setActiveProvider('openai');
    expect(pm.getActiveProviderId()).toBe('openai');
  });
  it('throws on unknown provider switch', () => {
    const pm = ProviderManager.getInstance();
    expect(() => pm.setActiveProvider('nonexistent')).toThrow();
  });
  it('throws AIProviderError if active provider not found after unregister', () => {
    const pm = ProviderManager.getInstance();
    pm.setActiveProvider('openai');
    pm.unregister('claude');
    expect(() => pm.unregister('openai')).toThrow(); 
  });
  it('validates claude key format', () => {
    const pm = ProviderManager.getInstance();
    expect(pm.validateKey('claude', 'sk-ant-api03-' + 'x'.repeat(30)).valid).toBe(true); 
    expect(pm.validateKey('claude', 'bad-key').valid).toBe(false);
    expect(pm.validateKey('claude', 'sk-ant-short').valid).toBe(false);
  });
  it('validates openai key format', () => {
    const pm = ProviderManager.getInstance();
    expect(pm.validateKey('openai', 'sk-' + 'a'.repeat(40)).valid).toBe(true);
    expect(pm.validateKey('openai', 'notakey').valid).toBe(false);
  });
  it('returns reason for invalid key', () => {
    const pm = ProviderManager.getInstance();
    const r = pm.validateKey('claude', 'invalid');
    expect(r.valid).toBe(false);
    expect(r.reason).toBeTruthy();
  });
  it('singleton returns same instance', () => {
    const a = ProviderManager.getInstance();
    const b = ProviderManager.getInstance();
    expect(a).toBe(b);
  });
});
describe('CacheEngine', () => {
  it('returns null on empty cache', () => {
    const cache = new CacheEngine(300);
    expect(cache.get('hash1', 'claude')).toBeNull();
  });
  it('stores and retrieves system prompt', () => {
    const cache = new CacheEngine(300);
    cache.set('hash1', 'claude', 'system prompt text');
    expect(cache.get('hash1', 'claude')).toBe('system prompt text');
  });
  it('returns null on graph hash mismatch', () => {
    const cache = new CacheEngine(300);
    cache.set('hash1', 'claude', 'text');
    expect(cache.get('hash2', 'claude')).toBeNull();
  });
  it('returns null on provider mismatch', () => {
    const cache = new CacheEngine(300);
    cache.set('hash1', 'claude', 'text');
    expect(cache.get('hash1', 'openai')).toBeNull();
  });
  it('invalidates explicitly', () => {
    const cache = new CacheEngine(300);
    cache.set('hash1', 'claude', 'text');
    cache.invalidate('test');
    expect(cache.get('hash1', 'claude')).toBeNull();
  });
  it('tracks hit rate correctly', () => {
    const cache = new CacheEngine(300);
    cache.set('h', 'claude', 'prompt');
    cache.get('h', 'claude'); 
    cache.get('h', 'openai'); 
    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe(0.5);
  });
  it('records last invalidation reason', () => {
    const cache = new CacheEngine(300);
    cache.invalidate('graph-update');
    expect(cache.getStats().lastInvalidationReason).toBe('graph-update');
  });
  it('returns null after TTL expires', async () => {
    const cache = new CacheEngine(0.001);
    cache.set('hash1', 'claude', 'system prompt text');
    await new Promise(r => setTimeout(r, 20)); 
    expect(cache.get('hash1', 'claude')).toBeNull();
  });
});
describe('computeGraphHash', () => {
  it('same decisions produce same hash', () => {
    const d = makeDecision();
    expect(computeGraphHash([d])).toBe(computeGraphHash([d]));
  });
  it('different decisions produce different hash', () => {
    const d1 = makeDecision();
    const d2 = { ...d1, id: 'test-2' };
    expect(computeGraphHash([d1])).not.toBe(computeGraphHash([d2]));
  });
  it('empty array produces a hash', () => {
    expect(computeGraphHash([])).toBeTruthy();
  });
});
describe('PromptBuilder', () => {
  it('builds prompt containing decision title', () => {
    const d = makeDecision();
    const prompt = PromptBuilder.build({ decisions: [d] });
    expect(prompt).toContain('Use fetch over axios');
  });
  it('builds prompt containing rationale', () => {
    const d = makeDecision();
    const prompt = PromptBuilder.build({ decisions: [d] });
    expect(prompt).toContain('Reduces bundle size');
  });
  it('handles empty decisions array', () => {
    const prompt = PromptBuilder.build({ decisions: [] });
    expect(prompt).toContain('No architectural decisions');
  });
  it('includes active file path when provided', () => {
    const d = makeDecision();
    const prompt = PromptBuilder.build({ decisions: [d], activeFilePath: 'src/api/client.ts' });
    expect(prompt).toContain('src/api/client.ts');
  });
  it('includes code context when provided', () => {
    const d = makeDecision();
    const prompt = PromptBuilder.build({ decisions: [d], codeContext: 'const x = require("axios")' });
    expect(prompt).toContain('axios');
  });
  it('respects maxDecisions limit', () => {
    const decisions = Array.from({ length: 30 }, (_, i) =>
      makeDecision({ title: `Decision ${i}` })
    );
    const prompt = PromptBuilder.build({ decisions, maxDecisions: 5 });
    const matches = (prompt.match(/Decision \d+/g) ?? []).length;
    expect(matches).toBe(5);
  });
  it('produces deterministic output for same input', () => {
    const d = makeDecision();
    const p1 = PromptBuilder.build({ decisions: [d] });
    const p2 = PromptBuilder.build({ decisions: [d] });
    expect(p1).toBe(p2); 
  });
});
describe('AIProviderError', () => {
  it('constructs correctly', () => {
    const err = new AIProviderError('Rate limited', 'RATE_LIMIT', 'claude', true, 429);
    expect(err.name).toBe('AIProviderError');
    expect(err.code).toBe('RATE_LIMIT');
    expect(err.providerId).toBe('claude');
    expect(err.retryable).toBe(true);
    expect(err.statusCode).toBe(429);
  });
  it('non-retryable by default', () => {
    const err = new AIProviderError('Auth failed', 'AUTH_ERROR', 'openai');
    expect(err.retryable).toBe(false);
  });
});
describe('validatePayload', () => {
  it('passes valid payload', () => {
    expect(validatePayload({
      title: 'Use fetch',
      rationale: 'Smaller bundle',
      type: 'constraint',
      status: 'accepted',
      filePaths: [],
      tags: [],
    })).toHaveLength(0);
  });
  it('fails on missing title', () => {
    const errors = validatePayload({ rationale: 'x', type: 'constraint' });
    expect(errors.some(e => e.field === 'title')).toBe(true);
  });
  it('fails on missing rationale', () => {
    const errors = validatePayload({ title: 'x', type: 'constraint' });
    expect(errors.some(e => e.field === 'rationale')).toBe(true);
  });
  it('fails on missing type', () => {
    const errors = validatePayload({ title: 'x', rationale: 'y' });
    expect(errors.some(e => e.field === 'type')).toBe(true);
  });
  it('fails on title over 120 chars', () => {
    const errors = validatePayload({ title: 'a'.repeat(121), rationale: 'r', type: 'why' });
    expect(errors.some(e => e.field === 'title')).toBe(true);
  });
});
describe('SemanticRanker', () => {
  let ranker: SemanticRanker;
  beforeEach(() => { ranker = new SemanticRanker(); });
  it('cosine(v, v) ≈ 1.0', () => {
    const v = new Float32Array([1, 2, 3, 4]);
    expect(ranker.cosine(v, v)).toBeCloseTo(1.0, 3);
  });
  it('cosine(v, -v) ≈ -1.0', () => {
    const v    = new Float32Array([1, 2, 3, 4]);
    const negV = new Float32Array([-1, -2, -3, -4]);
    expect(ranker.cosine(v, negV)).toBeCloseTo(-1.0, 3);
  });
  it('rank() returns results sorted descending by score', () => {
    ranker.updateIndex([
      { id: 'a', embedding: new Float32Array([1, 0]) },
      { id: 'b', embedding: new Float32Array([0, 1]) },
      { id: 'c', embedding: new Float32Array([1, 1]) },
    ]);
    const results = ranker.rank(new Float32Array([1, 0]));
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
  it('rank() returns at most topK results', () => {
    ranker.updateIndex([
      { id: '1', embedding: new Float32Array([1, 0]) },
      { id: '2', embedding: new Float32Array([0, 1]) },
      { id: '3', embedding: new Float32Array([1, 1]) },
      { id: '4', embedding: new Float32Array([-1, 0]) },
      { id: '5', embedding: new Float32Array([0, -1]) },
    ]);
    expect(ranker.rank(new Float32Array([1, 0]), 3)).toHaveLength(3);
  });
  it('rank() returns [] when index is empty', () => {
    expect(ranker.rank(new Float32Array([1, 0]))).toEqual([]);
  });
  it('rank() returns [] when queryVec has length 0', () => {
    ranker.updateIndex([
      { id: 'a', embedding: new Float32Array([1, 0, 0]) },
    ]);
    const results = ranker.rank(new Float32Array(0));
    expect(results).toEqual([]);
  });
  it('updateIndex() replaces the previous index', () => {
    ranker.updateIndex([{ id: 'old', embedding: new Float32Array([1, 0]) }]);
    expect(ranker.size).toBe(1);
    ranker.updateIndex([
      { id: 'new-a', embedding: new Float32Array([1, 0]) },
      { id: 'new-b', embedding: new Float32Array([0, 1]) },
    ]);
    expect(ranker.size).toBe(2);
    const ids = ranker.rank(new Float32Array([1, 0])).map(r => r.id);
    expect(ids).not.toContain('old');
    expect(ids).toContain('new-a');
  });
  it('updateIndex() with 3 then 1 entry results in size === 1', () => {
    ranker.updateIndex([
      { id: 'a', embedding: new Float32Array([1, 0, 0]) },
      { id: 'b', embedding: new Float32Array([0, 1, 0]) },
      { id: 'c', embedding: new Float32Array([0, 0, 1]) },
    ]);
    expect(ranker.size).toBe(3);
    ranker.updateIndex([
      { id: 'only', embedding: new Float32Array([1, 1, 1]) },
    ]);
    expect(ranker.size).toBe(1);
    const results = ranker.rank(new Float32Array([1, 0, 0]));
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('only');
  });
  it('cosine handles zero vectors without throwing', () => {
    const zero = new Float32Array([0, 0, 0]);
    const v    = new Float32Array([1, 0, 0]);
    expect(() => ranker.cosine(zero, v)).not.toThrow();
    expect(() => ranker.cosine(v, zero)).not.toThrow();
    expect(() => ranker.cosine(zero, zero)).not.toThrow();
    expect(Number.isFinite(ranker.cosine(zero, v))).toBe(true);
  });
});
