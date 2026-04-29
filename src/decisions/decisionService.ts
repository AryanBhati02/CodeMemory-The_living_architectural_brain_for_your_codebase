
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { CodeMemoryDatabase } from '../db/database';
import type { EmbeddingQueue } from '../workers/embeddingQueue';
import type {
  DecisionNode, DecisionEdge, DecisionPayload,
  DecisionFilter, GraphStats, GraphChangeEvent, RelationType,
} from '../graph/types';



async function resolveAuthor(): Promise<{ name: string; email: string }> {
  try {
    const { execSync } = await import('child_process');
    const name  = execSync('git config user.name',  { encoding: 'utf-8', stdio: ['ignore','pipe','ignore'] }).trim();
    const email = execSync('git config user.email', { encoding: 'utf-8', stdio: ['ignore','pipe','ignore'] }).trim();
    if (name && email) return { name, email };
  } catch {}
  return { name: 'CodeMemory User', email: 'user@codememory.local' };
}

function generateId(): string { return crypto.randomUUID(); }
function now(): string        { return new Date().toISOString(); }

function generateEdgeId(fromId: string, rel: RelationType, toId: string): string {
  return `${fromId}::${rel}::${toId}`;
}



export interface ValidationError { field: string; message: string; }

export function validatePayload(p: Partial<DecisionPayload>): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!p.title?.trim())     errors.push({ field: 'title',     message: 'Title is required.' });
  else if (p.title.length > 120) errors.push({ field: 'title', message: 'Title ≤ 120 chars.' });
  if (!p.rationale?.trim()) errors.push({ field: 'rationale', message: 'Rationale is required.' });
  if (!p.type)              errors.push({ field: 'type',      message: 'Decision type is required.' });
  return errors;
}



export class DecisionService implements vscode.Disposable {
  private readonly _onGraphChange = new vscode.EventEmitter<GraphChangeEvent>();
  readonly onGraphChange = this._onGraphChange.event;

  constructor(
    private readonly db: CodeMemoryDatabase,
    private readonly embeddingQueue: EmbeddingQueue
  ) {}

  

  async createDecision(
    partial: Omit<DecisionPayload, 'status'> & { status?: DecisionPayload['status'] }
  ): Promise<DecisionNode> {
    const errors = validatePayload(partial);
    if (errors.length) throw new Error(`Invalid decision: ${errors.map(e => e.message).join(', ')}`);

    const author = await resolveAuthor();
    const ts = now();
    const id = generateId();

    const payload: DecisionPayload = {
      title:      partial.title.trim(),
      rationale:  partial.rationale.trim(),
      type:       partial.type,
      status:     partial.status ?? 'proposed',
      filePaths:  partial.filePaths ?? [],
      tags:       partial.tags ?? [],
      codeContext: partial.codeContext,
      lineNumber:  partial.lineNumber,
    };

    const node: DecisionNode = {
      id, type: 'decision', payload,
      embedding: null,
      createdAt: ts, updatedAt: ts,
      authorName: author.name, authorEmail: author.email,
    };

    this.db.insertNode(node);
    this._emitChange('insert', id);
    this._enqueueEmbedding(id, payload);
    return node;
  }

  async updateDecision(id: string, updates: Partial<DecisionPayload>): Promise<DecisionNode> {
    const existing = this.db.getNodeById(id);
    if (!existing) throw new Error(`Decision not found: ${id}`);

    const payload: DecisionPayload = {
      ...existing.payload,
      ...updates,
      title:     (updates.title     ?? existing.payload.title).trim(),
      rationale: (updates.rationale ?? existing.payload.rationale).trim(),
    };

    const errors = validatePayload(payload);
    if (errors.length) throw new Error(`Invalid update: ${errors.map(e => e.message).join(', ')}`);

    const ts = now();
    this.db.updateNode(id, payload, ts);
    this._emitChange('update', id);
    this._enqueueEmbedding(id, payload);
    return { ...existing, payload, updatedAt: ts };
  }

  deleteDecision(id: string): void {
    if (!this.db.getNodeById(id)) throw new Error(`Decision not found: ${id}`);
    this.db.deleteNode(id);
    this._emitChange('delete', id);
  }

  getDecision(id: string): DecisionNode | undefined {
    return this.db.getNodeById(id);
  }

  getDecisions(filter?: DecisionFilter): DecisionNode[] {
    if (!filter || !Object.keys(filter).length) return this.db.getAllNodes();

    if (filter.searchQuery) return this.db.searchNodesFts(filter.searchQuery, filter.limit ?? 20);

    let nodes = this.db.getAllNodes();
    if (filter.type)        nodes = nodes.filter(n => n.payload.type === filter.type);
    if (filter.status)      nodes = nodes.filter(n => n.payload.status === filter.status);
    if (filter.tags?.length) nodes = nodes.filter(n => filter.tags!.some(t => n.payload.tags.includes(t)));
    if (filter.authorEmail) nodes = nodes.filter(n => n.authorEmail === filter.authorEmail);

    const offset = filter.offset ?? 0;
    const limit  = filter.limit  ?? 100;
    return nodes.slice(offset, offset + limit);
  }

  searchDecisions(query: string, limit = 20): DecisionNode[] {
    return this.db.searchNodesFts(query, limit);
  }

  

  createEdge(
    fromId: string, toId: string, relationType: RelationType,
    options: { weight?: number; note?: string } = {}
  ): DecisionEdge {
    if (!this.db.getNodeById(fromId)) throw new Error(`Source node not found: ${fromId}`);
    if (!this.db.getNodeById(toId))   throw new Error(`Target node not found: ${toId}`);

    const edge: DecisionEdge = {
      id: generateEdgeId(fromId, relationType, toId),
      fromId, toId, relationType,
      weight: options.weight ?? 1.0,
      createdAt: now(),
      note: options.note,
    };

    this.db.insertEdge(edge);

    if (relationType === 'SUPERSEDES') {
      const superseded = this.db.getNodeById(toId);
      if (superseded && superseded.payload.status !== 'superseded') {
        this.db.updateNode(toId, { ...superseded.payload, status: 'superseded' }, now());
      }
    }

    return edge;
  }

  deleteEdge(fromId: string, toId: string, rel: RelationType): void {
    this.db.deleteEdge(generateEdgeId(fromId, rel, toId));
  }

  getEdgesForDecision(nodeId: string): DecisionEdge[] {
    return this.db.getEdgesForNode(nodeId);
  }

  getGraphStats(): GraphStats {
    return this.db.getStats();
  }

  async importDecisions(nodes: DecisionNode[]): Promise<void> {
    this.db.transaction(() => {
      for (const node of nodes) {
        if (this.db.getNodeById(node.id)) {
          this.db.updateNode(node.id, node.payload, node.updatedAt);
        } else {
          this.db.insertNode(node);
        }
      }
    });
    for (const node of nodes) this._enqueueEmbedding(node.id, node.payload);
    this._emitChange('insert', 'batch-import');
  }

  

  private _emitChange(kind: GraphChangeEvent['kind'], nodeId: string): void {
    this._onGraphChange.fire({ kind, nodeId, timestamp: Date.now() });
  }

  private _enqueueEmbedding(id: string, payload: DecisionPayload): void {
    const text = `${payload.title}. ${payload.rationale}. ${payload.tags.join(' ')}`;
    this.embeddingQueue.enqueue(id, text).catch(() => {});
  }

  dispose(): void {
    this._onGraphChange.dispose();
  }
}
