import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CodeMemoryDatabase } from '../src/db/database';
import type { DecisionNode, DecisionEdge } from '../src/graph/types';

function makeNode(id: string, payloadOverrides: Partial<DecisionNode['payload']> = {}): DecisionNode {
  return {
    id,
    type: 'decision',
    payload: {
      title: 'Use SQLite for local persistence',
      rationale: 'Lightweight, zero-config, and portable to Turso in Phase 4.',
      type: 'constraint',
      status: 'accepted',
      filePaths: ['src/db/'],
      tags: ['storage', 'sqlite'],
      ...payloadOverrides,
    },
    embedding: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    authorName: 'Test Author',
    authorEmail: 'author@test.com',
  };
}

describe('CodeMemoryDatabase', () => {
  let db: CodeMemoryDatabase;

  beforeEach(() => {
    db = new CodeMemoryDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('insertNode stores payload as JSON and retrieves it correctly', () => {
    db.insertNode(makeNode('n1'));
    const node = db.getNodeById('n1');
    expect(node).toBeDefined();
    expect(node!.id).toBe('n1');
    expect(node!.payload.title).toBe('Use SQLite for local persistence');
    expect(node!.payload.rationale).toBe('Lightweight, zero-config, and portable to Turso in Phase 4.');
    expect(node!.payload.type).toBe('constraint');
    expect(node!.payload.status).toBe('accepted');
    expect(node!.authorName).toBe('Test Author');
    expect(node!.authorEmail).toBe('author@test.com');
    expect(node!.embedding).toBeNull();
  });

  it('getNodeById returns undefined for a non-existent id', () => {
    expect(db.getNodeById('ghost-id')).toBeUndefined();
  });

  it('updateNodeEmbedding stores a Float32Array blob and round-trips all values correctly', () => {
    db.insertNode(makeNode('n1'));
    const embedding = new Float32Array([0.1, 0.25, 0.5, 0.75]);
    db.updateNodeEmbedding('n1', embedding);
    const node = db.getNodeById('n1');
    expect(node!.embedding).not.toBeNull();
    expect(node!.embedding).toBeInstanceOf(Float32Array);
    expect(node!.embedding!.length).toBe(4);
    expect(node!.embedding![0]).toBeCloseTo(0.1);
    expect(node!.embedding![1]).toBeCloseTo(0.25);
    expect(node!.embedding![2]).toBeCloseTo(0.5);
    expect(node!.embedding![3]).toBeCloseTo(0.75);
  });

  it('searchNodesFts returns nodes whose title matches the query and excludes non-matching nodes', () => {
    db.insertNode(makeNode('sqlite-node', { title: 'Use SQLite for local persistence' }));
    db.insertNode(makeNode('redis-node',  { title: 'Use Redis for caching', rationale: 'Fast in-memory store.', tags: [] }));
    const results = db.searchNodesFts('SQLite');
    expect(results.some(n => n.id === 'sqlite-node')).toBe(true);
    expect(results.some(n => n.id === 'redis-node')).toBe(false);
  });

  it('searchNodesFts handles apostrophes in the query without throwing', () => {
    db.insertNode(makeNode('n1'));
    expect(() => db.searchNodesFts("don't use globals")).not.toThrow();
  });

  it('searchNodesFts handles double-quotes in the query without throwing', () => {
    db.insertNode(makeNode('n1'));
    expect(() => db.searchNodesFts('"exact phrase"')).not.toThrow();
  });

  it('deleteNode cascades and removes all associated edges (foreign key enforcement)', () => {
    db.insertNode(makeNode('node-a'));
    db.insertNode(makeNode('node-b'));
    const edge: DecisionEdge = {
      id: 'edge-ab',
      fromId: 'node-a',
      toId: 'node-b',
      relationType: 'DEPENDS_ON',
      weight: 1.0,
      createdAt: '2024-01-01T00:00:00.000Z',
    };
    db.insertEdge(edge);
    expect(db.getAllEdges()).toHaveLength(1);

    db.deleteNode('node-a');

    expect(db.getNodeById('node-a')).toBeUndefined();
    expect(db.getAllEdges()).toHaveLength(0);
  });

  it('deleteNode removes the target-side edge when the destination node is deleted', () => {
    db.insertNode(makeNode('node-a'));
    db.insertNode(makeNode('node-b'));
    db.insertEdge({ id: 'e1', fromId: 'node-a', toId: 'node-b', relationType: 'RELATED_TO', weight: 1.0, createdAt: '2024-01-01T00:00:00.000Z' });
    db.deleteNode('node-b');
    expect(db.getAllEdges()).toHaveLength(0);
  });

  it('getStats returns correct totalDecisions count and byType breakdown', () => {
    db.insertNode(makeNode('n1', { type: 'constraint' }));
    db.insertNode(makeNode('n2', { type: 'pattern' }));
    db.insertNode(makeNode('n3', { type: 'pattern' }));
    db.insertNode(makeNode('n4', { type: 'why' }));
    const stats = db.getStats();
    expect(stats.totalDecisions).toBe(4);
    expect(stats.byType.constraint).toBe(1);
    expect(stats.byType.pattern).toBe(2);
    expect(stats.byType.why).toBe(1);
    expect(stats.byType.convention).toBe(0);
    expect(stats.totalEdges).toBe(0);
  });

  it('getStats counts edges correctly', () => {
    db.insertNode(makeNode('a'));
    db.insertNode(makeNode('b'));
    db.insertEdge({ id: 'e1', fromId: 'a', toId: 'b', relationType: 'RELATED_TO', weight: 1.0, createdAt: '2024-01-01T00:00:00.000Z' });
    expect(db.getStats().totalEdges).toBe(1);
  });

  it('getUnembeddedNodes returns only nodes where embedding is null', () => {
    db.insertNode(makeNode('has-embedding'));
    db.insertNode(makeNode('needs-embedding'));
    db.updateNodeEmbedding('has-embedding', new Float32Array([0.1, 0.2]));

    const unembedded = db.getUnembeddedNodes();

    expect(unembedded.every(n => n.embedding === null)).toBe(true);
    expect(unembedded.some(n => n.id === 'needs-embedding')).toBe(true);
    expect(unembedded.some(n => n.id === 'has-embedding')).toBe(false);
  });

  it('getUnembeddedNodes returns an empty array when all nodes are embedded', () => {
    db.insertNode(makeNode('n1'));
    db.updateNodeEmbedding('n1', new Float32Array([0.9]));
    expect(db.getUnembeddedNodes()).toHaveLength(0);
  });
});
