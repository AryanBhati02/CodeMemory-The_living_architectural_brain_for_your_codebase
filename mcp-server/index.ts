














import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';



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
  createdAt: string;
  updatedAt: string;
  authorName: string;
  authorEmail: string;
}

interface NodeRow {
  id: string; type: string; payload: string; embedding: Buffer | null;
  created_at: string; updated_at: string; author_name: string; author_email: string;
}



function resolveDbPath(): string {
  return process.env.CODEMEMORY_DB_PATH
    ?? path.resolve(process.cwd(), '.codecontext', 'graph.db');
}

function deserializeNode(row: NodeRow): DecisionNode {
  return {
    id: row.id,
    type: 'decision',
    payload: JSON.parse(row.payload),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    authorName: row.author_name,
    authorEmail: row.author_email,
  };
}

function openDb(): Database.Database {
  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `CodeMemory database not found: ${dbPath}\n` +
      `Set CODEMEMORY_DB_PATH or run from a workspace with .codecontext/graph.db`
    );
  }
  return new Database(dbPath, { readonly: true });
}

function getAllNodes(db: Database.Database): DecisionNode[] {
  return (db.prepare(`SELECT * FROM nodes ORDER BY updated_at DESC`).all() as NodeRow[])
    .map(deserializeNode);
}

function getNodeById(db: Database.Database, id: string): DecisionNode | undefined {
  const row = db.prepare(`SELECT * FROM nodes WHERE id=?`).get(id) as NodeRow | undefined;
  return row ? deserializeNode(row) : undefined;
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

function formatDecision(n: DecisionNode): Record<string, unknown> {
  return {
    id: n.id,
    title: n.payload.title,
    rationale: n.payload.rationale,
    type: n.payload.type,
    status: n.payload.status,
    filePaths: n.payload.filePaths,
    tags: n.payload.tags,
    codeContext: n.payload.codeContext ?? null,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    author: n.authorName,
  };
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'codememory', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search_decisions',
      description:
        'Search architectural decisions by semantic meaning or keywords. ' +
        'Returns the most relevant decisions for the given query.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Natural-language search query' },
          limit: { type: 'number', description: 'Max results to return (default 5)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_decision',
      description: 'Get a specific architectural decision by its ID.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'Decision UUID' },
        },
        required: ['id'],
      },
    },
    {
      name: 'check_constraint_violation',
      description:
        'Check if a code snippet potentially violates any captured constraint ' +
        'decisions for a given file path. Returns matching constraints with their ' +
        'rationale so you can judge whether the snippet violates them.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          filePath: { type: 'string', description: 'Relative or absolute file path to check' },
          codeSnippet: { type: 'string', description: 'The code to check against constraints' },
        },
        required: ['filePath', 'codeSnippet'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const db = openDb();

  try {
    switch (name) {
      case 'search_decisions': {
        const query = String(args?.query ?? '');
        const limit = Number(args?.limit ?? 5);
        if (!query) {
          return { content: [{ type: 'text', text: 'Error: query is required' }] };
        }
        const results = searchNodesFts(db, query, limit);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(results.map(formatDecision), null, 2),
          }],
        };
      }

      case 'get_decision': {
        const id = String(args?.id ?? '');
        if (!id) {
          return { content: [{ type: 'text', text: 'Error: id is required' }] };
        }
        const node = getNodeById(db, id);
        if (!node) {
          return { content: [{ type: 'text', text: `Error: Decision not found: ${id}` }] };
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(formatDecision(node), null, 2),
          }],
        };
      }

      case 'check_constraint_violation': {
        const filePath = String(args?.filePath ?? '');
        const codeSnippet = String(args?.codeSnippet ?? '');
        if (!filePath) {
          return { content: [{ type: 'text', text: 'Error: filePath is required' }] };
        }
        if (!codeSnippet) {
          return { content: [{ type: 'text', text: 'Error: codeSnippet is required' }] };
        }

        const allNodes = getAllNodes(db);
        const constraints = allNodes.filter(n =>
          n.payload.type === 'constraint' &&
          n.payload.filePaths.some(p =>
            filePath.endsWith(p) || p.endsWith(filePath) || filePath.includes(p) || p.includes(filePath)
          )
        );

        if (!constraints.length) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                filePath,
                constraintsFound: 0,
                message: 'No constraint decisions are linked to this file path.',
              }, null, 2),
            }],
          };
        }

        const result = {
          filePath,
          constraintsFound: constraints.length,
          codeSnippetPreview: codeSnippet.slice(0, 200),
          constraints: constraints.map(c => ({
            id: c.id,
            title: c.payload.title,
            rationale: c.payload.rationale,
            status: c.payload.status,
            tags: c.payload.tags,
          })),
          instruction:
            'Review each constraint rationale against the provided code snippet. ' +
            'Determine if the code violates, partially violates, or complies with each constraint.',
        };

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      default:
        return { content: [{ type: 'text', text: `Error: Unknown tool: ${name}` }] };
    }
  } finally {
    db.close();
  }
});



async function main(): Promise<void> {
  const dbPath = resolveDbPath();
  process.stderr.write(`CodeMemory MCP server starting\n`);
  process.stderr.write(`  Database: ${dbPath}\n`);
  process.stderr.write(`  Exists: ${fs.existsSync(dbPath)}\n`);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(`CodeMemory MCP server connected via stdio\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
