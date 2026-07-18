'use strict';

function postcondition(plan, type) {
  return (plan.postconditions || []).find((entry) => entry.type === type) || null;
}

function documentTokenFor(plan, execution) {
  if (execution?.createdDocument) {
    return execution.createdDocument.token
      || execution.createdDocument.documentToken
      || execution.createdDocument.document_id
      || execution.createdDocument.obj_token
      || null;
  }
  if (execution?.patchedDocument) {
    return execution.patchedDocument.token
      || execution.patchedDocument.documentToken
      || execution.patchedDocument.document_id
      || plan.source.documentToken;
  }
  return plan.source.documentToken;
}

class SyncVerifier {
  constructor({ readDocument = null, readRecord = null } = {}) {
    this.readDocument = readDocument;
    this.readRecord = readRecord;
  }

  async verify(plan, execution = {}) {
    const errors = [];
    const targetDocument = postcondition(plan, 'TARGET_DOCUMENT');
    const targetLink = postcondition(plan, 'TARGET_LINK');
    const targetParent = postcondition(plan, 'TARGET_PARENT');
    const targetVersion = postcondition(plan, 'TARGET_VERSION');
    const olderSource = postcondition(plan, 'OLDER_SOURCE_UNCHANGED');

    const token = documentTokenFor(plan, execution);
    let document = null;
    if (targetDocument && this.readDocument) {
      document = await this.readDocument(token);
      if (!document || document.folderToken !== targetDocument.folderToken) {
        errors.push({
          code: 'TARGET_DOCUMENT_LOCATION',
          expected: targetDocument.folderToken,
          actual: document?.folderToken ?? null,
        });
      }
      if (plan.artifactDigest && document?.digest && document.digest !== plan.artifactDigest) {
        errors.push({
          code: 'ARTIFACT_DIGEST',
          expected: plan.artifactDigest,
          actual: document.digest,
        });
      }
    }

    let record = null;
    if ((targetLink || targetParent || targetVersion) && this.readRecord) {
      record = await this.readRecord(targetLink?.recordId || plan.source.recordId);
      if (targetLink && record?.documentToken !== token) {
        errors.push({ code: 'TARGET_LINK', expected: token, actual: record?.documentToken ?? null });
      }
      if (targetParent && record?.parentRecordId !== targetParent.parentRecordId) {
        errors.push({ code: 'TARGET_PARENT', expected: targetParent.parentRecordId, actual: record?.parentRecordId ?? null });
      }
      if (targetVersion && record?.version !== targetVersion.version) {
        errors.push({ code: 'TARGET_VERSION', expected: targetVersion.version, actual: record?.version ?? null });
      }
    }

    if (olderSource && this.readDocument) {
      const source = await this.readDocument(olderSource.documentToken);
      if (!source || source.token !== olderSource.documentToken) {
        errors.push({ code: 'OLDER_SOURCE_UNCHANGED', expected: olderSource.documentToken, actual: source?.token ?? null });
      }
    }

    return Object.freeze({
      ok: errors.length === 0,
      errors: Object.freeze(errors),
      document,
      record,
    });
  }
}

module.exports = SyncVerifier;
