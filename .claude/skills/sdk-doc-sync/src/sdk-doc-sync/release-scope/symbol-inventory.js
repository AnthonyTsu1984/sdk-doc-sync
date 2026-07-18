'use strict';

function publicIdentity(symbol) {
  return symbol.parentClass ? `${symbol.parentClass}.${symbol.name}` : symbol.name;
}

function comparableSignature(symbol) {
  return JSON.stringify({
    kind: symbol.kind || null,
    signature: symbol.signature || '',
    params: symbol.params || [],
    returnType: symbol.returnType || null,
    decorators: symbol.decorators || [],
  });
}

function sourceOf(symbol, sdkPackagePrefix = '') {
  const file = `${sdkPackagePrefix}${symbol.filePath}`.replace(/\\/g, '/');
  return { file, line: symbol.lineNumber || 1 };
}

function classifySymbolDeltas({ baseline, target } = {}) {
  const oldByIdentity = new Map((baseline || []).map((symbol) => [publicIdentity(symbol), symbol]));
  const targetByIdentity = new Map((target || []).map((symbol) => [publicIdentity(symbol), symbol]));
  const deltas = [];
  for (const symbol of target || []) {
    const identity = publicIdentity(symbol);
    const previous = oldByIdentity.get(identity);
    if (!previous) {
      deltas.push({
        type: 'CREATE',
        symbolIdentity: identity,
        symbol,
        previous: null,
        reason: `new public ${symbol.kind || 'symbol'}`,
      });
      continue;
    }
    if (comparableSignature(previous) !== comparableSignature(symbol)) {
      deltas.push({
        type: 'UPDATE',
        symbolIdentity: identity,
        symbol,
        previous,
        reason: 'signature changed',
      });
    }
  }
  for (const [identity, previous] of oldByIdentity.entries()) {
    if (targetByIdentity.has(identity)) continue;
    deltas.push({
      type: 'DEPRECATE',
      symbolIdentity: identity,
      symbol: previous,
      previous,
      reason: `removed public ${previous.kind || 'symbol'}`,
    });
  }
  return deltas.sort((a, b) => {
    const order = { UPDATE: 0, CREATE: 1, DEPRECATE: 2, BACKFILL: 3 };
    const typeOrder = (order[a.type] ?? 99) - (order[b.type] ?? 99);
    if (typeOrder !== 0) return typeOrder;
    return a.symbolIdentity.localeCompare(b.symbolIdentity);
  });
}

function filterSymbolsByChangedFiles({ symbols, changedFiles, sdkPackagePrefix = '' } = {}) {
  const changed = new Set(changedFiles || []);
  return (symbols || [])
    .filter((symbol) => changed.has(sourceOf(symbol, sdkPackagePrefix).file))
    .sort((a, b) => publicIdentity(a).localeCompare(publicIdentity(b)));
}

module.exports = {
  publicIdentity,
  sourceOf,
  classifySymbolDeltas,
  filterSymbolsByChangedFiles,
};
