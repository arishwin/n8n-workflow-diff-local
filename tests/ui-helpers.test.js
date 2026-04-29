import assert from 'node:assert/strict';
import { buildLineDiff } from '../src/textDiff.js';
import { buildGraphModel } from '../src/graph.js';
import { clampGraphScale, panGraphViewport, zoomGraphViewport } from '../src/graphViewport.js';
import { analyzeShareUrl, decodeDiffFragment, encodeDiffFragment } from '../src/shareUrl.js';

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('buildLineDiff marks common, removed, and added lines in order', () => {
  const diff = buildLineDiff('one\ntwo\nthree', 'one\ntwo changed\nthree\nfour');

  assert.deepEqual(diff, [
    { type: 'same', value: 'one' },
    { type: 'removed', value: 'two' },
    { type: 'added', value: 'two changed' },
    { type: 'same', value: 'three' },
    { type: 'added', value: 'four' },
  ]);
});

test('buildLineDiff handles scalar additions and removals', () => {
  assert.deepEqual(buildLineDiff(undefined, 'new value'), [{ type: 'added', value: 'new value' }]);
  assert.deepEqual(buildLineDiff('old value', undefined), [{ type: 'removed', value: 'old value' }]);
});

test('buildGraphModel uses n8n positions when available and creates edge paths', () => {
  const diff = {
    nodes: [
      {
        nodeId: '1',
        displayName: 'Start',
        nodeType: 'manualTrigger',
        status: 'unchanged',
        oldNode: { name: 'Start', position: [0, 0] },
        newNode: { name: 'Start', position: [0, 0] },
      },
      {
        nodeId: '2',
        displayName: 'Set',
        nodeType: 'set',
        status: 'modified',
        oldNode: { name: 'Set', position: [320, 160] },
        newNode: { name: 'Set', position: [320, 160] },
      },
    ],
    connections: [
      { status: 'unchanged', sourceNode: 'Start', targetNode: 'Set', connectionType: 'main' },
    ],
  };

  const graph = buildGraphModel(diff);

  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.deepEqual(
    graph.nodes.map((node) => ({ name: node.name, x: node.x, y: node.y, status: node.status })),
    [
      { name: 'Start', x: 40, y: 40, status: 'unchanged' },
      { name: 'Set', x: 360, y: 200, status: 'modified' },
    ],
  );
  assert.equal(graph.edges[0].sourceId, '1');
  assert.equal(graph.edges[0].targetId, '2');
});

test('buildGraphModel gives nodes without positions stable fallback locations', () => {
  const diff = {
    nodes: [
      { nodeId: 'a', displayName: 'A', nodeType: 'set', status: 'added', newNode: { name: 'A' } },
      { nodeId: 'b', displayName: 'B', nodeType: 'set', status: 'removed', oldNode: { name: 'B' } },
    ],
    connections: [],
  };

  const graph = buildGraphModel(diff);

  assert.equal(graph.nodes[0].x, 40);
  assert.equal(graph.nodes[0].y, 40);
  assert.equal(graph.nodes[1].x, 320);
  assert.equal(graph.nodes[1].y, 40);
});

test('clampGraphScale keeps zoom inside supported range', () => {
  assert.equal(clampGraphScale(0.1), 0.35);
  assert.equal(clampGraphScale(1.2), 1.2);
  assert.equal(clampGraphScale(6), 3);
});

test('zoomGraphViewport keeps the cursor point anchored', () => {
  const viewport = zoomGraphViewport(
    { scale: 1, x: 0, y: 0 },
    2,
    { x: 100, y: 50 },
  );

  assert.deepEqual(viewport, { scale: 2, x: -100, y: -50 });
});

test('panGraphViewport offsets the graph by drag delta', () => {
  const viewport = panGraphViewport({ scale: 1.5, x: 10, y: 20 }, { x: -5, y: 15 });

  assert.deepEqual(viewport, { scale: 1.5, x: 5, y: 35 });
});

test('encodeDiffFragment and decodeDiffFragment round-trip workflow data', () => {
  const oldWorkflow = { name: 'Old', nodes: [{ id: '1', name: 'Start' }], connections: {} };
  const newWorkflow = { name: 'New', nodes: [{ id: '1', name: 'Start' }], connections: {} };
  const fragment = encodeDiffFragment(oldWorkflow, newWorkflow);
  const decoded = decodeDiffFragment(`#${fragment}`);

  assert.equal(fragment.startsWith('diff='), true);
  assert.deepEqual(decoded, { oldWorkflow, newWorkflow });
});

test('decodeDiffFragment ignores unrelated hashes', () => {
  assert.equal(decodeDiffFragment('#section-one'), null);
  assert.equal(decodeDiffFragment(''), null);
});

test('analyzeShareUrl warns about long URLs and credentials', () => {
  const oldWorkflow = {
    name: 'Old',
    nodes: [{
      id: '1',
      name: 'HTTP',
      credentials: { githubApi: { id: 'secret-ish', name: 'Github Access Token' } },
      parameters: { url: 'http://internal.service.local/path' },
    }],
    connections: {},
  };
  const newWorkflow = {
    ...oldWorkflow,
    name: 'New',
    nodes: [{ ...oldWorkflow.nodes[0], parameters: { text: 'x'.repeat(9000) } }],
  };
  const analysis = analyzeShareUrl(oldWorkflow, newWorkflow, 'http://localhost:4174/');

  assert.equal(analysis.hasCredentials, true);
  assert.equal(analysis.hasUrls, true);
  assert.equal(analysis.isLong, true);
  assert.equal(analysis.warnings.length >= 3, true);
});
