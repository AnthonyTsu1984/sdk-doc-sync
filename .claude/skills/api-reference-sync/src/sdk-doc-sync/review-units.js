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

function buildReviewUnitManifest(plannedEntries, buildExecutionBatch) {
  if (!Array.isArray(plannedEntries)) throw new TypeError('plannedEntries must be an array');
  if (typeof buildExecutionBatch !== 'function') throw new TypeError('buildExecutionBatch is required');

  const actionable = plannedEntries.filter((entry) => entry?.plan?.action !== 'NOOP');
  const byPlanId = new Map(actionable.map((entry) => [entry.plan.stableId, entry]));
  const documentEntries = actionable
    .filter((entry) => entry.kind === 'document')
    .sort((left, right) => left.plan.stableId.localeCompare(right.plan.stableId));
  const assignedResourceIds = new Set();
  const entriesByUnitId = new Map();

  const units = documentEntries.map((documentEntry) => {
    const selectedIds = new Set([documentEntry.plan.stableId]);
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
  const semantic = {
    schemaVersion: 1,
    units: units.map((unit) => ({
      reviewUnitId: unit.reviewUnitId,
      documentStableId: unit.documentStableId,
      prerequisiteReviewUnitIds: unit.prerequisiteReviewUnitIds,
    })),
    unassignedResourceActionIds,
  };

  return Object.freeze({
    manifest: Object.freeze({
      ...semantic,
      manifestDigest: digestSemantic(semantic),
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
