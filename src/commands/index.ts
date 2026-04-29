
import * as vscode from 'vscode';
import type { DecisionService } from '../decisions/decisionService';
import type { AIPipeline } from '../ai/pipeline/AIPipeline';
import type { DecisionTreeProvider } from '../sidebar/DecisionTreeProvider';
import type { TokenDashboardPanel as TDP } from '../ui/TokenDashboardPanel';



export async function captureDecisionCommand(
  decisionService: DecisionService,
  treeProvider: DecisionTreeProvider
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const codeContext = editor?.document.getText(editor.selection) || undefined;
  const filePath    = editor?.document.uri.fsPath || undefined;

  const title = await vscode.window.showInputBox({
    title: 'CodeMemory: Capture Decision (1/3)',
    prompt: 'Decision title (e.g. "Use fetch instead of axios")',
    placeHolder: 'Short, descriptive title',
  });
  if (!title) return;

  const rationale = await vscode.window.showInputBox({
    title: 'CodeMemory: Capture Decision (2/3)',
    prompt: 'Why was this decision made?',
    placeHolder: 'Rationale / context',
  });
  if (!rationale) return;

  const typeChoice = await vscode.window.showQuickPick(
    [
      { label: '$(circuit-board) Pattern',    description: 'A recurring design pattern', id: 'pattern' },
      { label: '$(shield) Constraint',        description: 'A hard rule that must be followed', id: 'constraint' },
      { label: '$(book) Convention',          description: 'A soft style/naming agreement', id: 'convention' },
      { label: '$(question) Why',             description: 'Rationale for a non-obvious choice', id: 'why' },
    ],
    { title: 'CodeMemory: Capture Decision (3/3)', placeHolder: 'Decision type' }
  );
  if (!typeChoice) return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Saving decision…' },
    async () => {
      await decisionService.createDecision({
        title,
        rationale,
        type: (typeChoice as any).id,
        filePaths: filePath ? [filePath] : [],
        tags: [],
        codeContext,
      });
    }
  );

  treeProvider.refresh();
  vscode.window.showInformationMessage(`✓ Decision captured: "${title}"`);
}



export async function searchDecisionsCommand(
  decisionService: DecisionService
): Promise<void> {
  const query = await vscode.window.showInputBox({
    title: 'CodeMemory: Search Decisions',
    prompt: 'Search across titles, rationale, and tags',
    placeHolder: 'e.g. "fetch" or "authentication"',
  });
  if (query === undefined) return;

  const results = decisionService.searchDecisions(query, 20);

  if (!results.length) {
    vscode.window.showInformationMessage(`No decisions found for "${query}"`);
    return;
  }

  const pick = await vscode.window.showQuickPick(
    results.map((d) => ({
      label:       `$(${d.payload.type === 'constraint' ? 'shield' : 'circuit-board'}) ${d.payload.title}`,
      description: d.payload.type,
      detail:      d.payload.rationale.slice(0, 120),
      decision:    d,
    })),
    { title: `Found ${results.length} decision(s)`, matchOnDescription: true, matchOnDetail: true }
  );

  if (pick?.decision && pick.decision.payload.filePaths.length > 0) {
    const uri = vscode.Uri.file(pick.decision.payload.filePaths[0]);
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch {
      vscode.window.showWarningMessage(`Could not open: ${pick.decision.payload.filePaths[0]}`);
    }
  }
}



export async function askAICommand(
  pipeline: AIPipeline,
  decisionService: DecisionService
): Promise<void> {
  const query = await vscode.window.showInputBox({
    title: 'CodeMemory: Ask AI About Codebase',
    prompt: 'Ask anything about your architectural decisions',
    placeHolder: 'e.g. "Why do we use fetch instead of axios?"',
  });
  if (!query) return;

  const editor       = vscode.window.activeTextEditor;
  const codeContext  = editor?.document.getText(editor.selection) || undefined;
  const activeFile   = editor?.document.uri.fsPath;
  const decisions    = decisionService.getDecisions();

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'CodeMemory: Thinking…', cancellable: true },
    async (progress, token) => {
      const signal = new AbortController();
      token.onCancellationRequested(() => signal.abort());

      try {
        const result = await pipeline.query({
          query,
          decisions,
          activeFilePath: activeFile,
          codeContext,
          signal: signal.signal,
        });

        const panel = vscode.window.createWebviewPanel(
          'codememory.aiResponse',
          'CodeMemory: AI Response',
          vscode.ViewColumn.Beside,
          { enableScripts: false }
        );

        const cached  = result.cacheHit ? ' *(from cache)*' : '';
        const injected = result.graphDecisionsInjected;
        panel.webview.html = buildResponseHtml(query, result.response.content, result.providerId, injected, cached);
      } catch (err: any) {
        vscode.window.showErrorMessage(`CodeMemory AI error: ${err.message}`);
      }
    }
  );
}

function buildResponseHtml(query: string, content: string, providerId: string, injected: number, cached: string): string {
  const escaped = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body{background:#050508;color:#e2e8f0;font-family:'Segoe UI',sans-serif;padding:24px;line-height:1.7}
  .query{font-size:11px;font-family:monospace;color:#7878a0;margin-bottom:16px;padding:8px 12px;background:rgba(255,255,255,.04);border-radius:6px;border-left:2px solid #4fc3f7}
  pre{white-space:pre-wrap;font-family:monospace;font-size:13px}
  .meta{font-size:10px;font-family:monospace;color:#3a3a58;margin-top:16px;border-top:1px solid rgba(255,255,255,.06);padding-top:12px}
</style>
</head>
<body>
  <div class="query">Q: ${query}</div>
  <pre>${escaped}</pre>
  <div class="meta">Provider: ${providerId} · Decisions injected: ${injected}${cached}</div>
</body>
</html>`;
}

// ─── Navigate to Decision ─────────────────────────────────────────────────────

export async function navigateToDecisionCommand(node: any): Promise<void> {
  const filePaths = node?.payload?.filePaths ?? node?.filePaths ?? [];
  if (!filePaths.length) return;
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePaths[0]));
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch {
    vscode.window.showWarningMessage(`Could not open: ${filePaths[0]}`);
  }
}
