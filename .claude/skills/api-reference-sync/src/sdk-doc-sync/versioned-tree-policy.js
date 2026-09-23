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

const { canonicalStringify } = require('../../../doc-ops-core/src/canonical-json');
const { sha256Digest } = require('../../../doc-ops-core/src/digest');

const INVARIANT_ID = 'api.versioned-tree-delta';
const INVARIANT_VERSION = 2;

const DECISIONS = {
  REUSE_INHERITED_DOCUMENT: 'REUSE_INHERITED_DOCUMENT',
  COPY_PATCH_AND_REPOINT: 'COPY_PATCH_AND_REPOINT',
  COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE: 'COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE',
  UPDATE_IN_PLACE_VERIFIED_UNSHARED: 'UPDATE_IN_PLACE_VERIFIED_UNSHARED',
  CREATE_ADDED_IDENTITY: 'CREATE_ADDED_IDENTITY',
};

const BLOCKERS = {
  DELTA_MODEL_MIRROR_BLOCKED: 'DELTA_MODEL_MIRROR_BLOCKED',
  TREE_DELTA_INVENTORY_INCOMPLETE: 'TREE_DELTA_INVENTORY_INCOMPLETE',
  TREE_DELTA_PLACEMENT_UNKNOWN: 'TREE_DELTA_PLACEMENT_UNKNOWN',
  TREE_DELTA_DIFF_UNKNOWN: 'TREE_DELTA_DIFF_UNKNOWN',
};

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
    return allowed(DECISIONS.UPDATE_IN_PLACE_VERIFIED_UNSHARED, {
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
    const expectedRemaining = evidenceReferenceIds(evidence)
      .filter((recordId) => recordId !== plan.source?.recordId)
      .sort();
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
  } else if (decision === DECISIONS.UPDATE_IN_PLACE_VERIFIED_UNSHARED) {
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
  INVARIANT_ID,
  INVARIANT_VERSION,
  WRITE_PLAN_ACTIONS,
  categoryResourceDefinitions,
  evaluateVersionedTreeDelta,
  factsDigest,
  verifyTreeDeltaPostconditions,
};
