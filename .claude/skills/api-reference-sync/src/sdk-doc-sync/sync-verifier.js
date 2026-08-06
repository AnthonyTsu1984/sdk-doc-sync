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

function normalizedState(record) {
  const value = record?.state ?? record?.progress ?? (record?.deprecateSince ? 'DEPRECATED' : null);
  return typeof value === 'string' ? value.toUpperCase() : value;
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
    const targetMetadata = postcondition(plan, 'TARGET_METADATA');
    const targetRecordType = postcondition(plan, 'TARGET_RECORD_TYPE');
    const olderSource = postcondition(plan, 'OLDER_SOURCE_UNCHANGED');

    const token = documentTokenFor(plan, execution);
    let document = null;
    if (targetDocument && !this.readDocument) {
      errors.push({ code: 'DOCUMENT_READER_REQUIRED' });
    } else if (targetDocument) {
      document = await this.readDocument(token, {
        plan,
        expectedFolderToken: targetDocument.folderToken,
        purpose: 'target',
      });
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
    const needsRecord = targetLink || targetParent || targetVersion || targetMetadata || targetRecordType;
    if (needsRecord && !this.readRecord) {
      errors.push({ code: 'RECORD_READER_REQUIRED' });
    } else if (needsRecord) {
      record = await this.readRecord(targetLink?.recordId || plan.source.recordId, { plan });
      if (targetLink && record?.documentToken !== token) {
        errors.push({ code: 'TARGET_LINK', expected: token, actual: record?.documentToken ?? null });
      }
      if (targetParent && record?.parentRecordId !== targetParent.parentRecordId) {
        errors.push({ code: 'TARGET_PARENT', expected: targetParent.parentRecordId, actual: record?.parentRecordId ?? null });
      }
      if (targetVersion && record?.version !== targetVersion.version) {
        errors.push({ code: 'TARGET_VERSION', expected: targetVersion.version, actual: record?.version ?? null });
      }
      if (targetMetadata) {
        if (targetMetadata.version && record?.version !== targetMetadata.version) {
          errors.push({ code: 'TARGET_METADATA_VERSION', expected: targetMetadata.version, actual: record?.version ?? null });
        }
        if (targetMetadata.state && normalizedState(record) !== targetMetadata.state) {
          errors.push({ code: 'TARGET_METADATA_STATE', expected: targetMetadata.state, actual: normalizedState(record) });
        }
      }
      if (targetRecordType) {
        const actualType = record?.type ?? record?.metadata?.type ?? null;
        const actualResourceType = record?.docsResourceType
          ?? record?.resourceType
          ?? record?.metadata?.docsResourceType
          ?? record?.metadata?.resourceType
          ?? null;
        if (actualType !== targetRecordType.expected) {
          errors.push({ code: 'TARGET_RECORD_TYPE', expected: targetRecordType.expected, actual: actualType });
        }
        if (actualResourceType !== targetRecordType.docsResourceType) {
          errors.push({
            code: 'TARGET_DOCS_RESOURCE_TYPE',
            expected: targetRecordType.docsResourceType,
            actual: actualResourceType,
          });
        }
      }
    }

    if (olderSource && !this.readDocument) {
      if (!errors.some((error) => error.code === 'DOCUMENT_READER_REQUIRED')) {
        errors.push({ code: 'DOCUMENT_READER_REQUIRED' });
      }
    } else if (olderSource) {
      const source = await this.readDocument(olderSource.documentToken, {
        plan,
        purpose: 'older-source',
      });
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
