/**
 * CodeMemory — Retrieval Quality Benchmark
 *
 * Measures precision@1, @3, @5 for FTS5-only search against a set of
 * manually curated question–decision pairs.
 *
 * Usage:  npx ts-node --skip-project scripts/benchmark.ts
 *         npm run benchmark
 *
 * The script opens the workspace graph.db directly via better-sqlite3
 * (no VS Code APIs) and re-uses the production SQL queries verbatim.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

// ─── Types (mirrored from graph/types.ts — no import to avoid rootDir issues) ─

interface DecisionPayload {
  title: string;
  rationale: string;
  type: string;
  status: string;
  filePaths: string[];
  tags: string[];
  codeContext?: string;
  lineNumber?: number;
}

interface DecisionNode {
  id: string;
  type: 'decision';
  payload: DecisionPayload;
  embedding: Float32Array | null;
  createdAt: string;
  updatedAt: string;
  authorName: string;
  authorEmail: string;
}

interface NodeRow {
  id: string; type: string; payload: string; embedding: Buffer | null;
  created_at: string; updated_at: string; author_name: string; author_email: string;
}

// ─── SemanticRanker (inlined — small enough, avoids import path issues) ───────

class SemanticRanker {
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

// ─── Test Dataset ─────────────────────────────────────────────────────────────

interface TestCase { question: string; groundTruthTitle: string; }

const TEST_CASES: TestCase[] = [
  // IAIProvider interface & provider patterns
  { question: "How do providers validate their API keys?",                    groundTruthTitle: "IAIProvider interface" },
  { question: "Where is the provider abstraction defined?",                  groundTruthTitle: "IAIProvider interface" },
  { question: "How do we inject API keys per request?",                      groundTruthTitle: "IAIProvider interface" },
  { question: "What does the retryable flag on AIProviderError do?",         groundTruthTitle: "IAIProvider interface" },

  // ProviderManager
  { question: "Is ProviderManager a singleton?",                             groundTruthTitle: "ProviderManager singleton" },
  { question: "Does ProviderManager depend on VS Code?",                     groundTruthTitle: "ProviderManager singleton" },
  { question: "How do we switch AI providers at runtime?",                   groundTruthTitle: "ProviderManager singleton" },

  // AIPipeline
  { question: "What is the single entry point for all AI queries?",          groundTruthTitle: "AIPipeline single entry point" },
  { question: "How does the two-layer cache work?",                          groundTruthTitle: "AIPipeline single entry point" },
  { question: "Can I call a provider directly?",                             groundTruthTitle: "AIPipeline single entry point" },

  // EventBus
  { question: "How are graph changes decoupled from cache invalidation?",    groundTruthTitle: "EventBus decouples graph changes" },
  { question: "What event bus pattern is used?",                             groundTruthTitle: "EventBus decouples graph changes" },

  // Embedding worker
  { question: "Do embeddings block the main thread?",                        groundTruthTitle: "Embeddings in Worker thread" },
  { question: "How does the embedding queue work?",                          groundTruthTitle: "Embeddings in Worker thread" },
  { question: "What happens if the embedding worker crashes?",               groundTruthTitle: "Embeddings in Worker thread" },

  // graph/types.ts
  { question: "Where is the domain model defined?",                          groundTruthTitle: "graph/types.ts single source of truth" },
  { question: "Should I create types in my own file?",                       groundTruthTitle: "graph/types.ts single source of truth" },
  { question: "Where do DecisionNode and DecisionEdge live?",                groundTruthTitle: "graph/types.ts single source of truth" },

  // SecretStorage
  { question: "How are API keys stored securely?",                           groundTruthTitle: "SecretStorage for API keys" },
  { question: "Where do we persist provider credentials?",                   groundTruthTitle: "SecretStorage for API keys" },

  // Decision types
  { question: "What decision types are available?",                          groundTruthTitle: "Decision types" },
  { question: "What is the difference between pattern and convention?",      groundTruthTitle: "Decision types" },
  { question: "When should I use a constraint vs a convention?",             groundTruthTitle: "Decision types" },

  // SQLite WAL
  { question: "What journal mode does the database use?",                    groundTruthTitle: "SQLite WAL mode" },
  { question: "How does the database handle concurrent reads?",              groundTruthTitle: "SQLite WAL mode" },

  // FTS5
  { question: "How does full-text search work?",                             groundTruthTitle: "FTS5 full-text search" },
  { question: "What columns are indexed for search?",                        groundTruthTitle: "FTS5 full-text search" },

  // Adjacency-list graph
  { question: "How are decision relationships stored?",                      groundTruthTitle: "Adjacency-list graph model" },
  { question: "What edge types can link two decisions?",                     groundTruthTitle: "Adjacency-list graph model" },

  // Decision status lifecycle
  { question: "What statuses can a decision have?",                          groundTruthTitle: "Decision status lifecycle" },
  { question: "What happens when a decision is superseded?",                 groundTruthTitle: "Decision status lifecycle" },

  // DecisionService
  { question: "Where is decision CRUD handled?",                             groundTruthTitle: "DecisionService CRUD" },
  { question: "How are embedding jobs enqueued after creating a decision?",  groundTruthTitle: "DecisionService CRUD" },

  // Hybrid search (RRF)
  { question: "How does hybrid search combine semantic and keyword results?", groundTruthTitle: "Hybrid search RRF" },
  { question: "What is Reciprocal Rank Fusion?",                             groundTruthTitle: "Hybrid search RRF" },

  // Cache invalidation
  { question: "When is the AI prompt cache invalidated?",                    groundTruthTitle: "Cache invalidation on graph mutation" },
  { question: "Does switching providers clear the cache?",                   groundTruthTitle: "Cache invalidation on graph mutation" },

  // Stuck detector
  { question: "How does proactive stuck detection work?",                    groundTruthTitle: "Proactive stuck detector" },
  { question: "What happens when I stay on a file too long?",                groundTruthTitle: "Proactive stuck detector" },

  // Drift detector
  { question: "How does drift detection flag constraint violations?",        groundTruthTitle: "Drift detection for constraints" },
  { question: "What is the cosine similarity threshold for drift?",          groundTruthTitle: "Drift detection for constraints" },

  // DI wiring / activation
  { question: "What order are services initialized in?",                     groundTruthTitle: "Activation order DI wiring" },
  { question: "How is dependency injection handled in the extension?",       groundTruthTitle: "Activation order DI wiring" },

  // Status bar
  { question: "What does the status bar show?",                              groundTruthTitle: "Status bar decision count" },
  { question: "How does the status bar update on embedding progress?",       groundTruthTitle: "Status bar decision count" },

  // AI auto-tagging
  { question: "How does the capture command suggest tags automatically?",    groundTruthTitle: "AI auto-tagging on capture" },
  { question: "What prompt does auto-tagging use?",                          groundTruthTitle: "AI auto-tagging on capture" },

  // Token dashboard
  { question: "Where can I see token usage and cost estimates?",             groundTruthTitle: "Token usage dashboard" },
  { question: "How are API costs tracked per session?",                      groundTruthTitle: "Token usage dashboard" },
];

// ─── Database Helpers (mirrored from src/db/database.ts) ──────────────────────

function deserializeNode(row: NodeRow): DecisionNode {
  return {
    id: row.id, type: 'decision',
    payload: JSON.parse(row.payload),
    embedding: row.embedding ? new Float32Array(row.embedding.buffer) : null,
    createdAt: row.created_at, updatedAt: row.updated_at,
    authorName: row.author_name, authorEmail: row.author_email,
  };
}

function getAllNodes(db: Database.Database): DecisionNode[] {
  return (db.prepare(`SELECT * FROM nodes ORDER BY updated_at DESC`).all() as NodeRow[]).map(deserializeNode);
}

function searchNodesFts(db: Database.Database, query: string, limit = 20): DecisionNode[] {
  const safe = query.replace(/['"*]/g, ' ').trim();
  if (!safe) return getAllNodes(db).slice(0, limit);
  return (db.prepare(`
    SELECT * FROM nodes WHERE rowid IN (
      SELECT rowid FROM nodes_fts WHERE nodes_fts MATCH ?
    ) LIMIT ?
  `).all(`${safe}*`, limit) as NodeRow[]).map(deserializeNode);
}

function getEmbeddedNodes(db: Database.Database): Array<{ id: string; embedding: Float32Array }> {
  return (db.prepare(`SELECT id,embedding FROM nodes WHERE embedding IS NOT NULL`).all() as Array<{ id: string; embedding: Buffer }>)
    .map(r => ({ id: r.id, embedding: new Float32Array(r.embedding.buffer) }));
}

// ─── Precision Calculation ────────────────────────────────────────────────────

interface PrecisionResult {
  p1: number; p3: number; p5: number;
  failures: Array<{ question: string; expected: string; got: string[] }>;
}

function evaluate(
  allNodes: DecisionNode[],
  searchFn: (question: string) => DecisionNode[],
): PrecisionResult {
  let hits1 = 0, hits3 = 0, hits5 = 0;
  const failures: PrecisionResult['failures'] = [];

  for (const tc of TEST_CASES) {
    const results = searchFn(tc.question);
    const titles = results.map(n => n.payload.title);

    const matchesTitle = (t: string) =>
      t.toLowerCase().includes(tc.groundTruthTitle.toLowerCase()) ||
      tc.groundTruthTitle.toLowerCase().includes(t.toLowerCase());

    if (titles.slice(0, 1).some(matchesTitle)) hits1++;
    if (titles.slice(0, 3).some(matchesTitle)) hits3++;
    if (titles.slice(0, 5).some(matchesTitle)) hits5++;

    if (!titles.slice(0, 3).some(matchesTitle)) {
      failures.push({
        question: tc.question,
        expected: tc.groundTruthTitle,
        got: titles.slice(0, 3),
      });
    }
  }

  const n = TEST_CASES.length;
  return {
    p1: (hits1 / n) * 100,
    p3: (hits3 / n) * 100,
    p5: (hits5 / n) * 100,
    failures,
  };
}

// ─── RRF Hybrid (FTS5 + semantic, no worker needed) ───────────────────────────

function hybridSearch(
  db: Database.Database,
  ranker: SemanticRanker,
  allNodes: DecisionNode[],
  question: string,
  queryEmbedding: Float32Array | null,
  limit = 10,
): DecisionNode[] {
  const scores = new Map<string, number>();

  // Semantic arm
  if (queryEmbedding && ranker.size > 0) {
    const semanticIds = ranker.rank(queryEmbedding, 20).map(r => r.id);
    semanticIds.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (i + 60)));
  }

  // Keyword arm
  const keywordIds = searchNodesFts(db, question, 20).map(n => n.id);
  keywordIds.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (i + 60)));

  const rankedIds = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);

  const nodeMap = new Map(allNodes.map(n => [n.id, n]));
  return rankedIds.map(id => nodeMap.get(id)!).filter(Boolean);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const dbPath = path.resolve(process.cwd(), '.codecontext', 'graph.db');
  if (!fs.existsSync(dbPath)) {
    console.error(`❌  Database not found: ${dbPath}`);
    console.error(`    Run this script from the workspace root that has a .codecontext/graph.db`);
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: true });
  const allNodes = getAllNodes(db);
  console.log(`\n📊  CodeMemory Retrieval Benchmark`);
  console.log(`    Database: ${dbPath}`);
  console.log(`    Decisions loaded: ${allNodes.length}`);
  console.log(`    Test cases: ${TEST_CASES.length}\n`);

  if (!allNodes.length) {
    console.error(`❌  No decisions in database — nothing to benchmark.`);
    db.close();
    process.exit(1);
  }

  // Load semantic index
  const ranker = new SemanticRanker();
  const embedded = getEmbeddedNodes(db);
  ranker.updateIndex(embedded);
  console.log(`    Embedded nodes: ${embedded.length}/${allNodes.length}`);
  console.log(`${'─'.repeat(60)}\n`);

  // ── FTS5-only evaluation ──
  const fts = evaluate(allNodes, (q) => searchNodesFts(db, q, 10));
  console.log(`FTS5-only:   precision@1=${fts.p1.toFixed(1)}%  @3=${fts.p3.toFixed(1)}%  @5=${fts.p5.toFixed(1)}%`);

  // ── Hybrid RRF evaluation (keyword-only since we can't embed queries without the worker) ──
  const hybrid = evaluate(allNodes, (q) => hybridSearch(db, ranker, allNodes, q, null, 10));
  console.log(`Hybrid RRF:  precision@1=${hybrid.p1.toFixed(1)}%  @3=${hybrid.p3.toFixed(1)}%  @5=${hybrid.p5.toFixed(1)}%`);
  console.log(`             (semantic arm disabled — no embedding worker in standalone mode)`);

  // ── Failure analysis ──
  const allFailures = new Map<string, { expected: string; got: string[] }>();
  for (const f of fts.failures) allFailures.set(f.question, f);
  for (const f of hybrid.failures) allFailures.set(f.question, f);

  if (allFailures.size) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`\n❌ Failure analysis (${allFailures.size} questions missed in top 3):\n`);
    let i = 0;
    for (const [question, { expected, got }] of allFailures) {
      i++;
      console.log(`  ${i}. "${question}"`);
      console.log(`     Expected: "${expected}"`);
      console.log(`     Got top 3: ${got.length ? got.map(t => `"${t}"`).join(', ') : '(no results)'}`);
      console.log();
    }
  } else {
    console.log(`\n✅ All test cases matched in top 3!`);
  }

  // ── Per-type breakdown ──
  const types = [...new Set(allNodes.map(n => n.payload.type))];
  if (types.length > 1) {
    console.log(`${'─'.repeat(60)}`);
    console.log(`\nDecision breakdown:`);
    for (const t of types) {
      const count = allNodes.filter(n => n.payload.type === t).length;
      console.log(`  ${t}: ${count}`);
    }
  }

  console.log();
  db.close();
}

main();
