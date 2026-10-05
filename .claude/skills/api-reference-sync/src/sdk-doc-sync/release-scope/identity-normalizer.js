'use strict';

const fs = require('node:fs');
const { sourceOf } = require('./symbol-inventory');
const { ownershipFor } = require('./type-ownership');

// Typed scout blocker (2026-10-06): a missing or malformed identity map used
// to surface as a raw ENOENT/JSON crash (the go v3.0.x scout blocker was
// exactly this), leaving the operator with no recovery pointer. The map is
// load-bearing for approval-grade actions, so the failure carries its own
// typed code and the identity-reconcile draft workflow as the way out.
class ScoutIdentityMapError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ScoutIdentityMapError';
    this.code = code;
  }
}

function loadIdentityMap(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new ScoutIdentityMapError(
        'SCOUT_IDENTITY_MAP_MISSING',
        `no identity map at ${filePath} — a track without an identity map cannot produce approval-grade scout actions; draft entries with bin/identity-reconcile.js --emit-draft and merge them as a master-compared edit before scouting this track`,
      );
    }
    throw error;
  }
  let map;
  try {
    map = JSON.parse(raw);
  } catch (error) {
    throw new ScoutIdentityMapError('SCOUT_IDENTITY_MAP_INVALID', `identity map at ${filePath} is not valid JSON: ${error.message}`);
  }
  if (map.schemaVersion !== 1) throw new ScoutIdentityMapError('SCOUT_IDENTITY_MAP_INVALID', `Unsupported identity map schema: ${filePath}`);
  if (!map.language || !map.track || !map.symbols) throw new ScoutIdentityMapError('SCOUT_IDENTITY_MAP_INVALID', `Invalid identity map: ${filePath}`);
  return Object.freeze({
    ...map,
    symbols: Object.freeze({ ...map.symbols }),
  });
}

function fallbackIdentity(delta, map) {
  const slugPrefix = typeof map.slugPrefix === 'string' ? map.slugPrefix : '';
  if (!slugPrefix) {
    const suffix = delta.symbolIdentity.replace(/\./g, ':');
    return {
      stableId: `${map.language}:${map.defaultCategory}:${suffix}`,
      canonicalSlug: delta.symbolIdentity.replace(/\./g, '-'),
      category: map.defaultCategory,
    };
  }
  // Prefixed tracks (java: v2-<middle>-<member>) derive the fallback from the
  // scanner-assigned category (client methods and type pages) or the owning
  // class (nested members) so tag scouts and PR intakes compose the same
  // stableId/canonicalSlug for the same interface.
  const dot = delta.symbolIdentity.lastIndexOf('.');
  const middle = (delta.symbol && delta.symbol.category)
    || (dot > 0 ? delta.symbolIdentity.slice(0, dot) : '')
    || map.defaultCategory;
  const pageName = dot > 0 ? delta.symbolIdentity.slice(dot + 1) : delta.symbolIdentity;
  return {
    stableId: `${map.language}:${slugPrefix}${middle}:${pageName}`,
    canonicalSlug: `${slugPrefix}${middle}-${pageName}`,
    category: middle,
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
  ScoutIdentityMapError,
  loadIdentityMap,
  normalizeDelta,
  normalizeDeltas,
};
