'use strict';

const crypto = require('node:crypto');

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

function stableSerialize(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (seen.has(value)) throw new SyncPlanningError('INVALID_ARTIFACT', 'Document IR must not be circular');
  seen.add(value);
  let serialized;
  if (Array.isArray(value)) {
    serialized = `[${value.map((entry) => stableSerialize(entry, seen)).join(',')}]`;
  } else {
    const entries = Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key], seen)}`);
    serialized = `{${entries.join(',')}}`;
  }
  seen.delete(value);
  return serialized;
}

function defaultDigest(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function artifactBytes(artifact) {
  if (nonEmptyString(artifact.content) && artifact.content.trim().length > 0) {
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
  return {
    version: target.version ?? context.targetVersion ?? null,
    parentRecordId: target.parentRecordId ?? null,
    folderToken: target.folderToken ?? null,
    versionRootToken: target.versionRootToken ?? null,
  };
}

function stableIdFrom(action) {
  return action.stableId
    || action.symbol?.identity?.stableId
    || action.symbol?.stableId
    || action.slug
    || null;
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

    const source = sourceFrom(action, context);
    const target = targetFrom(context);
    const targetProof = context.target || {};
    if (!nonEmptyString(target.version)
      || (WRITE_ACTIONS.has(diffAction) && (
        !nonEmptyString(target.folderToken)
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
      artifactDigest = this.digest(Buffer.from(serialized.bytes));
      if (!nonEmptyString(artifactDigest)) {
        throw new SyncPlanningError('INVALID_DIGEST', `Digest function returned an invalid digest for ${stableId}`);
      }
      artifactKind = serialized.kind;
    }

    const shared = context.tokenReferencedByOlderVersions === true;
    const currentProof = context.current || {};
    const preconditions = [];
    if (artifactDigest) preconditions.push({ type: 'ARTIFACT_DIGEST', expected: artifactDigest });
    preconditions.push({
      type: 'CURRENT_RECORD',
      expected: diffAction === 'CREATE' ? 'ABSENT' : source.recordId,
    });
    preconditions.push({ type: 'CURRENT_DOCUMENT_TOKEN', expected: source.documentToken });
    preconditions.push({
      type: 'TARGET_ANCESTRY',
      expectedFolderToken: target.folderToken,
      expectedVersionRootToken: target.versionRootToken,
      verified: true,
    });
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
          && !shared;
        plannedAction = safeInPlace ? 'UPDATE_IN_PLACE' : 'CREATE_AND_REPOINT';
        postconditions = this._writePostconditions(target, source, plannedAction);
        if (source.version && source.version !== target.version) {
          postconditions.push({
            type: 'OLDER_SOURCE_UNCHANGED',
            version: source.version,
            documentToken: source.documentToken,
          });
        }
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
      source,
      target,
      preconditions,
      postconditions,
      metadata,
    }));
  }

  _writePostconditions(target, source, action) {
    const documentToken = action === 'UPDATE_IN_PLACE'
      ? source.documentToken
      : 'NEW_DOCUMENT_TOKEN';
    return [
      { type: 'TARGET_DOCUMENT', folderToken: target.folderToken, documentToken },
      { type: 'TARGET_LINK', recordId: source.recordId || 'NEW_RECORD_ID', documentToken },
      { type: 'TARGET_PARENT', parentRecordId: target.parentRecordId },
      { type: 'TARGET_VERSION', version: target.version },
    ];
  }
}

SyncPlanner.SyncPlanningError = SyncPlanningError;
SyncPlanner.stableSerialize = stableSerialize;

module.exports = SyncPlanner;
