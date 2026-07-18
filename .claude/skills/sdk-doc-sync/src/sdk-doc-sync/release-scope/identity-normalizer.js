'use strict';

const fs = require('node:fs');
const { sourceOf } = require('./symbol-inventory');

function loadIdentityMap(filePath) {
  const map = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (map.schemaVersion !== 1) throw new Error(`Unsupported identity map schema: ${filePath}`);
  if (!map.language || !map.track || !map.symbols) throw new Error(`Invalid identity map: ${filePath}`);
  return Object.freeze({
    ...map,
    symbols: Object.freeze({ ...map.symbols }),
  });
}

function fallbackIdentity(delta, map) {
  const suffix = delta.symbolIdentity.replace(/\./g, ':');
  return {
    stableId: `${map.language}:${map.defaultCategory}:${suffix}`,
    canonicalSlug: delta.symbolIdentity.replace(/\./g, '-'),
    category: map.defaultCategory,
  };
}

function normalizeDelta(delta, map) {
  const mapped = map.symbols[delta.symbolIdentity];
  const identity = mapped || fallbackIdentity(delta, map);
  const normalized = {
    type: delta.type,
    stableId: identity.stableId,
    canonicalSlug: identity.canonicalSlug,
    symbol: delta.symbolIdentity,
    source: sourceOf(delta.symbol, map.packagePrefix || ''),
    reason: delta.reason,
  };
  if (!mapped) {
    normalized.diagnostic = {
      level: 'warn',
      code: 'UNMAPPED_CANONICAL_IDENTITY',
      message: `No canonical identity mapping for ${delta.symbolIdentity} in ${map.language} ${map.track}.`,
    };
  }
  return normalized;
}

module.exports = {
  loadIdentityMap,
  normalizeDelta,
};
