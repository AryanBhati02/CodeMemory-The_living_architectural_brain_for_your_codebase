
import * as vscode from 'vscode';
import type { DecisionService } from '../decisions/decisionService';
import type { AIPipeline } from '../ai/pipeline/AIPipeline';
import type { DecisionTreeProvider } from '../sidebar/DecisionTreeProvider';
import type { TokenDashboardPanel as TDP } from '../ui/TokenDashboardPanel';
import type { RelationType } from '../graph/types';

interface DecisionTypeItem extends vscode.QuickPickItem { id: string }
interface DecisionPickItem  extends vscode.QuickPickItem { id: string }



export async function captureDecisionCommand(
  decisionService: DecisionService,
  treeProvider: DecisionTreeProvider
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const codeContext  = editor?.document.getText(editor.selection) || undefined;
  const filePath     = editor?.document.uri.fsPath || undefined;
  const lineNumber   = editor?.selection.start.line;

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

  const typeItems: DecisionTypeItem[] = [
    { label: '$(circuit-board) Pattern',    description: 'A recurring design pattern',        id: 'pattern' },
    { label: '$(shield) Constraint',        description: 'A hard rule that must be followed',  id: 'constraint' },
    { label: '$(book) Convention',          description: 'A soft style/naming agreement',      id: 'convention' },
    { label: '$(question) Why',             description: 'Rationale for a non-obvious choice', id: 'why' },
  ];
  const typeChoice = await vscode.window.showQuickPick(typeItems, {
    title: 'CodeMemory: Capture Decision (3/3)', placeHolder: 'Decision type',
  });
  if (!typeChoice) return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Saving decision…' },
    async () => {
      await decisionService.createDecision({
        title,
        rationale,
        type: typeChoice.id,
        filePaths: filePath ? [filePath] : [],
        lineNumber,
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

  const results = await decisionService.hybridSearch(query, 20);

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

  const editor      = vscode.window.activeTextEditor;
  const codeContext = editor?.document.getText(editor.selection) || undefined;
  const activeFile  = editor?.document.uri.fsPath;
  const decisions   = decisionService.getDecisions();

  
  const panel = vscode.window.createWebviewPanel(
    'codememory.aiResponse',
    'CodeMemory: AI Response',
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );
  panel.webview.html = buildStreamingResponseHtml(query);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'CodeMemory: Thinking…', cancellable: true },
    async (_progress, token) => {
      const signal = new AbortController();
      token.onCancellationRequested(() => signal.abort());

      try {
        let accumulated = '';

        const result = await pipeline.query({
          query,
          decisions,
          activeFilePath: activeFile,
          codeContext,
          stream: true,
          onChunk: (chunk) => {
            accumulated += chunk.delta;
            panel.webview.postMessage({ type: 'chunk', accumulated });
          },
          signal: signal.signal,
        });

        panel.webview.postMessage({
          type: 'done',
          metaText: `${result.providerId} · ${result.graphDecisionsInjected} decisions · ${result.cacheHit ? 'cached' : 'live'}`,
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(`CodeMemory AI error: ${err.message}`);
      }
    }
  );
}

function buildStreamingResponseHtml(query: string): string {
  const escapedQuery = query.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body{background:#050508;color:#e2e8f0;font-family:'Segoe UI',sans-serif;padding:24px;line-height:1.7;margin:0}
  .query{font-size:11px;font-family:monospace;color:#7878a0;margin-bottom:16px;padding:8px 12px;background:rgba(255,255,255,.04);border-radius:6px;border-left:2px solid #4fc3f7}
  #content{font-size:13px}
  #content pre{background:rgba(255,255,255,.04);padding:12px;border-radius:6px;overflow-x:auto;white-space:pre-wrap}
  #content code{font-family:monospace}
  #meta{font-size:10px;font-family:monospace;color:#3a3a58;margin-top:16px;border-top:1px solid rgba(255,255,255,.06);padding-top:12px}
</style>
</head>
<body>
  <div class="query">Q: ${escapedQuery}</div>
  <div id="content"></div>
  <div id="meta"></div>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script>
    window.addEventListener('message', e => {
      if (e.data.type === 'chunk') document.getElementById('content').innerHTML = marked.parse(e.data.accumulated);
      if (e.data.type === 'done') document.getElementById('meta').textContent = e.data.metaText;
    });
  </script>
</body>
</html>`;
}



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



export async function editDecisionCommand(
  decisionService: DecisionService,
  node: any
): Promise<void> {
  const title = await vscode.window.showInputBox({
    title: 'Edit Decision (1/4) — Title',
    value: node.payload.title,
    prompt: 'Decision title',
  });
  if (title === undefined) return;

  const rationale = await vscode.window.showInputBox({
    title: 'Edit Decision (2/4) — Rationale',
    value: node.payload.rationale,
    prompt: 'Why was this decision made?',
  });
  if (rationale === undefined) return;

  const editTypeItems: DecisionTypeItem[] = [
    { label: '$(circuit-board) Pattern',    description: 'A recurring design pattern',        id: 'pattern' },
    { label: '$(shield) Constraint',        description: 'A hard rule that must be followed',  id: 'constraint' },
    { label: '$(book) Convention',          description: 'A soft style/naming agreement',      id: 'convention' },
    { label: '$(question) Why',             description: 'Rationale for a non-obvious choice', id: 'why' },
  ].map(item => ({
    ...item,
    description: item.id === node.payload.type ? item.description + ' (current)' : item.description,
  }));

  const typePick = await vscode.window.showQuickPick(editTypeItems, {
    title: 'Edit Decision (3/4) — Type',
  });
  if (!typePick) return;

  const statusItems = (['proposed', 'accepted', 'deprecated', 'superseded'] as const).map(s => ({
    label:       s,
    description: s === node.payload.status ? '(current)' : '',
  }));

  const statusPick = await vscode.window.showQuickPick(statusItems, {
    title: 'Edit Decision (4/4) — Status',
  });
  if (!statusPick) return;

  await decisionService.updateDecision(node.id, {
    title,
    rationale,
    type:   typePick.id,
    status: statusPick.label,
  });
  vscode.window.showInformationMessage(`Decision updated: "${title}"`);
}



export async function deleteDecisionCommand(
  decisionService: DecisionService,
  node: any
): Promise<void> {
  const answer = await vscode.window.showWarningMessage(
    `Delete "${node.payload.title}"? This cannot be undone.`,
    'Delete', 'Cancel'
  );
  if (answer !== 'Delete') return;

  decisionService.deleteDecision(node.id);
  vscode.window.showInformationMessage(`Decision "${node.payload.title}" deleted.`);
}



export async function linkDecisionCommand(
  decisionService: DecisionService,
  node: any
): Promise<void> {
  const others = decisionService.getDecisions().filter(d => d.id !== node.id);
  if (!others.length) {
    vscode.window.showInformationMessage('No other decisions to link to.');
    return;
  }

  const targetItems: DecisionPickItem[] = others.map(d => ({
    label: d.payload.title, description: d.payload.type, id: d.id,
  }));
  const targetPick = await vscode.window.showQuickPick(targetItems, {
    title: 'Link Decision — Select Target', placeHolder: 'Select decision to link to',
  });
  if (!targetPick) return;

  const relPick = await vscode.window.showQuickPick(
    (['CONFLICTS_WITH', 'DEPENDS_ON', 'SUPERSEDES', 'RELATED_TO', 'APPLIES_TO'] as const).map(r => ({ label: r })),
    { title: 'Link Decision — Relation Type', placeHolder: 'Select relation type' }
  );
  if (!relPick) return;

  decisionService.createEdge(node.id, targetPick.id, relPick.label as RelationType);
  vscode.window.showInformationMessage(
    `Linked "${node.payload.title}" → ${relPick.label} → "${targetPick.label}"`
  );
}



export async function exportDecisionsCommand(
  decisionService: DecisionService
): Promise<void> {
  const decisions = decisionService.getDecisions();
  const json = JSON.stringify(decisions, null, 2);
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file('codememory-decisions.json'),
    filters: { 'JSON': ['json'] },
  });
  if (!uri) return;
  await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf-8'));
  vscode.window.showInformationMessage(`Exported ${decisions.length} decisions to ${uri.fsPath}`);
}



export async function importDecisionsCommand(
  decisionService: DecisionService
): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'JSON': ['json'] },
  });
  if (!uris?.length) return;
  const raw = await vscode.workspace.fs.readFile(uris[0]);
  let nodes;
  try {
    nodes = JSON.parse(Buffer.from(raw).toString('utf-8'));
  } catch {
    vscode.window.showErrorMessage('Invalid JSON file.');
    return;
  }
  if (!Array.isArray(nodes)) {
    vscode.window.showErrorMessage('Expected a JSON array of decisions.');
    return;
  }
  await decisionService.importDecisions(nodes);
  vscode.window.showInformationMessage(`Imported ${nodes.length} decisions.`);
}
