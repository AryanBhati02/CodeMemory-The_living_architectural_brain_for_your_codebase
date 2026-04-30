import { createHash } from 'crypto';
import { DecisionNode } from '../../graph/types';

export interface CacheEntry {
  systemPrompt: string;
  graphHash: string;
  providerId: string;
  createdAt: number;
  ttlMs: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalRequests: number;
  lastInvalidatedAt: number | null;
  lastInvalidationReason: string | null;
}

export function computeGraphHash(decisions: DecisionNode[]): string {
  const repr = decisions
    .map((d) => `${d.id}:${d.updatedAt}`)
    .join('|');
  return createHash('sha256').update(repr).digest('hex').slice(0, 16);
}

export class CacheEngine {
  private entry: CacheEntry | null = null;
  private ttlMs: number;

  private hits = 0;
  private misses = 0;
  private lastInvalidatedAt: number | null = null;
  private lastInvalidationReason: string | null = null;

  constructor(ttlSeconds = 300) {
    this.ttlMs = ttlSeconds * 1000;
  }

  get(graphHash: string, providerId: string): string | null {
    if (!this.entry) { this.misses++; return null; }

    const expired = Date.now() > this.entry.createdAt + this.entry.ttlMs;
    const stale   = this.entry.graphHash !== graphHash || this.entry.providerId !== providerId;

    if (expired || stale) {
      this.entry = null;
      this.misses++;
      return null;
    }

    this.hits++;
    return this.entry.systemPrompt;
  }

  set(graphHash: string, providerId: string, systemPrompt: string): void {
    this.entry = { systemPrompt, graphHash, providerId, createdAt: Date.now(), ttlMs: this.ttlMs };
  }

  invalidate(reason: string): void {
    this.entry = null;
    this.lastInvalidatedAt = Date.now();
    this.lastInvalidationReason = reason;
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      totalRequests: total,
      lastInvalidatedAt: this.lastInvalidatedAt,
      lastInvalidationReason: this.lastInvalidationReason,
    };
  }

  updateTtl(ttlSeconds: number): void {
    this.ttlMs = ttlSeconds * 1000;
  }
}
