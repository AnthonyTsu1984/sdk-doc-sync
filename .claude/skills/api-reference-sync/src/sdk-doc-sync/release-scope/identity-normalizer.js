'use strict';

const fs = require('node:fs');
const { sourceOf } = require('./symbol-inventory');
const { ownershipFor } = require('./type-ownership');

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

function normalizedItem(delta, identity, documentationOwnership) {
  const source = sourceOf(delta.symbol, identity.packagePrefix || '');
  const relatedFiles = [...new Set((delta.symbol.relatedFiles || [])
    .map((file) => `${identity.packagePrefix || ''}${file}`.replace(/\\/g, '/')))]
    .filter((file) => file !== source.file);
  const methodOwned = documentationOwnership.classification === 'method_owned';
  const normalized = {
    type: methodOwned ? 'UPDATE' : delta.type,
    stableId: identity.stableId,
    canonicalSlug: identity.canonicalSlug,
    symbol: delta.symbolIdentity,
    source,
    reason: delta.reason,
    documentationOwnership,
    ...(identity.organization !== undefined ? { organization: identity.organization } : {}),
    ...(relatedFiles.length > 0 ? { relatedFiles } : {}),
  };
  if (methodOwned) {
    normalized.sourceVariants = [{
      stableId: identity.stableId,
      canonicalSlug: identity.canonicalSlug,
      symbol: delta.symbolIdentity,
      source,
      reason: delta.reason,
      ...(delta.evidence !== undefined ? { evidence: delta.evidence } : {}),
      sourceDeltaType: delta.type,
    }];
  }
  return normalized;
}

function normalizeDeltas(delta, map) {
  const mapped = map.symbols[delta.symbolIdentity];
  const documentationOwnership = ownershipFor(mapped, delta.symbol);
  if (documentationOwnership.classification === 'method_owned') {
    return documentationOwnership.owners.map((owner) => normalizedItem(delta, {
      ...owner,
      packagePrefix: map.packagePrefix || '',
    }, {
      ...documentationOwnership,
      selectedOwnerStableId: owner.stableId,
    }));
  }
  const identity = mapped || fallbackIdentity(delta, map);
  const normalized = normalizedItem(delta, {
    ...identity,
    packagePrefix: map.packagePrefix || '',
  }, documentationOwnership);
  if (documentationOwnership.classification === 'ambiguous') {
    normalized.diagnostic = {
      level: 'error',
      code: 'AMBIGUOUS_DOCUMENTATION_OWNERSHIP',
      message: `Documentation ownership is ambiguous for ${delta.symbolIdentity} in ${map.language} ${map.track}.`,
    };
  } else if (!mapped) {
    normalized.diagnostic = {
      level: 'warn',
      code: 'UNMAPPED_CANONICAL_IDENTITY',
      message: `No canonical identity mapping for ${delta.symbolIdentity} in ${map.language} ${map.track}.`,
    };
  }
  return [normalized];
}

function normalizeDelta(delta, map) {
  return normalizeDeltas(delta, map)[0];
}

module.exports = {
  loadIdentityMap,
  normalizeDelta,
  normalizeDeltas,
};
