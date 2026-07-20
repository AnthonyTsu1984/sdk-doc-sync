'use strict';

const SyncVerifier = require('./sync-verifier');
const { LarkCliOps } = require('./lark-cli-ops');
const { validateRenderedApiBlocks } = require('./feishu-block-safety');
const { buildApiSectionModel } = require('./api-section-model');
const sdkLayoutProfiles = require('../renderers/sdk-layout-profiles');
const { languageId } = require('../document-ir/block-registry');

function parseJsonOutput(result) {
  const text = String(result?.stdout || '').trim();
  return text ? JSON.parse(text) : {};
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
  const items = payload.items || payload.histories || payload.data?.items || payload.data?.histories || [];
  const first = Array.isArray(items) ? items[0] : null;
  return first?.history_version_id
    || first?.version_id
    || first?.id
    || payload.history_version_id
    || payload.version_id
    || null;
}

class FeishuOperationalVerifier extends SyncVerifier {
  constructor({ ops = new LarkCliOps(), readDocument = null, readRecord = null } = {}) {
    super({ readDocument, readRecord });
    this.ops = ops;
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
    return {
      documentToken: token,
      historyVersionId: historyVersionId(payload),
      history: payload,
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
    const semanticErrors = [];
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
        for (const blockId of plan.apiPatchPlan?.preservedBlockIds || []) {
          if (!actualBlockIds.has(blockId)) {
            semanticErrors.push({ code: 'PRESERVED_BLOCK_MISSING', blockId });
          }
        }
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
}

module.exports = {
  FeishuOperationalVerifier,
  blocksFromPayload,
  historyVersionId,
};
