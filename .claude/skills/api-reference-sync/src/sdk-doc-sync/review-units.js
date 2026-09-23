'use strict';

const { digestSemantic } = require('../../../doc-ops-core/src/digest');

function reviewUnitId(stableId) {
  return `review:${stableId}`;
}

function planIdForDependency(dependency, byPlanId) {
  if (byPlanId.has(dependency)) return dependency;
  const resourceId = `resource:${dependency}`;
  return byPlanId.has(resourceId) ? resourceId : null;
}

function buildReviewUnitManifest(plannedEntries, buildExecutionBatch, { documentStableIds = null } = {}) {
  if (!Array.isArray(plannedEntries)) throw new TypeError('plannedEntries must be an array');
  if (typeof buildExecutionBatch !== 'function') throw new TypeError('buildExecutionBatch is required');

  const planned = plannedEntries.filter((entry) => entry?.plan);
  const actionable = planned.filter((entry) => entry.plan.action !== 'NOOP');
  const byPlanId = new Map(planned.map((entry) => [entry.plan.stableId, entry]));
  const allowedDocumentIds = documentStableIds ? new Set(documentStableIds) : null;
  const documentEntries = planned
    .filter((entry) => entry.kind === 'document'
      && (!allowedDocumentIds || allowedDocumentIds.has(entry.plan.stableId)))
    .sort((left, right) => left.plan.stableId.localeCompare(right.plan.stableId));
  const assignedResourceIds = new Set();
  const entriesByUnitId = new Map();

  // Downstream structural resources (e.g. a category VirtualNode repoint) are
  // planned as separate resource actions that DEPEND ON the document action.
  // They must ride the document's review unit so the exact approval digest
  // covers the entire transition and no orphan resource action remains.
  const downstreamResourceIdsByDocumentId = new Map();
  for (const entry of actionable) {
    if (entry.kind !== 'resource') continue;
    for (const dependency of entry.plan.dependencies || []) {
      const dependencyId = planIdForDependency(dependency, byPlanId);
      const dependencyEntry = dependencyId ? byPlanId.get(dependencyId) : null;
      if (dependencyEntry?.kind !== 'document') continue;
      const documentId = dependencyEntry.plan.stableId;
      const ids = downstreamResourceIdsByDocumentId.get(documentId) || new Set();
      ids.add(entry.plan.stableId);
      downstreamResourceIdsByDocumentId.set(documentId, ids);
    }
  }

  const units = documentEntries.map((documentEntry) => {
    const selectedIds = new Set(documentEntry.plan.action === 'NOOP' ? [] : [documentEntry.plan.stableId]);
    const prerequisiteReviewUnitIds = new Set();
    const pending = [...(documentEntry.plan.dependencies || [])];

    while (pending.length > 0) {
      const dependency = pending.shift();
      const dependencyId = planIdForDependency(dependency, byPlanId);
      if (!dependencyId) continue;
      const dependencyEntry = byPlanId.get(dependencyId);
      if (dependencyEntry.kind === 'document') {
        prerequisiteReviewUnitIds.add(reviewUnitId(dependencyEntry.plan.stableId));
        continue;
      }
      if (selectedIds.has(dependencyId)) continue;
      selectedIds.add(dependencyId);
      assignedResourceIds.add(dependencyId);
      pending.push(...(dependencyEntry.plan.dependencies || []));
    }

    for (const downstreamId of downstreamResourceIdsByDocumentId.get(documentEntry.plan.stableId) || []) {
      if (selectedIds.has(downstreamId)) continue;
      selectedIds.add(downstreamId);
      assignedResourceIds.add(downstreamId);
    }

    const entries = actionable.filter((entry) => selectedIds.has(entry.plan.stableId));
    const batch = buildExecutionBatch(entries, selectedIds);
    const id = reviewUnitId(documentEntry.plan.stableId);
    entriesByUnitId.set(id, entries);
    return Object.freeze({
      schemaVersion: 1,
      reviewUnitId: id,
      documentStableId: documentEntry.plan.stableId,
      actionIds: Object.freeze(batch.actions.map((action) => action.actionId)),
      prerequisiteReviewUnitIds: Object.freeze([...prerequisiteReviewUnitIds].sort()),
      batchDigest: batch.batchDigest,
      batch,
    });
  });

  const unassignedResourceActionIds = actionable
    .filter((entry) => entry.kind === 'resource' && !assignedResourceIds.has(entry.plan.stableId))
    .map((entry) => entry.plan.stableId)
    .sort();
  const manifestSemantic = {
    schemaVersion: 1,
    units: units.map((unit) => ({
      reviewUnitId: unit.reviewUnitId,
      documentStableId: unit.documentStableId,
      prerequisiteReviewUnitIds: unit.prerequisiteReviewUnitIds,
    })),
  };
  const semantic = {
    ...manifestSemantic,
    unassignedResourceActionIds,
  };

  return Object.freeze({
    manifest: Object.freeze({
      ...semantic,
      manifestDigest: digestSemantic(manifestSemantic),
    }),
    units: Object.freeze(units),
    entriesByUnitId,
  });
}

function buildAcceptanceManifest(reviewUnitManifest, acceptedUnits) {
  if (!reviewUnitManifest?.manifestDigest || !Array.isArray(reviewUnitManifest.units)) {
    throw new TypeError('reviewUnitManifest with manifestDigest and units is required');
  }
  if (!Array.isArray(acceptedUnits)) throw new TypeError('acceptedUnits must be an array');
  const expectedIds = reviewUnitManifest.units.map((unit) => unit.reviewUnitId).sort();
  const acceptedById = new Map();
  for (const unit of acceptedUnits) {
    if (!unit?.reviewUnitId || !unit?.executionJournalDigest) {
      throw new TypeError('Every accepted unit requires reviewUnitId and executionJournalDigest');
    }
    if (acceptedById.has(unit.reviewUnitId)) throw new TypeError(`Duplicate accepted review unit: ${unit.reviewUnitId}`);
    const touchedRecords = [...(unit.touchedRecords || [])]
      .map((record) => ({ actionId: record.actionId || null, recordId: record.recordId }))
      .sort((left, right) => String(left.recordId).localeCompare(String(right.recordId)));
    if (touchedRecords.some((record) => !record.recordId)) {
      throw new TypeError(`Accepted review unit ${unit.reviewUnitId} has an invalid touched record`);
    }
    acceptedById.set(unit.reviewUnitId, {
      reviewUnitId: unit.reviewUnitId,
      executionJournalDigest: unit.executionJournalDigest,
      touchedRecords,
    });
  }
  const acceptedIds = [...acceptedById.keys()].sort();
  if (JSON.stringify(acceptedIds) !== JSON.stringify(expectedIds)) {
    throw new TypeError(`Accepted review units must exactly match the manifest: expected ${expectedIds.join(', ')}, got ${acceptedIds.join(', ')}`);
  }
  const semantic = {
    schemaVersion: 1,
    reviewUnitManifestDigest: reviewUnitManifest.manifestDigest,
    acceptedUnits: expectedIds.map((id) => acceptedById.get(id)),
  };
  return Object.freeze({
    ...semantic,
    acceptanceManifestDigest: digestSemantic(semantic),
  });
}

module.exports = { buildAcceptanceManifest, buildReviewUnitManifest, reviewUnitId };
