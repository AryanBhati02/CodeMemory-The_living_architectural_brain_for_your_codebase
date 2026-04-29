
import { Worker } from 'worker_threads';
import * as path from 'path';
import * as vscode from 'vscode';
import type { CodeMemoryDatabase } from '../db/database';

interface PendingJob { resolve: () => void; reject: (err: Error) => void; }

export class EmbeddingQueue implements vscode.Disposable {
  private worker: Worker | null = null;
  private readonly pendingJobs = new Map<string, PendingJob>();
  private workerReady = false;
  private _disposed = false;

  private readonly _onEmbeddingComplete = new vscode.EventEmitter<string>();
  readonly onEmbeddingComplete = this._onEmbeddingComplete.event;

  constructor(
    private readonly db: CodeMemoryDatabase,
    private readonly extensionPath: string
  ) {}

  async start(): Promise<void> {
    await this._spawnWorker();
    this._scheduleBackfill();
  }

  enqueue(nodeId: string, text: string): Promise<void> {
    if (!this.worker || !this.workerReady) {
      return Promise.resolve(); 
    }
    return new Promise((resolve, reject) => {
      this.pendingJobs.set(nodeId, { resolve, reject });
      this.worker!.postMessage({ type: 'embed', nodeId, text });
    });
  }

  private async _spawnWorker(): Promise<void> {
    return new Promise((resolve, reject) => {
      const workerPath = path.join(this.extensionPath, 'dist', 'workers', 'embeddingWorker.js');
      this.worker = new Worker(workerPath);

      this.worker.on('message', (msg: any) => this._handleMessage(msg, resolve));
      this.worker.on('error', (err) => {
        console.error('[EmbeddingQueue] Worker error:', err);
        reject(err);
      });
      this.worker.on('exit', (code) => {
        this.workerReady = false;
        
        for (const [nodeId, job] of this.pendingJobs) {
          job.reject(new Error(`EmbeddingWorker exited with code ${code}`));
        }
        this.pendingJobs.clear();
        
        if (code !== 0 && !this._disposed) {
          setTimeout(() => this._spawnWorker().catch(() => {}), 5000);
        }
      });
    });
  }

  private _handleMessage(msg: any, onReady?: () => void): void {
    if (msg.type === 'ready') {
      this.workerReady = true;
      onReady?.();
      return;
    }
    if (msg.type === 'embedding') {
      const { nodeId, embedding, error } = msg;
      const job = this.pendingJobs.get(nodeId);
      this.pendingJobs.delete(nodeId);

      if (error) {
        job?.reject(new Error(error));
        return;
      }
      if (embedding) {
        this.db.updateNodeEmbedding(nodeId, new Float32Array(embedding));
        this._onEmbeddingComplete.fire(nodeId);
      }
      job?.resolve();
    }
  }

  private _scheduleBackfill(): void {
    setTimeout(() => {
      const unembedded = this.db.getUnembeddedNodes();
      for (const node of unembedded) {
        const text = `${node.payload.title}. ${node.payload.rationale}`;
        this.enqueue(node.id, text).catch(() => {});
      }
    }, 3000); 
  }

  dispose(): void {
    this._disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this._onEmbeddingComplete.dispose();
  }
}
