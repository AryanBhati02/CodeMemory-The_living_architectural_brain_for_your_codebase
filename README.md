# CodeMemory

![VS Code](https://img.shields.io/badge/VS_CODE-007ACC?style=for-the-badge&logo=visual-studio-code&logoColor=white) ![TypeScript](https://img.shields.io/badge/TYPESCRIPT-3178C6?style=for-the-badge&logo=typescript&logoColor=white) ![Min VS Code](https://img.shields.io/badge/MIN_VS_CODE-1.85.0-0088cc?style=for-the-badge) ![Database](https://img.shields.io/badge/DATABASE-SQLITE-003B57?style=for-the-badge&logo=sqlite&logoColor=white) ![Version](https://img.shields.io/badge/VERSION-0.1.0-ff8800?style=for-the-badge)

<!-- Record: capture decision → gutter icon → ask AI streaming → stuck detection fires → drift warning → graph visualization -->
![CodeMemory Demo](assets/demo.gif)

> **The living architectural brain for your codebase — persistent decisions, universal AI, hybrid semantic search.**

---

| Metric | Value |
|---|---|
| **Hybrid search precision@3** | 78% hybrid vs 61% keyword-only |
| **Providers supported** | 7 (Claude, OpenAI, Gemini, Ollama, Groq, LM Studio, Together AI) |
| **Embeddings** | 100% local — `all-MiniLM-L6-v2` via ONNX Worker thread |
| **Storage** | Local SQLite per workspace (`.codecontext/graph.db`) |
| **Team sync** | Optional Turso cloud replication |

## Installation

```
1. VS Code Marketplace → search "CodeMemory" → Install
2. Open a workspace → Ctrl+Shift+P → "CodeMemory: Select AI Provider"
```

That's it. No config files, no Docker, no database setup. The SQLite database and embedding index are created automatically on first use.

## Features

### Decision Capture

Right-click any code selection or press `Ctrl+Shift+Alt+D`. CodeMemory walks you through a 4-step flow:

1. **Title** — what was decided
2. **Rationale** — why this approach was chosen
3. **Type** — AI auto-suggests: `pattern` · `constraint` · `convention` · `why`
4. **Tags** — AI auto-suggests 3–5 relevant tags

Decisions are persisted in a local SQLite graph database and embedded for semantic search in the background.

### AI-Grounded Queries

Press `Ctrl+Shift+Alt+A` to ask your AI about the codebase. Every query is enriched with relevant decisions from your graph — the AI always knows *why* your code is structured the way it is. Responses stream in real-time.

### Hybrid Semantic Search

Combines FTS5 keyword search with cosine-similarity embedding search via Reciprocal Rank Fusion (k=60). Bridges the vocabulary gap — finds "Use fetch not axios" when you search "HTTP client library choice."

### Proactive Detection

| Detector | Trigger | Signal |
|---|---|---|
| **Stuck Detection** | 8+ minutes on one file | Notification with relevant decisions |
| **Constraint Drift** | File save | VS Code diagnostic warning when code diverges from linked constraints |

### Sidebar & Decorations

- **TreeView** grouped by type (pattern / constraint / convention / why)
- **Gutter icons** on lines linked to decisions
- **Detail panel** with full rationale, metadata, and linked decisions

### Graph Visualization

Interactive D3 force-directed graph of all decisions and their relationships. Click any node to open its detail panel.

### Git Archaeology

Run `CodeMemory: Discover Decisions from Git History` to scan your last 200 commits. AI extracts architectural decisions from commit messages containing reasoning keywords. Multi-select and import in one flow.

### Team Sync (Turso)

Replicate your decision graph to a shared Turso database. Last-write-wins conflict resolution. Embeddings regenerated locally on each machine. Configure via `CodeMemory: Configure Team Sync`.

### MCP Server

Expose your decision graph to external AI agents (Claude Code, Cursor) via the Model Context Protocol. See [`mcp-server/README.md`](./mcp-server/README.md).

## Provider Support

| Provider | Type | Key Required | Default Model | Notes |
|---|---|---|---|---|
| Claude (Anthropic) | Cloud | Yes | `claude-sonnet-4-20250514` | Prompt caching, extended thinking |
| OpenAI | Cloud | Yes | `gpt-4.1` | Function calling, streaming |
| Gemini (Google) | Cloud | Yes | `gemini-1.5-pro` | 1M token context window |
| Ollama | Local | No | `llama3.2` | NDJSON streaming, any local model |
| LM Studio | Local | No | `local-model` | Any GGUF model via OpenAI-compat API |
| Groq | Cloud | Yes | `llama-3.3-70b-versatile` | Ultra-fast inference |
| Together AI | Cloud | Yes | `Llama-3.3-70B-Instruct-Turbo` | Open model hosting at scale |

All providers implement the same `IAIProvider` interface. Adding a new provider = one file + one line in `ProviderManager`.

## Commands

| Command | Shortcut | Description |
|---|---|---|
| **Capture Decision** | `Ctrl+Shift+Alt+D` | Capture a new architectural decision with AI auto-tagging |
| **Ask AI About Codebase** | `Ctrl+Shift+Alt+A` | AI query grounded in your decision graph |
| **Search Decisions** | — | Full-text + semantic hybrid search |
| **Select AI Provider** | — | Open provider selector + API key management |
| **Quick Switch AI Provider** | `Ctrl+Shift+Alt+P` | Quick-pick provider switcher |
| **Open Token Usage Dashboard** | — | Real-time token usage, cost tracking, cache stats |
| **Open Decision Graph** | — | Interactive D3 graph visualization |
| **Discover from Git History** | — | AI-extract decisions from git commits |
| **Configure Team Sync** | — | Set up Turso cloud sync |
| **Sync Now** | — | Trigger immediate sync cycle |
| **Edit Decision** | — | Edit title, rationale, type, tags (sidebar context menu) |
| **Delete Decision** | — | Remove decision and cascade-delete edges |
| **Link to...** | — | Create typed edges between decisions |
| **Export Decisions** | — | Export full graph to JSON |
| **Import Decisions** | — | Import decisions from JSON |
| **Refresh Sidebar** | — | Force-refresh the decision tree |

## Configuration

| Setting | Type | Default | Description |
|---|---|---|---|
| `codememory.activeProviderId` | string | `claude` | Active AI provider |
| `codememory.maxDecisionsPerQuery` | number | `10` | Max decisions injected per AI prompt |
| `codememory.cacheTtlSeconds` | number | `300` | Prompt cache TTL (aligned with Anthropic's 5-min window) |
| `codememory.stuckDetectorEnabled` | boolean | `true` | Proactive stuck detection |
| `codememory.driftDetectorEnabled` | boolean | `true` | Constraint drift detection on save |
| `codememory.tursoUrl` | string | `""` | Turso database URL for team sync |
| `codememory.syncEnabled` | boolean | `false` | Enable periodic Turso sync |

## Architecture

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for full design decisions and tradeoffs, including:

- Why SQLite + adjacency list over a dedicated vector DB
- Why hybrid FTS5 + embeddings (not just one)
- Why a Worker thread for embeddings
- Two-layer prompt caching cost math
- Known limitations and 10× scale plan

## Development

```bash
# Install dependencies
npm install

# Build all entry points (extension + worker + MCP server)
npm run compile

# Watch mode
npm run watch

# Run tests
npm test

# Run retrieval benchmark
npm run benchmark

# Launch Extension Development Host
# Press F5 in VS Code
```

### Project Structure

```
src/
├── extension.ts              ← 17-step DI activation
├── ai/providers/             ← IAIProvider + 5 implementations
├── ai/pipeline/              ← AIPipeline + PromptBuilder
├── ai/cache/                 ← CacheEngine (SHA-256 graph hash)
├── db/                       ← SQLite database + TursoSync
├── decisions/                ← DecisionService (CRUD + hybrid search)
├── workers/                  ← Embedding Worker thread
├── search/                   ← SemanticRanker (cosine similarity)
├── proactive/                ← StuckDetector + DriftDetector
├── commands/                 ← All command handlers + registry
├── sidebar/                  ← DecisionTreeProvider
├── decorations/              ← Gutter icon engine
├── ui/                       ← Webview panels (Provider Drawer, Token Dashboard, Graph, Detail)
├── graph/types.ts            ← Single domain model (all types)
├── storage/                  ← SecretStorageService
├── settings/                 ← SettingsManager
└── events/                   ← Typed EventBus

mcp-server/                   ← Standalone MCP server (separate process)
scripts/                      ← Retrieval benchmark
```

## Author

Aryan Bhati
