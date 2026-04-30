const esbuild = require('esbuild');
const isWatch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !isWatch,
  minify: !isWatch,
  logLevel: 'info',
};

const extensionEntry = {
  ...shared,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  external: ['vscode', 'better-sqlite3', '@xenova/transformers', '@libsql/client'],
};

const workerEntry = {
  ...shared,
  entryPoints: ['src/workers/embeddingWorker.ts'],
  outfile: 'dist/workers/embeddingWorker.js',
  external: ['@xenova/transformers'],
};

const mcpEntry = {
  ...shared,
  entryPoints: ['mcp-server/index.ts'],
  outfile: 'dist/mcp-server/index.js',
  external: ['better-sqlite3', '@modelcontextprotocol/sdk'],
};

if (isWatch) {
  Promise.all([
    esbuild.context(extensionEntry).then(ctx => ctx.watch()),
    esbuild.context(workerEntry).then(ctx => ctx.watch()),
    esbuild.context(mcpEntry).then(ctx => ctx.watch()),
  ]).then(() => console.log('[esbuild] Watching all entry points...'));
} else {
  Promise.all([
    esbuild.build(extensionEntry),
    esbuild.build(workerEntry),
    esbuild.build(mcpEntry),
  ]).catch(() => process.exit(1));
}
