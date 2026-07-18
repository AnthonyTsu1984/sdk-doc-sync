'use strict';

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function planPostcondition(plan, type) {
  return (plan.postconditions || []).find((entry) => entry.type === type) || null;
}

function artifactTitle(plan, artifact, action = null) {
  return artifact?.title
    || action?.symbol?.identity?.title
    || action?.symbol?.title
    || action?.symbol?.name
    || plan.stableId;
}

function artifactMetadata(artifact) {
  return artifact?.metadata || {};
}

function containsLegacyScaffold(content) {
  return typeof content === 'string'
    && (/<!--\s*TODO:/i.test(content)
      || /\b(?:Brief description|Usage example|List relevant exceptions)\b/i.test(content));
}

function assertPublishableArtifact(plan, artifact) {
  if (!artifact || !nonEmptyString(artifact.content)) {
    throw new SyncExecutionError('ARTIFACT_CONTENT_REQUIRED', `Reviewed artifact content is required for ${plan.stableId}`);
  }
  if (containsLegacyScaffold(artifact.content)) {
    throw new SyncExecutionError(
      'LEGACY_SCAFFOLD_ARTIFACT',
      `Legacy scaffold content cannot be published for ${plan.stableId}; provide a reviewed schema-first artifact`,
    );
  }
}

function linkFromCreated(created) {
  return created?.url || created?.wiki_url || created?.link || created?.documentUrl || '';
}

function tokenFromCreated(created) {
  return created?.token || created?.documentToken || created?.document_id || created?.obj_token || null;
}

class SyncExecutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SyncExecutionError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

class SyncExecutor {
  constructor({ documentWriter, bitableWriter, verifier = null } = {}) {
    if (!documentWriter) throw new TypeError('documentWriter is required');
    if (!bitableWriter) throw new TypeError('bitableWriter is required');
    this.documentWriter = documentWriter;
    this.bitableWriter = bitableWriter;
    this.verifier = verifier;
  }

  async execute(plan, { artifact = null, approval = null, action = null } = {}) {
    this._assertApprovedPlan(plan, approval);
    const completedSteps = [];
    const result = {
      status: 'success',
      plan,
      completedSteps,
      createdDocument: null,
      patchedDocument: null,
      record: null,
      verification: null,
      originalRecord: plan.source?.recordId ? { ...plan.source } : null,
    };

    try {
      switch (plan.action) {
        case 'CREATE':
          await this._executeCreate(plan, artifact, action, result);
          break;
        case 'UPDATE_IN_PLACE':
          await this._executeUpdateInPlace(plan, artifact, action, result);
          break;
        case 'CREATE_AND_REPOINT':
          await this._executeCreateAndRepoint(plan, artifact, action, result);
          break;
        case 'DEPRECATE':
          await this._executeDeprecate(plan, result);
          break;
        case 'ORPHAN':
        case 'NOOP':
          completedSteps.push('noMutation');
          break;
        default:
          throw new SyncExecutionError('UNKNOWN_PLAN_ACTION', `Unknown plan action: ${plan.action}`);
      }

      if (this.verifier) {
        result.verification = await this.verifier.verify(plan, result);
        completedSteps.push('verify');
        if (!result.verification.ok) {
          throw new SyncExecutionError('VERIFICATION_FAILED', 'Plan verification failed', {
            errors: result.verification.errors,
          });
        }
      }
      return result;
    } catch (error) {
      return {
        ...result,
        status: 'error',
        failedStep: error.step || this._inferFailedStep(plan, completedSteps),
        error,
        suggestedRecovery: this._recovery(plan, result, error),
      };
    }
  }

  _assertApprovedPlan(plan, approval) {
    if (!plan || plan.schemaVersion !== 1 || Object.isFrozen(plan) !== true || approval?.approved !== true) {
      throw new SyncExecutionError(
        'APPROVED_PLAN_REQUIRED',
        'An approved immutable plan is required before SDK document execution',
      );
    }
  }

  async _executeCreate(plan, artifact, action, result) {
    const created = await this._createDocument(plan, artifact, action);
    result.createdDocument = created;
    result.completedSteps.push('createDocument');

    let record;
    try {
      record = await this._createRecord(plan, artifact, action, created);
    } catch (error) {
      error.step = 'createRecord';
      throw error;
    }
    result.record = record;
    result.completedSteps.push('createRecord');
  }

  async _executeUpdateInPlace(plan, artifact, action, result) {
    const patched = await this._patchDocument(plan, artifact);
    result.patchedDocument = patched;
    result.completedSteps.push('patchDocument');

    const metadata = artifactMetadata(artifact);
    result.record = await this.bitableWriter.updateRecord(plan.source.recordId, {
      description: metadata.description,
      lastModified: plan.target.version,
      progress: metadata.progress,
    });
    result.completedSteps.push('updateRecord');
  }

  async _executeCreateAndRepoint(plan, artifact, action, result) {
    const created = await this._createDocument(plan, artifact, action);
    result.createdDocument = created;
    result.completedSteps.push('createDocument');

    const metadata = artifactMetadata(artifact);
    try {
      result.record = await this.bitableWriter.updateRecord(plan.source.recordId, {
        title: artifactTitle(plan, artifact, action),
        link: linkFromCreated(created),
        description: metadata.description,
        lastModified: plan.target.version,
        progress: metadata.progress,
        parentRecordId: plan.target.parentRecordId,
      });
      result.completedSteps.push('updateRecord');
    } catch (error) {
      error.step = 'updateRecord';
      throw error;
    }
  }

  async _executeDeprecate(plan, result) {
    result.record = await this.bitableWriter.updateRecord(plan.source.recordId, {
      deprecateSince: plan.target.version,
      progress: 'Deprecated',
    });
    result.completedSteps.push('updateRecord');
  }

  async _createDocument(plan, artifact, action) {
    assertPublishableArtifact(plan, artifact);
    const input = {
      title: artifactTitle(plan, artifact, action),
      content: artifact.content,
      folderToken: plan.target.folderToken,
      version: plan.target.version,
      stableId: plan.stableId,
    };
    if (typeof this.documentWriter.createDocument === 'function') {
      return await this.documentWriter.createDocument(input);
    }
    if (typeof this.documentWriter.push_markdown === 'function') {
      const created = await this.documentWriter.push_markdown({
        markdown_content: input.content,
        title: input.title,
        folder_token: input.folderToken,
      });
      return {
        ...created,
        token: tokenFromCreated(created),
        url: linkFromCreated(created),
        title: input.title,
        folderToken: input.folderToken,
      };
    }
    throw new TypeError('documentWriter must expose createDocument() or push_markdown()');
  }

  async _patchDocument(plan, artifact) {
    assertPublishableArtifact(plan, artifact);
    const input = {
      documentToken: plan.source.documentToken,
      content: artifact.content,
      artifactDigest: plan.artifactDigest,
    };
    if (typeof this.documentWriter.patchDocument === 'function') {
      return await this.documentWriter.patchDocument(input);
    }
    if (typeof this.documentWriter.patch_document === 'function') {
      let blocks = artifact.blocks;
      if (!blocks && typeof this.documentWriter.parse_markdown === 'function' && typeof this.documentWriter.markdown_to_blocks === 'function') {
        const { tokens } = await this.documentWriter.parse_markdown(artifact.content);
        blocks = await this.documentWriter.markdown_to_blocks(tokens);
      }
      return await this.documentWriter.patch_document({
        document_id: input.documentToken,
        blocks,
        strategy: 'smart',
      });
    }
    throw new TypeError('documentWriter must expose patchDocument() or patch_document()');
  }

  async _createRecord(plan, artifact, action, created) {
    const metadata = artifactMetadata(artifact);
    return await this.bitableWriter.createRecord({
      title: artifactTitle(plan, artifact, action),
      link: linkFromCreated(created),
      progress: metadata.progress,
      addedSince: plan.target.version,
      description: metadata.description,
      type: metadata.type,
      targets: metadata.targets,
      parentRecordId: plan.target.parentRecordId,
    });
  }

  _inferFailedStep(plan, completedSteps) {
    if (completedSteps.length === 0) {
      return plan.action === 'UPDATE_IN_PLACE' ? 'patchDocument' : 'createDocument';
    }
    if (completedSteps.includes('createDocument') && !completedSteps.includes('updateRecord') && plan.action === 'CREATE_AND_REPOINT') {
      return 'updateRecord';
    }
    return 'execute';
  }

  _recovery(plan, result, error) {
    const failedStep = result.failedStep || error.step;
    if (plan.action === 'CREATE_AND_REPOINT' && result.createdDocument && failedStep === 'updateRecord') {
      return `Repoint record ${plan.source.recordId} to ${linkFromCreated(result.createdDocument)} or remove created document ${tokenFromCreated(result.createdDocument)} after inspection.`;
    }
    if (plan.action === 'CREATE' && result.createdDocument && failedStep === 'createRecord') {
      return `Create the missing record for ${linkFromCreated(result.createdDocument)} or remove created document ${tokenFromCreated(result.createdDocument)} after inspection.`;
    }
    if (error.code === 'VERIFICATION_FAILED') {
      return 'Inspect verifier errors and reconcile the document, record, and folder state before retrying.';
    }
    return 'No automatic recovery is available; inspect completedSteps before retrying.';
  }
}

SyncExecutor.SyncExecutionError = SyncExecutionError;

module.exports = SyncExecutor;
