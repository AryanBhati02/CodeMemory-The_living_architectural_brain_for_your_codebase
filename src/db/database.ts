
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import type { DecisionNode, DecisionEdge, GraphStats, DecisionType, DecisionStatus } from '../graph/types';



const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 134217728;

CREATE TABLE IF NOT EXISTS nodes (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL DEFAULT 'decision',
  payload      TEXT NOT NULL,
  embedding    BLOB,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  author_name  TEXT NOT NULL DEFAULT '',
  author_email TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS edges (
  id            TEXT PRIMARY KEY,
  from_id       TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  to_id         TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  weight        REAL NOT NULL DEFAULT 1.0,
  created_at    TEXT NOT NULL,
  note          TEXT
);

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_type    ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_updated ON nodes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_nodes_has_emb ON nodes(id) WHERE embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_edges_from    ON edges(from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to      ON edges(to_id);

-- Contentless FTS5: text is indexed but not stored (smaller DB).
-- rowid is pinned to nodes.rowid so MATCH queries can join back via rowid.
-- contentless_delete=1 enables rowid-based DELETE on the contentless table.
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  id UNINDEXED, title, rationale, tags,
  content='', contentless_delete=1
);

CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO nodes_fts(rowid, id, title, rationale, tags)
  VALUES (new.rowid, new.id, json_extract(new.payload,'$.title'), json_extract(new.payload,'$.rationale'), json_extract(new.payload,'$.tags'));
END;

CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
  DELETE FROM nodes_fts WHERE rowid = old.rowid;
  INSERT INTO nodes_fts(rowid, id, title, rationale, tags)
  VALUES (new.rowid, new.id, json_extract(new.payload,'$.title'), json_extract(new.payload,'$.rationale'), json_extract(new.payload,'$.tags'));
END;

CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
  DELETE FROM nodes_fts WHERE rowid = old.rowid;
END;
`;

const SCHEMA_VERSION = '1';

interface NodeRow {
  id: string; type: string; payload: string; embedding: Buffer | null;
  created_at: string; updated_at: string; author_name: string; author_email: string;
}
interface EdgeRow {
  id: string; from_id: string; to_id: string; relation_type: string;
  weight: number; created_at: string; note: string | null;
}
interface CountRow { c: number }
interface TypeGroupRow  { t: string; c: number }
interface StatusGroupRow { s: string; c: number }

export class CodeMemoryDatabase {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this._initialize();
  }

  private _initialize(): void {
    this.db.exec(SCHEMA_SQL);
    const v = this.db.prepare("SELECT value FROM schema_meta WHERE key='version'").get() as { value: string } | undefined;
    if (!v) this.db.prepare("INSERT INTO schema_meta(key,value) VALUES('version',?)").run(SCHEMA_VERSION);
  }



      insertNode(node: DecisionNode): void {
    this.db.prepare(`
      INSERT INTO nodes (id,type,payload,embedding,created_at,updated_at,author_name,author_email)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(
      node.id, node.type, JSON.stringify(node.payload),
      node.embedding ? Buffer.from(node.embedding.buffer) : null,
      node.createdAt, node.updatedAt, node.authorName, node.authorEmail
    );
  }

    updateNode(id: string, payload: DecisionNode['payload'], updatedAt: string): void {
    this.db.prepare(`UPDATE nodes SET payload=?,updated_at=? WHERE id=?`).run(JSON.stringify(payload), updatedAt, id);
  }

    updateNodeEmbedding(id: string, embedding: Float32Array): void {
    this.db.prepare(`UPDATE nodes SET embedding=? WHERE id=?`).run(Buffer.from(embedding.buffer), id);
  }

    deleteNode(id: string): void {
    this.db.prepare(`DELETE FROM nodes WHERE id=?`).run(id);
  }

    getNodeById(id: string): DecisionNode | undefined {
    const row = this.db.prepare(`SELECT * FROM nodes WHERE id=?`).get(id) as NodeRow | undefined;
    return row ? this._deserializeNode(row) : undefined;
  }

    getAllNodes(): DecisionNode[] {
    return (this.db.prepare(`SELECT * FROM nodes ORDER BY updated_at DESC`).all() as NodeRow[]).map(r => this._deserializeNode(r));
  }

    getUnembeddedNodes(): DecisionNode[] {
    return (this.db.prepare(`SELECT * FROM nodes WHERE embedding IS NULL ORDER BY created_at ASC`).all() as NodeRow[]).map(r => this._deserializeNode(r));
  }

    searchNodesFts(query: string, limit = 20): DecisionNode[] {
    const safe = query.replace(/['\"*]/g, ' ').trim();
    if (!safe) return this.getAllNodes().slice(0, limit);



    return (this.db.prepare(`
      SELECT * FROM nodes WHERE rowid IN (
        SELECT rowid FROM nodes_fts WHERE nodes_fts MATCH ?
      ) LIMIT ?
    `).all(`${safe}*`, limit) as NodeRow[]).map(r => this._deserializeNode(r));
  }


  getEmbeddedNodes(): Array<{ id: string; embedding: Float32Array }> {
    return (this.db.prepare(`SELECT id,embedding FROM nodes WHERE embedding IS NOT NULL`).all() as Array<{ id: string; embedding: Buffer }>)
      .map(r => ({ id: r.id, embedding: new Float32Array(r.embedding.buffer) }));
  }


  getNodesByIds(ids: string[]): DecisionNode[] {
    if (!ids.length) return [];
    const ph = ids.map(() => '?').join(',');
    return (this.db.prepare(`SELECT * FROM nodes WHERE id IN (${ph})`).all(...ids) as NodeRow[]).map(r => this._deserializeNode(r));
  }




  insertEdge(edge: DecisionEdge): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO edges (id,from_id,to_id,relation_type,weight,created_at,note)
      VALUES (?,?,?,?,?,?,?)
    `).run(edge.id, edge.fromId, edge.toId, edge.relationType, edge.weight, edge.createdAt, edge.note ?? null);
  }


  deleteEdge(id: string): void {
    this.db.prepare(`DELETE FROM edges WHERE id=?`).run(id);
  }


  getEdgesForNode(nodeId: string): DecisionEdge[] {
    return (this.db.prepare(`SELECT * FROM edges WHERE from_id=? OR to_id=?`).all(nodeId, nodeId) as EdgeRow[]).map(r => this._deserializeEdge(r));
  }


  getAllEdges(): DecisionEdge[] {
    return (this.db.prepare(`SELECT * FROM edges`).all() as EdgeRow[]).map(r => this._deserializeEdge(r));
  }




  getStats(): GraphStats {
    const total          = (this.db.prepare(`SELECT COUNT(*) as c FROM nodes`).get() as CountRow).c;
    const totalEdges     = (this.db.prepare(`SELECT COUNT(*) as c FROM edges`).get() as CountRow).c;
    const embeddingsReady = (this.db.prepare(`SELECT COUNT(*) as c FROM nodes WHERE embedding IS NOT NULL`).get() as CountRow).c;

    const typeRows   = this.db.prepare(`SELECT json_extract(payload,'$.type') as t, COUNT(*) as c FROM nodes GROUP BY t`).all() as TypeGroupRow[];
    const statusRows = this.db.prepare(`SELECT json_extract(payload,'$.status') as s, COUNT(*) as c FROM nodes GROUP BY s`).all() as StatusGroupRow[];

    const byType: Record<DecisionType, number> = { pattern: 0, constraint: 0, convention: 0, why: 0 };
    for (const r of typeRows) if (r.t in byType) byType[r.t as DecisionType] = r.c;

    const byStatus: Record<DecisionStatus, number> = { proposed: 0, accepted: 0, deprecated: 0, superseded: 0 };
    for (const r of statusRows) if (r.s in byStatus) byStatus[r.s as DecisionStatus] = r.c;

    return { totalDecisions: total, byType, byStatus, totalEdges, embeddingsReady };
  }

    transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

    close(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    this.db.close();
  }

  private _deserializeNode(row: NodeRow): DecisionNode {
    return {
      id: row.id, type: 'decision',
      payload: JSON.parse(row.payload),
      embedding: row.embedding ? new Float32Array(row.embedding.buffer) : null,
      createdAt: row.created_at, updatedAt: row.updated_at,
      authorName: row.author_name, authorEmail: row.author_email,
    };
  }

  private _deserializeEdge(row: EdgeRow): DecisionEdge {
    return {
      id: row.id, fromId: row.from_id, toId: row.to_id,
      relationType: row.relation_type as DecisionEdge['relationType'],
      weight: row.weight, createdAt: row.created_at,
      note: row.note ?? undefined,
    };
  }
}
