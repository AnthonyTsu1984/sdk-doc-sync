'use strict';

const { assertPublishableContent } = require('./feishu-block-safety');
const { canonicalStringify } = require('../../../doc-ops-core/src/canonical-json');
const { sha256Digest } = require('../../../doc-ops-core/src/digest');

const WRITE_ACTIONS = new Set(['CREATE', 'UPDATE']);
const KNOWN_ACTIONS = new Set(['CREATE', 'UPDATE', 'DEPRECATE', 'ORPHAN', 'SKIP']);

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
  };
}

function targetFrom(context) {
  const target = context.target || {};
  const result = {
    version: target.version ?? context.targetVersion ?? null,
    parentRecordId: target.parentRecordId ?? null,
    folderToken: target.folderToken ?? null,
    versionRootToken: target.versionRootToken ?? null,
  };
  if (target.parentRecordRef !== undefined) result.parentRecordRef = target.parentRecordRef ?? null;
  if (target.folderRef !== undefined) result.folderRef = target.folderRef ?? null;
  return result;
}

function copySourceFrom(context) {
  const copySource = context.copySource || {};
  return {
    documentToken: copySource.documentToken ?? null,
    link: copySource.link ?? null,
    title: copySource.title ?? null,
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

  planResource(resource) {
    if (!resource || typeof resource !== 'object') {
      throw new SyncPlanningError('RESOURCE_REQUIRED', 'A resource definition is required');
    }
    const ref = resource.ref;
    if (!nonEmptyString(ref)) {
      throw new SyncPlanningError('RESOURCE_REF_REQUIRED', 'A stable resource ref is required');
    }
    const lookup = resource.existingLookup || {};
    if (lookup.checked !== true || lookup.absent !== true) {
      throw new SyncPlanningError('RESOURCE_LOOKUP_REQUIRED', `Resource ${ref} requires checked-and-absent lookup evidence`);
    }
    const dependencies = [...new Set((resource.dependsOn || []).filter(nonEmptyString))];
    let action;
    let postconditions;
    if (resource.kind === 'folder') {
      if (!nonEmptyString(resource.name)
        || !nonEmptyString(resource.parentFolderToken)
        || !nonEmptyString(resource.versionRootToken)
        || lookup.parentFolderToken !== resource.parentFolderToken
        || lookup.name !== resource.name) {
        throw new SyncPlanningError('FOLDER_RESOURCE_INVALID', `Folder resource ${ref} requires canonical parent, root, name, and absent lookup evidence`);
      }
      action = 'CREATE_FOLDER';
      postconditions = [
        { type: 'RESOURCE_RESOLVED', ref, value: 'NEW_FOLDER_TOKEN' },
        { type: 'TARGET_ANCESTRY', folderRef: ref, versionRootToken: resource.versionRootToken },
      ];
      if (resource.repointVirtualNode?.recordId) {
        postconditions.push({
          type: 'VIRTUAL_NODE_LINK',
          recordId: resource.repointVirtualNode.recordId,
          folderRef: ref,
        });
      }
    } else if (resource.kind === 'virtual_node') {
      if (!nonEmptyString(resource.title)
        || !nonEmptyString(resource.folderRef)
        || !nonEmptyString(resource.baseToken)
        || !nonEmptyString(resource.tableId)
        || !nonEmptyString(resource.version)
        || !dependencies.includes(resource.folderRef)
        || !nonEmptyString(lookup.baseToken)
        || !nonEmptyString(lookup.tableId)
        || !lookup.criteria) {
        throw new SyncPlanningError('VIRTUAL_NODE_RESOURCE_INVALID', `VirtualNode resource ${ref} requires its folder dependency and absent Bitable lookup evidence`);
      }
      action = 'CREATE_VIRTUAL_NODE';
      postconditions = [
        { type: 'RESOURCE_RESOLVED', ref, value: 'NEW_RECORD_ID' },
        { type: 'VIRTUAL_NODE_LINK', recordId: 'NEW_RECORD_ID', folderRef: resource.folderRef },
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
      preconditions: [{ type: 'RESOURCE_ABSENT', ref, lookup: deepClone(lookup) }],
      postconditions,
      metadata: { diffAction: action, artifactKind: 'dependent-resource' },
    }));
  }

  planAction(action, context = {}) {
    const diffAction = action?.type;
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

    const source = sourceFrom(action, context);
    const target = targetFrom(context);
    const dependencies = dependenciesFrom(context);
    const targetProof = context.target || {};
    const hasFolderTarget = nonEmptyString(target.folderToken)
      || (nonEmptyString(target.folderRef) && dependencies.includes(target.folderRef));
    const hasParentTarget = nonEmptyString(target.parentRecordId)
      || (nonEmptyString(target.parentRecordRef) && dependencies.includes(target.parentRecordRef));
    if (!nonEmptyString(target.version)
      || (WRITE_ACTIONS.has(diffAction) && (
        !hasFolderTarget
        || !hasParentTarget
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
      if (diffAction === 'UPDATE' && reviewedArtifact.layout
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
    }

    const shared = context.tokenReferencedByOlderVersions === true;
    const currentProof = context.current || {};
    if (diffAction === 'CREATE' && (
      nonEmptyString(currentProof.recordId)
      || nonEmptyString(currentProof.documentToken)
      || nonEmptyString(source.recordId)
      || nonEmptyString(source.documentToken)
    )) {
      throw new SyncPlanningError(
        'CREATE_RECORD_ALREADY_EXISTS',
        `CREATE ${stableId} requires the release Bitable interface record to be absent`,
        {
          recordId: currentProof.recordId || source.recordId || null,
          documentToken: currentProof.documentToken || source.documentToken || null,
        },
      );
    }
    if (diffAction === 'CREATE') {
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
          `CREATE ${stableId} requires explicit absent existingRecordLookup evidence`,
        );
      }
    }
    if (diffAction === 'UPDATE' && (!nonEmptyString(currentProof.recordId) || !nonEmptyString(currentProof.documentToken))) {
      throw new SyncPlanningError(
        'UPDATE_SOURCE_REQUIRED',
        `UPDATE ${stableId} requires existing release record and document token evidence`,
        { recordId: currentProof.recordId || null, documentToken: currentProof.documentToken || null },
      );
    }
    if (diffAction === 'UPDATE' && (
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
    const preconditions = [];
    if (artifactDigest) preconditions.push({ type: 'ARTIFACT_DIGEST', expected: artifactDigest });
    preconditions.push({
      type: 'CURRENT_RECORD',
      expected: diffAction === 'CREATE' ? 'ABSENT' : source.recordId,
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
    preconditions.push({ type: 'SHARED_TOKEN', referencedByOlderVersions: shared });

    let plannedAction;
    let postconditions;
    const metadata = {
      reason: action.reason || null,
      diffAction,
      artifactKind,
    };

    switch (diffAction) {
      case 'CREATE':
        plannedAction = 'CREATE';
        postconditions = this._writePostconditions(target, source, plannedAction);
        break;
      case 'UPDATE': {
        const safeInPlace = source.version === target.version
          && nonEmptyString(source.documentToken)
          && source.folderToken === target.folderToken
          && currentProof.ancestryVerified === true
          && currentProof.placementVerified === true
          && !shared;
        let copySource = null;
        if (!safeInPlace) {
          copySource = copySourceFrom(context);
          if (!nonEmptyString(copySource.documentToken) || !nonEmptyString(copySource.link)) {
            throw new SyncPlanningError(
              'COPY_SOURCE_REQUIRED',
              `Unsafe UPDATE ${stableId} requires copySource document evidence before patching inherited docs`,
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
        plannedAction = 'NOOP';
        postconditions = [{ type: 'NO_MUTATION' }];
        break;
      default:
        throw new SyncPlanningError('UNKNOWN_ACTION', `Unknown SDK sync action: ${diffAction}`);
    }

    return deepFreeze(deepClone({
      schemaVersion: 1,
      action: plannedAction,
      stableId,
      artifactDigest,
      layout: context.artifact?.layout,
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
    const documentToken = action === 'UPDATE_IN_PLACE'
      ? source.documentToken
      : 'NEW_DOCUMENT_TOKEN';
    const targetDocument = { type: 'TARGET_DOCUMENT', folderToken: target.folderToken, documentToken };
    if (nonEmptyString(target.folderRef)) targetDocument.folderRef = target.folderRef;
    const targetParent = { type: 'TARGET_PARENT', parentRecordId: target.parentRecordId };
    if (nonEmptyString(target.parentRecordRef)) targetParent.parentRecordRef = target.parentRecordRef;
    return [
      targetDocument,
      { type: 'TARGET_LINK', recordId: source.recordId || 'NEW_RECORD_ID', documentToken },
      targetParent,
      { type: 'TARGET_VERSION', version: target.version },
    ];
  }
}

SyncPlanner.SyncPlanningError = SyncPlanningError;
SyncPlanner.stableSerialize = stableSerialize;

module.exports = SyncPlanner;
