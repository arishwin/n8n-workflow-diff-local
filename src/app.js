import { diffWorkflows, parseWorkflowJson } from './diff.js';
import { buildGraphModel } from './graph.js';
import { GRAPH_ZOOM_STEP, panGraphViewport, resetGraphViewport, zoomGraphViewport } from './graphViewport.js';
import { analyzeShareUrl, decodeDiffFragment } from './shareUrl.js';
import { buildLineDiff, valueToDiffText } from './textDiff.js';

const state = {
  oldWorkflow: null,
  newWorkflow: null,
  diff: null,
  selectedNodeId: null,
  graphViewport: resetGraphViewport(),
  graphDragging: null,
};

const statusLabels = {
  added: 'Added',
  removed: 'Removed',
  modified: 'Modified',
  renamed: 'Renamed',
  'credentials-only': 'Credentials only',
  unchanged: 'Unchanged',
};

const statuses = ['added', 'removed', 'modified', 'renamed', 'credentials-only', 'unchanged'];

const elements = {
  loaderView: document.querySelector('#loader-view'),
  diffView: document.querySelector('#diff-view'),
  diffTitle: document.querySelector('#diff-title'),
  summaryGrid: document.querySelector('#summary-grid'),
  shareMessage: document.querySelector('#share-message'),
  nodeList: document.querySelector('#node-list'),
  nodeDetail: document.querySelector('#node-detail'),
  detailModal: document.querySelector('#detail-modal'),
  detailTitle: document.querySelector('#detail-title'),
  detailClose: document.querySelector('#detail-close'),
  detailBackdrop: document.querySelector('#detail-backdrop'),
  search: document.querySelector('#search'),
  statusFilter: document.querySelector('#status-filter'),
  graphCanvas: document.querySelector('#graph-canvas'),
  graphZoomIn: document.querySelector('#graph-zoom-in'),
  graphZoomOut: document.querySelector('#graph-zoom-out'),
  graphZoomReset: document.querySelector('#graph-zoom-reset'),
  graphZoomLabel: document.querySelector('#graph-zoom-label'),
  connectionList: document.querySelector('#connection-list'),
  connectionCount: document.querySelector('#connection-count'),
};

setupSide('old');
setupSide('new');
loadDiffFromUrl();

document.querySelector('#new-comparison').addEventListener('click', reset);
document.querySelector('#export-html').addEventListener('click', exportHtml);
document.querySelector('#copy-share-url').addEventListener('click', copyShareUrl);
elements.search.addEventListener('input', renderNodeList);
elements.statusFilter.addEventListener('change', renderNodeList);
elements.graphZoomIn.addEventListener('click', () => zoomGraphFromCenter(GRAPH_ZOOM_STEP));
elements.graphZoomOut.addEventListener('click', () => zoomGraphFromCenter(1 / GRAPH_ZOOM_STEP));
elements.graphZoomReset.addEventListener('click', () => {
  state.graphViewport = resetGraphViewport();
  renderGraph();
});
elements.detailClose.addEventListener('click', closeNodeDetail);
elements.detailBackdrop.addEventListener('click', closeNodeDetail);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.detailModal.classList.contains('hidden')) {
    closeNodeDetail();
  }
});

function setupSide(side) {
  const fileInput = document.querySelector(`#${side}-file`);
  const parseButton = document.querySelector(`#${side}-parse`);
  const clearButton = document.querySelector(`#${side}-clear`);
  const textArea = document.querySelector(`#${side}-text`);
  const dropZone = document.querySelector(`.load-panel[data-side="${side}"] .drop-zone`);

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) {
      loadFile(side, file);
    }
  });

  parseButton.addEventListener('click', () => loadText(side, textArea.value));
  clearButton.addEventListener('click', () => {
    setWorkflow(side, null);
    textArea.value = '';
    fileInput.value = '';
    setMessage(side, '', '');
    document.querySelector(`#${side}-file-status`).textContent = 'or drag and drop here';
  });

  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
    const file = event.dataTransfer.files?.[0];
    if (file) {
      loadFile(side, file);
    }
  });
}

function loadFile(side, file) {
  if (!file.name.endsWith('.json')) {
    setMessage(side, 'Only .json files are accepted.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => loadText(side, String(reader.result ?? ''), file.name);
  reader.onerror = () => setMessage(side, 'Could not read file.', 'error');
  reader.readAsText(file);
}

function loadText(side, text, filename = null) {
  if (!text.trim()) {
    setMessage(side, 'Paste workflow JSON first.', 'error');
    return;
  }
  try {
    const workflow = parseWorkflowJson(text);
    setWorkflow(side, workflow);
    const label = filename ?? workflow.name ?? 'Pasted workflow';
    document.querySelector(`#${side}-file-status`).textContent = `${label} - ${workflow.nodes.length} nodes`;
    setMessage(side, `Loaded ${workflow.nodes.length} nodes.`, 'success');
  } catch (error) {
    setMessage(side, readableParseError(error, text), 'error');
  }
}

function setWorkflow(side, workflow) {
  state[`${side}Workflow`] = workflow;
  if (state.oldWorkflow && state.newWorkflow) {
    state.diff = diffWorkflows(state.oldWorkflow, state.newWorkflow);
    state.selectedNodeId = null;
    state.graphViewport = resetGraphViewport();
    showDiff();
  }
}

function showDiff() {
  elements.loaderView.classList.add('hidden');
  elements.diffView.classList.remove('hidden');
  elements.diffTitle.textContent = `${state.diff.oldName} -> ${state.diff.newName}`;
  setShareMessage('Share URLs include the workflow JSON in the URL fragment. Anyone with the link can read it.', 'warning');
  renderSummary();
  renderGraph();
  renderNodeList();
  renderConnections();
  closeNodeDetail();
}

function loadDiffFromUrl() {
  try {
    const decoded = decodeDiffFragment(window.location.hash);
    if (!decoded) {
      return;
    }
    state.oldWorkflow = decoded.oldWorkflow;
    state.newWorkflow = decoded.newWorkflow;
    state.diff = diffWorkflows(state.oldWorkflow, state.newWorkflow);
    state.selectedNodeId = null;
    state.graphViewport = resetGraphViewport();
    showDiff();
    setShareMessage('Loaded diff from URL fragment. The workflow JSON is embedded in this URL.', 'success');
  } catch (error) {
    setMessage('old', `Could not load diff link: ${error.message}`, 'error');
  }
}

async function copyShareUrl() {
  if (!state.oldWorkflow || !state.newWorkflow) {
    return;
  }
  const analysis = analyzeShareUrl(state.oldWorkflow, state.newWorkflow, `${window.location.origin}${window.location.pathname}`);
  const { url } = analysis;
  const fragment = url.split('#')[1];
  history.replaceState(null, '', `${window.location.pathname}#${fragment}`);
  const warningText = analysis.warnings.length ? ` ${analysis.warnings.join(' ')}` : '';
  try {
    await navigator.clipboard.writeText(url);
    setShareMessage(`Copied share URL and updated the address bar. Length: ${analysis.length.toLocaleString()} characters.${warningText}`, analysis.warnings.length ? 'warning' : 'success');
  } catch (error) {
    setShareMessage(`Address bar now contains the share URL. Clipboard copy failed. Length: ${analysis.length.toLocaleString()} characters.${warningText}`, 'warning');
    window.prompt('Copy share URL', url);
  }
}

function renderSummary() {
  elements.summaryGrid.innerHTML = statuses.map((status) => `
    <div class="summary-card">
      <strong>${state.diff.summary[status]}</strong>
      <span>${escapeHtml(statusLabels[status])}</span>
    </div>
  `).join('');
}

function renderNodeList() {
  const query = elements.search.value.trim().toLowerCase();
  const filter = elements.statusFilter.value;
  const nodes = state.diff.nodes.filter((node) => {
    const matchesSearch = !query || node.displayName.toLowerCase().includes(query) || node.nodeType.toLowerCase().includes(query);
    const matchesFilter = filter === 'all'
      || (filter === 'changed' && node.status !== 'unchanged')
      || node.status === filter;
    return matchesSearch && matchesFilter;
  });

  elements.nodeList.innerHTML = nodes.map((node) => `
    <button class="node-item ${state.selectedNodeId === node.nodeId ? 'active' : ''}" data-node-id="${escapeAttribute(node.nodeId)}" type="button">
      <strong>${escapeHtml(node.displayName)}</strong>
      <span class="node-meta">
        <span class="badge ${node.status}">${escapeHtml(statusLabels[node.status])}</span>
        <span class="badge">${escapeHtml(node.nodeType)}</span>
        <span class="badge">${node.changes.length} changes</span>
      </span>
    </button>
  `).join('') || '<div class="empty-detail"><p>No nodes match the current filters.</p></div>';

  elements.nodeList.querySelectorAll('.node-item').forEach((button) => {
    button.addEventListener('click', () => {
      openNodeDetail(button.dataset.nodeId);
    });
  });
}

function openNodeDetail(nodeId) {
  state.selectedNodeId = nodeId;
  renderNodeList();
  renderGraph();
  renderNodeDetail();
  elements.detailModal.classList.remove('hidden');
  elements.detailClose.focus();
}

function closeNodeDetail() {
  state.selectedNodeId = null;
  elements.detailModal.classList.add('hidden');
  elements.nodeDetail.innerHTML = '';
  if (state.diff) {
    renderNodeList();
    renderGraph();
  }
}

function renderNodeDetail() {
  const node = state.diff?.nodes.find((item) => item.nodeId === state.selectedNodeId);
  if (!node) {
    elements.nodeDetail.innerHTML = '';
    return;
  }

  elements.detailTitle.textContent = node.displayName;
  elements.nodeDetail.innerHTML = `
    <div class="node-meta">
      <span class="badge ${node.status}">${escapeHtml(statusLabels[node.status])}</span>
      <span class="badge">${escapeHtml(node.nodeType)}</span>
      <span class="badge">${node.changes.length} changes</span>
    </div>
    ${node.changes.length ? renderChangeTable(node.changes) : '<p class="message">No parameter changes after ignoring n8n metadata noise.</p>'}
  `;
}

function renderChangeTable(changes) {
  return `
    <table class="change-table">
      <thead>
        <tr>
          <th>Field</th>
          <th>Git-style diff</th>
        </tr>
      </thead>
      <tbody>
        ${changes.map((change) => `
          <tr>
            <td><code>${escapeHtml(change.field)}</code><br><span class="badge ${change.changeType}">${escapeHtml(change.changeType)}</span></td>
            <td>${renderGitDiff(change)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderGraph() {
  const graph = buildGraphModel(state.diff);
  elements.graphZoomLabel.textContent = `${Math.round(state.graphViewport.scale * 100)}%`;
  if (!graph.nodes.length) {
    elements.graphCanvas.innerHTML = '<p class="message">No workflow nodes to display.</p>';
    return;
  }

  elements.graphCanvas.innerHTML = `
    <svg class="workflow-graph" viewBox="0 0 ${graph.width} ${graph.height}" role="img" aria-label="Workflow graph with changed nodes highlighted">
      <defs>
        <marker id="arrow-neutral" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z"></path>
        </marker>
      </defs>
      <g class="graph-viewport" transform="translate(${state.graphViewport.x} ${state.graphViewport.y}) scale(${state.graphViewport.scale})">
        <g class="graph-edges">
          ${graph.edges.map((edge) => renderGraphEdge(edge)).join('')}
        </g>
        <g class="graph-nodes">
          ${graph.nodes.map((node) => renderGraphNode(node)).join('')}
        </g>
      </g>
    </svg>
  `;

  installGraphPanZoomHandlers();
  elements.graphCanvas.querySelectorAll('.graph-node').forEach((nodeElement) => {
    const selectGraphNode = () => {
      openNodeDetail(nodeElement.dataset.nodeId);
    };
    nodeElement.addEventListener('click', selectGraphNode);
    nodeElement.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectGraphNode();
      }
    });
  });
}

function installGraphPanZoomHandlers() {
  const svg = elements.graphCanvas.querySelector('.workflow-graph');
  if (!svg) {
    return;
  }

  svg.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    const point = svgPointFromEvent(svg, event);
    const direction = event.deltaY < 0 ? GRAPH_ZOOM_STEP : 1 / GRAPH_ZOOM_STEP;
    state.graphViewport = zoomGraphViewport(state.graphViewport, state.graphViewport.scale * direction, point);
    renderGraph();
  }, { passive: false });

  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.graph-node')) {
      return;
    }
    svg.setPointerCapture(event.pointerId);
    state.graphDragging = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    elements.graphCanvas.classList.add('panning');
  });

  svg.addEventListener('pointermove', (event) => {
    if (!state.graphDragging || state.graphDragging.pointerId !== event.pointerId) {
      return;
    }
    state.graphViewport = panGraphViewport(state.graphViewport, {
      x: event.clientX - state.graphDragging.x,
      y: event.clientY - state.graphDragging.y,
    });
    state.graphDragging = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    applyGraphViewportTransform();
  });

  const stopDrag = (event) => {
    if (state.graphDragging?.pointerId === event.pointerId) {
      state.graphDragging = null;
      elements.graphCanvas.classList.remove('panning');
    }
  };
  svg.addEventListener('pointerup', stopDrag);
  svg.addEventListener('pointercancel', stopDrag);
}

function applyGraphViewportTransform() {
  const viewport = elements.graphCanvas.querySelector('.graph-viewport');
  if (viewport) {
    viewport.setAttribute('transform', `translate(${state.graphViewport.x} ${state.graphViewport.y}) scale(${state.graphViewport.scale})`);
  }
  elements.graphZoomLabel.textContent = `${Math.round(state.graphViewport.scale * 100)}%`;
}

function zoomGraphFromCenter(factor) {
  const svg = elements.graphCanvas.querySelector('.workflow-graph');
  if (!svg) {
    return;
  }
  const rect = svg.getBoundingClientRect();
  state.graphViewport = zoomGraphViewport(state.graphViewport, state.graphViewport.scale * factor, {
    x: rect.width / 2,
    y: rect.height / 2,
  });
  renderGraph();
}

function svgPointFromEvent(svg, event) {
  const rect = svg.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function renderGraphEdge(edge) {
  const controlOffset = Math.max(80, Math.abs(edge.targetX - edge.sourceX) / 2);
  const path = `M ${edge.sourceX} ${edge.sourceY} C ${edge.sourceX + controlOffset} ${edge.sourceY}, ${edge.targetX - controlOffset} ${edge.targetY}, ${edge.targetX} ${edge.targetY}`;
  return `<path class="graph-edge ${edge.status}" d="${path}" marker-end="url(#arrow-neutral)"><title>${escapeHtml(edge.sourceId)} to ${escapeHtml(edge.targetId)} - ${escapeHtml(edge.status)}</title></path>`;
}

function renderGraphNode(node) {
  const selected = state.selectedNodeId === node.id ? 'selected' : '';
  return `
    <g class="graph-node ${node.status} ${selected}" data-node-id="${escapeAttribute(node.id)}" transform="translate(${node.x} ${node.y})" tabindex="0" role="button" aria-label="${escapeAttribute(node.label)}">
      <rect width="${node.width}" height="${node.height}" rx="8"></rect>
      <text class="graph-node-title" x="12" y="24">${escapeSvgText(truncate(node.label, 24))}</text>
      <text class="graph-node-type" x="12" y="45">${escapeSvgText(truncate(node.type, 24))}</text>
      <text class="graph-node-status" x="12" y="62">${escapeSvgText(statusLabels[node.status])}${node.changes ? ` - ${node.changes}` : ''}</text>
    </g>
  `;
}

function renderConnections() {
  const changed = state.diff.connections.filter((connection) => connection.status !== 'unchanged');
  elements.connectionCount.textContent = `${changed.length} changed - ${state.diff.connections.length} total`;
  if (!changed.length) {
    elements.connectionList.innerHTML = '<p class="message">No connection changes found.</p>';
    return;
  }
  elements.connectionList.innerHTML = `
    <table class="connection-table">
      <thead>
        <tr>
          <th>Status</th>
          <th>Type</th>
          <th>From</th>
          <th>Output</th>
          <th>To</th>
        </tr>
      </thead>
      <tbody>
        ${changed.map((connection) => `
          <tr>
            <td><span class="badge ${connection.status}">${escapeHtml(connection.status)}</span></td>
            <td><code>${escapeHtml(connection.connectionType)}</code></td>
            <td>${escapeHtml(connection.sourceNode)}</td>
            <td>${escapeHtml(connection.outputLabel)}</td>
            <td>${escapeHtml(connection.targetNode)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function exportHtml() {
  if (!state.diff) {
    return;
  }
  const html = buildReportHtml(state.diff);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `n8n-diff-${safeName(state.diff.oldName)}-vs-${safeName(state.diff.newName)}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildReportHtml(diff) {
  const changedNodes = diff.nodes.filter((node) => node.status !== 'unchanged');
  const changedConnections = diff.connections.filter((connection) => connection.status !== 'unchanged');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>n8n Diff Report</title>
<style>
body{margin:0;background:#0b0f14;color:#eef2f7;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5;padding:24px}
h1,h2,h3,p{margin:0}h1{margin-bottom:16px}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:16px 0}.card{border:1px solid #2a3545;border-radius:8px;background:#121821;padding:12px}.card strong{display:block;font-size:24px}.card span{color:#94a3b8;font-size:12px;text-transform:uppercase}.node{border:1px solid #2a3545;border-radius:8px;background:#121821;margin:12px 0;padding:14px}.badge{display:inline-block;border-radius:999px;background:#263241;color:#cbd5e1;font-size:12px;padding:2px 8px;margin-right:4px}.added{background:#064e3b;color:#bbf7d0}.removed{background:#4c1d26;color:#fecdd3}.modified{background:#3b2f0b;color:#fef3c7}.renamed{background:#312e81;color:#ddd6fe}.credentials-only{background:#4a2608;color:#fed7aa}.unchanged{background:#273244;color:#cbd5e1}table{width:100%;border-collapse:collapse;margin-top:12px;table-layout:fixed}th,td{border-bottom:1px solid #223044;padding:8px;text-align:left;vertical-align:top;word-break:break-word}th{color:#cbd5e1;font-size:12px;text-transform:uppercase}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}pre{white-space:pre-wrap;background:#070b11;border:1px solid #263241;border-radius:8px;padding:8px;max-height:260px;overflow:auto}.git-diff{padding:8px 0;white-space:pre}.diff-line{display:block;padding:0 8px}.diff-line.same{color:#cbd5e1}.diff-line.added{background:rgba(20,83,45,.45);color:#bbf7d0}.diff-line.removed{background:rgba(127,29,29,.45);color:#fecdd3}.muted{color:#94a3b8}
</style>
</head>
<body>
<p class="muted">Generated locally by n8n Workflow Diff Local. No remote assets.</p>
<h1>${escapeHtml(diff.oldName)} -> ${escapeHtml(diff.newName)}</h1>
<section class="summary">${statuses.map((status) => `<div class="card"><strong>${diff.summary[status]}</strong><span>${escapeHtml(statusLabels[status])}</span></div>`).join('')}</section>
<h2>Node Changes</h2>
${changedNodes.length ? changedNodes.map((node) => `<article class="node"><h3>${escapeHtml(node.displayName)}</h3><span class="badge ${node.status}">${escapeHtml(statusLabels[node.status])}</span><span class="badge">${escapeHtml(node.nodeType)}</span>${node.changes.length ? renderChangeTable(node.changes) : '<p class="muted">No parameter changes.</p>'}</article>`).join('') : '<p class="muted">No node changes.</p>'}
<h2>Connection Changes</h2>
${changedConnections.length ? `<table><thead><tr><th>Status</th><th>Type</th><th>From</th><th>Output</th><th>To</th></tr></thead><tbody>${changedConnections.map((connection) => `<tr><td><span class="badge ${connection.status}">${escapeHtml(connection.status)}</span></td><td><code>${escapeHtml(connection.connectionType)}</code></td><td>${escapeHtml(connection.sourceNode)}</td><td>${escapeHtml(connection.outputLabel)}</td><td>${escapeHtml(connection.targetNode)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No connection changes.</p>'}
</body>
</html>`;
}

function reset() {
  state.oldWorkflow = null;
  state.newWorkflow = null;
  state.diff = null;
  state.selectedNodeId = null;
  state.graphViewport = resetGraphViewport();
  state.graphDragging = null;
  history.replaceState(null, '', window.location.pathname);
  elements.diffView.classList.add('hidden');
  elements.loaderView.classList.remove('hidden');
  setShareMessage('', '');
  for (const side of ['old', 'new']) {
    document.querySelector(`#${side}-file`).value = '';
    document.querySelector(`#${side}-text`).value = '';
    document.querySelector(`#${side}-file-status`).textContent = 'or drag and drop here';
    setMessage(side, '', '');
  }
}

function setShareMessage(message, type) {
  elements.shareMessage.textContent = message;
  elements.shareMessage.className = `share-message ${type}`;
}

function setMessage(side, message, type) {
  const element = document.querySelector(`#${side}-message`);
  element.textContent = message;
  element.className = `message ${type}`;
}

function readableParseError(error, text) {
  if (error instanceof SyntaxError) {
    const match = error.message.match(/position\s+(\d+)/i);
    if (match) {
      const position = Number(match[1]);
      const line = text.slice(0, position).split('\n').length;
      const column = position - text.lastIndexOf('\n', position - 1);
      return `Invalid JSON: ${error.message} at line ${line}, column ${column}`;
    }
  }
  return `Invalid workflow: ${error.message}`;
}

function formatValue(value) {
  if (value === undefined) {
    return '<span class="message">Not set</span>';
  }
  if (value === null || typeof value !== 'object') {
    const text = String(value);
    return text.includes('\n') || text.length > 80 ? `<pre>${escapeHtml(text)}</pre>` : `<code>${escapeHtml(text)}</code>`;
  }
  return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}

function renderGitDiff(change) {
  const lines = buildLineDiff(change.oldValue, change.newValue);
  if (!lines.length) {
    return `<pre class="git-diff"><span class="diff-line same"> ${escapeHtml(valueToDiffText(change.newValue))}</span></pre>`;
  }
  return `
    <pre class="git-diff">${lines.map((line) => {
      const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
      return `<span class="diff-line ${line.type}">${prefix}${escapeHtml(line.value)}</span>`;
    }).join('')}</pre>
  `;
}

function safeName(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'workflow';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function escapeSvgText(value) {
  return escapeHtml(value);
}

function truncate(value, maxLength) {
  const text = String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}
