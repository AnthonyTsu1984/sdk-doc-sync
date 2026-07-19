'use strict';

function publicIdentity(symbol) {
  return symbol.parentClass ? `${symbol.parentClass}.${symbol.name}` : symbol.name;
}

function comparableSignature(symbol) {
  return JSON.stringify({
    kind: symbol.kind || null,
    signature: symbol.signature || '',
    params: symbol.params || [],
    fields: symbol.fields || [],
    values: symbol.values || [],
    methods: symbol.methods || [],
    optionMethods: symbol.optionMethods || [],
    altConstructors: symbol.altConstructors || [],
    returnType: symbol.returnType || null,
    decorators: symbol.decorators || [],
    hidden: symbol.hidden || false,
    bodyHash: symbol.bodyHash || null,
  });
}

function sameValue(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

function updateReason(previous, symbol) {
  if ((previous.signature || '') !== (symbol.signature || '')) return 'signature changed';
  if (!sameValue(previous.params || [], symbol.params || [])) return 'parameters changed';
  if (!sameValue(previous.optionMethods || [], symbol.optionMethods || [])) return 'builder methods changed';
  if (!sameValue(previous.altConstructors || [], symbol.altConstructors || [])) return 'constructors changed';
  if (!sameValue(previous.fields || [], symbol.fields || [])) return 'fields changed';
  if (!sameValue(previous.values || [], symbol.values || [])) return 'enum values changed';
  if (!sameValue(previous.methods || [], symbol.methods || [])) return 'public member methods changed';
  if ((previous.bodyHash || null) !== (symbol.bodyHash || null)) return 'public method behavior changed';
  if ((previous.returnType || null) !== (symbol.returnType || null)) return 'return type changed';
  if (!sameValue(previous.decorators || [], symbol.decorators || [])) return 'decorators changed';
  if ((previous.hidden || false) !== (symbol.hidden || false)) return 'visibility changed';
  return 'public surface changed';
}

function sourceOf(symbol, sdkPackagePrefix = '') {
  const file = `${sdkPackagePrefix}${symbol.filePath}`.replace(/\\/g, '/');
  return { file, line: symbol.lineNumber || 1 };
}

function relatedSourceFiles(symbol, sdkPackagePrefix = '') {
  const files = [sourceOf(symbol, sdkPackagePrefix).file];
  for (const file of symbol.relatedFiles || []) {
    files.push(`${sdkPackagePrefix}${file}`.replace(/\\/g, '/'));
  }
  return [...new Set(files)];
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
        reason: updateReason(previous, symbol),
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
    .filter((symbol) => relatedSourceFiles(symbol, sdkPackagePrefix).some((file) => changed.has(file)))
    .sort((a, b) => publicIdentity(a).localeCompare(publicIdentity(b)));
}

module.exports = {
  publicIdentity,
  sourceOf,
  relatedSourceFiles,
  classifySymbolDeltas,
  filterSymbolsByChangedFiles,
};
