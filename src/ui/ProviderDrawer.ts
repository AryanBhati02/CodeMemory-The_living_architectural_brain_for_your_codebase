
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { ProviderManager } from '../ai/providers/ProviderManager';
import type { SecretStorageService } from '../storage/secretStorage';
import { getNonce } from '../utils/getNonce';

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'apply-key'; providerId: string; apiKey: string }
  | { type: 'remove-key'; providerId: string }
  | { type: 'switch-provider'; providerId: string }
  | { type: 'open-url'; url: string };

export class ProviderDrawer implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

    private readonly _onProviderChanged = new vscode.EventEmitter<string>();
  readonly onProviderChanged = this._onProviderChanged.event;

  constructor(
    private readonly manager: ProviderManager,
    private readonly secrets: SecretStorageService,
    private readonly extensionUri: vscode.Uri
  ) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'codememory.providerDrawer',
      'CodeMemory · AI Provider',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'src', 'ui', 'webview')],
      }
    );

    this.panel.webview.html = this._getHtml();
    this.panel.webview.onDidReceiveMessage(this._handleMessage.bind(this), undefined, this.disposables);
    this.panel.onDidDispose(() => { this.panel = undefined; }, null, this.disposables);
  }

  private async _handleMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        await this._sendInitialState();
        break;

      case 'apply-key': {
        const validation = this.manager.validateKey(msg.providerId, msg.apiKey);
        if (validation.valid) {
          await this.secrets.storeKey(msg.providerId, msg.apiKey);
        }
        this._post({ type: 'validation-result', providerId: msg.providerId, result: validation });
        break;
      }

      case 'remove-key':
        await this.secrets.deleteKey(msg.providerId);
        this._post({ type: 'key-removed', providerId: msg.providerId });
        await this._sendInitialState();
        break;

      case 'switch-provider':
        try {
          this.manager.setActiveProvider(msg.providerId);
          await this.secrets.setActiveProvider(msg.providerId);
          this._onProviderChanged.fire(msg.providerId);
          this._post({ type: 'provider-switched', providerId: msg.providerId });
        } catch (err: any) {
          this._post({ type: 'error', message: err.message });
        }
        break;

      case 'open-url':
        if (msg.url) vscode.env.openExternal(vscode.Uri.parse(msg.url));
        break;
    }
  }

  private async _sendInitialState(): Promise<void> {
    const providers = this.manager.listProviders().map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      accentColor: p.accentColor,
      apiKeyUrl: p.apiKeyUrl,
      capabilities: p.capabilities,
    }));

    const configuredIds: string[] = [];
    for (const p of this.manager.listProviders()) {
      if (await this.secrets.hasKey(p.id)) configuredIds.push(p.id);
    }

    this._post({
      type: 'init',
      providers,
      activeProviderId: this.manager.getActiveProviderId(),
      configuredIds,
    });
  }

  private _post(msg: Record<string, unknown>): void {
    this.panel?.webview.postMessage(msg);
  }

  private _getHtml(): string {
    const htmlPath = path.join(this.extensionUri.fsPath, 'src', 'ui', 'webview', 'providerDrawer.html');
    if (fs.existsSync(htmlPath)) return fs.readFileSync(htmlPath, 'utf-8');
    return this._getFallbackHtml();
  }

  private _getFallbackHtml(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <style>
    body { background: #050508; color: #e2e8f0; font-family: 'Segoe UI', sans-serif; padding: 24px; }
    h1 { color: #4fc3f7; font-size: 18px; margin-bottom: 24px; }
    .provider { background: rgba(12,12,22,0.7); border: 1px solid rgba(79,195,247,0.15); border-radius: 12px; padding: 16px; margin-bottom: 12px; }
    .provider h2 { font-size: 14px; margin: 0 0 8px; color: #e2e8f0; }
    input { width: 100%; background: rgba(255,255,255,0.06); border: 1px solid rgba(79,195,247,0.2); border-radius: 8px; padding: 8px 12px; color: #e2e8f0; font-size: 13px; margin: 8px 0; box-sizing: border-box; }
    button { background: rgba(79,195,247,0.15); border: 1px solid rgba(79,195,247,0.3); color: #4fc3f7; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px; }
    button:hover { background: rgba(79,195,247,0.25); }
  </style>
</head>
<body>
  <h1>⚡ CodeMemory · AI Provider</h1>
  <div id="root"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const providers = [];
    let activeId = '';

    window.addEventListener('message', e => {
      const msg = e.data;
      if (msg.type === 'init') {
        activeId = msg.activeProviderId;
        renderProviders(msg.providers, msg.configuredIds);
      }
      if (msg.type === 'validation-result') {
        const el = document.getElementById('status-' + msg.result.providerId || msg.providerId);
        if (el) el.textContent = msg.result.valid ? '✓ Key saved' : '✗ ' + (msg.result.reason || 'Invalid key');
      }
    });

    function renderProviders(provs, configured) {
      const root = document.getElementById('root');
      root.innerHTML = provs.map(p => \`
        <div class="provider">
          <h2>\${p.name} \${configured.includes(p.id) ? '✓' : ''} \${activeId === p.id ? '(active)' : ''}</h2>
          <input id="key-\${p.id}" type="password" placeholder="API Key" />
          <button onclick="applyKey('\${p.id}')">Apply Key</button>
          <button onclick="switchTo('\${p.id}')">Set Active</button>
          <div id="status-\${p.id}" style="font-size:11px;margin-top:4px;color:#4fc3f7"></div>
        </div>
      \`).join('');
    }

    function applyKey(id) {
      const key = document.getElementById('key-' + id).value;
      vscode.postMessage({ type: 'apply-key', providerId: id, apiKey: key });
    }
    function switchTo(id) {
      vscode.postMessage({ type: 'switch-provider', providerId: id });
    }

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    this.panel?.dispose();
    this._onProviderChanged.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
