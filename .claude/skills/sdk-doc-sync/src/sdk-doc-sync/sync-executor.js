'use strict';

const {
  FeishuBlockSafetyError,
  assertPublishableContent,
} = require('./feishu-block-safety');

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

function editedRecordMetadata() {
  return { progress: 'WIP', targets: [] };
}

function containsLegacyTodo(content) {
  return typeof content === 'string' && /<!--\s*TODO:/i.test(content);
}

function assertPublishableArtifact(plan, artifact) {
  if (!artifact || !nonEmptyString(artifact.content)) {
    throw new SyncExecutionError('ARTIFACT_CONTENT_REQUIRED', `Reviewed artifact content is required for ${plan.stableId}`);
  }
  try {
    assertPublishableContent(artifact.content);
  } catch (error) {
    if (error instanceof FeishuBlockSafetyError) {
      throw new SyncExecutionError(
        error.code,
        `${error.message} (${plan.stableId})`,
        error.details,
      );
    }
    throw error;
  }
  if (containsLegacyTodo(artifact.content)) {
    throw new SyncExecutionError(
      'LEGACY_SCAFFOLD_ARTIFACT',
      `Legacy scaffold content cannot be published for ${plan.stableId}; provide a reviewed schema-first artifact`,
    );
  }
}

function linkFromCreated(created) {
  const link = created?.url || created?.wiki_url || created?.link || created?.documentUrl || '';
  if (link) return link;
  const token = tokenFromCreated(created);
  if (!token) return '';
  const host = (process.env.FEISHU_HOST || 'https://zilliverse.feishu.cn').replace(/\/$/, '');
  return `${host}/docx/${token}`;
}

function tokenFromCreated(created) {
  return created?.token || created?.documentToken || created?.document_id || created?.obj_token || null;
}

function normalizedCreatedDocument(created) {
  const token = tokenFromCreated(created);
  const url = linkFromCreated(created);
  return {
    ...created,
    token,
    url,
  };
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
      rollback: null,
      documentVerification: null,
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
          throw new SyncExecutionError(
            'LEGACY_PLAN_ACTION',
            'CREATE_AND_REPOINT is no longer executable; regenerate the plan as COPY_PATCH_AND_REPOINT with copySource evidence',
          );
        case 'COPY_PATCH_AND_REPOINT':
          await this._executeCopyPatchAndRepoint(plan, artifact, action, result);
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
          const error = new SyncExecutionError('VERIFICATION_FAILED', 'Plan verification failed', {
            errors: result.verification.errors,
          });
          error.step = 'verify';
          throw error;
        }
      }
      return result;
    } catch (error) {
      await this._rollbackInPlaceMutation(plan, result, error);
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
    try {
      this._assertCreatedDocumentLink(plan, created);

      await this._verifyDocumentBeforeBitableMutation(plan, result);

      result.record = await this._createRecord(plan, artifact, action, created);
      result.completedSteps.push('createRecord');
    } catch (error) {
      if (error.code === 'DOCUMENT_LINK_REQUIRED') {
        error.step = 'createDocument';
      } else if (!error.step && !result.completedSteps.includes('verifyDocument')) {
        error.step = 'createRecord';
      }
      await this._cleanupCreatedDocument(created, result);
      throw error;
    }
  }

  async _executeUpdateInPlace(plan, artifact, action, result) {
    assertPublishableArtifact(plan, artifact);
    await this._captureRollbackBeforeMutation(plan, result);

    const patched = await this._patchDocument(plan, artifact);
    result.patchedDocument = patched;
    result.completedSteps.push('patchDocument');

    await this._verifyDocumentBeforeBitableMutation(plan, result);

    const metadata = artifactMetadata(artifact);
    try {
      result.record = await this.bitableWriter.updateRecord(plan.source.recordId, {
        description: metadata.description,
        lastModified: plan.target.version,
        ...editedRecordMetadata(),
      });
    } catch (error) {
      error.step = 'updateRecord';
      throw error;
    }
    result.completedSteps.push('updateRecord');
  }

  async _executeCreateAndRepoint(plan, artifact, action, result) {
    const created = await this._createDocument(plan, artifact, action);
    result.createdDocument = created;
    result.completedSteps.push('createDocument');
    this._assertCreatedDocumentLink(plan, created);

    await this._verifyDocumentBeforeBitableMutation(plan, result);

    const metadata = artifactMetadata(artifact);
    try {
      result.record = await this.bitableWriter.updateRecord(plan.source.recordId, {
        title: artifactTitle(plan, artifact, action),
        link: linkFromCreated(created),
        description: metadata.description,
        lastModified: plan.target.version,
        ...editedRecordMetadata(),
        parentRecordId: plan.target.parentRecordId,
      });
      result.completedSteps.push('updateRecord');
    } catch (error) {
      error.step = 'updateRecord';
      await this._cleanupCreatedDocument(created, result);
      throw error;
    }
  }

  async _executeCopyPatchAndRepoint(plan, artifact, action, result) {
    assertPublishableArtifact(plan, artifact);
    await this._captureRollbackBeforeMutation(plan, result);

    const copied = await this._copyDocument(plan, artifact, action);
    result.createdDocument = copied;
    result.completedSteps.push('copyDocument');

    try {
      this._assertCreatedDocumentLink(plan, copied);

      const patched = await this._patchDocument(plan, artifact, copied.token);
      result.patchedDocument = patched;
      result.completedSteps.push('patchDocument');

      await this._verifyDocumentBeforeBitableMutation(plan, result);

      const metadata = artifactMetadata(artifact);
      result.record = await this.bitableWriter.updateRecord(plan.source.recordId, {
        title: artifactTitle(plan, artifact, action),
        link: linkFromCreated(copied),
        description: metadata.description,
        lastModified: plan.target.version,
        ...editedRecordMetadata(),
        parentRecordId: plan.target.parentRecordId,
      });
      result.completedSteps.push('updateRecord');
    } catch (error) {
      if (error.code === 'DOCUMENT_LINK_REQUIRED') {
        error.step = 'copyDocument';
      } else if (!error.step) {
        error.step = result.completedSteps.includes('patchDocument') ? 'updateRecord' : 'patchDocument';
      }
      await this._cleanupCreatedDocument(copied, result);
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
      return normalizedCreatedDocument(await this.documentWriter.createDocument(input));
    }
    if (typeof this.documentWriter.push_markdown === 'function') {
      const created = await this.documentWriter.push_markdown({
        markdown_content: input.content,
        title: input.title,
        folder_token: input.folderToken,
      });
      return normalizedCreatedDocument({
        ...created,
        token: tokenFromCreated(created),
        url: linkFromCreated(created),
        title: input.title,
        folderToken: input.folderToken,
      });
    }
    throw new TypeError('documentWriter must expose createDocument() or push_markdown()');
  }

  async _copyDocument(plan, artifact, action) {
    const input = {
      sourceDocumentToken: plan.copySource?.documentToken,
      sourceLink: plan.copySource?.link,
      title: artifactTitle(plan, artifact, action),
      folderToken: plan.target.folderToken,
      stableId: plan.stableId,
    };
    if (!nonEmptyString(input.sourceDocumentToken) || !nonEmptyString(input.sourceLink)) {
      throw new SyncExecutionError('COPY_SOURCE_REQUIRED', `Copy source evidence is required for ${plan.stableId}`);
    }
    if (typeof this.documentWriter.copyDocument !== 'function') {
      throw new TypeError('documentWriter must expose copyDocument() for COPY_PATCH_AND_REPOINT');
    }
    return normalizedCreatedDocument(await this.documentWriter.copyDocument(input));
  }

  async _patchDocument(plan, artifact, documentToken = plan.source.documentToken) {
    assertPublishableArtifact(plan, artifact);
    const input = {
      documentToken,
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
      progress: editedRecordMetadata().progress,
      addedSince: plan.target.version,
      description: metadata.description,
      type: metadata.type,
      targets: editedRecordMetadata().targets,
      parentRecordId: plan.target.parentRecordId,
    });
  }

  async _verifyDocumentBeforeBitableMutation(plan, result) {
    if (typeof this.verifier?.verifyDocument !== 'function') return;
    const documentVerification = await this.verifier.verifyDocument(plan, result);
    result.documentVerification = documentVerification;
    result.completedSteps.push('verifyDocument');
    if (!documentVerification.ok) {
      const error = new SyncExecutionError(
        'DOCUMENT_VERIFICATION_FAILED',
        'Document verification failed before Bitable mutation',
        { errors: documentVerification.errors },
      );
      error.step = 'verifyDocument';
      throw error;
    }
  }

  async _captureRollbackBeforeMutation(plan, result) {
    if (typeof this.verifier?.beforeMutation !== 'function' || !plan.source?.documentToken) return;
    try {
      result.rollback = await this.verifier.beforeMutation(plan);
      result.completedSteps.push('captureRollback');
    } catch (error) {
      error.step = 'captureRollback';
      throw error;
    }
  }

  _assertCreatedDocumentLink(plan, created) {
    if (!nonEmptyString(tokenFromCreated(created)) || !nonEmptyString(linkFromCreated(created))) {
      throw new SyncExecutionError(
        'DOCUMENT_LINK_REQUIRED',
        `A created document token and link are required before mutating the Bitable record for ${plan.stableId}`,
      );
    }
  }

  async _cleanupCreatedDocument(created, result) {
    const documentToken = tokenFromCreated(created);
    if (!documentToken || typeof this.documentWriter.deleteDocument !== 'function') return;
    try {
      await this.documentWriter.deleteDocument({ documentToken });
      result.completedSteps.push('deleteDocument');
    } catch (error) {
      result.cleanupError = {
        step: 'deleteDocument',
        documentToken,
        message: error.message,
      };
      result.completedSteps.push('deleteDocumentFailed');
    }
  }

  async _rollbackInPlaceMutation(plan, result, originalError) {
    if (plan.action !== 'UPDATE_IN_PLACE') return;
    if (!result.completedSteps.includes('patchDocument')) return;
    if (result.completedSteps.includes('rollbackRevert') || result.completedSteps.includes('rollbackRevertFailed')) return;
    if (typeof this.verifier?.rollback !== 'function') return;
    try {
      result.rollbackResult = await this.verifier.rollback(plan, result, originalError);
      result.completedSteps.push('rollbackRevert');
    } catch (error) {
      result.rollbackError = {
        step: 'rollbackRevert',
        message: error.message,
      };
      result.completedSteps.push('rollbackRevertFailed');
    }
  }

  _inferFailedStep(plan, completedSteps) {
    if (completedSteps.length === 0) {
      if (plan.action === 'COPY_PATCH_AND_REPOINT') return 'copyDocument';
      return plan.action === 'UPDATE_IN_PLACE' ? 'patchDocument' : 'createDocument';
    }
    if (completedSteps.includes('captureRollback') && completedSteps.length === 1) {
      return plan.action === 'UPDATE_IN_PLACE' ? 'patchDocument' : 'copyDocument';
    }
    if (plan.action === 'COPY_PATCH_AND_REPOINT'
      && completedSteps.includes('copyDocument')
      && !completedSteps.includes('patchDocument')) {
      return 'patchDocument';
    }
    if (plan.action === 'COPY_PATCH_AND_REPOINT'
      && completedSteps.includes('patchDocument')
      && !completedSteps.includes('verifyDocument')
      && !completedSteps.includes('updateRecord')) {
      return 'verifyDocument';
    }
    if (plan.action === 'COPY_PATCH_AND_REPOINT'
      && completedSteps.includes('patchDocument')
      && !completedSteps.includes('updateRecord')) {
      return 'updateRecord';
    }
    return 'execute';
  }

  _recovery(plan, result, error) {
    const failedStep = result.failedStep || error.step;
    if (plan.action === 'COPY_PATCH_AND_REPOINT' && result.createdDocument && failedStep === 'updateRecord') {
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
