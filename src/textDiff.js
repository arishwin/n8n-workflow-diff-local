export function buildLineDiff(oldValue, newValue) {
  const oldLines = valueToLines(oldValue);
  const newLines = valueToLines(newValue);
  const table = buildLcsTable(oldLines, newLines);
  const result = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      result.push({ type: 'same', value: oldLines[oldIndex] });
      oldIndex += 1;
      newIndex += 1;
    } else if (table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1]) {
      result.push({ type: 'removed', value: oldLines[oldIndex] });
      oldIndex += 1;
    } else {
      result.push({ type: 'added', value: newLines[newIndex] });
      newIndex += 1;
    }
  }

  while (oldIndex < oldLines.length) {
    result.push({ type: 'removed', value: oldLines[oldIndex] });
    oldIndex += 1;
  }
  while (newIndex < newLines.length) {
    result.push({ type: 'added', value: newLines[newIndex] });
    newIndex += 1;
  }

  return collapseReplacementRuns(result);
}

export function valueToDiffText(value) {
  if (value === undefined) {
    return '';
  }
  if (value === null || typeof value !== 'object') {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

function valueToLines(value) {
  const text = valueToDiffText(value);
  return text === '' ? [] : text.split('\n');
}

function buildLcsTable(oldLines, newLines) {
  const table = Array.from({ length: oldLines.length + 1 }, () => Array(newLines.length + 1).fill(0));
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? table[oldIndex + 1][newIndex + 1] + 1
        : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
    }
  }
  return table;
}

function collapseReplacementRuns(lines) {
  const collapsed = [];
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1];
    if (current?.type === 'added' && next?.type === 'removed') {
      collapsed.push(next, current);
      index += 1;
    } else {
      collapsed.push(current);
    }
  }
  return collapsed;
}

