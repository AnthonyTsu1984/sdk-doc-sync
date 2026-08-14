'use strict';

const {compareReleaseTracks, normalizeReleaseTrack} = require('./release-track');
const {digestSemantic} = require('../../../doc-ops-core/src/digest');

function reviewUnitIdFor(track, endpoint, method) {
  return `rest:${track}:${method.toLowerCase()}:${encodeURIComponent(endpoint)}`;
}

function operationKey(operation) {
  return `${operation.endpoint}|${operation.method}`;
}

function assertLifecycle(lifecycle, semantic, label) {
  if (!lifecycle) throw new Error(`REST_LIFECYCLE_MISSING: ${label}`);
  for (const key of ['x-added-at', 'x-last-modified']) {
    if (lifecycle[key] == null) throw new Error(`REST_LIFECYCLE_MISSING: ${label}.${key}`);
    try {
      normalizeReleaseTrack(lifecycle[key]);
    } catch {
      throw new Error(`REST_LIFECYCLE_INVALID: ${label}.${key}=${JSON.stringify(lifecycle[key])}`);
    }
  }
  if (lifecycle['x-deprecated-since'] != null) {
    try {
      normalizeReleaseTrack(lifecycle['x-deprecated-since']);
    } catch {
      throw new Error(`REST_LIFECYCLE_INVALID: ${label}.x-deprecated-since=${JSON.stringify(lifecycle['x-deprecated-since'])}`);
    }
  }
  if (compareReleaseTracks(lifecycle['x-added-at'], lifecycle['x-last-modified']) > 0) {
    throw new Error(`REST_LIFECYCLE_ORDER_INVALID: ${label}`);
  }
  if (semantic?.deprecated === true && lifecycle['x-deprecated-since'] == null) {
    throw new Error(`REST_DEPRECATION_METADATA_MISSING: ${label}`);
  }
}

function buildContractChanges(previousOperation, currentOperation) {
  const previous = new Map((previousOperation?.elements || []).map((element) => [element.pointer, element]));
  const current = new Map((currentOperation?.elements || []).map((element) => [element.pointer, element]));
  const changes = [];

  for (const [pointer, element] of current) {
    const prior = previous.get(pointer);
    if (!prior) {
      changes.push({pointer, kind: element.kind, change: 'ADDED'});
      continue;
    }
    if (digestSemantic(element.semantic) !== digestSemantic(prior.semantic)) {
      changes.push({pointer, kind: element.kind, change: 'MODIFIED'});
    } else if (element.lifecycle?.['x-deprecated-since'] != null
      && prior.lifecycle?.['x-deprecated-since'] == null) {
      changes.push({pointer, kind: element.kind, change: 'DEPRECATED'});
    }
  }

  for (const [pointer, element] of previous) {
    if (!current.has(pointer)) changes.push({pointer, kind: element.kind, change: 'REMOVED'});
  }

  return changes.sort((left, right) =>
    left.pointer.localeCompare(right.pointer) || left.change.localeCompare(right.change));
}

function contractChangesFor(action, previousOperation, currentOperation) {
  if (action === 'BACKFILL_LIFECYCLE') {
    return (currentOperation.elements || [])
      .map((element) => ({pointer: element.pointer, kind: element.kind, change: 'BACKFILL_LIFECYCLE'}))
      .sort((left, right) =>
        left.pointer.localeCompare(right.pointer) || left.change.localeCompare(right.change));
  }
  if (action === 'ADD') {
    return (currentOperation.elements || [])
      .map((element) => ({pointer: element.pointer, kind: element.kind, change: 'ADDED'}))
      .sort((left, right) =>
        left.pointer.localeCompare(right.pointer) || left.change.localeCompare(right.change));
  }
  return buildContractChanges(previousOperation, currentOperation);
}

function operationDeprecated(operation) {
  const operationElement = (operation.elements || []).find((element) => element.kind === 'operation');
  return operationElement?.semantic?.deprecated === true;
}

function buildSharedComponents(sortedInventories, unitIdByKey) {
  const trackOrder = sortedInventories.map((inventory) => inventory.track);
  const semanticsByTrack = new Map();
  const referencesByTrack = new Map();
  for (const inventory of sortedInventories) {
    const semantics = new Map();
    const references = new Map();
    for (const [pointer, component] of inventory.components) {
      semantics.set(pointer, component.semantic);
      references.set(pointer, component.referencedBy || []);
    }
    semanticsByTrack.set(inventory.track, semantics);
    referencesByTrack.set(inventory.track, references);
  }

  const pointers = new Set();
  for (const semantics of semanticsByTrack.values()) for (const pointer of semantics.keys()) pointers.add(pointer);

  const sharedComponents = [];
  for (const pointer of [...pointers].sort()) {
    const presentTracks = trackOrder.filter((track) => semanticsByTrack.get(track).has(pointer));
    const semanticDigests = new Set(presentTracks.map((track) =>
      digestSemantic(semanticsByTrack.get(track).get(pointer))));
    const changed = semanticDigests.size > 1 || presentTracks.length !== trackOrder.length;
    if (!changed) continue;

    const allAffectedKeys = new Set();
    for (const track of presentTracks) {
      for (const unitKey of referencesByTrack.get(track).get(pointer)) allAffectedKeys.add(unitKey);
    }
    if (allAffectedKeys.size === 0) {
      throw new Error(`REST_COMPONENT_OWNER_UNKNOWN: ${pointer}`);
    }

    if (presentTracks.length > 1) {
      const latestTrack = presentTracks[presentTracks.length - 1];
      const affectedOperations = [...referencesByTrack.get(latestTrack).get(pointer)]
        .map((unitKey) => unitIdByKey.get(unitKey))
        .filter(Boolean)
        .sort();
      sharedComponents.push({
        pointer,
        digest: digestSemantic(semanticsByTrack.get(latestTrack).get(pointer)),
        affectedOperations,
      });
    }
  }
  return sharedComponents;
}

function buildRestReviewManifest({tracks, managedFloor = '2.6.x', sourceEvidence = {}}) {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new Error('REST_TRACKS_REQUIRED');
  }

  const normalizedManagedFloor = normalizeReleaseTrack(managedFloor);
  const sortedInventories = [...tracks].sort((left, right) =>
    compareReleaseTracks(left.track, right.track));

  const units = [];
  const seenUnits = new Set();
  const previousByKey = new Map();
  const unitIdByKey = new Map();

  for (const inventory of sortedInventories) {
    const track = normalizeReleaseTrack(inventory.track);
    for (const operation of inventory.operations.values()) {
      const key = operationKey(operation);
      const duplicateKey = `${track}|${key}`;
      if (seenUnits.has(duplicateKey)) {
        throw new Error(`REST_REVIEW_UNIT_DUPLICATE: ${duplicateKey}`);
      }
      seenUnits.add(duplicateKey);

      assertLifecycle(operation.lifecycle, null, `${track}|${operation.pointer}`);
      for (const element of operation.elements || []) {
        if (element.lifecycle) assertLifecycle(element.lifecycle, element.semantic, element.pointer);
      }

      const previousOperation = previousByKey.get(key);
      let action;
      if (!previousOperation) {
        action = track === normalizedManagedFloor ? 'BACKFILL_LIFECYCLE' : 'ADD';
      } else if (operationDeprecated(operation) && !operationDeprecated(previousOperation)) {
        action = 'DEPRECATE';
      } else {
        action = buildContractChanges(previousOperation, operation).length > 0 ? 'UPDATE' : 'NOOP';
      }

      const reviewUnitId = reviewUnitIdFor(track, operation.endpoint, operation.method);
      unitIdByKey.set(`${track}|${key}`, reviewUnitId);
      const evidence = sourceEvidence[track] || {};
      units.push({
        reviewUnitId,
        versionTrack: track,
        endpoint: operation.endpoint,
        method: operation.method,
        action,
        sourceEvidence: {
          repository: evidence.repository || null,
          revision: evidence.revision || null,
          sourceFile: inventory.sourceFile,
        },
        proposedLifecycle: operation.lifecycle,
        contractChanges: contractChangesFor(action, previousOperation, operation),
        sharedComponentRefs: operation.componentRefs || [],
        blockers: [],
        warnings: [],
      });
      previousByKey.set(key, operation);
    }
  }

  units.sort((left, right) =>
    compareReleaseTracks(left.versionTrack, right.versionTrack)
      || left.endpoint.localeCompare(right.endpoint)
      || left.method.localeCompare(right.method));

  const actionCounts = {};
  for (const unit of units) actionCounts[unit.action] = (actionCounts[unit.action] || 0) + 1;

  const manifest = {
    schemaVersion: 1,
    managedFloor: normalizedManagedFloor,
    tracks: sortedInventories.map((inventory) => inventory.track),
    units,
    sharedComponents: buildSharedComponents(sortedInventories, unitIdByKey),
    summary: {
      unitCount: units.length,
      actionCounts: Object.fromEntries(Object.keys(actionCounts).sort().map((key) => [key, actionCounts[key]])),
    },
  };
  manifest.manifestDigest = digestSemantic(manifest);
  return manifest;
}

module.exports = {
  buildRestReviewManifest,
  reviewUnitIdFor,
};
