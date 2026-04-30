import * as vscode from 'vscode';
import { getNonce } from '../utils/getNonce';
import type { DecisionService } from '../decisions/decisionService';

export class GraphPanel implements vscode.Disposable {
  static current: GraphPanel | undefined;
  private static readonly VIEW_TYPE = 'codememory.graphPanel';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private onNodeClick: ((nodeId: string) => void) | undefined;

  static createOrShow(
    extensionUri: vscode.Uri,
    decisionService: DecisionService,
    onNodeClick?: (nodeId: string) => void
  ): GraphPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (GraphPanel.current) {
      GraphPanel.current.panel.reveal(column);
      GraphPanel.current.onNodeClick = onNodeClick;
      return GraphPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      GraphPanel.VIEW_TYPE,
      'CodeMemory — Decision Graph',
      column,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    GraphPanel.current = new GraphPanel(panel, decisionService, extensionUri, onNodeClick);
    return GraphPanel.current;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly decisionService: DecisionService,
    private readonly extensionUri: vscode.Uri,
    onNodeClick?: (nodeId: string) => void
  ) {
    this.panel = panel;
    this.onNodeClick = onNodeClick;
    this.panel.webview.html = this._buildHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg.type === 'node-click' && msg.nodeId && this.onNodeClick) {
          this.onNodeClick(msg.nodeId);
        }
      },
      null,
      this.disposables
    );

    this.disposables.push(
      this.decisionService.onGraphChange(() => this.refresh())
    );

    this.refresh();
  }

  refresh(): void {
    const nodes = this.decisionService.getDecisions();
    const edges = this.decisionService.getAllEdges();

    const edgeCounts = new Map<string, number>();
    for (const e of edges) {
      edgeCounts.set(e.fromId, (edgeCounts.get(e.fromId) ?? 0) + 1);
      edgeCounts.set(e.toId, (edgeCounts.get(e.toId) ?? 0) + 1);
    }

    const graphNodes = nodes.map(n => ({
      id:        n.id,
      title:     n.payload.title,
      type:      n.payload.type,
      status:    n.payload.status,
      edgeCount: edgeCounts.get(n.id) ?? 0,
    }));

    const graphLinks = edges.map(e => ({
      source:       e.fromId,
      target:       e.toId,
      relationType: e.relationType,
      note:         e.note ?? '',
    }));

    this.panel.webview.postMessage({
      type: 'graph-data',
      nodes: graphNodes,
      links: graphLinks,
    });
  }

  private _buildHtml(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com; style-src 'unsafe-inline';">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #050508; overflow: hidden; width: 100vw; height: 100vh; }
    svg { display: block; width: 100%; height: 100%; }

    .tooltip {
      position: absolute;
      pointer-events: none;
      background: rgba(15, 15, 25, 0.92);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px;
      padding: 10px 14px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px;
      color: #e2e8f0;
      max-width: 280px;
      opacity: 0;
      transition: opacity 0.15s ease;
      backdrop-filter: blur(8px);
      z-index: 100;
    }
    .tooltip.visible { opacity: 1; }
    .tooltip .tt-title { font-weight: 700; font-size: 13px; margin-bottom: 4px; }
    .tooltip .tt-type { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.6; margin-bottom: 2px; font-family: monospace; }
    .tooltip .tt-status { font-size: 10px; opacity: 0.5; font-family: monospace; }

    .edge-label {
      font-family: monospace;
      font-size: 9px;
      fill: #6b7fa8;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    .edge-label.visible { opacity: 1; }

    .empty-state {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      font-family: system-ui, sans-serif;
      color: #6b7fa8;
      display: none;
    }
    .empty-state.visible { display: block; }
    .empty-state h2 { font-size: 18px; font-weight: 600; color: #8892a8; margin-bottom: 8px; }
    .empty-state p { font-size: 13px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="tooltip" id="tooltip">
    <div class="tt-type" id="tt-type"></div>
    <div class="tt-title" id="tt-title"></div>
    <div class="tt-status" id="tt-status"></div>
  </div>

  <div class="empty-state" id="empty-state">
    <h2>No decisions yet</h2>
    <p>Capture your first architectural decision with<br><code>Ctrl+Shift+Alt+D</code> to see the graph.</p>
  </div>

  <svg id="graph-svg">
    <defs>
      <marker id="arrow-CONFLICTS_WITH" viewBox="0 -4 8 8" refX="20" refY="0" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0,-4L8,0L0,4" fill="#ff5c5c"/>
      </marker>
      <marker id="arrow-DEPENDS_ON" viewBox="0 -4 8 8" refX="20" refY="0" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0,-4L8,0L0,4" fill="#f5a52a"/>
      </marker>
      <marker id="arrow-SUPERSEDES" viewBox="0 -4 8 8" refX="20" refY="0" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0,-4L8,0L0,4" fill="#a78bfa"/>
      </marker>
      <marker id="arrow-RELATED_TO" viewBox="0 -4 8 8" refX="20" refY="0" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0,-4L8,0L0,4" fill="#7a86a6"/>
      </marker>
      <marker id="arrow-APPLIES_TO" viewBox="0 -4 8 8" refX="20" refY="0" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0,-4L8,0L0,4" fill="#2dd4bf"/>
      </marker>
    </defs>
  </svg>

  <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const NODE_COLORS = {
      pattern:    '#4da8ff',
      constraint: '#ff5c5c',
      convention: '#1fd68a',
      why:        '#f5a52a',
    };

    const EDGE_COLORS = {
      CONFLICTS_WITH: '#ff5c5c',
      DEPENDS_ON:     '#f5a52a',
      SUPERSEDES:     '#a78bfa',
      RELATED_TO:     '#7a86a6',
      APPLIES_TO:     '#2dd4bf',
    };

    const svg       = d3.select('#graph-svg');
    const tooltip   = document.getElementById('tooltip');
    const ttTitle   = document.getElementById('tt-title');
    const ttType    = document.getElementById('tt-type');
    const ttStatus  = document.getElementById('tt-status');
    const emptyEl   = document.getElementById('empty-state');

    let width  = window.innerWidth;
    let height = window.innerHeight;

    const g = svg.append('g');

    const zoom = d3.zoom()
      .scaleExtent([0.15, 5])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom);

    let linkGroup      = g.append('g').attr('class', 'links');
    let edgeLabelGroup = g.append('g').attr('class', 'edge-labels');
    let nodeGroup      = g.append('g').attr('class', 'nodes');

    let simulation = null;

    function truncate(str, max) {
      return str.length > max ? str.slice(0, max) + '…' : str;
    }

    function nodeRadius(d) {
      return Math.sqrt((d.edgeCount || 0) + 1) * 8;
    }

    function renderGraph(nodes, links) {
      if (!nodes.length) {
        emptyEl.classList.add('visible');
        linkGroup.selectAll('*').remove();
        edgeLabelGroup.selectAll('*').remove();
        nodeGroup.selectAll('*').remove();
        if (simulation) { simulation.stop(); simulation = null; }
        return;
      }
      emptyEl.classList.remove('visible');

      linkGroup.selectAll('*').remove();
      edgeLabelGroup.selectAll('*').remove();
      nodeGroup.selectAll('*').remove();


      const linkSel = linkGroup.selectAll('line')
        .data(links)
        .enter()
        .append('line')
        .attr('stroke', d => EDGE_COLORS[d.relationType] || '#7a86a6')
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.5)
        .attr('marker-end', d => 'url(#arrow-' + d.relationType + ')')
        .on('mouseenter', function(event, d) {
          d3.select(this).attr('stroke-opacity', 1).attr('stroke-width', 2.5);
          const label = edgeLabelGroup.selectAll('.edge-label')
            .filter(ld => ld.source.id === d.source.id && ld.target.id === d.target.id);
          label.classed('visible', true);
        })
        .on('mouseleave', function(event, d) {
          d3.select(this).attr('stroke-opacity', 0.5).attr('stroke-width', 1.5);
          edgeLabelGroup.selectAll('.edge-label').classed('visible', false);
        });

      const edgeLabelSel = edgeLabelGroup.selectAll('text')
        .data(links)
        .enter()
        .append('text')
        .attr('class', 'edge-label')
        .attr('text-anchor', 'middle')
        .text(d => d.relationType.replace(/_/g, ' '));


      const nodeSel = nodeGroup.selectAll('g')
        .data(nodes)
        .enter()
        .append('g')
        .attr('cursor', 'pointer')
        .call(d3.drag()
          .on('start', dragStart)
          .on('drag', dragging)
          .on('end', dragEnd)
        );

      nodeSel.append('circle')
        .attr('r', d => nodeRadius(d))
        .attr('fill', d => NODE_COLORS[d.type] || '#4da8ff')
        .attr('fill-opacity', 0.85)
        .attr('stroke', d => NODE_COLORS[d.type] || '#4da8ff')
        .attr('stroke-width', 2)
        .attr('stroke-opacity', 0.3);


      nodeSel.append('circle')
        .attr('r', d => nodeRadius(d) + 6)
        .attr('fill', 'none')
        .attr('stroke', d => NODE_COLORS[d.type] || '#4da8ff')
        .attr('stroke-width', 1)
        .attr('stroke-opacity', 0.1);

      nodeSel.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', d => nodeRadius(d) + 16)
        .attr('fill', '#c8cdd8')
        .attr('font-size', '11px')
        .attr('font-family', 'system-ui, sans-serif')
        .text(d => truncate(d.title, 20));


      nodeSel
        .on('mouseenter', (event, d) => {
          ttType.textContent   = d.type;
          ttTitle.textContent  = d.title;
          ttStatus.textContent = d.status;
          tooltip.classList.add('visible');
        })
        .on('mousemove', (event) => {
          tooltip.style.left = (event.pageX + 14) + 'px';
          tooltip.style.top  = (event.pageY - 14) + 'px';
        })
        .on('mouseleave', () => {
          tooltip.classList.remove('visible');
        })
        .on('click', (event, d) => {
          vscode.postMessage({ type: 'node-click', nodeId: d.id });
        });


      simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(100))
        .force('charge', d3.forceManyBody().strength(-300))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(30));

      simulation.on('tick', () => {
        linkSel
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y);

        edgeLabelSel
          .attr('x', d => (d.source.x + d.target.x) / 2)
          .attr('y', d => (d.source.y + d.target.y) / 2);

        nodeSel.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
      });
    }


    function dragStart(event, d) {
      if (!event.active && simulation) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    function dragging(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }
    function dragEnd(event, d) {
      if (!event.active && simulation) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }


    window.addEventListener('resize', () => {
      width  = window.innerWidth;
      height = window.innerHeight;
      if (simulation) simulation.force('center', d3.forceCenter(width / 2, height / 2)).alpha(0.3).restart();
    });


    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg.type === 'graph-data') {
        renderGraph(msg.nodes || [], msg.links || []);
      }
    });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    GraphPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
