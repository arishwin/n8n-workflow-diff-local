export const GRAPH_MIN_SCALE = 0.35;
export const GRAPH_MAX_SCALE = 3;
export const GRAPH_ZOOM_STEP = 1.2;

export function clampGraphScale(scale) {
  return Math.min(GRAPH_MAX_SCALE, Math.max(GRAPH_MIN_SCALE, roundScale(scale)));
}

export function panGraphViewport(viewport, delta) {
  return {
    scale: viewport.scale,
    x: roundPosition(viewport.x + delta.x),
    y: roundPosition(viewport.y + delta.y),
  };
}

export function zoomGraphViewport(viewport, nextScale, anchor) {
  const scale = clampGraphScale(nextScale);
  const scaleRatio = scale / viewport.scale;
  return {
    scale,
    x: roundPosition(anchor.x - (anchor.x - viewport.x) * scaleRatio),
    y: roundPosition(anchor.y - (anchor.y - viewport.y) * scaleRatio),
  };
}

export function resetGraphViewport() {
  return { scale: 1, x: 0, y: 0 };
}

function roundScale(value) {
  return Math.round(value * 100) / 100;
}

function roundPosition(value) {
  return Math.round(value * 100) / 100;
}

