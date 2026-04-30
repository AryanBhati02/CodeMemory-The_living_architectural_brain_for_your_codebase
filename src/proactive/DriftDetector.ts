import * as vscode from 'vscode';
import type { DecisionService } from '../decisions/decisionService';
import type { EmbeddingQueue } from '../workers/embeddingQueue';
import type { SemanticRanker } from '../search/SemanticRanker';
export class DriftDetector implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('codememory.drift');
  private readonly disposables: vscode.Disposable[] = [];
  private readonly DRIFT_THRESHOLD = 0.65;
  constructor(
    private readonly decisionService: DecisionService,
    private readonly embeddingQueue: EmbeddingQueue,
    private readonly ranker: SemanticRanker,
  ) {
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(doc => this._check(doc)),
      this.diagnostics,
    );
  }
  private async _check(doc: vscode.TextDocument): Promise<void> {
    const filePath = doc.uri.fsPath;
    const linked = this.decisionService.getDecisions().filter(d =>
      d.payload.type === 'constraint' &&
      d.payload.codeContext &&
      d.embedding !== null &&
      d.payload.filePaths.some(p => filePath.endsWith(p) || p.endsWith(filePath))
    );
    if (!linked.length) {
      this.diagnostics.delete(doc.uri);
      return;
    }
    let currentVec;
    try {
      currentVec = await this.embeddingQueue.embedText(doc.getText().slice(0, 500));
    } catch {
      return;
    }
    const violations: vscode.Diagnostic[] = [];
    for (const d of linked) {
      const sim = this.ranker.cosine(currentVec, d.embedding!);
      if (sim < this.DRIFT_THRESHOLD) {
        const diag = new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 0),
          `CodeMemory: Code may violate constraint "${d.payload.title}" (similarity: ${sim.toFixed(2)}, threshold: ${this.DRIFT_THRESHOLD})`,
          vscode.DiagnosticSeverity.Warning
        );
        diag.code = { value: d.id, target: vscode.Uri.parse(`command:codememory.navigateToDecision`) };
        diag.source = 'CodeMemory';
        violations.push(diag);
      }
    }
    this.diagnostics.set(doc.uri, violations);
  }
  dispose(): void {
    this.diagnostics.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
