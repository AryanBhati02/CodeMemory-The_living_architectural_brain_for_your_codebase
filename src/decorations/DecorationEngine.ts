import * as vscode from 'vscode';
import type { DecisionNode } from '../graph/types';
export class DecorationEngine implements vscode.Disposable {
  private readonly decorationType: vscode.TextEditorDecorationType;
  private currentDecisions: DecisionNode[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  constructor(private readonly extensionUri: vscode.Uri) {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(extensionUri, 'assets', 'gutter-icon.svg'),
      gutterIconSize: '60%',
    });
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((e) => {
        if (e) this._applyDecorations(e);
      }),
      this.decorationType
    );
  }
  updateDecisions(decisions: DecisionNode[]): void {
    this.currentDecisions = decisions;
    const editor = vscode.window.activeTextEditor;
    if (editor) this._applyDecorations(editor);
  }
  private _applyDecorations(editor: vscode.TextEditor): void {
    const filePath = editor.document.uri.fsPath;
    const relevant = this.currentDecisions.filter((d) =>
      d.payload.filePaths.some((p) => filePath.endsWith(p) || p.endsWith(filePath))
    );
    const decorations: vscode.DecorationOptions[] = relevant.map((d) => ({
      range: new vscode.Range(d.payload.lineNumber ?? 0, 0, d.payload.lineNumber ?? 0, 0),
      hoverMessage: new vscode.MarkdownString(
        `**CodeMemory Decision**\n\n` +
        `**[${d.payload.type.toUpperCase()}]** ${d.payload.title}\n\n` +
        `${d.payload.rationale}`
      ),
    }));
    editor.setDecorations(this.decorationType, decorations);
  }
  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
