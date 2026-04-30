import * as vscode from 'vscode';
import * as path from 'path';
import type { DecisionService } from '../decisions/decisionService';
export class StuckDetector implements vscode.Disposable {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly dismissedFiles = new Set<string>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly STUCK_MS: number;
  constructor(
    private readonly decisionService: DecisionService,
    stuckMinutes = 8
  ) {
    this.STUCK_MS = stuckMinutes * 60 * 1000;
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(e => {
        if (e) this._resetTimer(e.document.uri.fsPath);
      }),
      vscode.workspace.onDidChangeTextDocument(e => {
        this.dismissedFiles.delete(e.document.uri.fsPath);
        this._resetTimer(e.document.uri.fsPath);
      }),
    );
    const current = vscode.window.activeTextEditor;
    if (current) this._resetTimer(current.document.uri.fsPath);
  }
  private _resetTimer(filePath: string): void {
    clearTimeout(this.timers.get(filePath));
    if (this.dismissedFiles.has(filePath)) return;
    const t = setTimeout(() => this._onStuck(filePath), this.STUCK_MS);
    this.timers.set(filePath, t);
  }
  private async _onStuck(filePath: string): Promise<void> {
    const fileName = path.basename(filePath, path.extname(filePath));
    const editor = vscode.window.activeTextEditor;
    const snippet = editor?.document.getText().slice(0, 200) ?? '';
    const query = `${fileName} ${snippet}`.trim();
    let results;
    try {
      results = await this.decisionService.hybridSearch(query, 3);
    } catch { return; }
    if (!results.length) return;
    const top = results[0];
    const action = await vscode.window.showInformationMessage(
      `CodeMemory: "${top.payload.title}" may be relevant to what you're working on.`,
      'Show All 3',
      'Not helpful',
      'Dismiss for this file'
    );
    if (action === 'Show All 3') {
      const picks = await vscode.window.showQuickPick(
        results.map(d => ({ label: d.payload.title, detail: d.payload.rationale.slice(0, 100), decision: d })),
        { title: 'Relevant decisions for this file' }
      );
      if (picks?.decision) {
        vscode.commands.executeCommand('codememory.navigateToDecision', picks.decision);
      }
    } else if (action === 'Dismiss for this file') {
      this.dismissedFiles.add(filePath);
    }
  }
  dispose(): void {
    this.timers.forEach(t => clearTimeout(t));
    this.timers.clear();
    this.disposables.forEach(d => d.dispose());
  }
}
