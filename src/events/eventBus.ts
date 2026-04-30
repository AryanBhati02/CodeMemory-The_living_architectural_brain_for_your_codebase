import * as vscode from 'vscode';
import type { GraphChangeEvent, ProviderChangeEvent } from '../graph/types';
export class EventBus implements vscode.Disposable {
  private readonly _onGraphChange      = new vscode.EventEmitter<GraphChangeEvent>();
  private readonly _onProviderChange   = new vscode.EventEmitter<ProviderChangeEvent>();
  private readonly _onEmbeddingComplete = new vscode.EventEmitter<string>();
  readonly onGraphChange       = this._onGraphChange.event;
  readonly onProviderChange    = this._onProviderChange.event;
  readonly onEmbeddingComplete = this._onEmbeddingComplete.event;
  fireGraphChange(e: GraphChangeEvent): void    { this._onGraphChange.fire(e); }
  fireProviderChange(e: ProviderChangeEvent): void { this._onProviderChange.fire(e); }
  fireEmbeddingComplete(nodeId: string): void   { this._onEmbeddingComplete.fire(nodeId); }
  dispose(): void {
    this._onGraphChange.dispose();
    this._onProviderChange.dispose();
    this._onEmbeddingComplete.dispose();
  }
}
