
import { createClient, type Client, type InStatement } from '@libsql/client';
import * as vscode from 'vscode';
import type { CodeMemoryDatabase } from './database';
import type { DecisionNode, DecisionEdge } from '../graph/types';
import { logger } from '../utils/logger';

const TURSO_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS nodes (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL DEFAULT 'decision',
    payload      TEXT NOT NULL,
    embedding    BLOB,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    author_name  TEXT NOT NULL DEFAULT '',
    author_email TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS edges (
    id            TEXT PRIMARY KEY,
    from_id       TEXT NOT NULL,
    to_id         TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    weight        REAL NOT NULL DEFAULT 1.0,
    created_at    TEXT NOT NULL,
    note          TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_updated ON nodes(updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_edges_from    ON edges(from_id)`,
  `CREATE INDEX IF NOT EXISTS idx_edges_to      ON edges(to_id)`,
];

export interface SyncStatus {
  isSyncing: boolean;
  lastSyncAt: Date | null;
  lastError: string | null;
  pushed: number;
  pulled: number;
}

export class TursoSync implements vscode.Disposable {
  private client: Client | null = null;
  private syncInterval: NodeJS.Timeout | null = null;
  private readonly globalState: vscode.Memento;

  private status: SyncStatus = {
    isSyncing: false,
    lastSyncAt: null,
    lastError: null,
    pushed: 0,
    pulled: 0,
  };

  private readonly _onSyncStatusChange = new vscode.EventEmitter<SyncStatus>();
  readonly onSyncStatusChange = this._onSyncStatusChange.event;

  constructor(
    private readonly localDb: CodeMemoryDatabase,
    private readonly tursoUrl: string,
    private readonly tursoToken: string,
    globalState: vscode.Memento,
  ) {
    this.globalState = globalState;
  }

  async connect(): Promise<void> {
    this.client = createClient({
      url: this.tursoUrl,
      authToken: this.tursoToken,
    });
    await this._initRemoteSchema();
    logger.info('TursoSync', `Connected to ${this.tursoUrl}`);
  }

  get isConnected(): boolean {
    return this.client !== null;
  }

  getStatus(): SyncStatus {
    return { ...this.status };
  }

  async pushAll(): Promise<number> {
    this._assertConnected();
    const nodes = this.localDb.getAllNodes();
    const edges = this.localDb.getAllEdges();

    const statements: InStatement[] = [];

    for (const node of nodes) {
      statements.push({
        sql: 'INSERT OR REPLACE INTO nodes (id,type,payload,embedding,created_at,updated_at,author_name,author_email) VALUES (?,?,?,?,?,?,?,?)',
        args: [node.id, node.type, JSON.stringify(node.payload), null, node.createdAt, node.updatedAt, node.authorName, node.authorEmail],
      });
    }

    for (const edge of edges) {
      statements.push({
        sql: 'INSERT OR REPLACE INTO edges (id,from_id,to_id,relation_type,weight,created_at,note) VALUES (?,?,?,?,?,?,?)',
        args: [edge.id, edge.fromId, edge.toId, edge.relationType, edge.weight, edge.createdAt, edge.note ?? null],
      });
    }

    if (statements.length) {
      const BATCH_SIZE = 50;
      for (let i = 0; i < statements.length; i += BATCH_SIZE) {
        await this.client!.batch(statements.slice(i, i + BATCH_SIZE), 'write');
      }
    }

    const total = nodes.length + edges.length;
    logger.info('TursoSync', `Pushed ${nodes.length} nodes + ${edges.length} edges`);
    return total;
  }

  async pushNode(node: DecisionNode): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.execute({
        sql: 'INSERT OR REPLACE INTO nodes (id,type,payload,embedding,created_at,updated_at,author_name,author_email) VALUES (?,?,?,?,?,?,?,?)',
        args: [node.id, node.type, JSON.stringify(node.payload), null, node.createdAt, node.updatedAt, node.authorName, node.authorEmail],
      });
    } catch (err) {
      logger.warn('TursoSync', `pushNode failed for ${node.id}: ${String(err)}`);
    }
  }

  async pushEdge(edge: DecisionEdge): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.execute({
        sql: 'INSERT OR REPLACE INTO edges (id,from_id,to_id,relation_type,weight,created_at,note) VALUES (?,?,?,?,?,?,?)',
        args: [edge.id, edge.fromId, edge.toId, edge.relationType, edge.weight, edge.createdAt, edge.note ?? null],
      });
    } catch (err) {
      logger.warn('TursoSync', `pushEdge failed for ${edge.id}: ${String(err)}`);
    }
  }

  async pushDeleteNode(nodeId: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.batch([
        { sql: 'DELETE FROM edges WHERE from_id=? OR to_id=?', args: [nodeId, nodeId] },
        { sql: 'DELETE FROM nodes WHERE id=?', args: [nodeId] },
      ], 'write');
    } catch (err) {
      logger.warn('TursoSync', `pushDeleteNode failed for ${nodeId}: ${String(err)}`);
    }
  }

  async pullChanges(): Promise<number> {
    this._assertConnected();
    const since = this._getLastSync();
    let pulled = 0;

    const nodesResult = await this.client!.execute({
      sql: 'SELECT * FROM nodes WHERE updated_at > ? ORDER BY updated_at ASC',
      args: [since],
    });

    for (const row of nodesResult.rows) {
      const remoteUpdatedAt = String(row.updated_at);
      const localNode = this.localDb.getNodeById(String(row.id));

      if (localNode && localNode.updatedAt >= remoteUpdatedAt) {
        continue;
      }

      const payload = JSON.parse(String(row.payload));
      const node: DecisionNode = {
        id: String(row.id),
        type: 'decision',
        payload,
        embedding: null,
        createdAt: String(row.created_at),
        updatedAt: remoteUpdatedAt,
        authorName: String(row.author_name),
        authorEmail: String(row.author_email),
      };

      if (localNode) {
        this.localDb.updateNode(node.id, node.payload, node.updatedAt);
      } else {
        this.localDb.insertNode(node);
      }
      pulled++;
    }

    const edgesResult = await this.client!.execute({
      sql: 'SELECT * FROM edges WHERE created_at > ? ORDER BY created_at ASC',
      args: [since],
    });

    for (const row of edgesResult.rows) {
      const edge: DecisionEdge = {
        id: String(row.id),
        fromId: String(row.from_id),
        toId: String(row.to_id),
        relationType: String(row.relation_type) as DecisionEdge['relationType'],
        weight: Number(row.weight),
        createdAt: String(row.created_at),
        note: row.note ? String(row.note) : undefined,
      };
      this.localDb.insertEdge(edge);
      pulled++;
    }

    if (pulled > 0) {
      logger.info('TursoSync', `Pulled ${pulled} changes from remote`);
    }
    return pulled;
  }

  async sync(): Promise<{ pushed: number; pulled: number }> {
    this._assertConnected();
    this._setStatus({ isSyncing: true, lastError: null });

    try {
      const since = this._getLastSync();
      let pushed = 0;

      const localNodes = this.localDb.getAllNodes().filter(n => n.updatedAt > since);
      for (const node of localNodes) {
        await this.pushNode(node);
        pushed++;
      }

      const pulled = await this.pullChanges();
      const now = new Date().toISOString();
      this._saveLastSync(now);

      this._setStatus({
        isSyncing: false,
        lastSyncAt: new Date(now),
        pushed,
        pulled,
      });

      return { pushed, pulled };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._setStatus({ isSyncing: false, lastError: msg });
      logger.error('TursoSync', 'Sync failed', err);
      throw err;
    }
  }

  startPeriodicSync(intervalMs = 30_000): void {
    this.stopPeriodicSync();
    this.syncInterval = setInterval(() => {
      this.sync().catch(() => {});
    }, intervalMs);
    logger.info('TursoSync', `Periodic sync started (${intervalMs / 1000}s interval)`);
  }

  stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  private async _initRemoteSchema(): Promise<void> {
    await this.client!.batch(
      TURSO_SCHEMA_SQL.map(sql => ({ sql, args: [] })),
      'write',
    );
  }

  private _assertConnected(): void {
    if (!this.client) {
      throw new Error('TursoSync: Not connected. Call connect() first.');
    }
  }

  private _getLastSync(): string {
    return this.globalState.get<string>('codememory.lastSyncTimestamp') ?? '1970-01-01T00:00:00.000Z';
  }

  private _saveLastSync(ts: string): void {
    this.globalState.update('codememory.lastSyncTimestamp', ts);
  }

  private _setStatus(partial: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...partial };
    this._onSyncStatusChange.fire({ ...this.status });
  }

  dispose(): void {
    this.stopPeriodicSync();
    this.client?.close();
    this.client = null;
    this._onSyncStatusChange.dispose();
  }
}
