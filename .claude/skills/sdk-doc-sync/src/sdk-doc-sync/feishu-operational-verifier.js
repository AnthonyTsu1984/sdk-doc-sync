'use strict';

const SyncVerifier = require('./sync-verifier');
const { LarkCliOps } = require('./lark-cli-ops');
const { validateRenderedApiBlocks } = require('./feishu-block-safety');

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
    const rendered = validateRenderedApiBlocks(blocksFromPayload(payload));
    return {
      ...rendered,
      documentToken: token,
      blockCount: blocksFromPayload(payload).length,
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
