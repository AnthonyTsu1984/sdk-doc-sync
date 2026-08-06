'use strict';

const SyncVerifier = require('./sync-verifier');
const { LarkCliOps } = require('./lark-cli-ops');
const { validateRenderedApiBlocks } = require('./feishu-block-safety');
const { buildApiSectionModel } = require('./api-section-model');
const sdkLayoutProfiles = require('../renderers/sdk-layout-profiles');
const { languageId } = require('../document-ir/block-registry');
const { digestSemantic } = require('../../../doc-ops-core/src/digest');
const { matchesRecordState } = require('./record-state');

function parseJsonOutput(result) {
  const text = String(result?.stdout || '').trim();
  if (!text) return {};
  const start = text.indexOf('{');
  return JSON.parse(start >= 0 ? text.slice(start) : text);
}

function blocksFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.blocks)) return payload.blocks;
  if (Array.isArray(payload.data?.items)) return payload.data.items;
  if (Array.isArray(payload.data?.blocks)) return payload.data.blocks;
  return [];
}

function historyVersionId(payload) {
  const items = payload.items
    || payload.histories
    || payload.entries
    || payload.data?.items
    || payload.data?.histories
    || payload.data?.entries
    || [];
  const first = Array.isArray(items) ? items[0] : null;
  return first?.history_version_id
    || first?.version_id
    || first?.id
    || payload.history_version_id
    || payload.version_id
    || null;
}

function codeBlockText(block) {
  if (!block?.code?.elements) return '';
  return block.code.elements.map((element) => element.text_run?.content || '').join('');
}

function validateCodeVariantDirectives(blocks) {
  const errors = [];
  const directiveToken = /\b(?:include|exclude)-(?:next-line|start|end)\b/;
  const completeDirective = /^\s*(?:#|\/\/)\s+(?:(?:include|exclude)-(?:next-line|start)\s+[a-z0-9][a-z0-9.-]*|(?:include|exclude)-end)\s*$/;
  for (const block of blocks || []) {
    const text = codeBlockText(block);
    if (!text) continue;
    if (/<\s*\/?\s*(?:include|exclude)\b/i.test(text)) {
      errors.push({ code: 'HTML_AUDIENCE_TAG_IN_CODE', blockId: block.block_id });
    }
    for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
      if (directiveToken.test(line) && !completeDirective.test(line)) {
        errors.push({
          code: 'INVALID_CODE_VARIANT_DIRECTIVE',
          blockId: block.block_id,
          line: lineIndex + 1,
          text: line,
        });
      }
    }
  }
  return errors;
}

class FeishuOperationalVerifier extends SyncVerifier {
  constructor({
    ops = new LarkCliOps(),
    readDocument = null,
    readRecord = null,
    documentWriter = null,
    bitableWriter = null,
  } = {}) {
    super({ readDocument, readRecord });
    this.ops = ops;
    this.documentWriter = documentWriter;
    this.bitableWriter = bitableWriter;
    this._authPromise = null;
  }

  async ensureAuth() {
    if (!this._authPromise) this._authPromise = this.ops.authStatus();
    await this._authPromise;
  }

  async beforeMutation(plan) {
    await this.ensureAuth();
    const token = plan.source?.documentToken;
    if (!token) return null;
    const payload = parseJsonOutput(await this.ops.historyList(token));
    const blockPayload = parseJsonOutput(await this.ops.fetchDocBlocks(token));
    const blocks = blocksFromPayload(blockPayload);
    return {
      documentToken: token,
      historyVersionId: historyVersionId(payload),
      history: payload,
      blockDigest: digestSemantic(blocks),
    };
  }

  async verifyDocument(plan, execution = {}) {
    await this.ensureAuth();
    const token = execution.createdDocument?.token
      || execution.createdDocument?.documentToken
      || execution.patchedDocument?.token
      || execution.patchedDocument?.documentToken
      || plan.source?.documentToken;
    const payload = parseJsonOutput(await this.ops.fetchDocBlocks(token));
    const blocks = blocksFromPayload(payload);
    const rendered = validateRenderedApiBlocks(blocks);
    const semanticErrors = validateCodeVariantDirectives(blocks);
    if (plan.layout) {
      const profile = sdkLayoutProfiles[plan.layout.profileId];
      if (!profile || profile.version !== plan.layout.profileVersion) {
        semanticErrors.push({ code: 'INVALID_LAYOUT_PROFILE', layout: plan.layout });
      } else {
        const model = buildApiSectionModel(blocks, profile);
        semanticErrors.push(...model.errors);
        const expectedRoles = plan.apiPatchPlan?.desiredRoleSequence;
        const actualRoles = model.sections.map((section) => section.role);
        if (Array.isArray(expectedRoles) && JSON.stringify(actualRoles) !== JSON.stringify(expectedRoles)) {
          semanticErrors.push({
            code: 'SECTION_SEQUENCE_MISMATCH',
            expected: expectedRoles,
            actual: actualRoles,
          });
        }
        const actualBlockIds = new Set(model.topLevelBlockIds);
        const preservedBlockIds = execution.patchedDocument?.preservedBlockIds
          || plan.apiPatchPlan?.preservedBlockIds
          || [];
        for (const blockId of preservedBlockIds) {
          if (!actualBlockIds.has(blockId)) {
            semanticErrors.push({ code: 'PRESERVED_BLOCK_MISSING', blockId });
          }
        }
        const preservedPlacements = execution.patchedDocument?.preservedPlacements
          || plan.apiPatchPlan?.preservedPlacements
          || [];
        [...preservedPlacements]
          .sort((left, right) => left.insertAt - right.insertAt)
          .forEach((placement, placementIndex) => {
            const actualIndex = model.topLevelBlockIds.indexOf(placement.blockId);
            const expectedIndex = placement.insertAt + placementIndex;
            if (actualIndex !== expectedIndex) {
              semanticErrors.push({
                code: 'PRESERVED_BLOCK_POSITION_MISMATCH',
                blockId: placement.blockId,
                expectedIndex,
                actualIndex,
              });
            }
          });
        const seenSignatures = new Set();
        for (const signature of model.signatures.filter((entry) => (
          ['canonical-signature', 'request-signature'].includes(entry.role)
        ))) {
          if (seenSignatures.has(signature.normalized)) {
            semanticErrors.push({
              code: 'DUPLICATE_SIGNATURE',
              blockId: signature.blockId,
              value: signature.normalized,
            });
          }
          seenSignatures.add(signature.normalized);
        }
        const byId = new Map(blocks.map((block) => [block.block_id, block]));
        for (const signature of model.signatures) {
          const expectedFence = profile.fences[signature.role];
          if (!expectedFence) continue;
          const actualFence = byId.get(signature.blockId)?.code?.style?.language;
          const actualFenceId = Number.isInteger(actualFence) ? actualFence : languageId(actualFence);
          if (actualFenceId !== languageId(expectedFence)) {
            semanticErrors.push({
              code: 'CODE_FENCE_POLICY_INVALID',
              blockId: signature.blockId,
              role: signature.role,
              expected: expectedFence,
              actual: actualFence,
            });
          }
        }
      }
    }
    const errors = [...rendered.errors, ...semanticErrors];
    return {
      ok: errors.length === 0,
      errors,
      documentToken: token,
      blockCount: blocks.length,
    };
  }

  async rollback(plan, execution = {}) {
    const rollback = execution.rollback;
    if (!rollback?.documentToken || !rollback?.historyVersionId) {
      return { ok: false, skipped: true, reason: 'missing_history_version' };
    }
    await this.ensureAuth();
    await this.ops.historyRevert(rollback.documentToken, rollback.historyVersionId);
    return { ok: true, documentToken: rollback.documentToken, historyVersionId: rollback.historyVersionId };
  }

  async revertDocument(rollback) {
    if (!rollback?.documentToken || !rollback?.historyVersionId) {
      throw new TypeError('documentToken and historyVersionId are required to revert a document');
    }
    await this.ensureAuth();
    await this.ops.historyRevert(rollback.documentToken, rollback.historyVersionId);
    return { documentToken: rollback.documentToken, historyVersionId: rollback.historyVersionId };
  }

  async verifyBlockDigest(documentToken, expectedDigest) {
    if (!documentToken || !expectedDigest) throw new TypeError('documentToken and expectedDigest are required');
    await this.ensureAuth();
    const payload = parseJsonOutput(await this.ops.fetchDocBlocks(documentToken));
    const actualDigest = digestSemantic(blocksFromPayload(payload));
    if (actualDigest !== expectedDigest) {
      const error = new Error(`Restored block digest mismatch: expected ${expectedDigest}, got ${actualDigest}`);
      error.code = 'ROLLBACK_BLOCK_DIGEST_MISMATCH';
      throw error;
    }
    return { documentToken, blockDigest: actualDigest };
  }

  async preflightRollbackAction(action) {
    const expectedRecord = action?.expectedPostRecord || action?.createdRecord?.expectedState || null;
    if (expectedRecord) await this.verifyRecordState(expectedRecord.recordId, expectedRecord);
    const document = action?.createdDocument || action?.copiedDocument || null;
    if (document) await this._verifyDriveChild(document.folderToken, document.token, 'docx', true);
    if (action?.createdFolder) {
      await this._verifyDriveChild(
        action.createdFolder.parentFolderToken,
        action.createdFolder.token,
        'folder',
        true,
      );
    }
    if (action?.documentRollback?.documentToken) {
      await this.ensureAuth();
      await this.ops.fetchDocBlocks(action.documentRollback.documentToken);
    }
    return { ok: true };
  }

  async verifyRecordState(recordId, snapshot) {
    if (typeof this.bitableWriter?.getRecord !== 'function') {
      const error = new Error(`Bitable reader is required to verify ${recordId}`);
      error.code = 'ROLLBACK_RECORD_READER_REQUIRED';
      throw error;
    }
    const record = await this.bitableWriter.getRecord(recordId);
    if (!matchesRecordState(record, snapshot)) {
      const error = new Error(`Bitable record state mismatch: ${recordId}`);
      error.code = 'ROLLBACK_TARGET_DRIFT';
      throw error;
    }
    return { recordId };
  }

  async verifyRecordAbsent(recordId) {
    if (typeof this.bitableWriter?.listRecords !== 'function') {
      const error = new Error(`Bitable list reader is required to verify absence of ${recordId}`);
      error.code = 'ROLLBACK_RECORD_READER_REQUIRED';
      throw error;
    }
    const records = await this.bitableWriter.listRecords();
    if (records.some((record) => (record.record_id || record.recordId || record.id) === recordId)) {
      const error = new Error(`Bitable record still exists: ${recordId}`);
      error.code = 'ROLLBACK_RECORD_NOT_DELETED';
      throw error;
    }
    return { recordId, absent: true };
  }

  async verifyDocumentAbsent(documentToken, parentFolderToken) {
    return this._verifyDriveChild(parentFolderToken, documentToken, 'docx', false);
  }

  async verifyFolderEmpty(folderToken) {
    if (typeof this.documentWriter?.listFolder !== 'function') {
      const error = new Error(`Drive folder reader is required to inspect ${folderToken}`);
      error.code = 'ROLLBACK_FOLDER_READER_REQUIRED';
      throw error;
    }
    const files = await this.documentWriter.listFolder({ folderToken });
    if (files.length > 0) {
      const error = new Error(`Folder is not empty: ${folderToken}`);
      error.code = 'ROLLBACK_FOLDER_NOT_EMPTY';
      error.childTokens = files.map((file) => file.token || file.file_token).filter(Boolean).sort();
      throw error;
    }
    return { folderToken, empty: true };
  }

  async verifyFolderAbsent(folderToken, parentFolderToken) {
    return this._verifyDriveChild(parentFolderToken, folderToken, 'folder', false);
  }

  async _verifyDriveChild(parentFolderToken, childToken, type, shouldExist) {
    if (!parentFolderToken || typeof this.documentWriter?.listFolder !== 'function') {
      const error = new Error(`Parent folder evidence is required to verify ${type} ${childToken}`);
      error.code = 'ROLLBACK_DRIVE_IDENTITY_REQUIRED';
      throw error;
    }
    const files = await this.documentWriter.listFolder({ folderToken: parentFolderToken });
    const found = files.find((file) => (file.token || file.file_token) === childToken);
    const matchesType = found && (!found.type || found.type === type);
    if ((shouldExist && !matchesType) || (!shouldExist && found)) {
      const error = new Error(
        shouldExist ? `${type} identity drifted: ${childToken}` : `${type} still exists: ${childToken}`,
      );
      error.code = shouldExist ? 'ROLLBACK_TARGET_DRIFT' : 'ROLLBACK_DRIVE_DELETE_VERIFY_FAILED';
      throw error;
    }
    return { childToken, type, present: shouldExist };
  }
}

module.exports = {
  FeishuOperationalVerifier,
  blocksFromPayload,
  historyVersionId,
  validateCodeVariantDirectives,
};
