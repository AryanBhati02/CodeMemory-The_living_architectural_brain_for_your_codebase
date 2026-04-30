
import * as vscode from 'vscode';
import * as path from 'path';
import { CodeMemoryDatabase } from './database';

const DB_DIR  = '.codecontext';
const DB_FILE = 'graph.db';

function resolveDbPath(context: vscode.ExtensionContext): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return path.join(context.globalStorageUri.fsPath, DB_FILE);
  }
  return path.join(folders[0].uri.fsPath, DB_DIR, DB_FILE);
}

export class DatabaseManager implements vscode.Disposable {
  private db: CodeMemoryDatabase | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this._reinitialize())
    );
  }

  getDatabase(): CodeMemoryDatabase {
    if (!this.db) this._reinitialize();
    return this.db!;
  }

  private _reinitialize(): void {
    this.db?.close();
    this.db = new CodeMemoryDatabase(resolveDbPath(this.context));
  }

  dispose(): void {
    this.db?.close();
    this.db = undefined;
  }
}
