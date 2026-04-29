const NODE_WIDTH = 180;
const NODE_HEIGHT = 72;
const POSITION_OFFSET = 40;
const FALLBACK_X_GAP = 280;
const FALLBACK_Y_GAP = 150;
const FALLBACK_COLUMNS = 4;

export function buildGraphModel(diff) {
  const graphNodes = diff.nodes.map((node, index) => {
    const sourceNode = node.newNode ?? node.oldNode ?? {};
    const position = Array.isArray(sourceNode.position) ? sourceNode.position : null;
    const fallbackColumn = index % FALLBACK_COLUMNS;
    const fallbackRow = Math.floor(index / FALLBACK_COLUMNS);
    const x = position ? position[0] + POSITION_OFFSET : POSITION_OFFSET + fallbackColumn * FALLBACK_X_GAP;
    const y = position ? position[1] + POSITION_OFFSET : POSITION_OFFSET + fallbackRow * FALLBACK_Y_GAP;
    return {
      id: String(node.nodeId),
      name: displayNodeName(node),
      label: node.displayName,
      type: node.nodeType,
      status: node.status,
      changes: node.changes?.length ?? 0,
      x,
      y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    };
  });

  const byName = new Map(graphNodes.map((node) => [node.name, node]));
  const edges = diff.connections
    .map((connection, index) => {
      const source = byName.get(connection.sourceNode);
      const target = byName.get(connection.targetNode);
      if (!source || !target) {
        return null;
      }
      return {
        id: `${connection.status}-${connection.sourceNode}-${connection.targetNode}-${connection.connectionType}-${index}`,
        status: connection.status,
        type: connection.connectionType,
        sourceId: source.id,
        targetId: target.id,
        sourceX: source.x + source.width,
        sourceY: source.y + source.height / 2,
        targetX: target.x,
        targetY: target.y + target.height / 2,
      };
    })
    .filter(Boolean);

  const bounds = graphNodes.reduce((accumulator, node) => ({
    minX: Math.min(accumulator.minX, node.x),
    minY: Math.min(accumulator.minY, node.y),
    maxX: Math.max(accumulator.maxX, node.x + node.width),
    maxY: Math.max(accumulator.maxY, node.y + node.height),
  }), { minX: 0, minY: 0, maxX: 720, maxY: 360 });

  return {
    nodes: graphNodes,
    edges,
    width: Math.max(760, bounds.maxX + POSITION_OFFSET),
    height: Math.max(360, bounds.maxY + POSITION_OFFSET),
  };
}

function displayNodeName(node) {
  return node.newNode?.name ?? node.oldNode?.name ?? node.displayName;
}

