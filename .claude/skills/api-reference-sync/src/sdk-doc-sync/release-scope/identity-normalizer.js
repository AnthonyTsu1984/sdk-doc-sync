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
    if (error.code === 'EISDIR') {
      throw new ScoutIdentityMapError('SCOUT_IDENTITY_MAP_INVALID', `identity map at ${filePath} is a directory, not a JSON file`);
    }
    throw error;
  }
  let map;
  try {
    map = JSON.parse(raw);
  } catch (error) {
    throw new ScoutIdentityMapError('SCOUT_IDENTITY_MAP_INVALID', `identity map at ${filePath} is not valid JSON: ${error.message}`);
  }
  // A JSON null/scalar/array root would otherwise surface as a raw TypeError
  // on property access — the exact crash class this typed blocker exists to
  // replace (review finding: null map probe).
  if (map === null || typeof map !== 'object' || Array.isArray(map)) {
    throw new ScoutIdentityMapError('SCOUT_IDENTITY_MAP_INVALID', `identity map at ${filePath} must be a JSON object`);
  }
  if (map.schemaVersion !== 1) throw new ScoutIdentityMapError('SCOUT_IDENTITY_MAP_INVALID', `Unsupported identity map schema: ${filePath}`);
  if (!map.language || !map.track || !map.symbols) throw new ScoutIdentityMapError('SCOUT_IDENTITY_MAP_INVALID', `Invalid identity map: ${filePath}`);
  return Object.freeze({
    ...map,
    symbols: Object.freeze({ ...map.symbols }),
  });
}

// Live go slug-head conventions the scanner's parentClass cannot express.
// Both rules are evidence-pinned against the two go Bitable snapshots (172
// v2.6.x / 232 v3.0.x records) over the full scanned symbol sets at the track
// target tags: live-hit 102→165 (v2.6.x) and 139→222 (v3.0.x) with zero
// regressions, every residual miss a record that does not exist live.
//  - index/annparam constructors are parented by the doc-tree category
//    (Management.NewGenericIndex / Vector.NewIvfRabitQAnnParam) but live under
//    the constructed-type head (v2-Index-NewGenericIndex,
//    v2-AnnParam-NewIvfRabitQAnnParam); the head is the name suffix, not the
//    filePath directory — both families live in the same client/index/*.go
//    files, so a directory-based head cannot distinguish them and would also
//    corrupt the landing interfaces (v2-Management-Index) and every flat
//    method. This mirrors deepPathIdentity's slugMiddle in pr-scan.js so tag
//    scouts and PR intakes compose the same stableId/canonicalSlug.
//  - the collection/partition method groups scan with plural parentClass
//    while every live record head is singular (24 v2-Collection-* and 6
//    v2-Partition-* records, zero v2-Collections-*/v2-Partitions-*); the go
//    identity maps already bridge exactly this rename for mapped entries
//    (Collections.AddCollectionField => v2-Collection-AddCollectionField).
const GO_FALLBACK_HEAD_RENAMES = new Map([
  ['Collections', 'Collection'],
  ['Partitions', 'Partition'],
]);

function goFallbackHead({ name, middle }) {
  const constructorOwner = /^New.+(Index|AnnParam)$/.exec(name || '');
  if (constructorOwner) return constructorOwner[1];
  return GO_FALLBACK_HEAD_RENAMES.get(middle) || middle;
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
  // stableId/canonicalSlug for the same interface. Go additionally mirrors
  // the live slug-head conventions above, otherwise an unmapped deep-path
  // symbol would CREATE under a category-headed slug the PR pipeline just
  // updated under its owner-headed one.
  const dot = delta.symbolIdentity.lastIndexOf('.');
  const middle = (delta.symbol && delta.symbol.category)
    || (dot > 0 ? delta.symbolIdentity.slice(0, dot) : '')
    || map.defaultCategory;
  const pageName = dot > 0 ? delta.symbolIdentity.slice(dot + 1) : delta.symbolIdentity;
  const head = map.language === 'go' ? goFallbackHead({ name: pageName, middle }) : middle;
  return {
    stableId: `${map.language}:${slugPrefix}${head}:${pageName}`,
    canonicalSlug: `${slugPrefix}${head}-${pageName}`,
    category: head,
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
