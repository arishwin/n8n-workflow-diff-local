import assert from 'node:assert/strict';
import { diffWorkflows, parseWorkflowJson } from '../src/diff.js';

function workflow(overrides = {}) {
  return {
    name: 'Workflow',
    nodes: [
      {
        id: '1',
        name: 'Manual Trigger',
        type: 'n8n-nodes-base.manualTrigger',
        position: [0, 0],
        parameters: {},
      },
    ],
    connections: {},
    ...overrides,
  };
}

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('parseWorkflowJson unwraps n8n API data arrays', () => {
  const parsed = parseWorkflowJson(JSON.stringify({ data: [workflow({ name: 'From API' })] }));

  assert.equal(parsed.name, 'From API');
  assert.equal(parsed.nodes.length, 1);
});

test('diffWorkflows ignores noisy metadata and node position changes', () => {
  const oldWorkflow = workflow({
    updatedAt: 'old',
    nodes: [{ ...workflow().nodes[0], position: [0, 0] }],
  });
  const newWorkflow = workflow({
    updatedAt: 'new',
    nodes: [{ ...workflow().nodes[0], position: [500, 100] }],
  });

  const diff = diffWorkflows(oldWorkflow, newWorkflow);

  assert.equal(diff.summary.unchanged, 1);
  assert.equal(diff.summary.modified, 0);
});

test('diffWorkflows detects node additions, removals, renames, parameters, and credentials-only changes', () => {
  const oldWorkflow = workflow({
    nodes: [
      { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', parameters: { path: 'old' } },
      { id: '2', name: 'Delete Me', type: 'n8n-nodes-base.set', parameters: {} },
      { id: '3', name: 'Credential Node', type: 'n8n-nodes-base.httpRequest', parameters: {}, credentials: { httpBasicAuth: { id: 'a' } } },
    ],
  });
  const newWorkflow = workflow({
    nodes: [
      { id: '1', name: 'Webhook Renamed', type: 'n8n-nodes-base.webhook', parameters: { path: 'new' } },
      { id: '3', name: 'Credential Node', type: 'n8n-nodes-base.httpRequest', parameters: {}, credentials: { httpBasicAuth: { id: 'b' } } },
      { id: '4', name: 'Add Me', type: 'n8n-nodes-base.set', parameters: {} },
    ],
  });

  const diff = diffWorkflows(oldWorkflow, newWorkflow);

  assert.equal(diff.summary.added, 1);
  assert.equal(diff.summary.removed, 1);
  assert.equal(diff.summary.renamed, 1);
  assert.equal(diff.summary['credentials-only'], 1);
  assert.deepEqual(
    diff.nodes.find((node) => node.nodeId === '1').changes.map((change) => change.field),
    ['name', 'parameters.path'],
  );
});

test('diffWorkflows detects connection rewiring using renamed node names', () => {
  const oldWorkflow = workflow({
    nodes: [
      { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
      { id: '2', name: 'Old Target', type: 'n8n-nodes-base.set', parameters: {} },
    ],
    connections: {
      Trigger: {
        main: [[{ node: 'Old Target', type: 'main', index: 0 }]],
      },
    },
  });
  const newWorkflow = workflow({
    nodes: [
      { id: '1', name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
      { id: '2', name: 'New Target', type: 'n8n-nodes-base.set', parameters: {} },
    ],
    connections: {
      Trigger: {
        main: [[{ node: 'New Target', type: 'main', index: 0 }]],
      },
    },
  });

  const diff = diffWorkflows(oldWorkflow, newWorkflow);

  assert.equal(diff.summary.renamed, 1);
  assert.equal(diff.connections.filter((connection) => connection.status === 'unchanged').length, 1);
  assert.equal(diff.connections.filter((connection) => connection.status !== 'unchanged').length, 0);
});

