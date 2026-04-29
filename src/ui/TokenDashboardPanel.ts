
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; font-src https://fonts.googleapis.com https://fonts.gstatic.com;">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500&family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{background:#050508;color:#e2e8f0;font-family:'Syne',sans-serif;padding:0;min-height:100vh;overflow-x:hidden}
    body::before{content:'';position:fixed;inset:0;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");pointer-events:none;z-index:9999;opacity:.4}
    .orb{position:fixed;border-radius:50%;filter:blur(120px);pointer-events:none}
    .o1{width:500px;height:500px;background:rgba(79,195,247,.05);top:-150px;left:-150px}
    .o2{width:400px;height:400px;background:rgba(124,58,237,.04);bottom:0;right:-100px}
    header{padding:32px 40px 24px;border-bottom:1px solid rgba(255,255,255,.06)}
    .badge{display:inline-flex;align-items:center;gap:6px;background:rgba(79,195,247,.08);border:1px solid rgba(79,195,247,.2);color:#4fc3f7;font-family:'JetBrains Mono',monospace;font-size:10px;padding:4px 12px;border-radius:100px;margin-bottom:12px;text-transform:uppercase;letter-spacing:.1em}
    .badge::before{content:'';width:5px;height:5px;background:#4fc3f7;border-radius:50%;box-shadow:0 0 6px #4fc3f7;animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
    h1{font-size:28px;font-weight:800;letter-spacing:-.02em;background:linear-gradient(135deg,#4fc3f7,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;padding:32px 40px}
    .card{background:rgba(12,12,22,.7);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:20px;backdrop-filter:blur(24px);transition:border-color .3s,transform .3s}
    .card:hover{border-color:rgba(79,195,247,.25);transform:translateY(-2px)}
    .card-label{font-family:'JetBrains Mono',monospace;font-size:10px;color:#7878a0;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px}
    .card-value{font-size:32px;font-weight:800;color:#4fc3f7;font-family:'JetBrains Mono',monospace}
    .card-sub{font-size:11px;color:#3a3a58;margin-top:4px;font-family:'JetBrains Mono',monospace}
    .card.gold .card-value{color:#f6c445}
    .card.green .card-value{color:#10b981}
    .card.purple .card-value{color:#8b5cf6}
    .section{padding:0 40px 40px}
    .section-title{font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:.2em;color:#3a3a58;margin-bottom:16px;display:flex;align-items:center;gap:12px}
    .section-title::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.06)}
    .cache-bar{background:rgba(12,12,22,.7);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:20px;display:flex;align-items:center;gap:16px}
    .bar-track{flex:1;height:8px;background:rgba(255,255,255,.06);border-radius:4px;overflow:hidden}
    .bar-fill{height:100%;background:linear-gradient(90deg,#4fc3f7,#7c3aed);border-radius:4px;transition:width .5s ease}
    .provider-chip{display:inline-flex;align-items:center;gap:6px;background:rgba(79,195,247,.08);border:1px solid rgba(79,195,247,.2);color:#4fc3f7;font-family:'JetBrains Mono',monospace;font-size:11px;padding:4px 10px;border-radius:6px}
  </style>
</head>
<body>
  <div class="orb o1"></div><div class="orb o2"></div>
  <header>
    <div class="badge">Live</div>
    <h1>Token Dashboard</h1>
  </header>

  <div class="grid">
    <div class="card"><div class="card-label">Total Requests</div><div class="card-value" id="requests">—</div></div>
    <div class="card"><div class="card-label">Input Tokens</div><div class="card-value" id="input-tokens">—</div></div>
    <div class="card"><div class="card-label">Output Tokens</div><div class="card-value" id="output-tokens">—</div></div>
    <div class="card gold"><div class="card-label">Est. Cost (USD)</div><div class="card-value" id="cost">—</div></div>
    <div class="card green"><div class="card-label">Savings (USD)</div><div class="card-value" id="savings">—</div><div class="card-sub">via prompt caching</div></div>
    <div class="card purple"><div class="card-label">Active Provider</div><div class="card-value" id="provider" style="font-size:18px">—</div></div>
  </div>

  <div class="section">
    <div class="section-title">Cache Performance</div>
    <div class="cache-bar">
      <span style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#7878a0;min-width:80px">Hit Rate</span>
      <div class="bar-track"><div class="bar-fill" id="cache-bar" style="width:0%"></div></div>
      <span id="hit-rate" style="font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:#4fc3f7;min-width:48px;text-align:right">0%</span>
    </div>
    <div style="display:flex;gap:24px;margin-top:12px">
      <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#3a3a58">Hits: <span id="hits" style="color:#4fc3f7">0</span></span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#3a3a58">Misses: <span id="misses" style="color:#7878a0">0</span></span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#3a3a58">Cache reads: <span id="cache-reads" style="color:#8b5cf6">0</span></span>
    </div>
  </div>

  <script nonce="${nonce}">
    function fmt(n){return n>=1e6?(n/1e6).toFixed(2)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n)}
    function fmtUsd(n){return '$'+n.toFixed(4)}

    window.addEventListener('message', e=>{
      const{type,stats}=e.data;
      if(type!=='stats-update'||!stats) return;
      document.getElementById('requests').textContent     = fmt(stats.totalRequests);
      document.getElementById('input-tokens').textContent = fmt(stats.totalInputTokens);
      document.getElementById('output-tokens').textContent= fmt(stats.totalOutputTokens);
      document.getElementById('cost').textContent         = fmtUsd(stats.estimatedCostUsd);
      document.getElementById('savings').textContent      = fmtUsd(stats.estimatedSavingsUsd);
      document.getElementById('provider').textContent     = stats.activeProviderId;
      document.getElementById('cache-reads').textContent  = fmt(stats.totalCacheReadTokens);

      const cs=stats.cacheStats;
      const pct=Math.round((cs.hitRate||0)*100);
      document.getElementById('hit-rate').textContent = pct+'%';
      document.getElementById('cache-bar').style.width = pct+'%';
      document.getElementById('hits').textContent   = cs.hits;
      document.getElementById('misses').textContent = cs.misses;
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
