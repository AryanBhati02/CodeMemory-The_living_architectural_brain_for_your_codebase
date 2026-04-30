










import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';



vi.mock('vscode', () => ({
  EventEmitter: class MockEventEmitter {
    
    
    event = (_listener: Function) => ({ dispose: () => {} });
    fire(_data: unknown) {}
    dispose() {}
  },
  Disposable: class MockDisposable {
    dispose() {}
  },
}));

import { DecisionService, validatePayload } from '../src/decisions/decisionService';
import { CodeMemoryDatabase } from '../src/db/database';
import type { EmbeddingQueue } from '../src/workers/embeddingQueue';



function makeMockQueue(): Pick<EmbeddingQueue, 'enqueue' | 'onEmbeddingComplete'> {
  return {
    enqueue: vi.fn().mockResolvedValue(undefined),
    onEmbeddingComplete: (_listener: Function) => ({ dispose: () => {} }),
  };
}



describe('DecisionService', () => {
  let db: CodeMemoryDatabase;
  let service: DecisionService;

  beforeEach(() => {
    db = new CodeMemoryDatabase(':memory:');
    service = new DecisionService(db, makeMockQueue() as unknown as EmbeddingQueue);
  });

  afterEach(() => {
    service.dispose();
    db.close();
  });

  

  it('createDecision rejects an empty title and throws a descriptive error', async () => {
    await expect(
      service.createDecision({ title: '', rationale: 'Some rationale', type: 'constraint' })
    ).rejects.toThrow(/title/i);
  });

  it('createDecision rejects a whitespace-only title', async () => {
    await expect(
      service.createDecision({ title: '   ', rationale: 'Some rationale', type: 'constraint' })
    ).rejects.toThrow();
  });

  it('createDecision rejects an empty rationale and throws a descriptive error', async () => {
    await expect(
      service.createDecision({ title: 'Valid Title', rationale: '', type: 'constraint' })
    ).rejects.toThrow(/rationale/i);
  });

  it('createDecision rejects a whitespace-only rationale', async () => {
    await expect(
      service.createDecision({ title: 'Valid Title', rationale: '   ', type: 'pattern' })
    ).rejects.toThrow();
  });

  

  it("createDecision sets payload.status to 'proposed' when no status is provided", async () => {
    const node = await service.createDecision({
      title: 'Adopt monorepo layout',
      rationale: 'Single source of truth for shared utilities',
      type: 'convention',
    });
    expect(node.payload.status).toBe('proposed');
  });

  it('createDecision respects an explicitly supplied status', async () => {
    const node = await service.createDecision({
      title: 'Use TypeScript strictly',
      rationale: 'Catch type errors at compile time',
      type: 'constraint',
      status: 'accepted',
    });
    expect(node.payload.status).toBe('accepted');
  });

  it('createDecision persists the node so getNodeById returns it', async () => {
    const node = await service.createDecision({
      title: 'Use dependency injection',
      rationale: 'Decouples modules from their dependencies',
      type: 'pattern',
    });
    const fetched = db.getNodeById(node.id);
    expect(fetched).toBeDefined();
    expect(fetched!.payload.title).toBe('Use dependency injection');
  });

  

  it('updateDecision merges partial updates without overwriting untouched fields', async () => {
    const created = await service.createDecision({
      title: 'Use React Query for server state',
      rationale: 'Reduces boilerplate and manages caching automatically',
      type: 'pattern',
      tags: ['react', 'data-fetching'],
    });

    const updated = await service.updateDecision(created.id, { title: 'Use TanStack Query for server state' });

    expect(updated.payload.title).toBe('Use TanStack Query for server state');
    expect(updated.payload.rationale).toBe('Reduces boilerplate and manages caching automatically');
    expect(updated.payload.tags).toEqual(['react', 'data-fetching']);
    expect(updated.payload.type).toBe('pattern');
  });

  it('updateDecision persists the merged payload to the database', async () => {
    const created = await service.createDecision({
      title: 'Original Title',
      rationale: 'Original rationale',
      type: 'why',
    });
    await service.updateDecision(created.id, { rationale: 'Updated rationale' });

    const fetched = db.getNodeById(created.id);
    expect(fetched!.payload.rationale).toBe('Updated rationale');
    expect(fetched!.payload.title).toBe('Original Title');
  });

  it('updateDecision throws when the target id does not exist', async () => {
    await expect(
      service.updateDecision('nonexistent-uuid', { title: 'Ghost' })
    ).rejects.toThrow(/not found/i);
  });

  

  it("createEdge with SUPERSEDES relation updates the target node's status to 'superseded'", async () => {
    const older = await service.createDecision({
      title: 'Use Redux for global state',
      rationale: 'Centralized state management',
      type: 'pattern',
      status: 'accepted',
    });
    const newer = await service.createDecision({
      title: 'Use Zustand for global state',
      rationale: 'Simpler API, less boilerplate than Redux',
      type: 'pattern',
    });

    service.createEdge(newer.id, older.id, 'SUPERSEDES');

    const updatedOlder = db.getNodeById(older.id);
    expect(updatedOlder!.payload.status).toBe('superseded');
  });

  it('createEdge with non-SUPERSEDES relation does not change target status', async () => {
    const nodeA = await service.createDecision({
      title: 'Use Tailwind',
      rationale: 'Utility-first CSS',
      type: 'convention',
      status: 'accepted',
    });
    const nodeB = await service.createDecision({
      title: 'Use PostCSS',
      rationale: 'CSS transforms',
      type: 'convention',
      status: 'accepted',
    });

    service.createEdge(nodeA.id, nodeB.id, 'RELATED_TO');

    expect(db.getNodeById(nodeB.id)!.payload.status).toBe('accepted');
  });

  it('createEdge throws when the source node does not exist', async () => {
    const nodeB = await service.createDecision({
      title: 'Target Node',
      rationale: 'Some rationale',
      type: 'why',
    });
    expect(() => service.createEdge('ghost-id', nodeB.id, 'DEPENDS_ON')).toThrow(/not found/i);
  });

  it('createEdge throws when the target node does not exist', async () => {
    const nodeA = await service.createDecision({
      title: 'Source Node',
      rationale: 'Some rationale',
      type: 'why',
    });
    expect(() => service.createEdge(nodeA.id, 'ghost-id', 'DEPENDS_ON')).toThrow(/not found/i);
  });

  

  it('deleteDecision throws when the id does not exist', () => {
    expect(() => service.deleteDecision('completely-unknown-id')).toThrow(/not found/i);
  });

  it('deleteDecision removes the node so it cannot be retrieved afterwards', async () => {
    const node = await service.createDecision({
      title: 'Transient Decision',
      rationale: 'Will be deleted',
      type: 'why',
    });
    service.deleteDecision(node.id);
    expect(db.getNodeById(node.id)).toBeUndefined();
  });

  

  it('getDecisions with type filter returns only nodes matching that type', async () => {
    await service.createDecision({ title: 'Constraint A', rationale: 'Rationale A', type: 'constraint' });
    await service.createDecision({ title: 'Pattern B',    rationale: 'Rationale B', type: 'pattern' });
    await service.createDecision({ title: 'Pattern C',    rationale: 'Rationale C', type: 'pattern' });
    await service.createDecision({ title: 'Convention D', rationale: 'Rationale D', type: 'convention' });

    const constraints = service.getDecisions({ type: 'constraint' });
    expect(constraints).toHaveLength(1);
    expect(constraints[0].payload.type).toBe('constraint');

    const patterns = service.getDecisions({ type: 'pattern' });
    expect(patterns).toHaveLength(2);
    expect(patterns.every(n => n.payload.type === 'pattern')).toBe(true);
  });

  it('getDecisions with no filter returns all nodes', async () => {
    await service.createDecision({ title: 'A', rationale: 'R', type: 'why' });
    await service.createDecision({ title: 'B', rationale: 'R', type: 'pattern' });
    expect(service.getDecisions()).toHaveLength(2);
  });

  it('getDecisions with status filter returns only nodes matching that status', async () => {
    await service.createDecision({ title: 'Proposed', rationale: 'R', type: 'why' }); 
    await service.createDecision({ title: 'Accepted', rationale: 'R', type: 'why', status: 'accepted' });

    const proposed = service.getDecisions({ status: 'proposed' });
    expect(proposed).toHaveLength(1);
    expect(proposed[0].payload.status).toBe('proposed');
  });
});
