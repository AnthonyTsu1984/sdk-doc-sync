'use strict';

const { assertPublishableContent } = require('./feishu-block-safety');
const { verbatimContentDigest } = require('./verbatim-content');
const {
  organizationRecordType,
  validateOrganizationContract,
  validateOrganizationTarget,
  validateReleasePlacement,
} = require('./sdk-organization-contract');
const {
  evidenceShared,
  validateInheritanceEvidence,
} = require('./inheritance-evidence');
const {
  DECISIONS,
  evaluateVersionedTreeDelta,
} = require('./versioned-tree-policy');
const { canonicalStringify } = require('../../../doc-ops-core/src/canonical-json');
const { sha256Digest } = require('../../../doc-ops-core/src/digest');

const WRITE_ACTIONS = new Set(['CREATE', 'UPDATE', 'BACKFILL', 'REBUILD']);
const KNOWN_ACTIONS = new Set(['CREATE', 'UPDATE', 'DEPRECATE', 'ORPHAN', 'SKIP', 'BACKFILL', 'REBUILD']);
// BACKFILL is a documentation-gap create: the interface predates the scan
// baseline, but the record and document still need the full CREATE path.
const CREATE_LIKE_ACTIONS = new Set(['CREATE', 'BACKFILL']);

class SyncPlanningError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SyncPlanningError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function deepClone(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  const clone = Array.isArray(value) ? [] : {};
  seen.set(value, clone);
  for (const [key, child] of Object.entries(value)) clone[key] = deepClone(child, seen);
  return clone;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function stableSerialize(value) {
  try {
    return canonicalStringify(value).slice(0, -1);
  } catch (error) {
    throw new SyncPlanningError('INVALID_ARTIFACT', error.message);
  }
}

function defaultDigest(bytes) {
  return sha256Digest(bytes);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function artifactBytes(artifact) {
  if (artifact.documentIr && typeof artifact.documentIr === 'object' && artifact.layout) {
    if (nonEmptyString(artifact.content) && artifact.content.trim().length > 0) {
      assertPublishableContent(artifact.content);
    }
    return {
      bytes: Buffer.from(stableSerialize({
        documentIr: artifact.documentIr,
        layout: artifact.layout,
      }), 'utf8'),
      kind: 'sdk-document-ir',
    };
  }
  if (nonEmptyString(artifact.content) && artifact.content.trim().length > 0) {
    assertPublishableContent(artifact.content);
    return { bytes: Buffer.from(artifact.content, 'utf8'), kind: 'content' };
  }
  if (artifact.documentIr && typeof artifact.documentIr === 'object') {
    return { bytes: Buffer.from(stableSerialize(artifact.documentIr), 'utf8'), kind: 'document-ir' };
  }
  return null;
}

function sourceFrom(action, context) {
  const doc = action.doc || {};
  const metadata = doc.metadata || {};
  const current = context.current || {};
  const currentValue = (key, fallback) => Object.prototype.hasOwnProperty.call(current, key)
    ? current[key]
    : fallback;
  return {
    version: currentValue('version', metadata.version ?? null),
    recordId: currentValue('recordId', doc.id ?? null),
    documentToken: currentValue('documentToken', metadata.documentToken ?? metadata.token ?? null),
    folderToken: currentValue('folderToken', metadata.folderToken ?? null),
    parentRecordId: currentValue('parentRecordId', metadata.parentRecordId ?? action.doc?.parent ?? null),
    recordType: currentValue('recordType', metadata.type ?? null),
    docsResourceType: currentValue(
      'docsResourceType',
      metadata.docsResourceType
        ?? (String(metadata.link || '').includes('/drive/folder/') ? 'folder' : 'docx'),
    ),
  };
}

function targetFrom(context) {
  const target = context.target || {};
  const result = {
    version: target.version ?? context.targetVersion ?? null,
    parentRecordId: target.parentRecordId ?? null,
    folderToken: target.folderToken ?? null,
    versionRootToken: target.versionRootToken ?? null,
    releaseVersion: target.releaseVersion ?? target.version ?? context.targetVersion ?? null,
    documentHomeVersion: target.documentHomeVersion ?? null,
  };
  if (target.parentRecordRef !== undefined) result.parentRecordRef = target.parentRecordRef ?? null;
  if (target.folderRef !== undefined) result.folderRef = target.folderRef ?? null;
  if (target.recordType !== undefined) result.recordType = target.recordType ?? null;
  // Kernel v3 containment evidence: the folder chain from the target version
  // root down to the target folder. The kernel blocks copy decisions without
  // it; pass it through untouched so the attestation digest binds the bytes.
  if (target.folderAncestry !== undefined) result.folderAncestry = target.folderAncestry;
  return result;
}

function copySourceFrom(context) {
  const copySource = context.copySource || {};
  const placement = copySource.placement || {};
  return {
    documentToken: copySource.documentToken ?? null,
    link: copySource.link ?? null,
    title: copySource.title ?? null,
    // Kernel v5: the source document's live placement (from the placement
    // audit entry of the record the copy repoints away from) — the executor's
    // copy-structure mirror gate re-derives both chains live and asserts the
    // target mirrors the source section structure level-by-level.
    placement: (nonEmptyString(placement.versionRootToken) && nonEmptyString(placement.folderToken))
      ? { versionRootToken: placement.versionRootToken, folderToken: placement.folderToken }
      : null,
  };
}

function existingRecordLookupFrom(context) {
  const lookup = context.existingRecordLookup || {};
  return {
    checked: lookup.checked === true,
    absent: lookup.absent === true,
    baseToken: lookup.baseToken ?? null,
    tableId: lookup.tableId ?? null,
    parentRecordId: lookup.parentRecordId ?? null,
    parentRecordRef: lookup.parentRecordRef ?? null,
    criteria: lookup.criteria ?? null,
  };
}

function dependenciesFrom(context) {
  return [...new Set((context.dependencies || []).filter(nonEmptyString))];
}

function stableIdFrom(action) {
  return action.stableId
    || action.symbol?.identity?.stableId
    || action.symbol?.stableId
    || action.slug
    || null;
}

function assertDocumentationOwnership(action, stableId) {
  const ownership = action.documentationOwnership;
  if (!ownership) return;
  const owners = [
    ...(Array.isArray(ownership.owners) ? ownership.owners : []),
    ...(Array.isArray(ownership.targets) ? ownership.targets : []),
  ];
  const hasDeclaredOwners = ownership.owners !== undefined || ownership.targets !== undefined;
  if (ownership.classification === 'ambiguous') {
    throw new SyncPlanningError(
      'AMBIGUOUS_DOCUMENTATION_OWNERSHIP',
      `Documentation ownership is ambiguous for ${stableId}`,
    );
  }
  if (ownership.classification === 'standalone' && (hasDeclaredOwners || owners.length > 0)) {
    throw new SyncPlanningError(
      'METHOD_OWNED_STANDALONE_FORBIDDEN',
      `Standalone documentation cannot retain known method owners for ${stableId}`,
    );
  }
  if (ownership.classification !== 'method_owned') return;
  const declaredOwner = owners.some((owner) => owner?.stableId === ownership.selectedOwnerStableId);
  if (!declaredOwner || ownership.selectedOwnerStableId !== stableId) {
    throw new SyncPlanningError(
      'METHOD_OWNED_STANDALONE_FORBIDDEN',
      `Method-owned documentation must plan a declared owner for ${stableId}`,
    );
  }
}

/**
 * Pure planner for immutable version-safe SDK document changes.
 *
 * `planAction(action, context)` plans one DiffEngine action. `planAll(actions,
 * contexts)` preserves input order; contexts may be an array, one shared object,
 * or a function receiving `(action, index)`.
 */
class SyncPlanner {
  constructor({ digest = defaultDigest } = {}) {
    if (typeof digest !== 'function') throw new TypeError('digest must be a function');
    this.digest = digest;
  }

  planAll(actions, contexts = {}) {
    if (!Array.isArray(actions)) throw new TypeError('actions must be an array');
    const plans = actions.map((action, index) => {
      const context = typeof contexts === 'function'
        ? contexts(action, index)
        : Array.isArray(contexts)
          ? contexts[index]
          : contexts;
      return this.planAction(action, context || {});
    });
    return deepFreeze(plans);
  }

  planResource(resource, { placementWalkDigest = null } = {}) {
    if (!resource || typeof resource !== 'object') {
      throw new SyncPlanningError('RESOURCE_REQUIRED', 'A resource definition is required');
    }
    const ref = resource.ref;
    if (!nonEmptyString(ref)) {
      throw new SyncPlanningError('RESOURCE_REF_REQUIRED', 'A stable resource ref is required');
    }
    const lookup = resource.existingLookup || {};
    if (resource.kind === 'virtual_node_repoint') {
      // A repoint targets an EXISTING VirtualNode: the evidence must attest a
      // matched record, not an absent one.
      if (lookup.checked !== true || lookup.matched !== true || lookup.recordId !== resource.recordId) {
        throw new SyncPlanningError('RESOURCE_LOOKUP_REQUIRED', `Resource ${ref} requires checked-and-matched lookup evidence for the repointed record`);
      }
    } else if (lookup.checked !== true || lookup.absent !== true) {
      throw new SyncPlanningError('RESOURCE_LOOKUP_REQUIRED', `Resource ${ref} requires checked-and-absent lookup evidence`);
    }
    const dependencies = [...new Set((resource.dependsOn || []).filter(nonEmptyString))];
    let action;
    let postconditions;
    let preconditions = [{ type: 'RESOURCE_ABSENT', ref, lookup: deepClone(lookup) }];
    if (resource.kind === 'folder') {
      if (!nonEmptyString(resource.name)
        || !nonEmptyString(resource.parentFolderToken)
        || !nonEmptyString(resource.versionRootToken)
        || lookup.parentFolderToken !== resource.parentFolderToken
        || lookup.name !== resource.name) {
        throw new SyncPlanningError('FOLDER_RESOURCE_INVALID', `Folder resource ${ref} requires canonical parent, root, name, and absent lookup evidence`);
      }
      if (resource.repointVirtualNode !== undefined) {
        // Phase 2 DAG split: repointing the category VirtualNode inside the
        // folder action produces CREATE_FOLDER -> REPOINT before the document
        // action. The invariant requires the repoint to run only after the
        // copied document is verified, so it must be planned as its own
        // virtual_node_repoint resource instead.
        throw new SyncPlanningError(
          'VIRTUAL_NODE_REPOINT_REQUIRED',
          `Folder resource ${ref} must not embed repointVirtualNode; plan a separate virtual_node_repoint resource that depends on the folder and the document action`,
        );
      }
      action = 'CREATE_FOLDER';
      postconditions = [
        { type: 'RESOURCE_RESOLVED', ref, value: 'NEW_FOLDER_TOKEN' },
        { type: 'TARGET_ANCESTRY', folderRef: ref, versionRootToken: resource.versionRootToken },
      ];
    } else if (resource.kind === 'virtual_node_repoint') {
      const expectedFields = resource.expectedFields || {};
      // Exactly one destination form: folderRef resolved from a CREATE_FOLDER
      // resource planned in the same batch (pre-creation), or a concrete
      // folderToken for a version folder that already exists (post-creation
      // adoption — no folder resource is planned anymore).
      const hasFolderRef = nonEmptyString(resource.folderRef);
      const hasFolderToken = nonEmptyString(resource.folderToken);
      if (hasFolderRef === hasFolderToken) {
        throw new SyncPlanningError(
          'VIRTUAL_NODE_REPOINT_RESOURCE_INVALID',
          `VirtualNode repoint resource ${ref} requires exactly one of folderRef (in-batch CREATE_FOLDER) or folderToken (existing folder)`,
        );
      }
      const documentDependencies = dependencies.filter((dependency) => dependency !== resource.folderRef);
      if (!nonEmptyString(resource.recordId)
        || !nonEmptyString(resource.baseToken)
        || !nonEmptyString(resource.tableId)
        || (hasFolderRef && !dependencies.includes(resource.folderRef))
        || documentDependencies.length === 0
        || !nonEmptyString(resource.currentFolderToken)
        || expectedFields.type !== 'VirtualNode'
        || !Array.isArray(expectedFields.targets)
        || expectedFields.targets.length === 0
        || !expectedFields.targets.every(nonEmptyString)
        || !nonEmptyString(expectedFields.progress)
        || !nonEmptyString(expectedFields.slug)) {
        throw new SyncPlanningError(
          'VIRTUAL_NODE_REPOINT_RESOURCE_INVALID',
          `VirtualNode repoint resource ${ref} requires the folder and document dependencies, the current folder link, and preserved VirtualNode field evidence`,
        );
      }
      action = 'REPOINT_CATEGORY_VIRTUAL_NODE';
      postconditions = [
        { type: 'RESOURCE_RESOLVED', ref, value: 'REPOINTED' },
        {
          type: 'VIRTUAL_NODE_LINK',
          recordId: resource.recordId,
          ...(hasFolderRef ? { folderRef: resource.folderRef } : { folderToken: resource.folderToken }),
          preservedFields: deepClone(expectedFields),
        },
      ];
      // A repoint updates an existing VirtualNode: its precondition is the
      // approved CURRENT link plus intact structural fields (re-verified live
      // pre-write), and it must run only after the document action it
      // depends on completed with verified postconditions.
      preconditions = [
        {
          type: 'VIRTUAL_NODE_CURRENT_LINK',
          recordId: resource.recordId,
          currentFolderToken: resource.currentFolderToken,
          preservedFields: deepClone(expectedFields),
        },
        ...documentDependencies.map((dependency) => ({
          type: 'DOCUMENT_ACTION_VERIFIED',
          stableId: dependency,
        })),
      ];
    } else if (resource.kind === 'virtual_node') {
      if (!nonEmptyString(resource.title)
        || !nonEmptyString(resource.folderRef)
        || !nonEmptyString(resource.baseToken)
        || !nonEmptyString(resource.tableId)
        || !nonEmptyString(resource.version)
        || !Array.isArray(resource.targets)
        || resource.targets.length === 0
        || !resource.targets.every(nonEmptyString)
        || !nonEmptyString(resource.progress)
        || !dependencies.includes(resource.folderRef)
        || !nonEmptyString(lookup.baseToken)
        || !nonEmptyString(lookup.tableId)
        || !nonEmptyString(lookup.criteria?.canonicalSlug)) {
        throw new SyncPlanningError('VIRTUAL_NODE_RESOURCE_INVALID', `VirtualNode resource ${ref} requires folder dependency, explicit structural metadata, and absent Bitable lookup evidence`);
      }
      if (!nonEmptyString(resource.parentRecordId)) {
        // The Slug duplex field derives from the parent-record chain: a VN
        // record parented under its category VirtualNode carries the
        // prefixed slug (MilvusClient-FunctionChain) without writing it.
        throw new SyncPlanningError('VIRTUAL_NODE_RESOURCE_INVALID', `VirtualNode resource ${ref} requires parentRecordId (the category VirtualNode record) — the Slug derives from the parent-record chain`);
      }
      action = 'CREATE_VIRTUAL_NODE';
      postconditions = [
        { type: 'RESOURCE_RESOLVED', ref, value: 'NEW_RECORD_ID' },
        { type: 'VIRTUAL_NODE_LINK', recordId: 'NEW_RECORD_ID', folderRef: resource.folderRef },
        {
          type: 'VIRTUAL_NODE_METADATA',
          slug: lookup.criteria.canonicalSlug,
          targets: [...resource.targets],
          progress: resource.progress,
        },
      ];
    } else {
      throw new SyncPlanningError('UNKNOWN_RESOURCE_KIND', `Unknown dependent resource kind: ${resource.kind || '(missing)'}`);
    }
    return deepFreeze(deepClone({
      schemaVersion: 1,
      action,
      stableId: `resource:${ref}`,
      artifactDigest: null,
      resource,
      dependencies,
      preconditions,
      postconditions,
      // T3 placement-live binding: resource placement derives from the same
      // audit walk as the document plans it precedes — a walk-bound run
      // refuses batches where resource plans ride their siblings' binding
      // without carrying it themselves (PLACEMENT_WALK_UNBOUND). Legacy
      // callers stay byte-compatible: the field only appears when a walk is
      // actually bound.
      ...(nonEmptyString(placementWalkDigest) ? { placementWalkDigest } : {}),
      metadata: { diffAction: action, artifactKind: 'dependent-resource' },
    }));
  }

  planAction(action, context = {}) {
    const diffAction = action?.type;
    let effectiveDiffAction = diffAction;
    let autoRoutedFromAction = null;
    let rebuildOfDigest = null;
    if (!KNOWN_ACTIONS.has(diffAction)) {
      throw new SyncPlanningError('UNKNOWN_ACTION', `Unknown SDK sync action: ${diffAction || '(missing)'}`, {
        action: diffAction || null,
      });
    }

    const stableId = stableIdFrom(action);
    if (!nonEmptyString(stableId)) {
      throw new SyncPlanningError('STABLE_ID_REQUIRED', 'A stableId is required to plan an SDK document action');
    }
    assertDocumentationOwnership(action, stableId);

    // Reviewed action-type override (grouping-bound campaigns): the entry
    // scope is the receipt-bound union scope whose scout action types can
    // disagree with the operator's reviewed intent (e.g. CDC pages the scout
    // typed UPDATE over records the ruling re-classified as CREATE — the
    // records predate the v3.0.x KB view). The reviewed reference context
    // carries the grouping-approved intent; it wins here, exactly as
    // spec.actionIntent wins in build-reviewed-release-context.
    const reviewedActionType = context.reviewedActionType;
    if (reviewedActionType !== undefined) {
      if (!KNOWN_ACTIONS.has(reviewedActionType)) {
        throw new SyncPlanningError(
          'UNKNOWN_ACTION',
          `Reviewed action type ${reviewedActionType} is not a plannable action for ${stableId}`,
          { action: reviewedActionType },
        );
      }
      if (reviewedActionType !== diffAction) {
        effectiveDiffAction = reviewedActionType;
        autoRoutedFromAction = diffAction;
      }
    }

    const source = sourceFrom(action, context);
    const target = targetFrom(context);
    const dependencies = dependenciesFrom(context);
    const targetProof = context.target || {};
    if (context.releasePlacement !== undefined) {
      const validation = validateReleasePlacement(context.releasePlacement);
      if (!validation.valid) {
        const first = validation.errors[0];
        throw new SyncPlanningError(
          first.code,
          `Invalid release placement for ${stableId}`,
          { errors: validation.errors },
        );
      }
      if (context.releasePlacement.targetVersion !== target.version
        || context.releasePlacement.actualReleaseFolderToken !== target.versionRootToken) {
        throw new SyncPlanningError(
          'RELEASE_TARGET_MISMATCH',
          `Target version root does not match the reviewed release folder for ${stableId}`,
        );
      }
    }
    if (context.organization !== undefined) {
      if (!context.organizationInventory || typeof context.organizationInventory !== 'object') {
        throw new SyncPlanningError(
          'SOURCE_ORGANIZATION_INVENTORY_REQUIRED',
          `SDK organization planning requires scanner-derived source inventory for ${stableId}`,
        );
      }
      const contractValidation = validateOrganizationContract(context.organization, {
        sourceInventory: context.organizationInventory,
      });
      if (!contractValidation.valid) {
        const first = contractValidation.errors[0];
        throw new SyncPlanningError(
          first.code,
          `Invalid scanner-bound SDK organization for ${stableId}`,
          { errors: contractValidation.errors },
        );
      }
      const validation = validateOrganizationTarget({
        contract: context.organization,
        stableId,
        target,
      });
      if (!validation.valid) {
        const first = validation.errors[0];
        throw new SyncPlanningError(
          first.code,
          `Invalid SDK organization target for ${stableId}`,
          { errors: validation.errors },
        );
      }
    }
    const hasFolderTarget = nonEmptyString(target.folderToken)
      || (nonEmptyString(target.folderRef) && dependencies.includes(target.folderRef));
    const hasParentTarget = nonEmptyString(target.parentRecordId)
      || (nonEmptyString(target.parentRecordRef) && dependencies.includes(target.parentRecordRef));
    // Root-level class/virtual-node pages (the per-category records: v2-
    // Collection, v2-Database, …) legitimately carry no parent record —
    // their container is the drive folder (same carve-out as
    // build-reviewed-release-context).
    const rootLevelClassPage = ['Class', 'VirtualNode'].includes(source.recordType)
      && !nonEmptyString(source.parentRecordId);
    if (!nonEmptyString(target.version)
      || (WRITE_ACTIONS.has(diffAction) && (
        !hasFolderTarget
        || (!hasParentTarget && !rootLevelClassPage)
        || !nonEmptyString(target.versionRootToken)
        || targetProof.ancestryVerified !== true
      ))) {
      throw new SyncPlanningError(
        'TARGET_ANCESTRY_REQUIRED',
        `Canonical target folder, version root, and verified ancestry are required for ${stableId}`,
      );
    }

    let artifactDigest = null;
    let artifactKind = null;
    let verbatimAttestation = null;
    if (WRITE_ACTIONS.has(diffAction)) {
      const reviewedArtifact = context.artifact;
      const serialized = reviewedArtifact && artifactBytes(reviewedArtifact);
      if (!reviewedArtifact || reviewedArtifact.reviewed !== true || !serialized) {
        throw new SyncPlanningError(
          'REVIEWED_ARTIFACT_REQUIRED',
          `A nonempty reviewed artifact is required for ${diffAction} ${stableId}`,
        );
      }
      if (reviewedArtifact.validated !== true && reviewedArtifact.validation?.valid !== true) {
        throw new SyncPlanningError(
          'VALIDATED_ARTIFACT_REQUIRED',
          `A validated artifact is required for ${diffAction} ${stableId}`,
        );
      }
      if (effectiveDiffAction === 'UPDATE' && reviewedArtifact.layout
        && (!context.apiPatchPlan || context.apiPatchPlan.validation?.valid !== true)) {
        throw new SyncPlanningError(
          'API_PATCH_PLAN_REQUIRED',
          `A validated API patch plan is required for UPDATE ${stableId}`,
        );
      }
      const digestBytes = diffAction === 'UPDATE' && reviewedArtifact.layout
        ? Buffer.from(`${serialized.bytes.toString('utf8')}\n${stableSerialize(context.apiPatchPlan)}`, 'utf8')
        : Buffer.from(serialized.bytes);
      artifactDigest = this.digest(digestBytes);
      if (!nonEmptyString(artifactDigest)) {
        throw new SyncPlanningError('INVALID_DIGEST', `Digest function returned an invalid digest for ${stableId}`);
      }
      artifactKind = serialized.kind;
      // Verbatim merged-PR pages attest the exact solidified content: the
      // inputDigest binds the normalized upstream markdown so an approved
      // batch covers the bytes that must land line-for-line
      // (api.pr-verbatim-content).
      if (reviewedArtifact.patchStrategy === 'rebuild' && reviewedArtifact.pr) {
        verbatimAttestation = {
          id: 'api.pr-verbatim-content',
          version: 1,
          inputDigest: verbatimContentDigest(reviewedArtifact.content),
          decision: 'PR_VERBATIM_REBUILD',
          evidenceDigest: artifactDigest,
        };
      }
    }

    const currentProof = context.current || {};
    // Campaign-control hardening batch 5 (J6): a CREATE-like action whose
    // record already exists used to either die on CREATE_RECORD_ALREADY_EXISTS
    // (stalling the whole scope's planning) or, inside a session that had
    // already executed the unit, silently plan another CREATE that would
    // double-create at write time. When the record is THIS campaign's product
    // (reviewSessionExecuted — the session's execution history proves it), the
    // plan routes to REBUILD instead: reuse the recordId, full content
    // replacement. A record the campaign did not create stays fail-closed.
    const createLikeOverExisting = CREATE_LIKE_ACTIONS.has(diffAction)
      && (nonEmptyString(currentProof.recordId)
        || nonEmptyString(currentProof.documentToken)
        || nonEmptyString(source.recordId)
        || nonEmptyString(source.documentToken));
    if (createLikeOverExisting && context.reviewSessionExecuted !== true) {
      throw new SyncPlanningError(
        'CREATE_RECORD_ALREADY_EXISTS',
        `${diffAction} ${stableId} requires the release Bitable interface record to be absent`,
        {
          recordId: currentProof.recordId || source.recordId || null,
          documentToken: currentProof.documentToken || source.documentToken || null,
        },
      );
    }
    if (createLikeOverExisting && context.reviewSessionExecuted === true) {
      effectiveDiffAction = 'REBUILD';
      autoRoutedFromAction = diffAction;
      // The auto-routed redo (changes-requested) reuses the reviewed
      // generated artifact as the whole-body replacement: a generated
      // artifact declares no strategy, so bind it to rebuild at the routing
      // that defines it. An explicitly declared surgical strategy
      // ('smart'/'replace') still refuses below — that artifact is the
      // reviewer-chosen UPDATE shape, never a redo payload.
      if (context.artifact && context.artifact.layout && context.artifact.patchStrategy === undefined) {
        context.artifact.patchStrategy = 'rebuild';
      }
    }
    if (effectiveDiffAction === 'REBUILD' && context.reviewSessionExecuted !== true) {
      // Explicit REBUILD over a record this campaign did not execute is a
      // scope question only the operator can answer — fail closed (J6).
      throw new SyncPlanningError(
        'REBUILD_SCOPE_FOREIGN',
        `REBUILD ${stableId} targets a record this campaign has not executed; rebuild is reserved for this campaign's own records (changes-requested redo or re-execution) — adjudicate the foreign record with the operator`,
        {
          recordId: currentProof.recordId || source.recordId || null,
          documentToken: currentProof.documentToken || source.documentToken || null,
        },
      );
    }
    if (effectiveDiffAction === 'REBUILD' && (
      !nonEmptyString(currentProof.recordId)
      || !nonEmptyString(currentProof.documentToken)
      || !nonEmptyString(source.recordId)
      || !nonEmptyString(source.documentToken)
    )) {
      throw new SyncPlanningError(
        'REBUILD_SOURCE_REQUIRED',
        `REBUILD ${stableId} requires the existing release record and document tokens it replaces (the campaign created them; the rebuild reuses both)`,
        { recordId: currentProof.recordId || source.recordId || null, documentToken: currentProof.documentToken || source.documentToken || null },
      );
    }
    if (effectiveDiffAction === 'REBUILD' && (
      !nonEmptyString(source.version)
      || !nonEmptyString(source.folderToken)
      || currentProof.placementVerified !== true
    )) {
      throw new SyncPlanningError(
        'REBUILD_PLACEMENT_REQUIRED',
        `REBUILD ${stableId} requires verified current document placement before planning`,
        {
          version: source.version || null,
          folderToken: source.folderToken || null,
          placementVerified: currentProof.placementVerified === true,
        },
      );
    }
    // Whole-body replacement only: a surgical artifact (layout + apiPatchPlan,
    // or an explicit non-rebuild patch strategy) is the UPDATE path — REBUILD
    // must land exact bytes. A schema-first artifact carries a layout but no
    // patch strategy and no patch plan; it is whole-body content, the same
    // shape the executor normalizes to 'rebuild' (review 2026-10-08: J6's
    // session-executed REBUILD route dead-ended here for schema-first units).
    if (effectiveDiffAction === 'REBUILD' && context.artifact
      && context.artifact.layout
      && ((context.artifact.patchStrategy != null && context.artifact.patchStrategy !== 'rebuild')
        || context.apiPatchPlan)) {
      throw new SyncPlanningError(
        'REBUILD_STRATEGY_REQUIRED',
        `REBUILD ${stableId} requires a whole-body replacement artifact (patchStrategy 'rebuild'); a surgical apiPatchPlan artifact is the UPDATE path`,
      );
    }
    // Lineage: when the session remembers the unit's previous execution
    // journal (changes-requested preserved it), bind the newest digest so the
    // rebuild receipt can cite what it replaces (lineage unbroken).
    if (effectiveDiffAction === 'REBUILD') {
      const lineage = context.reviewSessionRebuildLineage;
      if (lineage !== undefined && lineage !== null) {
        const digests = (Array.isArray(lineage) ? lineage : [lineage]).filter(nonEmptyString);
        for (const digest of digests) {
          if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
            throw new SyncPlanningError(
              'REBUILD_LINEAGE_DIGEST_INVALID',
              `REBUILD ${stableId} lineage carries a malformed execution journal digest (expected sha256:<64 hex>): ${digest.slice(0, 24)}`,
            );
          }
        }
        if (digests.length > 0) rebuildOfDigest = digests[digests.length - 1];
      }
    }
    if (CREATE_LIKE_ACTIONS.has(effectiveDiffAction)) {
      const lookup = existingRecordLookupFrom(context);
      if (lookup.checked !== true
        || lookup.absent !== true
        || !nonEmptyString(lookup.baseToken)
        || !nonEmptyString(lookup.tableId)
        || (!nonEmptyString(lookup.parentRecordId)
          && !(nonEmptyString(lookup.parentRecordRef) && dependencies.includes(lookup.parentRecordRef)))
        || !lookup.criteria) {
        throw new SyncPlanningError(
          'CREATE_LOOKUP_REQUIRED',
          `${effectiveDiffAction} ${stableId} requires explicit absent existingRecordLookup evidence`,
        );
      }
    }
    if (effectiveDiffAction === 'UPDATE' && (!nonEmptyString(currentProof.recordId) || !nonEmptyString(currentProof.documentToken))) {
      throw new SyncPlanningError(
        'UPDATE_SOURCE_REQUIRED',
        `UPDATE ${stableId} requires existing release record and document token evidence`,
        { recordId: currentProof.recordId || null, documentToken: currentProof.documentToken || null },
      );
    }
    if (effectiveDiffAction === 'UPDATE' && (
      !nonEmptyString(source.version)
      || !nonEmptyString(source.folderToken)
      || currentProof.placementVerified !== true
    )) {
      throw new SyncPlanningError(
        'UPDATE_PLACEMENT_REQUIRED',
        `UPDATE ${stableId} requires verified current document placement before planning`,
        {
          version: source.version || null,
          folderToken: source.folderToken || null,
          placementVerified: currentProof.placementVerified === true,
        },
      );
    }
    let inheritanceEvidence = null;
    // REBUILD reuses the record and document (no repoint), but the executor's
    // pre-write shared-token revalidation still requires the evidence, and a
    // shared token under REBUILD needs the same classified shape as an
    // in-place patch — whole-body replacement affects every referencing track.
    if (effectiveDiffAction === 'UPDATE' || effectiveDiffAction === 'REBUILD') {
      const validation = validateInheritanceEvidence(context.inheritanceEvidence, {
        stableId,
        current: {
          recordId: source.recordId,
          documentToken: source.documentToken,
          version: source.version,
          folderToken: source.folderToken,
        },
        target,
      });
      if (!validation.valid) {
        const first = validation.errors[0];
        throw new SyncPlanningError(
          first.code === 'SHARED_TOKEN_EVIDENCE_UNKNOWN' ? 'SHARED_TOKEN_EVIDENCE_REQUIRED' : first.code,
          `${effectiveDiffAction} ${stableId} requires verified inheritance evidence before planning`,
          { errors: validation.errors },
        );
      }
      inheritanceEvidence = context.inheritanceEvidence;
    }
    const shared = inheritanceEvidence ? evidenceShared(inheritanceEvidence) : false;
    // Phase 2: the versioned-tree policy kernel is the single decision
    // authority for delta transitions. Every document write plan carries its
    // attestation (bound into the plan digest); a blocked decision never
    // produces a plan.
    let invariantAttestations = null;
    let treeDecision = null;
    // REBUILD rides the UPDATE evaluation: the record, document, and placement
    // are unchanged, so a shared token needs the same classified shape a
    // shared in-place patch needs — whole-body replacement affects every
    // referencing track just the same.
    if (effectiveDiffAction === 'UPDATE' || effectiveDiffAction === 'REBUILD') {
      const treeDelta = evaluateVersionedTreeDelta({
        operation: 'UPDATE',
        stableId,
        sourceDiff: 'changed',
        inheritanceEvidence,
        current: {
          version: source.version,
          recordId: source.recordId,
          documentToken: source.documentToken,
          folderToken: source.folderToken,
          ancestryVerified: currentProof.ancestryVerified === true,
        },
        target,
        category: context.treeDelta?.category ?? null,
        // Kernel v4: classification evidence for a shared cross-track in-place
        // patch (one entry per other referencing record, joined from the
        // inheritance review). The kernel fails closed when the decision is a
        // shared patch and these are missing or incompatible.
        sharedUpdateReviews: context.sharedUpdateReviews ?? null,
      });
      if (treeDelta.status === 'blocked') {
        throw new SyncPlanningError(
          treeDelta.blocker,
          `Versioned-tree delta policy blocked ${stableId}: ${treeDelta.detail}`,
          { detail: treeDelta.detail },
        );
      }
      if (treeDelta.decision === DECISIONS.COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE
        && context.treeDelta.category.folder.ref !== target.folderRef) {
        throw new SyncPlanningError(
          'TREE_DELTA_CATEGORY_MISMATCH',
          `Category resource spec targets ${context.treeDelta.category.folder.ref} but the document plan depends on ${target.folderRef} for ${stableId}`,
        );
      }
      invariantAttestations = [treeDelta.attestation];
      treeDecision = treeDelta.decision;
    } else if (CREATE_LIKE_ACTIONS.has(effectiveDiffAction)) {
      const treeDelta = evaluateVersionedTreeDelta({
        operation: effectiveDiffAction,
        stableId,
        existingRecordLookup: context.existingRecordLookup,
        target,
      });
      if (treeDelta.status === 'blocked') {
        throw new SyncPlanningError(
          treeDelta.blocker,
          `Versioned-tree delta policy blocked ${stableId}: ${treeDelta.detail}`,
          { detail: treeDelta.detail },
        );
      }
      invariantAttestations = [treeDelta.attestation];
    }
    if (verbatimAttestation) {
      invariantAttestations = [verbatimAttestation, ...(invariantAttestations || [])];
    }
    const preconditions = [];
    if (artifactDigest) preconditions.push({ type: 'ARTIFACT_DIGEST', expected: artifactDigest });
    preconditions.push({
      type: 'CURRENT_RECORD',
      expected: CREATE_LIKE_ACTIONS.has(effectiveDiffAction) ? 'ABSENT' : source.recordId,
    });
    preconditions.push({ type: 'CURRENT_DOCUMENT_TOKEN', expected: source.documentToken });
    const targetAncestry = {
      type: 'TARGET_ANCESTRY',
      expectedFolderToken: target.folderToken,
      expectedVersionRootToken: target.versionRootToken,
      verified: true,
    };
    if (nonEmptyString(target.folderRef)) targetAncestry.expectedFolderRef = target.folderRef;
    preconditions.push(targetAncestry);
    preconditions.push({
      type: 'SHARED_TOKEN',
      referencedByOlderVersions: shared,
      evidenceDigest: inheritanceEvidence?.evidenceDigest || null,
    });

    let plannedAction;
    let postconditions;
    const metadata = {
      reason: action.reason || null,
      diffAction: effectiveDiffAction,
      artifactKind,
    };
    if (autoRoutedFromAction) metadata.autoRoutedFrom = autoRoutedFromAction;
    if (rebuildOfDigest) metadata.rebuildOf = rebuildOfDigest;

    switch (effectiveDiffAction) {
      case 'REBUILD':
        // The kernel must have decided the verified in-place shape — a
        // copy-patch decision means the record/document/placement story does
        // not hold and REBUILD's reuse contract would be a lie.
        if (treeDecision && treeDecision !== DECISIONS.UPDATE_IN_PLACE_VERIFIED) {
          throw new SyncPlanningError(
            'REBUILD_TREE_DELTA_INVALID',
            `REBUILD ${stableId} requires the verified in-place shape (same record, document, placement); the tree-delta kernel decided ${treeDecision} — plan UPDATE instead or adjudicate the placement change first`,
          );
        }
        plannedAction = 'REBUILD';
        postconditions = this._writePostconditions(target, source, plannedAction);
        break;
      case 'CREATE':
      case 'BACKFILL':
        plannedAction = 'CREATE';
        postconditions = this._writePostconditions(target, source, plannedAction);
        break;
      case 'UPDATE': {
        const safeInPlace = treeDecision === DECISIONS.UPDATE_IN_PLACE_VERIFIED;
        let copySource = null;
        if (!safeInPlace) {
          copySource = copySourceFrom(context);
          if (!nonEmptyString(copySource.documentToken) || !nonEmptyString(copySource.link)) {
            throw new SyncPlanningError(
              'COPY_SOURCE_REQUIRED',
              `Unsafe UPDATE ${stableId} requires copySource document evidence before patching inherited docs`,
            );
          }
          // Kernel v5: a copy without the source's live placement evidence
          // cannot be mirror-checked (V1 flat-copy failure mode).
          if (!copySource.placement) {
            throw new SyncPlanningError(
              'COPY_SOURCE_PLACEMENT_REQUIRED',
              `Unsafe UPDATE ${stableId} requires copySource.placement (versionRootToken + folderToken from the live placement audit) for the copy-structure mirror gate`,
            );
          }
        }
        plannedAction = safeInPlace ? 'UPDATE_IN_PLACE' : 'COPY_PATCH_AND_REPOINT';
        postconditions = this._writePostconditions(target, source, plannedAction);
        if (source.version && source.version !== target.version) {
          postconditions.push({
            type: 'OLDER_SOURCE_UNCHANGED',
            version: source.version,
            documentToken: source.documentToken,
          });
        }
        metadata.copyBeforePatch = !safeInPlace;
        metadata.copySourceTitle = copySource?.title || null;
        break;
      }
      case 'DEPRECATE':
        plannedAction = 'DEPRECATE';
        postconditions = [{ type: 'TARGET_METADATA', version: target.version, state: 'DEPRECATED' }];
        break;
      case 'ORPHAN':
        plannedAction = 'ORPHAN';
        metadata.destructive = false;
        postconditions = [{ type: 'NO_MUTATION' }];
        break;
      case 'SKIP':
        if (context.organization && (
          source.parentRecordId !== target.parentRecordId
          || source.recordType !== organizationRecordType(context.organization, stableId)
          || source.docsResourceType !== 'docx'
        )) {
          if (!nonEmptyString(source.recordId) || !nonEmptyString(source.documentToken)) {
            throw new SyncPlanningError(
              'METADATA_SOURCE_REQUIRED',
              `Record-only organization repair requires an existing record and document token for ${stableId}`,
            );
          }
          plannedAction = 'UPDATE_RECORD_METADATA';
          postconditions = [
            { type: 'TARGET_LINK', recordId: source.recordId, documentToken: source.documentToken },
            { type: 'TARGET_PARENT', parentRecordId: target.parentRecordId },
          ];
          metadata.organizationOnly = true;
          metadata.preserveDocumentToken = true;
        } else {
          plannedAction = 'NOOP';
          postconditions = [{ type: 'NO_MUTATION' }];
        }
        break;
      default:
        throw new SyncPlanningError('UNKNOWN_ACTION', `Unknown SDK sync action: ${diffAction}`);
    }
    if (context.organization && (WRITE_ACTIONS.has(diffAction) || plannedAction === 'UPDATE_RECORD_METADATA')) {
      postconditions.push({
        type: 'TARGET_RECORD_TYPE',
        expected: organizationRecordType(context.organization, stableId),
        docsResourceType: 'docx',
      });
    }
    if (invariantAttestations) {
      metadata.invariantDecision = invariantAttestations[0].decision;
      if (invariantAttestations[0].decision === DECISIONS.COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE) {
        metadata.categoryCreate = true;
        metadata.requiredResourceDag = deepClone(invariantAttestations[0].requiredResourceDag);
      }
    }

    return deepFreeze(deepClone({
      schemaVersion: 1,
      action: plannedAction,
      stableId,
      artifactDigest,
      layout: context.artifact?.layout,
      organization: context.organization,
      organizationInventory: context.organizationInventory,
      releasePlacement: context.releasePlacement,
      inheritanceEvidence: inheritanceEvidence ? deepClone(inheritanceEvidence) : undefined,
      // Kernel v4: the classification evidence a shared in-place patch was
      // allowed on. The executor revalidates coverage against the live
      // reference multiset immediately before the write.
      sharedUpdateReviews: (plannedAction === 'UPDATE_IN_PLACE' || plannedAction === 'REBUILD') && inheritanceEvidence?.sharedToken?.status === 'shared'
        ? deepClone(context.sharedUpdateReviews)
        : undefined,
      invariantAttestations: invariantAttestations ? deepClone(invariantAttestations) : undefined,
      // T3 placement-live binding (batch 2c): the placement audit walk this
      // plan's placement decisions derive from — executions must name the
      // same digest (PLACEMENT_SOURCE_STALE otherwise). Legacy contexts
      // without a bound walk carry null.
      placementWalkDigest: context.placementWalk?.digest || null,
      apiPatchPlan: context.artifact?.layout && diffAction === 'UPDATE'
        ? context.apiPatchPlan
        : undefined,
      source,
      existingRecordLookup: plannedAction === 'CREATE' ? existingRecordLookupFrom(context) : undefined,
      copySource: plannedAction === 'COPY_PATCH_AND_REPOINT' ? copySourceFrom(context) : undefined,
      target,
      dependencies,
      preconditions,
      postconditions,
      metadata,
    }));
  }

  _writePostconditions(target, source, action) {
    const documentToken = (action === 'UPDATE_IN_PLACE' || action === 'REBUILD')
      ? source.documentToken
      : 'NEW_DOCUMENT_TOKEN';
    const targetDocument = { type: 'TARGET_DOCUMENT', folderToken: target.folderToken, documentToken };
    if (nonEmptyString(target.folderRef)) targetDocument.folderRef = target.folderRef;
    const targetParent = { type: 'TARGET_PARENT', parentRecordId: target.parentRecordId };
    if (nonEmptyString(target.parentRecordRef)) targetParent.parentRecordRef = target.parentRecordRef;
    const postconditions = [
      targetDocument,
      { type: 'TARGET_LINK', recordId: source.recordId || 'NEW_RECORD_ID', documentToken },
      targetParent,
      { type: 'TARGET_VERSION', version: target.version },
    ];
    // Record-type normalization (e.g. legacy lowercase "method" -> "Function")
    // rides the same write so the verifier can assert it post-execution. The
    // verifier pairs TARGET_RECORD_TYPE with a docsResourceType assertion, so
    // both fields must be present together.
    if (nonEmptyString(target.recordType)) {
      postconditions.push({
        type: 'TARGET_RECORD_TYPE',
        expected: target.recordType,
        docsResourceType: target.docsResourceType ?? 'docx',
      });
    }
    return postconditions;
  }
}

// py-v30 wall rule (rule-candidate:api-reference-sync:dryrun-live-folder-chain,
// harnessed 2026-10-08): a scope target chain transcribed at intake goes stale
// the moment live tree surgery creates, moves, or mirror-builds a folder —
// dry-run passed with zero errors while the write gate blew
// (PLACEMENT_TARGET_UNRESOLVED), and every occurrence cost a full re-approval
// cycle. When the run binds a placement walk PRODUCT (--placement-walk, the
// audit artifact carrying folderChains), reconcile every write plan's target
// chain against the walk's recorded live chain at PLAN time, so the stale
// chain fails planning instead of the write boundary. Document plans carry
// target.folderToken/folderAncestry; resource plans carry
// parentFolderToken/parentAncestry — same reconciliation, same shape (token
// arrays byte-compared, exactly like the executor's live re-derivation).
function reconcilePlanTargetChain(plan, placementWalkProduct) {
  if (!placementWalkProduct || !plan) return;
  const leafToken = plan.target?.folderToken ?? plan.parentFolderToken ?? null;
  const chain = plan.target?.folderAncestry ?? plan.parentAncestry ?? null;
  if (!nonEmptyString(leafToken) || !Array.isArray(chain) || chain.length === 0) return;
  const walkedChain = placementWalkProduct.folderChains?.[leafToken];
  if (!Array.isArray(walkedChain)) {
    throw new SyncPlanningError(
      'PLACEMENT_TARGET_CHAIN_STALE',
      `target folder ${leafToken} is absent from the bound placement walk product — the walk predates the folder `
      + `(re-run the placement audit and replan ${plan.stableId || '(unstableIded plan)'})`,
    );
  }
  if (JSON.stringify(walkedChain) !== JSON.stringify(chain)) {
    throw new SyncPlanningError(
      'PLACEMENT_TARGET_CHAIN_STALE',
      `scope target chain for ${plan.stableId || leafToken} disagrees with the bound walk product's live chain `
      + `— refresh the scope target (folderAncestry) from a fresh walk and replan`,
    );
  }
}

SyncPlanner.SyncPlanningError = SyncPlanningError;
SyncPlanner.stableSerialize = stableSerialize;
SyncPlanner.reconcilePlanTargetChain = reconcilePlanTargetChain;

module.exports = SyncPlanner;
