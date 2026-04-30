









import { Worker } from 'worker_threads';
import * as path from 'path';
import * as vscode from 'vscode';
import { logger } from '../utils/logger';
import type { CodeMemoryDatabase } from '../db/database';

type WorkerMessage =
  | { type: 'ready'; error?: string }
  | { type: 'embedding'; nodeId: string; embedding?: number[]; error?: string }
  | { type: 'text-embedding'; requestId: string; embedding?: number[]; error?: string };

interface PendingJob { resolve: () => void; reject: (err: Error) => void; }
interface TextJob { resolve: (v: Float32Array) => void; reject: (err: Error) => void; }

export class EmbeddingQueue implements vscode.Disposable {
  private worker: Worker | null = null;
  private readonly pendingJobs = new Map<string, PendingJob>();
  private readonly _textJobs   = new Map<string, TextJob>();
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

  
  embedText(text: string): Promise<Float32Array> {
    if (!this.worker || !this.workerReady) {
      return Promise.reject(new Error('Embedding worker not ready'));
    }
    const requestId = `text-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      this.pendingJobs.set(requestId, { resolve: () => {}, reject });
      this._textJobs.set(requestId, { resolve, reject });
      this.worker!.postMessage({ type: 'embed-text', requestId, text });
    });
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

      this.worker.on('message', (msg: WorkerMessage) => this._handleMessage(msg, resolve));
      this.worker.on('error', (err) => {
        logger.error('EmbeddingQueue', 'Worker error', err);
        reject(err);
      });
      this.worker.on('exit', (code) => {
        this.workerReady = false;
        for (const [, job] of this.pendingJobs) {
          job.reject(new Error(`EmbeddingWorker exited with code ${code}`));
        }
        this.pendingJobs.clear();
        if (code !== 0 && !this._disposed) {
          setTimeout(() => this._spawnWorker().catch(() => {}), 5000);
        }
      });
    });
  }

  private _handleMessage(msg: WorkerMessage, onReady?: () => void): void {
    if (msg.type === 'ready') {
      this.workerReady = true;
      if (msg.error) {
        logger.warn('EmbeddingQueue', `Worker started with init error: ${msg.error}`);
      }
      onReady?.();
      return;
    }

    if (msg.type === 'text-embedding') {
      const { requestId, embedding, error } = msg;
      const job = this._textJobs.get(requestId);
      this._textJobs.delete(requestId);
      this.pendingJobs.delete(requestId);
      if (error || !embedding) {
        job?.reject(new Error(error ?? 'No embedding returned'));
      } else {
        job?.resolve(new Float32Array(embedding));
      }
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
