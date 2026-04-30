import * as vscode from 'vscode';
import { getNonce } from '../utils/getNonce';
import type { DecisionService } from '../decisions/decisionService';
import type { DecisionNode, DecisionEdge } from '../graph/types';

export class DecisionDetailPanel implements vscode.Disposable {
  private static readonly VIEW_TYPE = 'codememory.decisionDetail';
  private static panels = new Map<string, DecisionDetailPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static show(
    node: DecisionNode,
    decisionService: DecisionService,
    extensionUri: vscode.Uri
  ): DecisionDetailPanel {
    const existing = DecisionDetailPanel.panels.get(node.id);
    if (existing) {
      existing.panel.reveal();
      existing._pushData(node, decisionService);
      return existing;
    }

    const column = vscode.window.activeTextEditor?.viewColumn
      ? vscode.window.activeTextEditor.viewColumn + 1
      : vscode.ViewColumn.Beside;

    const panel = vscode.window.createWebviewPanel(
      DecisionDetailPanel.VIEW_TYPE,
      `Decision: ${node.payload.title.slice(0, 40)}`,
      column as vscode.ViewColumn,
      { enableScripts: true, retainContextWhenHidden: false }
    );

    const instance = new DecisionDetailPanel(panel, node, decisionService, extensionUri);
    DecisionDetailPanel.panels.set(node.id, instance);
    return instance;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly node: DecisionNode,
    private readonly decisionService: DecisionService,
    private readonly extensionUri: vscode.Uri
  ) {
    this.panel = panel;
    this.panel.webview.html = this._buildHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      null,
      this.disposables
    );

    this.disposables.push(
      this.decisionService.onGraphChange(() => {
        const updated = this.decisionService.getDecision(this.node.id);
        if (updated) {
          this._pushData(updated, this.decisionService);
        }
      })
    );

    this._pushData(node, decisionService);
  }

  private _pushData(node: DecisionNode, decisionService: DecisionService): void {
    const edges = decisionService.getEdgesForDecision(node.id);
    const relatedIds = new Set<string>();
    for (const e of edges) {
      relatedIds.add(e.fromId === node.id ? e.toId : e.fromId);
    }
    const relatedDecisions = decisionService.getDecisions()
      .filter(d => relatedIds.has(d.id));

    const serializableEdges = edges.map(e => ({
      id: e.id,
      fromId: e.fromId,
      toId: e.toId,
      relationType: e.relationType,
      weight: e.weight,
      createdAt: e.createdAt,
      note: e.note,
    }));

    const serializableNode = {
      id: node.id,
      type: node.type,
      payload: node.payload,
      embedding: null,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      authorName: node.authorName,
      authorEmail: node.authorEmail,
    };

    const serializableRelated = relatedDecisions.map(d => ({
      id: d.id,
      type: d.type,
      payload: d.payload,
      embedding: null,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      authorName: d.authorName,
      authorEmail: d.authorEmail,
    }));

    this.panel.webview.postMessage({
      type: 'init',
      node: serializableNode,
      edges: serializableEdges,
      relatedDecisions: serializableRelated,
    });
  }

  private async _handleMessage(msg: any): Promise<void> {
    switch (msg.type) {
      case 'open-file': {
        try {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(msg.path));
          await vscode.window.showTextDocument(doc, { preview: false });
        } catch {
          vscode.window.showWarningMessage(`Could not open: ${msg.path}`);
        }
        break;
      }
      case 'open-decision': {
        const target = this.decisionService.getDecision(msg.nodeId);
        if (target) {
          DecisionDetailPanel.show(target, this.decisionService, this.extensionUri);
        }
        break;
      }
      case 'edit': {
        await vscode.commands.executeCommand('codememory.editDecision', this.node);
        break;
      }
      case 'delete': {
        await vscode.commands.executeCommand('codememory.deleteDecision', this.node);
        break;
      }
    }
  }

  private _buildHtml(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #050508;
      color: #e2e8f0;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      padding: 32px 36px 48px;
      line-height: 1.6;
      min-height: 100vh;
    }

    /* ── Header ─────────────────────────────────────────── */
    .header { margin-bottom: 28px; }
    .header-title {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #f1f5f9;
      margin-bottom: 10px;
      line-height: 1.3;
    }
    .badges { display: flex; gap: 8px; flex-wrap: wrap; }
    .badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      font-family: monospace;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 4px 10px;
      border-radius: 4px;
      line-height: 1;
    }
    .badge-pattern    { background: rgba(77,168,255,0.15); color: #4da8ff; border: 1px solid rgba(77,168,255,0.25); }
    .badge-constraint { background: rgba(255,92,92,0.15);  color: #ff5c5c; border: 1px solid rgba(255,92,92,0.25); }
    .badge-convention { background: rgba(31,214,138,0.15); color: #1fd68a; border: 1px solid rgba(31,214,138,0.25); }
    .badge-why        { background: rgba(245,165,42,0.15); color: #f5a52a; border: 1px solid rgba(245,165,42,0.25); }

    .badge-accepted   { background: rgba(31,214,138,0.12); color: #1fd68a; border: 1px solid rgba(31,214,138,0.2); }
    .badge-proposed   { background: rgba(255,255,255,0.06); color: #8892a8; border: 1px solid rgba(255,255,255,0.1); }
    .badge-deprecated { background: rgba(245,165,42,0.12); color: #f5a52a; border: 1px solid rgba(245,165,42,0.2); }
    .badge-superseded { background: rgba(255,92,92,0.12);  color: #ff5c5c; border: 1px solid rgba(255,92,92,0.2); }

    /* ── Section cards ──────────────────────────────────── */
    .section {
      background: rgba(255,255,255,0.025);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 10px;
      padding: 18px 22px;
      margin-bottom: 16px;
    }
    .section-label {
      font-size: 10px;
      color: #6b7fa8;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-family: monospace;
      margin-bottom: 10px;
    }
    .section-body { font-size: 13px; color: #cbd5e1; line-height: 1.7; }

    /* ── Code context ───────────────────────────────────── */
    .code-block {
      background: rgba(0,0,0,0.4);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 6px;
      padding: 14px 16px;
      font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
      font-size: 12px;
      color: #94a3b8;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.6;
    }

    /* ── File paths ─────────────────────────────────────── */
    .file-list { list-style: none; }
    .file-list li { margin-bottom: 6px; }
    .file-link {
      color: #4da8ff;
      cursor: pointer;
      text-decoration: none;
      font-family: monospace;
      font-size: 12px;
      transition: color 0.15s;
    }
    .file-link:hover { color: #7dc4ff; text-decoration: underline; }

    /* ── Tags ───────────────────────────────────────────── */
    .tags { display: flex; gap: 6px; flex-wrap: wrap; }
    .tag-pill {
      font-size: 11px;
      font-family: monospace;
      padding: 3px 10px;
      border-radius: 12px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
      color: #94a3b8;
    }

    /* ── Related decisions ──────────────────────────────── */
    .related-list { list-style: none; }
    .related-list li {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      padding: 8px 12px;
      border-radius: 6px;
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(255,255,255,0.04);
      transition: background 0.15s;
    }
    .related-list li:hover { background: rgba(255,255,255,0.05); }
    .rel-type {
      font-size: 9px;
      font-family: monospace;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 2px 7px;
      border-radius: 3px;
      flex-shrink: 0;
    }
    .rel-CONFLICTS_WITH { background: rgba(255,92,92,0.15); color: #ff5c5c; }
    .rel-DEPENDS_ON     { background: rgba(245,165,42,0.15); color: #f5a52a; }
    .rel-SUPERSEDES     { background: rgba(167,139,250,0.15); color: #a78bfa; }
    .rel-RELATED_TO     { background: rgba(122,134,166,0.15); color: #7a86a6; }
    .rel-APPLIES_TO     { background: rgba(45,212,191,0.15); color: #2dd4bf; }
    .rel-title {
      font-size: 12px;
      color: #4da8ff;
      cursor: pointer;
      transition: color 0.15s;
    }
    .rel-title:hover { color: #7dc4ff; text-decoration: underline; }

    /* ── Metadata footer ────────────────────────────────── */
    .meta-footer {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid rgba(255,255,255,0.06);
      font-size: 11px;
      font-family: monospace;
      color: #4a5578;
      line-height: 1.8;
    }

    /* ── Action buttons ─────────────────────────────────── */
    .actions { display: flex; gap: 10px; margin-top: 20px; }
    .btn {
      font-family: monospace;
      font-size: 11px;
      padding: 7px 18px;
      border-radius: 6px;
      cursor: pointer;
      letter-spacing: 0.03em;
      border: 1px solid rgba(255,255,255,0.09);
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .btn-edit {
      background: rgba(77,168,255,0.1);
      color: #4da8ff;
      border-color: rgba(77,168,255,0.25);
    }
    .btn-edit:hover { background: rgba(77,168,255,0.2); border-color: rgba(77,168,255,0.4); }
    .btn-delete {
      background: rgba(255,92,92,0.08);
      color: #ff5c5c;
      border-color: rgba(255,92,92,0.2);
    }
    .btn-delete:hover { background: rgba(255,92,92,0.18); border-color: rgba(255,92,92,0.35); }

    .hidden { display: none; }
  </style>
</head>
<body>
  <div id="content">
    <div class="header">
      <div class="header-title" id="title"></div>
      <div class="badges">
        <span class="badge" id="type-badge"></span>
        <span class="badge" id="status-badge"></span>
      </div>
    </div>

    <div class="section">
      <div class="section-label">Rationale</div>
      <div class="section-body" id="rationale"></div>
    </div>

    <div class="section" id="code-section">
      <div class="section-label">Code Context</div>
      <pre class="code-block" id="code-context"></pre>
    </div>

    <div class="section" id="files-section">
      <div class="section-label">File Paths</div>
      <ul class="file-list" id="file-list"></ul>
    </div>

    <div class="section" id="tags-section">
      <div class="section-label">Tags</div>
      <div class="tags" id="tags"></div>
    </div>

    <div class="section" id="related-section">
      <div class="section-label">Related Decisions</div>
      <ul class="related-list" id="related-list"></ul>
    </div>

    <div class="meta-footer" id="meta-footer"></div>

    <div class="actions">
      <button class="btn btn-edit" id="btn-edit">Edit</button>
      <button class="btn btn-delete" id="btn-delete">Delete</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    function esc(str) {
      const el = document.createElement('span');
      el.textContent = str;
      return el.innerHTML;
    }

    function formatDate(iso) {
      try {
        const d = new Date(iso);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      } catch { return iso; }
    }

    function render(node, edges, relatedDecisions) {
      document.getElementById('title').textContent = node.payload.title;

      const typeBadge = document.getElementById('type-badge');
      typeBadge.textContent = node.payload.type;
      typeBadge.className = 'badge badge-' + node.payload.type;

      const statusBadge = document.getElementById('status-badge');
      statusBadge.textContent = node.payload.status;
      statusBadge.className = 'badge badge-' + node.payload.status;

      document.getElementById('rationale').textContent = node.payload.rationale;

      // Code context
      const codeSection = document.getElementById('code-section');
      if (node.payload.codeContext) {
        codeSection.classList.remove('hidden');
        document.getElementById('code-context').textContent = node.payload.codeContext;
      } else {
        codeSection.classList.add('hidden');
      }

      // File paths
      const filesSection = document.getElementById('files-section');
      const fileList = document.getElementById('file-list');
      fileList.innerHTML = '';
      const paths = node.payload.filePaths || [];
      if (paths.length) {
        filesSection.classList.remove('hidden');
        paths.forEach(function(p) {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.className = 'file-link';
          a.textContent = p;
          a.addEventListener('click', function() {
            vscode.postMessage({ type: 'open-file', path: p });
          });
          li.appendChild(a);
          fileList.appendChild(li);
        });
      } else {
        filesSection.classList.add('hidden');
      }

      // Tags
      const tagsSection = document.getElementById('tags-section');
      const tagsEl = document.getElementById('tags');
      tagsEl.innerHTML = '';
      const tags = node.payload.tags || [];
      if (tags.length) {
        tagsSection.classList.remove('hidden');
        tags.forEach(function(t) {
          const pill = document.createElement('span');
          pill.className = 'tag-pill';
          pill.textContent = t;
          tagsEl.appendChild(pill);
        });
      } else {
        tagsSection.classList.add('hidden');
      }

      // Related decisions
      const relatedSection = document.getElementById('related-section');
      const relatedList = document.getElementById('related-list');
      relatedList.innerHTML = '';
      if (edges.length && relatedDecisions.length) {
        relatedSection.classList.remove('hidden');
        const relMap = {};
        relatedDecisions.forEach(function(d) { relMap[d.id] = d; });

        edges.forEach(function(edge) {
          var relatedId = edge.fromId === node.id ? edge.toId : edge.fromId;
          var related = relMap[relatedId];
          if (!related) return;

          var li = document.createElement('li');

          var relType = document.createElement('span');
          relType.className = 'rel-type rel-' + edge.relationType;
          relType.textContent = edge.relationType.replace(/_/g, ' ');
          li.appendChild(relType);

          var relTitle = document.createElement('span');
          relTitle.className = 'rel-title';
          relTitle.textContent = related.payload.title;
          relTitle.addEventListener('click', function() {
            vscode.postMessage({ type: 'open-decision', nodeId: related.id });
          });
          li.appendChild(relTitle);

          if (edge.note) {
            var noteEl = document.createElement('span');
            noteEl.style.cssText = 'font-size:10px;color:#4a5578;font-family:monospace;margin-left:auto;';
            noteEl.textContent = edge.note;
            li.appendChild(noteEl);
          }

          relatedList.appendChild(li);
        });
      } else {
        relatedSection.classList.add('hidden');
      }

      // Metadata footer
      var meta = document.getElementById('meta-footer');
      meta.innerHTML =
        'Created by ' + esc(node.authorName) + ' on ' + formatDate(node.createdAt) + '<br>' +
        'Last updated ' + formatDate(node.updatedAt);
    }

    // --- Buttons ---
    document.getElementById('btn-edit').addEventListener('click', function() {
      vscode.postMessage({ type: 'edit' });
    });
    document.getElementById('btn-delete').addEventListener('click', function() {
      vscode.postMessage({ type: 'delete' });
    });

    // --- Messages from extension ---
    window.addEventListener('message', function(e) {
      var msg = e.data;
      if (msg.type === 'init') {
        render(msg.node, msg.edges, msg.relatedDecisions);
      }
    });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    DecisionDetailPanel.panels.delete(this.node.id);
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
