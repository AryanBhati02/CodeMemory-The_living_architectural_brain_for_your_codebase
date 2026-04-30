# CodeMemory MCP Server

Standalone [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes CodeMemory's decision graph to AI agents (Claude Code, Cursor, Windsurf, etc.).

This is a **separate Node.js process** — it reads the same `.codecontext/graph.db` file the VS Code extension writes to.

## Tools

| Tool | Description |
|---|---|
| `search_decisions` | FTS5 keyword search across decision titles, rationale, and tags |
| `get_decision` | Fetch a specific decision by UUID |
| `check_constraint_violation` | List constraint decisions linked to a file path so the AI can check code against them |

## Build

From the project root:

```bash
npm run compile
```

This builds the MCP server to `dist/mcp-server/index.js` alongside the main extension.

## Configuration

The database path is resolved in this order:

1. `CODEMEMORY_DB_PATH` environment variable (absolute path)
2. `<cwd>/.codecontext/graph.db` (default)

## Register in Claude Code

Add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "codememory": {
      "command": "node",
      "args": ["/absolute/path/to/CodeMemory/dist/mcp-server/index.js"],
      "env": {
        "CODEMEMORY_DB_PATH": "/absolute/path/to/your/workspace/.codecontext/graph.db"
      }
    }
  }
}
```

## Register in Cursor

Add to `.cursor/mcp.json` in your workspace:

```json
{
  "mcpServers": {
    "codememory": {
      "command": "node",
      "args": ["/absolute/path/to/CodeMemory/dist/mcp-server/index.js"],
      "env": {
        "CODEMEMORY_DB_PATH": "./.codecontext/graph.db"
      }
    }
  }
}
```

## Register in VS Code (GitHub Copilot)

Add to `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "codememory": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/CodeMemory/dist/mcp-server/index.js"],
      "env": {
        "CODEMEMORY_DB_PATH": "${workspaceFolder}/.codecontext/graph.db"
      }
    }
  }
}
```

## Test Manually

```bash
# From a workspace with .codecontext/graph.db:
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/mcp-server/index.js
```

## Architecture

```
AI Agent (Claude/Cursor/etc.)
  │
  ├── stdio ──► MCP Server (this process)
  │                │
  │                ├── better-sqlite3 (readonly)
  │                │       │
  │                │       └── .codecontext/graph.db
  │                │
  │                └── FTS5 search, node lookup, constraint matching
  │
  └── VS Code Extension (writes to the same DB)
```

The MCP server opens the database in **read-only mode** — it never writes. The VS Code extension owns all writes (decisions, embeddings, edges).
