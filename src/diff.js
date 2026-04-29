const NODE_NOISE_KEYS = new Set(['id', 'position']);
const WORKFLOW_NOISE_KEYS = new Set([
  'createdAt',
  'updatedAt',
  'versionId',
  'versionCounter',
  'meta',
  'pinData',
  'staticData',
  'triggerCount',
  'isArchived',
]);
const STATUS_ORDER = ['added', 'removed', 'modified', 'renamed', 'credentials-only', 'unchanged'];

export function parseWorkflowJson(text) {
  let parsed = JSON.parse(text);
  if (Array.isArray(parsed?.data)) {
    parsed = parsed.data[0];
  }
  validateWorkflow(parsed);
  return parsed;
}

export function validateWorkflow(workflow) {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    throw new Error('Workflow must be a JSON object');
  }
  if (!Array.isArray(workflow.nodes)) {
    throw new Error('Workflow must contain a nodes array');
  }
  if (!workflow.connections || typeof workflow.connections !== 'object' || Array.isArray(workflow.connections)) {
    throw new Error('Workflow must contain a connections object');
  }
  return true;
}

export function diffWorkflows(oldWorkflow, newWorkflow) {
  validateWorkflow(oldWorkflow);
  validateWorkflow(newWorkflow);

  const oldNormalized = normalizeWorkflow(oldWorkflow);
  const newNormalized = normalizeWorkflow(newWorkflow);
  const matches = matchNodes(oldWorkflow.nodes, newWorkflow.nodes);
  const renameMap = new Map();
  const nodeTypes = new Map();
  const nodes = [];

  for (const match of matches) {
    const { oldNode, newNode, matchType } = match;
    if (oldNode?.type === 'n8n-nodes-base.stickyNote' || newNode?.type === 'n8n-nodes-base.stickyNote') {
      continue;
    }
    if (matchType === 'none') {
      if (newNode) {
        nodeTypes.set(newNode.name, newNode.type);
        nodes.push({
          status: 'added',
          nodeId: newNode.id ?? newNode.name,
          displayName: newNode.name,
          nodeType: shortNodeType(newNode.type),
          newNode,
          changes: flattenAddedRemoved(undefined, cleanNode(newNode), '', 'added'),
        });
      } else {
        nodeTypes.set(oldNode.name, oldNode.type);
        nodes.push({
          status: 'removed',
          nodeId: oldNode.id ?? oldNode.name,
          displayName: oldNode.name,
          nodeType: shortNodeType(oldNode.type),
          oldNode,
          changes: flattenAddedRemoved(cleanNode(oldNode), undefined, '', 'removed'),
        });
      }
      continue;
    }

    if (oldNode.name !== newNode.name) {
      renameMap.set(oldNode.name, newNode.name);
    }
    nodeTypes.set(oldNode.name, oldNode.type);
    nodeTypes.set(newNode.name, newNode.type);

    const oldComparable = findComparableNode(oldNormalized.nodes, oldNode.name);
    const newComparable = findComparableNode(newNormalized.nodes, newNode.name);
    const changes = diffValues(oldComparable, newComparable).filter((change) => change.field);
    const renamed = oldNode.name !== newNode.name;
    let status = 'unchanged';
    if (renamed) {
      status = 'renamed';
    } else if (changes.length > 0 && changes.every((change) => change.field.startsWith('credentials'))) {
      status = 'credentials-only';
    } else if (changes.length > 0) {
      status = 'modified';
    }

    nodes.push({
      status,
      nodeId: newNode.id ?? newNode.name,
      displayName: renamed ? `${oldNode.name} -> ${newNode.name}` : newNode.name,
      nodeType: shortNodeType(newNode.type),
      oldNode,
      newNode,
      changes,
    });
  }

  const connections = diffConnections(oldWorkflow.connections, newWorkflow.connections, renameMap, nodeTypes);
  const summary = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
  for (const node of nodes) {
    summary[node.status] += 1;
  }
  const connectionSummary = {
    added: connections.filter((connection) => connection.status === 'added').length,
    removed: connections.filter((connection) => connection.status === 'removed').length,
    unchanged: connections.filter((connection) => connection.status === 'unchanged').length,
  };

  return {
    oldName: oldWorkflow.name ?? 'Untitled Workflow',
    newName: newWorkflow.name ?? 'Untitled Workflow',
    nodes: nodes.sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.displayName.localeCompare(b.displayName)),
    connections,
    summary,
    connectionSummary,
  };
}

function normalizeWorkflow(workflow) {
  const normalized = {};
  for (const [key, value] of Object.entries(workflow)) {
    if (!WORKFLOW_NOISE_KEYS.has(key)) {
      normalized[key] = value;
    }
  }
  normalized.nodes = workflow.nodes
    .filter((node) => node.type !== 'n8n-nodes-base.stickyNote')
    .map(cleanNode);
  return normalized;
}

function cleanNode(node) {
  const cleaned = {};
  for (const [key, value] of Object.entries(node)) {
    if (!NODE_NOISE_KEYS.has(key)) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

function matchNodes(oldNodes, newNodes) {
  const matches = [];
  const oldById = new Map(oldNodes.filter((node) => node.id).map((node) => [node.id, node]));
  const newById = new Map(newNodes.filter((node) => node.id).map((node) => [node.id, node]));
  const oldUnmatched = new Set(oldNodes);
  const newUnmatched = new Set(newNodes);

  for (const [id, oldNode] of oldById) {
    const newNode = newById.get(id);
    if (newNode) {
      matches.push({ oldNode, newNode, matchType: 'id' });
      oldUnmatched.delete(oldNode);
      newUnmatched.delete(newNode);
    }
  }

  const newByName = new Map([...newUnmatched].map((node) => [node.name, node]));
  for (const oldNode of [...oldUnmatched]) {
    const newNode = newByName.get(oldNode.name);
    if (newNode) {
      matches.push({ oldNode, newNode, matchType: 'name' });
      oldUnmatched.delete(oldNode);
      newUnmatched.delete(newNode);
    }
  }

  for (const oldNode of oldUnmatched) {
    matches.push({ oldNode, matchType: 'none' });
  }
  for (const newNode of newUnmatched) {
    matches.push({ newNode, matchType: 'none' });
  }
  return matches;
}

function findComparableNode(nodes, name) {
  return nodes.find((node) => node.name === name);
}

function diffValues(oldValue, newValue, path = '') {
  if (oldValue === newValue) {
    return [];
  }
  if (isPlainObject(oldValue) && isPlainObject(newValue)) {
    const keys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);
    return [...keys].flatMap((key) => {
      const nextPath = path ? `${path}.${key}` : key;
      if (!(key in oldValue)) {
        return flattenAddedRemoved(undefined, newValue[key], nextPath, 'added');
      }
      if (!(key in newValue)) {
        return flattenAddedRemoved(oldValue[key], undefined, nextPath, 'removed');
      }
      return diffValues(oldValue[key], newValue[key], nextPath);
    });
  }
  if (Array.isArray(oldValue) && Array.isArray(newValue)) {
    const length = Math.max(oldValue.length, newValue.length);
    const changes = [];
    for (let index = 0; index < length; index += 1) {
      const nextPath = `${path}[${index}]`;
      if (index >= oldValue.length) {
        changes.push(...flattenAddedRemoved(undefined, newValue[index], nextPath, 'added'));
      } else if (index >= newValue.length) {
        changes.push(...flattenAddedRemoved(oldValue[index], undefined, nextPath, 'removed'));
      } else {
        changes.push(...diffValues(oldValue[index], newValue[index], nextPath));
      }
    }
    return changes;
  }
  return [{
    field: path,
    oldValue,
    newValue,
    changeType: 'modified',
    ...classifyValue(oldValue, newValue, path),
  }];
}

function flattenAddedRemoved(oldValue, newValue, path, changeType) {
  const value = changeType === 'added' ? newValue : oldValue;
  if (isPlainObject(value)) {
    return Object.entries(value).flatMap(([key, nestedValue]) => {
      const nextPath = path ? `${path}.${key}` : key;
      return flattenAddedRemoved(changeType === 'removed' ? nestedValue : undefined, changeType === 'added' ? nestedValue : undefined, nextPath, changeType);
    });
  }
  if (Array.isArray(value)) {
    return value.flatMap((nestedValue, index) => {
      const nextPath = `${path}[${index}]`;
      return flattenAddedRemoved(changeType === 'removed' ? nestedValue : undefined, changeType === 'added' ? nestedValue : undefined, nextPath, changeType);
    });
  }
  return [{
    field: path,
    oldValue: changeType === 'removed' ? oldValue : undefined,
    newValue: changeType === 'added' ? newValue : undefined,
    changeType,
    ...classifyValue(oldValue, newValue, path),
  }];
}

function diffConnections(oldConnections, newConnections, renameMap, nodeTypes) {
  const oldSet = connectionSet(oldConnections, renameMap);
  const newSet = connectionSet(newConnections, new Map());
  const allKeys = new Set([...oldSet, ...newSet]);
  return [...allKeys].map((key) => {
    const parsed = parseConnectionKey(key);
    const sourceType = nodeTypes.get(parsed.sourceNode) ?? '';
    return {
      status: oldSet.has(key) && newSet.has(key) ? 'unchanged' : oldSet.has(key) ? 'removed' : 'added',
      ...parsed,
      outputLabel: outputLabel(sourceType, parsed.sourceOutput),
    };
  }).sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.sourceNode.localeCompare(b.sourceNode));
}

function connectionSet(connections, renameMap) {
  const set = new Set();
  for (const [sourceName, outputsByType] of Object.entries(connections ?? {})) {
    const sourceNode = renameMap.get(sourceName) ?? sourceName;
    for (const [connectionType, outputs] of Object.entries(outputsByType ?? {})) {
      if (!Array.isArray(outputs)) {
        continue;
      }
      outputs.forEach((outputConnections, sourceOutput) => {
        if (!Array.isArray(outputConnections)) {
          return;
        }
        outputConnections.forEach((connection) => {
          const targetNode = renameMap.get(connection.node) ?? connection.node;
          const targetInput = Number(connection.index ?? 0);
          set.add(`${connectionType}|${sourceNode}|${sourceOutput}|${targetNode}|${targetInput}`);
        });
      });
    }
  }
  return set;
}

function parseConnectionKey(key) {
  const [connectionType, sourceNode, sourceOutput, targetNode, targetInput] = key.split('|');
  return {
    connectionType,
    sourceNode,
    sourceOutput: Number(sourceOutput),
    targetNode,
    targetInput: Number(targetInput),
  };
}

function outputLabel(type, outputIndex) {
  if (type === 'n8n-nodes-base.if') {
    return ['true', 'false'][outputIndex] ?? `out-${outputIndex}`;
  }
  if (type === 'n8n-nodes-base.filter') {
    return ['keep', 'discard'][outputIndex] ?? `out-${outputIndex}`;
  }
  if (type === 'n8n-nodes-base.splitInBatches') {
    return ['done', 'loop'][outputIndex] ?? `out-${outputIndex}`;
  }
  if (type === 'n8n-nodes-base.switch') {
    return `route-${outputIndex}`;
  }
  return outputIndex === 0 ? 'main' : `out-${outputIndex}`;
}

function classifyValue(oldValue, newValue, path) {
  const value = typeof newValue === 'string' ? newValue : oldValue;
  const lastPart = path.split('.').at(-1) ?? '';
  const isCode = typeof value === 'string' && value.includes('\n') && /query|jsCode|jsFunction|sql|code|htmlBody/i.test(lastPart);
  const isExpression = typeof value === 'string' && value.startsWith('=');
  return { isCode, isExpression };
}

function shortNodeType(type = '') {
  return type.replace('n8n-nodes-base.', '').replace('@n8n/n8n-nodes-langchain.', '');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function statusRank(status) {
  const rank = STATUS_ORDER.indexOf(status);
  return rank === -1 ? STATUS_ORDER.length : rank;
}

