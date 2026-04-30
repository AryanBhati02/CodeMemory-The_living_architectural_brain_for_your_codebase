# ARCHITECTURE.md — CodeMemory Technical Architecture

## 1. System Overview

CodeMemory is a VS Code extension that stores architectural decisions in a local SQLite graph database and injects them into AI coding queries as contextual memory. The system runs entirely within the VS Code extension host process (TypeScript, Node.js), with a separate Worker thread for embedding computation. The database is a single-file SQLite store using an adjacency-list graph model. External AI providers (Claude, OpenAI, Gemini, Ollama) are accessed through a unified pipeline with two-layer prompt caching. An optional Turso cloud sync replicates the local graph for team collaboration. An MCP server process can expose the decision graph to external AI agents. No data leaves the developer's machine unless explicitly configured.

```
┌──────────────────────────────────────────────────────────────┐
│  VS Code Extension Host                                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐ │
│  │ Commands    │  │ Sidebar    │  │ Status Bar / Panels    │ │
│  └─────┬──────┘  └─────┬──────┘  └────────────┬───────────┘ │
│        │               │                      │              │
│  ┌─────▼───────────────▼──────────────────────▼───────────┐ │
│  │              DecisionService (CRUD + events)           │ │
│  └─────┬──────────────────────┬───────────────────────────┘ │
│        │                      │                              │
│  ┌─────▼──────┐    ┌─────────▼──────────────────────────┐  │
│  │ SQLite DB   │    │ AIPipeline                         │  │
│  │ (WAL mode)  │    │ ┌──────────┐  ┌────────────────┐  │  │
│  │ - nodes     │    │ │CacheEngine│  │ProviderManager │  │  │
│  │ - edges     │    │ │(SHA-256)  │  │(Claude/OpenAI/ │  │  │
│  │ - FTS5      │    │ └──────────┘  │ Gemini/Ollama) │  │  │
│  └─────────────┘    │               └────────────────┘  │  │
│                     └───────────────────────────────────┘  │
│  ┌──────────────┐    ┌───────────────────┐                  │
│  │ Worker Thread │    │ TursoSync (opt.)  │                  │
│  │ ONNX model   │    │ @libsql/client    │                  │
│  │ all-MiniLM   │    │ 30s periodic pull │                  │
│  └──────────────┘    └───────────────────┘                  │
└──────────────────────────────────────────────────────────────┘
```

## 2. Why SQLite + Adjacency-List Graph

**Why SQLite, not a vector database.** Pinecone, Weaviate, and Qdrant all require a running service — either a cloud endpoint or a local daemon. This violates two constraints: (1) CodeMemory must work offline with zero external dependencies, and (2) API keys and decision content must never leave the machine by default. SQLite is a single file (`<workspace>/.codecontext/graph.db`), requires no daemon, survives VS Code restarts without connection management, and ships with the `better-sqlite3` native addon already used across the Node.js ecosystem. It is also portable: the same schema runs on Turso with zero migration for team sync.

**Why adjacency list, not closure table.** Decision graphs are sparse. A workspace with 200 decisions might have 30–50 edges. Relationships are traversed at most 2 hops deep (e.g., "show me what this decision supersedes, and what *that* superseded"). An adjacency list handles this with two simple index scans (`idx_edges_from`, `idx_edges_to`). A closure table would pre-materialize all transitive paths, adding O(n²) insert overhead and denormalized rows that provide no benefit when the max traversal depth is 2. For a graph this sparse, adjacency list gives O(1) inserts and O(degree) reads.

**Why WAL mode.** The embedding worker writes embedding BLOBs asynchronously while the main thread reads decisions for sidebar rendering and AI queries. Without WAL, these would serialize on the database lock. WAL (`PRAGMA journal_mode = WAL`) allows concurrent readers with a single writer. The remaining PRAGMAs:

| PRAGMA | Value | Reason |
|---|---|---|
| `synchronous` | `NORMAL` | Acceptable durability trade-off for a local cache; full sync on every write is unnecessarily slow |
| `foreign_keys` | `ON` | Edge deletion cascades when a node is removed — referential integrity enforced at the DB level |
| `temp_store` | `MEMORY` | Temp tables in RAM (faster sorts/joins), fine for a single-user workload |
| `mmap_size` | `134217728` | 128 MB memory-mapped I/O — avoids syscall overhead for a DB that fits in RAM |

## 3. Why Hybrid FTS5 + Embeddings

FTS5 and semantic embeddings each fail in complementary ways.

**Where FTS5 fails:** A user asks "Why don't we use Axios?" The decision is titled "Use fetch not axios." FTS5 matches "axios" but a query like "HTTP client library choice" returns nothing — there is no lexical overlap. This is the vocabulary gap problem. FTS5 cannot bridge synonyms or rephrasings.

**Where embeddings fail:** A user asks "What's the cacheTtlSeconds default?" The `all-MiniLM-L6-v2` model produces a semantically reasonable vector, but a decision titled "Cache TTL configuration" with the exact string `cacheTtlSeconds` in its rationale ranks lower than a decision about "caching strategy" whose embedding is semantically closer. Embeddings lose exact keyword anchoring.

**Why Reciprocal Rank Fusion.** RRF combines ranked lists from different retrieval systems without requiring score calibration. The formula is: `score(d) = Σ 1 / (k + rank_i(d))` with `k = 60` (from Cormack, Clarke & Büttcher, 2009). Unlike linear combination (`α * semantic_score + (1-α) * keyword_score`), RRF does not need the two score distributions to be on the same scale. FTS5 returns no score at all in contentless mode — only a rank order. Embedding cosine similarity ranges from 0 to 1. Linear combination would require normalizing two incomparable scales. RRF sidesteps this entirely.

**Implementation:** Both arms retrieve the top 20 candidates. RRF fuses by summing `1/(rank + 60)` per arm. Results that appear in both arms get boosted. The fused list is truncated to the requested limit (default 10). If the embedding worker is unavailable, the system degrades to FTS5-only.

## 4. Why a Worker Thread for Embeddings

The `@xenova/transformers` library loads the `all-MiniLM-L6-v2` ONNX model (~23 MB quantized). Model initialization takes 1–3 seconds. Each embedding inference takes 50–200 ms depending on text length. Running this on the extension host thread would freeze the VS Code editor during every decision save and every search query.

Node.js `Worker` threads provide true thread-level isolation with a separate V8 isolate. The worker loads the model once on startup, then serves `embed` and `embed-text` requests via `postMessage`. The main thread enqueues jobs asynchronously — `enqueue()` returns a Promise that resolves when the worker posts back the result. The embedding BLOB is written to SQLite by the main thread (not the worker) to avoid cross-thread database access.

**Crash recovery:** If the worker process exits with a non-zero code (OOM, ONNX runtime crash), the `EmbeddingQueue` drains all pending jobs by rejecting their Promises, then respawns the worker after a 5-second delay. This delay prevents a crash loop from consuming CPU. Decisions created during the downtime save successfully with `embedding = NULL` — the backfill scheduler runs on startup and picks up any un-embedded nodes, so recovery is automatic.

**Graceful degradation:** If the worker never starts (missing ONNX runtime, unsupported platform), all embedding-dependent features (semantic search, drift detection) degrade silently. FTS5 keyword search still works. No error dialogs are shown.

## 5. Two-Layer Prompt Caching

**Layer 1: Application-level (CacheEngine).** The system prompt is built by `PromptBuilder` from the current decision graph state. This involves serializing all relevant decisions into a structured text block. `CacheEngine` stores the rendered system prompt string in memory, keyed by `SHA-256(decision_id:updated_at|...)` concatenated with `providerId`. Default TTL is 300 seconds. On cache hit, the pipeline skips prompt building entirely and re-uses the byte-identical string.

**Layer 2: Anthropic server-side (cache_control: ephemeral).** Claude's API caches prompt prefixes that are byte-identical across requests within a 5-minute window. Cache-read tokens cost $0.30/M vs $3.00/M for regular input — a 10× reduction. Layer 1 is designed specifically to guarantee byte-for-byte identical system prompts: same decision set + same provider → same string. Without Layer 1, minor serialization differences (floating point formatting, key ordering) would break Layer 2 hits.

**Invalidation triggers:** Three events flush the Layer 1 cache: (1) any graph mutation (insert/update/delete fires `invalidateCache`), (2) provider switch (different providers may need different prompt formats), (3) TTL expiry. The 300-second TTL is aligned with Anthropic's server-side cache window.

**Cost math for a typical session:** A system prompt with 50 decisions is ~4,000 tokens. 20 queries in a session: first query pays full input ($0.012), next 19 hit cache at $0.30/M ($0.0228 total vs $0.228 without caching). Net savings: ~$0.19 per session, or roughly 90% reduction in system prompt costs.

## 6. Provider Abstraction Design

The `IAIProvider` interface defines the contract: `id`, `name`, `capabilities`, `validateKey`, `generateResponse`, `streamResponse`. Five implementations exist: `ClaudeProvider`, `OpenAIProvider`, `GeminiProvider`, `OllamaProvider`, `OpenAICompatProvider`.

**Why `validateKey` is synchronous.** It performs a format-only check (e.g., Claude keys start with `sk-ant-`, OpenAI keys start with `sk-`). Network validation — actually calling the API with the key — is a UI-layer concern handled by the Provider Drawer, not the interface contract. Making `validateKey` async would force callers to await a network round-trip just to render a form validation error.

**Why `apiKey` is injected per-request.** API keys are stored in VS Code's OS keychain via `SecretStorage`. The pipeline fetches the key from `SecretStorageService` immediately before dispatching each request. Provider instances never hold key state. This means a leaked provider object reveals zero credentials. It also allows key rotation without restarting the extension.

**Adding a new provider:** Create a single file implementing `IAIProvider` (e.g., `MistralProvider.ts`) and add one line in `ProviderManager.registerDefaults()`. Zero changes to the pipeline, cache, commands, or UI.

**How Ollama differs.** Ollama uses NDJSON streaming (one JSON object per line) instead of SSE. It requires no API key (runs locally). The `OllamaProvider` sets `validateKey` to always return `{ valid: true }` and parses the NDJSON stream in `streamResponse` instead of standard SSE event parsing.

## 7. Known Limitations

**Linear-scan semantic search.** The `SemanticRanker` stores all embeddings in a flat array and computes cosine similarity against every entry on each query. This is O(n) per query. For the expected workload (< 5,000 decisions per workspace), this takes under 5 ms. At 50,000+ decisions, this will become a bottleneck.

**Drift detection is a proxy.** The `DriftDetector` computes cosine similarity between a saved file's embedding and linked constraint decisions. A similarity score below 0.65 triggers a warning. This measures semantic distance, not actual constraint violation. Code can drift semantically (different topic) without violating a constraint, or violate a constraint while remaining semantically similar.

**Stuck detection is time-based.** The `StuckDetector` fires when a user stays on a single file for an extended period. It has no signal for actual frustration — a developer reading a complex file carefully looks identical to one who is stuck. False positive rate depends heavily on the threshold setting.

**Worker crash loses pending jobs.** When the embedding worker exits abnormally, all in-flight jobs are rejected with an error. The decisions themselves are already persisted (embedding is nullable), and the backfill scheduler picks them up on next startup, but there is a window where embedding data is unavailable.

**RRF k=60 is empirical.** The fusion constant `k=60` comes from Cormack et al. (2009), a general information retrieval paper. It was not tuned on architectural decision data. A domain-specific k value might improve precision, but the current value performs well enough that tuning is low priority.

## 8. What Changes at 10× Scale

| Current (< 1K decisions) | 10× scale (10K+ decisions) |
|---|---|
| In-memory flat array + O(n) cosine | `hnswlib-node` for approximate nearest neighbor search — O(log n) queries |
| `setInterval` embedding backfill | Persistent job queue (BullMQ or SQLite-backed) with progress tracking |
| Local-only SQLite | Turso cloud sync (already implemented — schema is portable by design) |
| Fixed 0.65 cosine threshold for drift | Trained threshold from labelled violation dataset using logistic regression |
| Single-process MCP server | Horizontally scaled MCP server behind a load balancer for team-wide access |
| SHA-256 graph hash for cache key | Incremental hash (Merkle tree over decision nodes) to avoid O(n) hash computation |
