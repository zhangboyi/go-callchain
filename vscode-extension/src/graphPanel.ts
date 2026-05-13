import * as vscode from 'vscode';
import * as path from 'path';
import { graphCanvasDimensions, graphNodePosition } from './graphLayout';
import { changedFunctionIDSet } from './graphChangedFunctions';
import { graphEdgeTooltip, graphNodeTooltip, graphTooltipDelayMs, truncateText } from './graphTooltip';
import { graphToolbarActions } from './graphToolbar';
import { copyPngToClipboard } from './pngClipboard';
import { pngDataUrlToBuffer } from './pngDataUrl';
import type { CallTreeNode, ChangedFunction, FunctionCallchainResponse, GoFunction } from './types';
import { shortFunctionName } from './treeItems';

interface GraphNode {
  key: string;
  functionID: string;
  label: string;
  detail: string;
  depth: number;
  y: number;
  changed: boolean;
}

interface GraphEdge {
  from: string;
  to: string;
  source?: string;
  confidence?: string;
}

export class CallchainGraphPanel {
  private panel?: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  show(
    context: vscode.ExtensionContext,
    callchain: FunctionCallchainResponse,
    functions: GoFunction[],
    changedFunctions: readonly ChangedFunction[] = [],
  ): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'goCallchain.graph',
        'Callchain Graph',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        },
      );
      this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
      this.panel.webview.onDidReceiveMessage(
        async (message: { command?: string; functionID?: string; dataUrl?: string; title?: string; copiedInWebview?: boolean }) => {
          if (message.command === 'openFunction' && message.functionID) {
            void vscode.commands.executeCommand('goCallchain.openFunction', message.functionID);
            return;
          }
          if (message.command === 'exportPng' && message.dataUrl) {
            await savePng(message.dataUrl, message.title ?? 'callchain-graph');
            return;
          }
          if (message.command === 'copyPng') {
            if (message.copiedInWebview) {
              void vscode.window.showInformationMessage('Callchain graph copied to clipboard');
              return;
            }
            if (!message.dataUrl) {
              throw new Error('missing PNG clipboard payload');
            }
            await copyPngToClipboard(message.dataUrl);
            void vscode.window.showInformationMessage('Callchain graph copied to clipboard');
            return;
          }
          if (message.command === 'fullscreen') {
            await vscode.commands.executeCommand('workbench.action.toggleMaximizeEditorGroup');
          }
        },
        null,
        this.disposables,
      );
      context.subscriptions.push(this.panel);
    }
    this.panel.title = `Callchain Graph: ${shortFunctionName(callchain.function)}`;
    this.panel.webview.html = renderGraphHtml(this.panel.webview, callchain, functions, changedFunctions);
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  dispose(): void {
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
    this.panel = undefined;
  }
}

async function savePng(dataUrl: string, title: string): Promise<void> {
  const buffer = pngDataUrlToBuffer(dataUrl);
  const defaultName = `${safeFileName(title)}.png`;
  const defaultUri = vscode.workspace.workspaceFolders?.[0]
    ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, defaultName)
    : vscode.Uri.file(path.join(process.cwd(), defaultName));
  const target = await vscode.window.showSaveDialog({
    title: 'Export Callchain Graph PNG',
    defaultUri,
    filters: {
      PNG: ['png'],
    },
  });
  if (!target) {
    return;
  }
  await vscode.workspace.fs.writeFile(target, buffer);
  void vscode.window.showInformationMessage(`Callchain graph exported: ${target.fsPath}`);
}

function safeFileName(value: string): string {
  return value.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'callchain-graph';
}

function renderGraphHtml(
  webview: vscode.Webview,
  callchain: FunctionCallchainResponse,
  functions: GoFunction[],
  changedFunctions: readonly ChangedFunction[] = [],
): string {
  const nonce = createNonce();
  const graph = buildGraph(callchain.tree, functions, changedFunctionIDSet(changedFunctions));
  const svg = renderSvg(graph.nodes, graph.edges);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Callchain Graph</title>
	  <style>
	    html {
	      height: 100%;
	    }
	    body {
	      margin: 0;
	      height: 100vh;
	      overflow: hidden;
	      color: var(--vscode-foreground);
	      background: var(--vscode-editor-background);
	      font-family: var(--vscode-font-family);
	      display: flex;
	      flex-direction: column;
	    }
	    .toolbar {
	      position: sticky;
	      top: 0;
	      z-index: 1;
	      display: flex;
	      flex: 0 0 auto;
	      flex-wrap: wrap;
	      gap: 12px;
	      align-items: center;
	      padding: 10px 14px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editor-background);
    }
	    .title {
	      font-weight: 600;
	      min-width: 260px;
	      max-width: min(640px, 100%);
	      overflow: hidden;
	      text-overflow: ellipsis;
	      white-space: nowrap;
	    }
	    .meta {
	      color: var(--vscode-descriptionForeground);
	      font-size: 12px;
	      white-space: nowrap;
	    }
    .spacer {
      flex: 1;
    }
    .toolbar button,
    .graph-actions summary {
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      padding: 4px 9px;
      cursor: pointer;
      font: inherit;
      font-size: 12px;
    }
    .toolbar button:hover,
    .graph-actions summary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .graph-actions {
      position: relative;
    }
    .graph-actions summary {
      list-style: none;
    }
    .graph-actions summary::-webkit-details-marker {
      display: none;
    }
    .action-menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      z-index: 3;
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 168px;
      padding: 6px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      background: var(--vscode-dropdown-background, var(--vscode-editor-background));
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
    }
    .action-menu button {
      width: 100%;
      border: 0;
      color: var(--vscode-foreground);
      background: transparent;
      text-align: left;
    }
    .action-menu button:hover {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-hoverBackground);
    }
	    .stage {
	      flex: 1 1 auto;
	      min-height: 0;
	      overflow: auto;
	      background: var(--vscode-editor-background);
	      cursor: grab;
	      user-select: none;
	    }
    .stage.dragging {
      cursor: grabbing;
    }
	    svg {
	      display: block;
	      background: transparent;
	    }
    .edge {
      fill: none;
      stroke: var(--vscode-descriptionForeground);
      stroke-width: 1.4;
      opacity: 0.65;
    }
    .edge-label {
      fill: var(--vscode-descriptionForeground);
      font-size: 11px;
    }
    .node rect {
      fill: var(--vscode-sideBar-background);
      stroke: var(--vscode-focusBorder);
      stroke-width: 1.1;
      rx: 6;
    }
    .node.root rect {
      stroke: var(--vscode-charts-green);
      stroke-width: 1.6;
    }
    .node.changed rect {
      fill: var(--vscode-inputValidation-errorBackground, var(--vscode-sideBar-background));
      stroke: var(--vscode-charts-red);
      stroke-width: 2;
    }
    .node.changed text.label {
      fill: var(--vscode-errorForeground, var(--vscode-foreground));
    }
    .node text.label {
      fill: var(--vscode-foreground);
      font-size: 13px;
      font-weight: 600;
    }
    .node text.detail {
      fill: var(--vscode-descriptionForeground);
      font-size: 11px;
    }
    .node {
      cursor: grab;
    }
    .node.dragging {
      cursor: grabbing;
    }
    .node:hover rect {
      stroke: var(--vscode-charts-yellow);
      stroke-width: 1.8;
    }
    .node.collapsed rect {
      stroke-dasharray: 5 3;
    }
    .collapse-toggle {
      cursor: pointer;
    }
    .collapse-toggle circle {
      fill: var(--vscode-button-background);
      stroke: var(--vscode-button-border, transparent);
      stroke-width: 1;
    }
    .collapse-toggle text {
      fill: var(--vscode-button-foreground);
      font-size: 14px;
      font-weight: 700;
      text-anchor: middle;
      pointer-events: none;
      user-select: none;
    }
    .collapse-toggle:hover circle {
      fill: var(--vscode-button-hoverBackground);
    }
    .quick-tooltip {
      position: fixed;
      z-index: 10;
      max-width: min(520px, calc(100vw - 28px));
      padding: 6px 8px;
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 4px;
      color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground));
      background: var(--vscode-editorHoverWidget-background, var(--vscode-editor-background));
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.32);
      font-size: 12px;
      line-height: 1.35;
      white-space: pre-wrap;
      pointer-events: none;
    }
    .quick-tooltip[hidden] {
      display: none;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="title">${escapeHtml(shortFunctionName(callchain.function))}</div>
    <div class="meta">${graph.nodes.length} nodes · ${graph.edges.length} edges</div>
    <div class="meta">Drag cards to rearrange · drag background to pan</div>
    <div class="spacer"></div>
    <details class="graph-actions" id="graph-actions-menu">
      <summary data-tooltip="Graph actions">Graph Actions</summary>
      <div class="action-menu" role="menu">
        ${renderGraphActionButtons()}
      </div>
    </details>
  </div>
  <div class="stage">${svg}</div>
  <div class="quick-tooltip" id="quick-tooltip" hidden></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const svg = document.getElementById('callchain-svg');
    const viewport = document.getElementById('viewport');
    const stage = document.querySelector('.stage');
    const nodeWidth = Number(svg.dataset.nodeWidth);
    const nodeHeight = Number(svg.dataset.nodeHeight);
    let panX = 0;
	    let panY = 0;
	    let dragState = null;
    let suppressClick = false;
    let tooltipTimer = null;
    let tooltipTarget = null;
    const graphChildren = new Map();
    const collapsedNodeKeys = new Set();
    const tooltipDelayMs = ${graphTooltipDelayMs()};
    const tooltip = document.getElementById('quick-tooltip');

    document.querySelectorAll('.edge-group').forEach((edge) => {
      const values = graphChildren.get(edge.dataset.from) || [];
      values.push(edge.dataset.to);
      graphChildren.set(edge.dataset.from, values);
    });

	    requestAnimationFrame(() => {
	      stage.scrollLeft = 0;
	      stage.scrollTop = 0;
	      document.documentElement.scrollTop = 0;
	      document.body.scrollTop = 0;
	    });

    function applyPan() {
      viewport.setAttribute('transform', 'translate(' + panX + ' ' + panY + ')');
    }

    function nodePosition(node) {
      return {
        x: Number(node.dataset.x),
        y: Number(node.dataset.y),
      };
    }

    function setNodePosition(node, x, y) {
      node.dataset.x = String(x);
      node.dataset.y = String(y);
      node.setAttribute('transform', 'translate(' + x + ', ' + y + ')');
    }

    function edgePath(from, to) {
      const startX = from.x + nodeWidth;
      const startY = from.y + nodeHeight / 2;
      const endX = to.x;
      const endY = to.y + nodeHeight / 2;
      const midX = startX + (endX - startX) / 2;
      return {
        d: 'M ' + startX + ' ' + startY + ' C ' + midX + ' ' + startY + ', ' + midX + ' ' + endY + ', ' + endX + ' ' + endY,
        labelX: midX - 38,
        labelY: Math.min(startY, endY) + Math.abs(endY - startY) / 2 - 6,
      };
    }

    function updateEdge(edge) {
      const fromNode = document.querySelector('[data-node-key="' + edge.dataset.from + '"]');
      const toNode = document.querySelector('[data-node-key="' + edge.dataset.to + '"]');
      if (!fromNode || !toNode) {
        return;
      }
      const next = edgePath(nodePosition(fromNode), nodePosition(toNode));
      edge.querySelector('path')?.setAttribute('d', next.d);
      const label = edge.querySelector('.edge-label');
      if (label) {
        label.setAttribute('x', String(next.labelX));
        label.setAttribute('y', String(next.labelY));
      }
    }

    function updateConnectedEdges(nodeKey) {
      document.querySelectorAll('.edge-group').forEach((edge) => {
        if (edge.dataset.from === nodeKey || edge.dataset.to === nodeKey) {
          updateEdge(edge);
        }
      });
    }

    function collectDescendants(nodeKey, output) {
      for (const childKey of graphChildren.get(nodeKey) || []) {
        if (output.has(childKey)) {
          continue;
        }
        output.add(childKey);
        collectDescendants(childKey, output);
      }
    }

    function hiddenNodeKeys() {
      const hidden = new Set();
      collapsedNodeKeys.forEach((nodeKey) => collectDescendants(nodeKey, hidden));
      return hidden;
    }

    function syncCollapsedGraph() {
      const hidden = hiddenNodeKeys();
      document.querySelectorAll('.node').forEach((node) => {
        node.style.display = hidden.has(node.dataset.nodeKey) ? 'none' : '';
        node.classList.toggle('collapsed', collapsedNodeKeys.has(node.dataset.nodeKey));
      });
      document.querySelectorAll('.edge-group').forEach((edge) => {
        edge.style.display = hidden.has(edge.dataset.from) || hidden.has(edge.dataset.to) ? 'none' : '';
      });
      document.querySelectorAll('[data-node-toggle]').forEach((toggle) => {
        const collapsed = collapsedNodeKeys.has(toggle.dataset.nodeToggle);
        toggle.querySelector('.toggle-icon').textContent = collapsed ? '+' : '−';
        toggle.setAttribute('aria-label', collapsed ? 'Expand descendants' : 'Collapse descendants');
        toggle.dataset.tooltip = collapsed ? 'Expand descendants' : 'Collapse descendants';
      });
    }

    function toggleCollapsedNode(nodeKey) {
      if (collapsedNodeKeys.has(nodeKey)) {
        collapsedNodeKeys.delete(nodeKey);
      } else {
        collapsedNodeKeys.add(nodeKey);
      }
      syncCollapsedGraph();
      hideTooltip();
    }

    function moveTooltip(event) {
      const offset = 12;
      const clientX = typeof event.clientX === 'number' ? event.clientX : window.innerWidth / 2;
      const clientY = typeof event.clientY === 'number' ? event.clientY : 24;
      const maxLeft = window.innerWidth - tooltip.offsetWidth - offset;
      const maxTop = window.innerHeight - tooltip.offsetHeight - offset;
      tooltip.style.left = Math.max(offset, Math.min(clientX + offset, maxLeft)) + 'px';
      tooltip.style.top = Math.max(offset, Math.min(clientY + offset, maxTop)) + 'px';
    }

    function scheduleTooltip(target, event) {
      const text = target.dataset.tooltip;
      if (!text) {
        return;
      }
      tooltipTarget = target;
      window.clearTimeout(tooltipTimer);
      moveTooltip(event);
      tooltipTimer = window.setTimeout(() => {
        if (tooltipTarget !== target) {
          return;
        }
        tooltip.textContent = text;
        tooltip.hidden = false;
        moveTooltip(event);
      }, tooltipDelayMs);
    }

    function hideTooltip() {
      tooltipTarget = null;
      window.clearTimeout(tooltipTimer);
      tooltip.hidden = true;
    }

    document.querySelectorAll('[data-tooltip]').forEach((target) => {
      target.addEventListener('pointerenter', (event) => scheduleTooltip(target, event));
      target.addEventListener('pointermove', moveTooltip);
      target.addEventListener('pointerleave', hideTooltip);
      target.addEventListener('pointerdown', hideTooltip);
      target.addEventListener('focusin', (event) => scheduleTooltip(target, event));
      target.addEventListener('focusout', hideTooltip);
    });
    stage.addEventListener('scroll', hideTooltip);

    document.querySelectorAll('[data-node-toggle]').forEach((toggle) => {
      toggle.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
      });
      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleCollapsedNode(toggle.dataset.nodeToggle);
      });
      toggle.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        toggleCollapsedNode(toggle.dataset.nodeToggle);
      });
    });

    function finishDrag(event) {
      if (!dragState) {
        return;
      }
      if (dragState.type === 'node') {
        dragState.node.classList.remove('dragging');
        dragState.node.releasePointerCapture(event.pointerId);
	      } else {
	        stage.classList.remove('dragging');
	        stage.releasePointerCapture(event.pointerId);
	      }
      suppressClick = dragState.moved;
      dragState = null;
      setTimeout(() => {
        suppressClick = false;
      }, 0);
    }

    document.querySelectorAll('[data-function-id]').forEach((node) => {
      node.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) {
          return;
        }
        if (event.target.closest('[data-node-toggle]')) {
          return;
        }
        event.stopPropagation();
        const pos = nodePosition(node);
        dragState = {
          type: 'node',
          node,
          nodeKey: node.dataset.nodeKey,
          startX: event.clientX,
          startY: event.clientY,
          originalX: pos.x,
          originalY: pos.y,
          moved: false,
        };
        node.classList.add('dragging');
        node.setPointerCapture(event.pointerId);
      });
      node.addEventListener('pointermove', (event) => {
        if (!dragState || dragState.type !== 'node' || dragState.node !== node) {
          return;
        }
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;
        if (Math.abs(dx) + Math.abs(dy) > 3) {
          dragState.moved = true;
        }
        setNodePosition(node, dragState.originalX + dx, dragState.originalY + dy);
        updateConnectedEdges(dragState.nodeKey);
      });
      node.addEventListener('pointerup', finishDrag);
      node.addEventListener('pointercancel', finishDrag);
      node.addEventListener('click', (event) => {
        if (event.target.closest('[data-node-toggle]')) {
          return;
        }
        if (suppressClick) {
          return;
        }
        vscode.postMessage({ command: 'openFunction', functionID: node.getAttribute('data-function-id') });
      });
    });

	    stage.addEventListener('pointerdown', (event) => {
	      if (event.button !== 0 || event.target.closest('.node')) {
	        return;
	      }
      dragState = {
        type: 'pan',
        startX: event.clientX,
        startY: event.clientY,
        originalX: panX,
        originalY: panY,
        moved: false,
	      };
	      stage.classList.add('dragging');
	      stage.setPointerCapture(event.pointerId);
	    });
	    stage.addEventListener('pointermove', (event) => {
	      if (!dragState || dragState.type !== 'pan') {
	        return;
	      }
      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        dragState.moved = true;
      }
      panX = dragState.originalX + dx;
	      panY = dragState.originalY + dy;
	      applyPan();
	    });
	    stage.addEventListener('pointerup', finishDrag);
	    stage.addEventListener('pointercancel', finishDrag);

    document.getElementById('reset-layout').addEventListener('click', () => {
      closeGraphActionsMenu();
      panX = 0;
      panY = 0;
      applyPan();
      collapsedNodeKeys.clear();
      syncCollapsedGraph();
      document.querySelectorAll('.node').forEach((node) => {
        setNodePosition(node, Number(node.dataset.originalX), Number(node.dataset.originalY));
      });
      document.querySelectorAll('.edge-group').forEach(updateEdge);
    });

    document.getElementById('export-png').addEventListener('click', () => {
      closeGraphActionsMenu();
      exportPng('export').catch((error) => {
        console.error(error);
      });
    });

    document.getElementById('copy-png').addEventListener('click', () => {
      closeGraphActionsMenu();
      exportPng('copy').catch((error) => {
        console.error(error);
      });
    });

    document.getElementById('fullscreen-graph').addEventListener('click', () => {
      closeGraphActionsMenu();
      vscode.postMessage({ command: 'fullscreen' });
    });

    function closeGraphActionsMenu() {
      document.getElementById('graph-actions-menu').removeAttribute('open');
    }

    async function exportPng(mode) {
      const clone = svg.cloneNode(true);
      const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      style.textContent = exportSvgCss();
      clone.insertBefore(style, clone.firstChild);
      const data = new XMLSerializer().serializeToString(clone);
      const blob = new Blob([data], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      try {
        const image = await loadImage(url);
        const canvas = document.createElement('canvas');
        const viewBox = svg.viewBox.baseVal;
        canvas.width = Math.ceil(viewBox.width);
        canvas.height = Math.ceil(viewBox.height);
        const context = canvas.getContext('2d');
        context.fillStyle = cssColor('--vscode-editor-background', '#1e1e1e');
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        if (mode === 'copy') {
          if (navigator.clipboard && window.ClipboardItem) {
            try {
              const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
              vscode.postMessage({ command: 'copyPng', copiedInWebview: true });
              return;
            } catch (error) {
              console.warn(error);
            }
          }
          vscode.postMessage({ command: 'copyPng', dataUrl });
          return;
        }
        vscode.postMessage({
          command: 'exportPng',
          title: '${escapeJsString(shortFunctionName(callchain.function))}',
          dataUrl,
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    function loadImage(url) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      });
    }

    function cssColor(name, fallback) {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    }

    function exportSvgCss() {
      return '.edge{fill:none;stroke:' + cssColor('--vscode-descriptionForeground', '#999') + ';stroke-width:1.4;opacity:.65}' +
        '.edge-label{fill:' + cssColor('--vscode-descriptionForeground', '#999') + ';font-size:11px}' +
        '.node rect{fill:' + cssColor('--vscode-sideBar-background', '#252526') + ';stroke:' + cssColor('--vscode-focusBorder', '#007acc') + ';stroke-width:1.1;rx:6}' +
        '.node.root rect{stroke:' + cssColor('--vscode-charts-green', '#89d185') + ';stroke-width:1.6}' +
        '.node.changed rect{fill:' + cssColor('--vscode-inputValidation-errorBackground', '#3f1111') + ';stroke:' + cssColor('--vscode-charts-red', '#f14c4c') + ';stroke-width:2}' +
        '.node text.label{fill:' + cssColor('--vscode-foreground', '#ddd') + ';font-size:13px;font-weight:600}' +
        '.node text.detail{fill:' + cssColor('--vscode-descriptionForeground', '#999') + ';font-size:11px}' +
        '.node.collapsed rect{stroke-dasharray:5 3}' +
        '.collapse-toggle circle{fill:' + cssColor('--vscode-button-background', '#0e639c') + ';stroke:' + cssColor('--vscode-button-border', 'transparent') + ';stroke-width:1}' +
        '.collapse-toggle text{fill:' + cssColor('--vscode-button-foreground', '#fff') + ';font-size:14px;font-weight:700;text-anchor:middle}';
    }
  </script>
</body>
</html>`;
}

function renderGraphActionButtons(): string {
  return graphToolbarActions()
    .map((action) => `<button type="button" role="menuitem" id="${action.id}" data-tooltip="${escapeAttr(action.title)}">${escapeHtml(action.label)}</button>`)
    .join('');
}

function buildGraph(
  root: CallTreeNode,
  functions: GoFunction[],
  changedFunctionIDs: Set<string> = new Set(),
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const functionIndex = new Map(functions.map((fn) => [fn.id, fn]));
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const levelCounts = new Map<number, number>();

  function visit(node: CallTreeNode, depth: number, parentKey?: string, siblingIndex = 0): void {
    const count = levelCounts.get(depth) ?? 0;
    levelCounts.set(depth, count + 1);
    const key = `${depth}-${count}-${siblingIndex}-${nodes.length}`;
    const fn = functionIndex.get(node.function);
    nodes.push({
      key,
      functionID: node.function,
      label: shortFunctionName(node.function),
      detail: fn ? `${fn.file}:${fn.start_line}` : packageHint(node.function),
      depth,
      y: count,
      changed: changedFunctionIDs.has(node.function),
    });
    if (parentKey) {
      edges.push({
        from: parentKey,
        to: key,
        source: node.edge?.source,
        confidence: node.edge?.confidence,
      });
    }
    (node.children ?? []).forEach((child, index) => visit(child, depth + 1, key, index));
  }

  visit(root, 0);
  return { nodes, edges };
}

function renderSvg(nodes: GraphNode[], edges: GraphEdge[]): string {
  const maxDepth = Math.max(0, ...nodes.map((node) => node.depth));
  const maxY = Math.max(0, ...nodes.map((node) => node.y));
  const {
    width,
    height,
    nodeWidth,
    nodeHeight,
  } = graphCanvasDimensions(maxDepth, maxY);
  const positions = new Map(nodes.map((node) => [node.key, graphNodePosition(node)]));
  const childCounts = new Map<string, number>();
  for (const edge of edges) {
    childCounts.set(edge.from, (childCounts.get(edge.from) ?? 0) + 1);
  }

  const edgeSvg = edges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) {
      return '';
    }
    const startX = from.x + nodeWidth;
    const startY = from.y + nodeHeight / 2;
    const endX = to.x;
    const endY = to.y + nodeHeight / 2;
    const midX = startX + (endX - startX) / 2;
    const label = [edge.source, edge.confidence].filter(Boolean).join(' ');
    const tooltip = graphEdgeTooltip(edge);
    return `<g class="edge-group" data-from="${escapeAttr(edge.from)}" data-to="${escapeAttr(edge.to)}"${tooltip ? ` data-tooltip="${escapeAttr(tooltip)}"` : ''}>
  <path class="edge" d="M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}" />
  ${label ? `<text class="edge-label" x="${midX - 38}" y="${Math.min(startY, endY) + Math.abs(endY - startY) / 2 - 6}">${escapeHtml(label)}</text>` : ''}
</g>`;
  }).join('\n');

  const nodeSvg = nodes.map((node) => {
    const pos = positions.get(node.key);
    if (!pos) {
      return '';
    }
    const label = truncateText(node.label, 40);
    const detail = truncateText(node.detail, 52);
    const className = ['node', node.depth === 0 ? 'root' : '', node.changed ? 'changed' : ''].filter(Boolean).join(' ');
    const toggle = childCounts.has(node.key)
      ? `<g class="collapse-toggle" data-node-toggle="${escapeAttr(node.key)}" data-tooltip="Collapse descendants" role="button" tabindex="0" aria-label="Collapse descendants">
  <circle cx="${nodeWidth - 20}" cy="20" r="10" />
  <text class="toggle-icon" x="${nodeWidth - 20}" y="25">−</text>
</g>`
      : '';
    return `<g class="${className}" transform="translate(${pos.x}, ${pos.y})" data-function-id="${escapeAttr(node.functionID)}" data-node-key="${escapeAttr(node.key)}" data-x="${pos.x}" data-y="${pos.y}" data-original-x="${pos.x}" data-original-y="${pos.y}" data-tooltip="${escapeAttr(graphNodeTooltip(node))}">
  <rect width="${nodeWidth}" height="${nodeHeight}" />
  <text class="label" x="14" y="27">${escapeHtml(label)}</text>
  <text class="detail" x="14" y="51">${escapeHtml(detail)}</text>
  ${toggle}
</g>`;
  }).join('\n');

  return `<svg id="callchain-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Callchain graph" data-node-width="${nodeWidth}" data-node-height="${nodeHeight}">
<g id="viewport">
${edgeSvg}
${nodeSvg}
</g>
</svg>`;
}

function packageHint(functionID: string): string {
  const parts = functionID.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : functionID;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function escapeJsString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
