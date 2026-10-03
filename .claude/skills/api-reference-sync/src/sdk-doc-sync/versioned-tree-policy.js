'use strict';

// Deterministic policy kernel for the api.versioned-tree-delta invariant
// (Phase 2 of .claude/plans/2026-09-23-skill-harness-rule-enforcement.md).
//
// The kernel is the single decision authority for how a versioned-tree
// transition may mutate documents. It consumes authoritative inventory facts,
// returns one typed decision from the PR #19 delta-model table, and emits the
// invariant attestation that plans bind into their (digest-covered) body and
// the execution batch revalidates before approval. Equivalent inputs always
// produce identical decisions, DAGs, and digests.
//
// Kernel v4 (issue #76, 2026-10-03 ruling): the blanket "never patch a shared
// cross-track document in place" rule is conditional — in the source track's
// own sync, a shared document may be patched in place when every other
// referencing record is inheritance-review-classified as inheriting the
// change; all other shapes keep the copy-patch-and-repoint table.

const { canonicalStringify } = require('../../../doc-ops-core/src/canonical-json');
const { sha256Digest } = require('../../../doc-ops-core/src/digest');

const INVARIANT_ID = 'api.versioned-tree-delta';
const INVARIANT_VERSION = 4;

// Shared with the executor's live re-derivation (deriveFolderAncestry in
// tree-delta-reconciliation.js): a containment chain deeper than this can
// never be re-derived live, so planning must not approve one.
const FOLDER_ANCESTRY_MAX_DEPTH = 10;

const DECISIONS = {
  REUSE_INHERITED_DOCUMENT: 'REUSE_INHERITED_DOCUMENT',
  COPY_PATCH_AND_REPOINT: 'COPY_PATCH_AND_REPOINT',
  COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE: 'COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE',
  UPDATE_IN_PLACE_VERIFIED: 'UPDATE_IN_PLACE_VERIFIED',
  CREATE_ADDED_IDENTITY: 'CREATE_ADDED_IDENTITY',
};

const BLOCKERS = {
  DELTA_MODEL_MIRROR_BLOCKED: 'DELTA_MODEL_MIRROR_BLOCKED',
  TREE_DELTA_INVENTORY_INCOMPLETE: 'TREE_DELTA_INVENTORY_INCOMPLETE',
  TREE_DELTA_PLACEMENT_UNKNOWN: 'TREE_DELTA_PLACEMENT_UNKNOWN',
  TREE_DELTA_TARGET_OUTSIDE_VERSION_ROOT: 'TREE_DELTA_TARGET_OUTSIDE_VERSION_ROOT',
  TREE_DELTA_DIFF_UNKNOWN: 'TREE_DELTA_DIFF_UNKNOWN',
  TREE_DELTA_POINTING_TRACK_UNCLASSIFIED: 'TREE_DELTA_POINTING_TRACK_UNCLASSIFIED',
};

// The inheritance-review decision vocabulary (mirrors
// scripts/build-reviewed-release-context.js, which enforces the status/
// decision pairing upstream). The kernel only gates on the decision: a
// referencing record is compatible with a shared in-place patch when its
// track inherits the change; every other decision must take the exception
// path (successor-side copy+repoint, then a post-repoint in-place patch).
const INHERITANCE_DECISIONS = new Set([
  'no_successor_action',
  'include_successor_action',
  'defer',
  'exclude',
]);
const INHERITANCE_STATUSES = new Set([
  'inherited',
  'missing',
  'renamed',
  'changed',
  'not_applicable',
  'deferred',
  'successor_action_planned',
]);
const SHARED_UPDATE_INHERITING_DECISION = 'no_successor_action';

const WRITE_PLAN_ACTIONS = new Set(['CREATE', 'BACKFILL', 'UPDATE_IN_PLACE', 'COPY_PATCH_AND_REPOINT']);

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function canonicalFacts(facts) {
  return canonicalStringify(facts).slice(0, -1);
}

function factsDigest(facts) {
  return sha256Digest(Buffer.from(canonicalFacts(facts), 'utf8'));
}

function evidenceSharedStatus(evidence) {
  return evidence?.sharedToken?.status ?? 'unknown';
}

function evidenceReferenceIds(evidence) {
  return [...(evidence?.sharedToken?.referencedRecordIds || [])].filter(nonEmptyString);
}

function evidenceCoversBothTracks(evidence, currentVersion, targetVersion) {
  const digests = evidence?.trackInventoryDigests || {};
  const covered = (version) => nonEmptyString(version)
    && /^sha256:[0-9a-f]{64}$/.test(String(digests[version] || ''));
  // Same-track unshared documents legitimately carry one digest entry that
  // covers both the current and the target version.
  return covered(currentVersion) && covered(targetVersion);
}

function validExpectedFields(fields) {
  return Boolean(fields)
    && fields.type === 'VirtualNode'
    && Array.isArray(fields.targets) && fields.targets.length > 0 && fields.targets.every(nonEmptyString)
    && nonEmptyString(fields.progress)
    && nonEmptyString(fields.slug);
}

// Placement containment evidence (kernel v3, 2026-10-03 java audit): the
// folder chain from the target track's version root down to the target
// folder, inclusive. A copy decision without it is unplanable — a target
// resolved inside the older tree is exactly the in-place-copy failure mode
// where the "copy" was created beside its source and both tables ended up
// pointing at same-title documents in one directory.
// Shape contract shared with the executor's live re-derivation
// (deriveFolderAncestry): a duplicate-free folder chain from the version root
// to the leaf. minLength 2 applies to plain-copy targets (a category folder
// sits below the root); a category-create parent may BE the root
// (minLength 1). Chains the live BFS can never produce — duplicates, or depth
// beyond FOLDER_ANCESTRY_MAX_DEPTH — are rejected here so planning never
// approves a shape that execution will refuse.
function validFolderAncestry(chain, { rootToken, leafToken, minLength = 1 }) {
  return Array.isArray(chain)
    && chain.length >= minLength
    && chain.length <= FOLDER_ANCESTRY_MAX_DEPTH + 1
    && chain.every(nonEmptyString)
    && nonEmptyString(rootToken)
    && nonEmptyString(leafToken)
    && chain[0] === rootToken
    && chain[chain.length - 1] === leafToken
    && new Set(chain).size === chain.length;
}

function validCategorySpec(category) {
  const folder = category?.folder;
  const repoint = category?.repoint;
  if (!folder
    || !nonEmptyString(folder.ref)
    || !nonEmptyString(folder.name)
    || !nonEmptyString(folder.parentFolderToken)
    || !nonEmptyString(folder.versionRootToken)
    || folder.existingLookup?.checked !== true
    || folder.existingLookup?.absent !== true) {
    return false;
  }
  if (!repoint
    || !nonEmptyString(repoint.ref)
    || repoint.ref === folder.ref
    || !nonEmptyString(repoint.recordId)
    || !nonEmptyString(repoint.currentFolderToken)
    || !validExpectedFields(repoint.expectedFields)) {
    return false;
  }
  // The repoint resource must be assemblable: planResource rejects a
  // virtual_node_repoint without checked-and-matched record evidence and an
  // explicit Bitable target, so the spec is invalid without them.
  const lookup = repoint.existingLookup;
  return Boolean(
    lookup
    && lookup.checked === true
    && lookup.matched === true
    && lookup.recordId === repoint.recordId
    && lookup.currentFolderToken === repoint.currentFolderToken
    && nonEmptyString(repoint.baseToken)
    && nonEmptyString(repoint.tableId),
  );
}

function requiredResourceDag({ stableId, category }) {
  return Object.freeze([
    { action: 'CREATE_FOLDER', stableId: `resource:${category.folder.ref}` },
    { action: 'COPY_PATCH_AND_REPOINT', stableId },
    {
      action: 'REPOINT_CATEGORY_VIRTUAL_NODE',
      stableId: `resource:${category.repoint.ref}`,
      dependsOn: Object.freeze([`resource:${category.folder.ref}`, stableId]),
    },
    { action: 'VERIFY_TREE_DELTA', stableId: `tree-delta:${stableId}` },
  ]);
}

function blocked(blocker, detail) {
  return Object.freeze({
    status: 'blocked',
    decision: null,
    blocker,
    detail: detail ?? null,
    attestation: null,
    requiredResourceDag: null,
  });
}

function allowed(decision, { inputDigest, evidenceDigest = null, requiredResourceDag: dag = null }) {
  const attestation = Object.freeze({
    id: INVARIANT_ID,
    version: INVARIANT_VERSION,
    inputDigest,
    decision,
    evidenceDigest,
    ...(dag ? { requiredResourceDag: dag } : {}),
  });
  return Object.freeze({
    status: 'allowed',
    decision,
    blocker: null,
    detail: null,
    attestation,
    requiredResourceDag: dag,
  });
}

// Kernel v4 (issue #76 ruling, 2026-10-03): classification gate for a shared
// in-place patch in the source track's own sync. `reviews` carries one entry
// per OTHER record referencing the shared document — { recordId, track,
// decision, status? } joined from the inheritance review — and must cover the
// reference set exactly. Every entry must classify its track as inheriting
// the change (`no_successor_action`); any gap, unknown record, or other
// decision fails closed, because an in-place patch would push the change onto
// tracks the review did not clear. A referencing record classified
// include_successor_action / defer / exclude must take the exception path
// instead: a successor-side copy+repoint executed first, then an in-place
// patch planned against refreshed post-repoint (unshared) evidence — the
// executor's live reference drift check refuses the in-place patch while the
// successor record still points at the shared document, so batch ordering is
// structurally enforced. Shared with the executor's pre-write revalidation.
function validateSharedUpdateReviews(reviews, { referencedRecordIds, sourceRecordId }) {
  const others = [...new Set(referencedRecordIds.filter((id) => id !== sourceRecordId))];
  const blocked = (detail) => ({ ok: false, code: BLOCKERS.TREE_DELTA_POINTING_TRACK_UNCLASSIFIED, detail });
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return blocked(
      'A shared cross-track in-place patch requires a sharedUpdateReviews classification for every other referencing record (inheritance review decision no_successor_action); none were supplied',
    );
  }
  const byRecordId = new Map();
  for (const review of reviews) {
    if (!nonEmptyString(review?.recordId)
      || !nonEmptyString(review?.track)
      || !INHERITANCE_DECISIONS.has(review?.decision)
      || (review?.status !== undefined && !INHERITANCE_STATUSES.has(review.status))) {
      return blocked('sharedUpdateReviews entries require recordId, track, and an inheritance-review decision');
    }
    if (byRecordId.has(review.recordId)) {
      return blocked(`Duplicate sharedUpdateReviews entry for referencing record ${review.recordId}`);
    }
    byRecordId.set(review.recordId, review);
  }
  const missing = others.filter((recordId) => !byRecordId.has(recordId));
  if (missing.length > 0) {
    return blocked(
      `Referencing records not classified in the inheritance review: ${missing.join(', ')}; classification is required before a shared in-place patch`,
    );
  }
  const extra = [...byRecordId.keys()].filter((recordId) => !others.includes(recordId));
  if (extra.length > 0) {
    return blocked(
      `sharedUpdateReviews classify records that do not reference the shared document: ${extra.join(', ')}`,
    );
  }
  for (const [recordId, review] of byRecordId) {
    if (review.decision !== SHARED_UPDATE_INHERITING_DECISION) {
      return blocked(
        `Referencing record ${recordId} (track ${review.track}) is classified ${review.decision}; an in-place patch would push the change onto a track the review did not clear — use the successor-side copy+repoint exception path, then patch from post-repoint evidence`,
      );
    }
  }
  return { ok: true, reviews };
}

// Input facts for one canonical identity. `sourceDiff` comes from the diff
// engine (UPDATE ⇒ changed, SKIP ⇒ unchanged); `operation` is the requested
// plan operation. Everything else mirrors the planner context the builder
// already validates.
function evaluateVersionedTreeDelta(input) {
  const operation = input?.operation;
  const stableId = input?.stableId;
  if (!nonEmptyString(stableId) || !nonEmptyString(operation)) {
    return blocked('TREE_DELTA_DIFF_UNKNOWN', 'stableId and operation are required');
  }

  if (operation === 'CREATE' || operation === 'BACKFILL') {
    const lookup = input?.existingRecordLookup;
    if (!lookup || lookup.checked !== true || lookup.absent !== true) {
      return blocked(
        BLOCKERS.DELTA_MODEL_MIRROR_BLOCKED,
        `${operation} ${stableId} requires checked-and-absent lookup evidence; an existing interface must not be mirrored into the newer tree`,
      );
    }
    const facts = { existingRecordLookup: lookup, stableId, target: input.target ?? null };
    return allowed(DECISIONS.CREATE_ADDED_IDENTITY, { inputDigest: factsDigest(facts) });
  }

  if (operation !== 'UPDATE') {
    return blocked('TREE_DELTA_DIFF_UNKNOWN', `Operation ${operation} is outside the versioned-tree delta table`);
  }

  const sourceDiff = input.sourceDiff;
  if (sourceDiff !== 'changed' && sourceDiff !== 'unchanged') {
    return blocked(BLOCKERS.TREE_DELTA_DIFF_UNKNOWN, `Source diff classification is ${sourceDiff || 'unknown'} for ${stableId}`);
  }

  const current = input.current || {};
  const target = input.target || {};
  const evidence = input.inheritanceEvidence;
  if (!evidence
    || evidence.evidenceDigest == null
    || !evidenceCoversBothTracks(evidence, current.version, target.version)
    || evidenceSharedStatus(evidence) === 'unknown') {
    return blocked(
      BLOCKERS.TREE_DELTA_INVENTORY_INCOMPLETE,
      `Verified cross-track inventory evidence is required for ${stableId}`,
    );
  }

  if (sourceDiff === 'unchanged') {
    if (operation === 'UPDATE' && input.mirrorAttempt === true) {
      return blocked(
        BLOCKERS.DELTA_MODEL_MIRROR_BLOCKED,
        `Unchanged interface ${stableId} must reuse the inherited document; mirroring it into the newer tree violates the delta model`,
      );
    }
    const facts = { current: input.current ?? null, sourceDiff, stableId };
    return allowed(DECISIONS.REUSE_INHERITED_DOCUMENT, {
      inputDigest: factsDigest(facts),
      evidenceDigest: evidence.evidenceDigest,
    });
  }

  // Mirrors the pre-kernel UPDATE_IN_PLACE conditions exactly: verified
  // target-local placement plus tri-state unshared evidence.
  const unsharedAndTargetLocal = evidenceSharedStatus(evidence) === 'unshared'
    && current.version === target.version
    && current.ancestryVerified === true
    && nonEmptyString(current.folderToken)
    && current.folderToken === target.folderToken;
  if (unsharedAndTargetLocal) {
    const facts = {
      current,
      referencedRecordIds: evidenceReferenceIds(evidence),
      sourceDiff,
      stableId,
      target,
    };
    return allowed(DECISIONS.UPDATE_IN_PLACE_VERIFIED, {
      inputDigest: factsDigest(facts),
      evidenceDigest: evidence.evidenceDigest,
    });
  }

  // Kernel v4: a source-track sync hitting a shared cross-track document may
  // patch it in place — the change structurally flows to every track that
  // still points at it — but only when every other referencing record is
  // classified by the inheritance review as inheriting the change. Anything
  // else fails closed (validateSharedUpdateReviews).
  const sameTrackShared = evidenceSharedStatus(evidence) === 'shared'
    && current.version === target.version
    && current.ancestryVerified === true
    && nonEmptyString(current.folderToken)
    && current.folderToken === target.folderToken;
  if (sameTrackShared) {
    const referencedRecordIds = evidenceReferenceIds(evidence);
    const verdict = validateSharedUpdateReviews(input.sharedUpdateReviews, {
      referencedRecordIds,
      sourceRecordId: current.recordId,
    });
    if (!verdict.ok) {
      return blocked(verdict.code, verdict.detail);
    }
    const facts = {
      current,
      referencedRecordIds,
      sharedUpdateReviews: input.sharedUpdateReviews,
      sourceDiff,
      stableId,
      target,
    };
    return allowed(DECISIONS.UPDATE_IN_PLACE_VERIFIED, {
      inputDigest: factsDigest(facts),
      evidenceDigest: evidence.evidenceDigest,
    });
  }

  const categoryPresent = nonEmptyString(target.folderToken);
  const categoryAbsentWithResource = !categoryPresent
    && nonEmptyString(target.folderRef);
  if (!categoryPresent && !categoryAbsentWithResource) {
    return blocked(
      BLOCKERS.TREE_DELTA_PLACEMENT_UNKNOWN,
      `Target category placement is unknown for ${stableId}; planning cannot fall back to an in-place patch`,
    );
  }
  if (categoryPresent) {
    if (target.folderAncestry === undefined) {
      return blocked(
        BLOCKERS.TREE_DELTA_PLACEMENT_UNKNOWN,
        `Copy target containment evidence is required for ${stableId}: supply target.folderAncestry (the folder chain from the target version root down to target.folderToken)`,
      );
    }
    if (!validFolderAncestry(target.folderAncestry, {
      rootToken: target.versionRootToken,
      leafToken: target.folderToken,
      minLength: 2,
    })) {
      return blocked(
        BLOCKERS.TREE_DELTA_TARGET_OUTSIDE_VERSION_ROOT,
        `Copy target ${target.folderToken} for ${stableId} is not contained under version root ${target.versionRootToken ?? '(missing)'} per the supplied folderAncestry (the chain must run from the version root to the target folder without duplicates and within depth ${FOLDER_ANCESTRY_MAX_DEPTH})`,
      );
    }
  } else {
    const parentAncestry = input.category?.folder?.parentAncestry;
    if (parentAncestry === undefined) {
      return blocked(
        BLOCKERS.TREE_DELTA_PLACEMENT_UNKNOWN,
        `Category-create containment evidence is required for ${stableId}: supply category.folder.parentAncestry (the folder chain from the target version root down to category.folder.parentFolderToken)`,
      );
    }
    if (!validFolderAncestry(parentAncestry, {
      rootToken: input.category.folder.versionRootToken,
      leafToken: input.category.folder.parentFolderToken,
    })) {
      return blocked(
        BLOCKERS.TREE_DELTA_TARGET_OUTSIDE_VERSION_ROOT,
        `Category-create parent ${input.category.folder.parentFolderToken} for ${stableId} is not contained under version root ${input.category.folder.versionRootToken ?? '(missing)'} per the supplied parentAncestry`,
      );
    }
  }
  if (categoryAbsentWithResource && !validCategorySpec(input.category)) {
    return blocked(
      BLOCKERS.TREE_DELTA_PLACEMENT_UNKNOWN,
      `Missing target category for ${stableId} requires a matching folder + VirtualNode repoint resource spec (context.treeDelta.category)`,
    );
  }
  const decision = categoryPresent
    ? DECISIONS.COPY_PATCH_AND_REPOINT
    : DECISIONS.COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE;
  const dag = categoryPresent ? null : requiredResourceDag({ stableId, category: input.category });
  const facts = {
    category: categoryPresent ? null : input.category,
    current,
    referencedRecordIds: evidenceReferenceIds(evidence),
    requiredResourceDag: dag,
    sourceDiff,
    stableId,
    target,
  };
  return allowed(decision, {
    inputDigest: factsDigest(facts),
    evidenceDigest: evidence.evidenceDigest,
    requiredResourceDag: dag,
  });
}

// Pure assembly of the resource definitions the missing-category decision
// requires. Callers (candidate-spec builders) feed these to planResource; the
// batch builder re-derives the same specs from the attestation's DAG and
// rejects any drift.
function categoryResourceDefinitions({ stableId, category }) {
  if (!validCategorySpec(category)) {
    throw new TypeError('categoryResourceDefinitions requires a validated category spec');
  }
  const folder = category.folder;
  const repoint = category.repoint;
  return Object.freeze([
    Object.freeze({
      kind: 'folder',
      ref: folder.ref,
      name: folder.name,
      parentFolderToken: folder.parentFolderToken,
      versionRootToken: folder.versionRootToken,
      ...(Array.isArray(folder.parentAncestry) ? { parentAncestry: Object.freeze([...folder.parentAncestry]) } : {}),
      existingLookup: Object.freeze({ ...folder.existingLookup }),
    }),
    Object.freeze({
      kind: 'virtual_node_repoint',
      ref: repoint.ref,
      recordId: repoint.recordId,
      title: repoint.title || folder.name,
      folderRef: folder.ref,
      currentFolderToken: repoint.currentFolderToken,
      expectedFields: Object.freeze({ ...repoint.expectedFields }),
      baseToken: repoint.baseToken,
      tableId: repoint.tableId,
      dependsOn: Object.freeze([folder.ref, stableId]),
      existingLookup: Object.freeze({ ...repoint.existingLookup }),
    }),
  ]);
}

// Pure post-write comparator for VERIFY_TREE_DELTA. `observed` carries freshly
// refetched state; every mismatch becomes one typed finding. This function
// never reads or writes — callers own the refetch.
function verifyTreeDeltaPostconditions({ plan, observed }) {
  const errors = [];
  const attestation = (plan?.invariantAttestations || [])
    .find((entry) => entry?.id === INVARIANT_ID) || null;
  if (!attestation) {
    return { ok: false, errors: [{ code: 'INVARIANT_ATTESTATION_REQUIRED', actionId: plan?.stableId || null }] };
  }
  const decision = attestation.decision;
  const evidence = plan?.inheritanceEvidence;

    if (decision === DECISIONS.COPY_PATCH_AND_REPOINT
    || decision === DECISIONS.COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE) {
    // Repointing removes exactly ONE reference — the repointed track's
    // record — not every record sharing its (possibly cloned) recordId.
    const expectedRemaining = evidenceReferenceIds(evidence).sort();
    if (decision === DECISIONS.COPY_PATCH_AND_REPOINT
      || decision === DECISIONS.COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE) {
      const repointedIndex = expectedRemaining.indexOf(plan.source?.recordId);
      if (repointedIndex >= 0) expectedRemaining.splice(repointedIndex, 1);
    }
    const live = [...(observed?.olderDocumentReferences || [])].filter(nonEmptyString).sort();
    if (JSON.stringify(expectedRemaining) !== JSON.stringify(live)) {
      errors.push({
        code: 'TREE_DELTA_REFERENCES_DRIFTED',
        expected: expectedRemaining,
        actual: live,
      });
    }
    const expectedToken = observed?.createdDocumentToken ?? null;
    if (!nonEmptyString(expectedToken) || observed?.targetRecordDocumentToken !== expectedToken) {
      errors.push({
        code: 'TREE_DELTA_TARGET_RECORD_NOT_REPOINTED',
        expected: expectedToken,
        actual: observed?.targetRecordDocumentToken ?? null,
      });
    }
    // Placement closure (2026-10-03 ruling: the copy must land under the
    // target track's tree). For WITH_CATEGORY_CREATE the expected folder is
    // the freshly created category folder; for the plain copy decision it is
    // the planned target folder. The check runs only when the observation
    // carries placement (the created document's folder, or the
    // missing-from-target-folder flag) so already-approved in-flight
    // plans without those fields keep verifying.
    const expectedFolderToken = decision === DECISIONS.COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE
      ? (observed?.categoryFolderToken ?? null)
      : (plan?.target?.folderToken ?? null);
    if (nonEmptyString(expectedFolderToken)
      && (observed?.createdDocumentMissingFromTargetFolder === true
        || (observed?.createdDocumentFolderToken != null
          && observed.createdDocumentFolderToken !== expectedFolderToken))) {
      errors.push({
        code: 'TREE_DELTA_CREATED_DOCUMENT_MISPLACED',
        expected: expectedFolderToken,
        actual: observed.createdDocumentFolderToken,
      });
    }
    if (decision === DECISIONS.COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE) {
      const expectedFolderLink = observed?.categoryFolderLink ?? null;
      if (!nonEmptyString(expectedFolderLink) || observed?.categoryNodeLink !== expectedFolderLink) {
        errors.push({
          code: 'TREE_DELTA_CATEGORY_NODE_NOT_REPOINTED',
          expected: expectedFolderLink,
          actual: observed?.categoryNodeLink ?? null,
        });
      }
      const expectedFolderToken = observed?.categoryFolderToken ?? null;
      if (!nonEmptyString(expectedFolderToken)
        || observed?.createdDocumentFolderToken !== expectedFolderToken) {
        errors.push({
          code: 'TREE_DELTA_CREATED_DOCUMENT_MISPLACED',
          expected: expectedFolderToken,
          actual: observed?.createdDocumentFolderToken ?? null,
        });
      }
    }
  } else if (decision === DECISIONS.UPDATE_IN_PLACE_VERIFIED) {
    // Both in-place flavors (target-local unshared, and the kernel v4
    // classified shared patch) assert the same post-write fact: the live
    // reference multiset still equals the approved evidence, so no track was
    // silently repointed onto or away from the patched document.
    const expected = evidenceReferenceIds(evidence).sort();
    const live = [...(observed?.olderDocumentReferences || [])].filter(nonEmptyString).sort();
    if (JSON.stringify(expected) !== JSON.stringify(live)) {
      errors.push({
        code: 'TREE_DELTA_REFERENCES_DRIFTED',
        expected,
        actual: live,
      });
    }
  } else if (decision !== DECISIONS.CREATE_ADDED_IDENTITY
    && decision !== DECISIONS.REUSE_INHERITED_DOCUMENT) {
    errors.push({ code: 'TREE_DELTA_DECISION_UNKNOWN', decision });
  }

  return { ok: errors.length === 0, errors, invariantId: INVARIANT_ID, decision };
}

module.exports = {
  BLOCKERS,
  DECISIONS,
  FOLDER_ANCESTRY_MAX_DEPTH,
  INHERITANCE_DECISIONS,
  INHERITANCE_STATUSES,
  INVARIANT_ID,
  INVARIANT_VERSION,
  WRITE_PLAN_ACTIONS,
  categoryResourceDefinitions,
  evaluateVersionedTreeDelta,
  factsDigest,
  validFolderAncestry,
  validateSharedUpdateReviews,
  verifyTreeDeltaPostconditions,
};
