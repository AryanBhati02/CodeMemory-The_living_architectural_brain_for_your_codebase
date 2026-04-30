import * as vscode from 'vscode';
import { getNonce } from '../utils/getNonce';
import type { AIPipeline } from '../ai/pipeline/AIPipeline';

export class TokenDashboardPanel implements vscode.Disposable {
  static current: TokenDashboardPanel | undefined;
  private static readonly VIEW_TYPE = 'codememory.tokenDashboard';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private refreshInterval: ReturnType<typeof setInterval> | undefined;

  static createOrShow(extensionUri: vscode.Uri, pipeline: AIPipeline): TokenDashboardPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (TokenDashboardPanel.current) {
      TokenDashboardPanel.current.panel.reveal(column);
      return TokenDashboardPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      TokenDashboardPanel.VIEW_TYPE,
      'CodeMemory — Token Dashboard',
      column,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')] }
    );
    TokenDashboardPanel.current = new TokenDashboardPanel(panel, pipeline, extensionUri);
    return TokenDashboardPanel.current;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly pipeline: AIPipeline,
    private readonly extensionUri: vscode.Uri
  ) {
    this.panel = panel;
    this.panel.webview.html = this._buildHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.refreshInterval = setInterval(() => this._pushStats(), 2000);
    this._pushStats();

    this.panel.webview.onDidReceiveMessage(
      (msg) => { if (msg.type === 'reset') this.pipeline.resetStats(); },
      null,
      this.disposables
    );
  }

  private _pushStats(): void {
    const stats = this.pipeline.getSessionStats();
    this.panel.webview.postMessage({ type: 'stats-update', stats });
  }

  private _buildHtml(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{background:#050508;color:#e2e8f0;font-family:system-ui,sans-serif;padding:32px 36px;min-height:100vh}
    h1{font-size:20px;font-weight:700;letter-spacing:-.02em;margin-bottom:2px}
    .subtitle{font-size:11px;color:#6b7fa8;margin-bottom:28px;font-family:monospace}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;margin-bottom:24px}
    .card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:18px 20px}
    .card-label{font-size:10px;color:#6b7fa8;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;font-family:monospace}
    .card-value{font-size:28px;font-weight:700;color:#e2e8f0;font-family:system-ui,sans-serif;line-height:1}
    .card-value.blue{color:#4fc3f7}
    .card-value.green{color:#1fd68a}
    .card-value.mono{font-family:monospace;font-size:15px;color:#4fc3f7;word-break:break-all;line-height:1.4}
    .cache-section{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:20px;margin-bottom:20px}
    .cache-section-label{font-size:10px;color:#6b7fa8;text-transform:uppercase;letter-spacing:.1em;margin-bottom:14px;font-family:monospace}
    .bar-row{display:flex;align-items:center;gap:12px;margin-bottom:14px}
    .bar-track{flex:1;height:6px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden}
    .bar-fill{height:100%;width:0%;background:#1fd68a;border-radius:3px;transition:width .5s ease}
    .bar-label{font-family:monospace;font-size:13px;font-weight:700;color:#1fd68a;min-width:50px;text-align:right}
    .cache-meta{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:12px}
    .cache-stat{font-size:11px;color:#6b7fa8;font-family:monospace}
    .cache-stat span{color:#e2e8f0}
    .cache-reason{font-size:11px;color:#6b7fa8;font-family:monospace}
    .cache-reason span{color:#e2e8f0}
    .reset-btn{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);color:#6b7fa8;font-family:monospace;font-size:11px;padding:7px 16px;border-radius:6px;cursor:pointer;letter-spacing:.04em}
    .reset-btn:hover{background:rgba(255,255,255,.08);color:#e2e8f0;border-color:rgba(255,255,255,.18)}
  </style>
</head>
<body>
  <h1>Token Dashboard</h1>
  <div class="subtitle">Live · refreshes every 2 s</div>

  <div class="grid">
    <div class="card">
      <div class="card-label">Input Tokens</div>
      <div class="card-value blue" id="input-tokens">—</div>
    </div>
    <div class="card">
      <div class="card-label">Output Tokens</div>
      <div class="card-value" id="output-tokens">—</div>
    </div>
    <div class="card">
      <div class="card-label">Cache Hit Rate</div>
      <div class="card-value green" id="hit-rate">—</div>
    </div>
    <div class="card">
      <div class="card-label">Est. Cost (USD)</div>
      <div class="card-value" id="cost">—</div>
    </div>
    <div class="card">
      <div class="card-label">Est. Savings (USD)</div>
      <div class="card-value green" id="savings">—</div>
    </div>
    <div class="card">
      <div class="card-label">Total Requests</div>
      <div class="card-value" id="requests">—</div>
    </div>
    <div class="card">
      <div class="card-label">Active Provider</div>
      <div class="card-value mono" id="provider">—</div>
    </div>
  </div>

  <div class="cache-section">
    <div class="cache-section-label">Cache Performance</div>
    <div class="bar-row">
      <div class="bar-track"><div class="bar-fill" id="cache-bar"></div></div>
      <div class="bar-label" id="hit-rate-bar">0.0%</div>
    </div>
    <div class="cache-meta">
      <div class="cache-stat">Hits: <span id="hits">0</span></div>
      <div class="cache-stat">Misses: <span id="misses">0</span></div>
    </div>
    <div class="cache-reason">Last invalidation: <span id="invalidation-reason">none</span></div>
  </div>

  <button class="reset-btn" id="reset-btn">Reset Stats</button>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    function fmt(n) { return n >= 1e6 ? (n/1e6).toFixed(2)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n); }
    function fmtUsd(n) { return '$' + n.toFixed(4); }
    function fmtPct(r) { return (r * 100).toFixed(1) + '%'; }

    window.addEventListener('message', e => {
      const { type, stats } = e.data;
      if (type !== 'stats-update' || !stats) return;

      document.getElementById('input-tokens').textContent  = fmt(stats.totalInputTokens);
      document.getElementById('output-tokens').textContent = fmt(stats.totalOutputTokens);
      document.getElementById('cost').textContent          = fmtUsd(stats.estimatedCostUsd);
      document.getElementById('savings').textContent       = fmtUsd(stats.estimatedSavingsUsd);
      document.getElementById('requests').textContent      = fmt(stats.totalRequests);
      document.getElementById('provider').textContent      = stats.activeProviderId;

      const cs  = stats.cacheStats;
      const pct = fmtPct(cs.hitRate || 0);
      document.getElementById('hit-rate').textContent      = pct;
      document.getElementById('hit-rate-bar').textContent  = pct;
      document.getElementById('cache-bar').style.width     = ((cs.hitRate || 0) * 100) + '%';
      document.getElementById('hits').textContent          = cs.hits;
      document.getElementById('misses').textContent        = cs.misses;
      document.getElementById('invalidation-reason').textContent = cs.lastInvalidationReason || 'none';
    });

    document.getElementById('reset-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'reset' });
    });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    TokenDashboardPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
