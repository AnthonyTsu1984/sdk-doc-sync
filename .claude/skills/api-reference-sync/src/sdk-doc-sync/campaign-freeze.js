'use strict';

// Campaign freeze (batch 18 W-H). A failure that must stop the campaign is
// recorded durably and announced — never swallowed. Two facts are kept
// separate on purpose:
//
//   * the FREEZE RECORD (a local artifact under tmp/, idempotent by digest) is
//     the operational truth: what stopped, why, and where the execution journal
//     is so the operator can reconcile;
//   * the NOTICE (the batch-14 doorbell: p2p Feishu + the reply relay) is
//     best-effort delivery. A failed notification must NEVER mask the freeze or
//     pretend the campaign is fine — dispatchFreezeNotice records whether it
//     reached the operator and the caller reports both.
//
// The freeze does not touch the execution journal: the journal is the recovery
// evidence (铁律 — never delete it to "clean up"), and reconciliation reads it.

const fs = require('node:fs');
const path = require('node:path');

const { digestSemantic } = require('../../../doc-ops-core/src/digest');

const CAMPAIGN_FROZEN = 'CAMPAIGN_FROZEN';
const FREEZE_NOTICE_UNDELIVERED = 'FREEZE_NOTICE_UNDELIVERED';

class CampaignFreezeError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CampaignFreezeError';
    this.code = code;
    this.details = details;
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// The durable freeze record. It carries the failure LOCATION (the same
// {code, step, actionId, expected, actual, path} the retry loop feeds back) so
// the operator sees the same evidence the runner did.
function buildFreezeRecord({ campaignPlanDigest = null, reason, location = null, journalPath = null, frozenAt = null } = {}) {
  if (!nonEmptyString(reason)) {
    throw new CampaignFreezeError(CAMPAIGN_FROZEN, 'a freeze requires a reason');
  }
  const record = {
    schemaVersion: 1,
    code: CAMPAIGN_FROZEN,
    campaignPlanDigest: campaignPlanDigest ?? null,
    reason,
    location: location ?? null,
    journalPath: journalPath ?? null,
    frozenAt: frozenAt ?? new Date().toISOString(),
  };
  return Object.freeze({ ...record, freezeDigest: digestSemantic(record) });
}

// Persist the freeze idempotently by digest: re-freezing the same failure keeps
// the first record (the first freeze time is the truth).
function persistFreeze({ record, freezeDir }) {
  if (!nonEmptyString(record?.freezeDigest)) {
    throw new CampaignFreezeError(CAMPAIGN_FROZEN, 'persistFreeze requires a built freeze record');
  }
  const filePath = path.join(freezeDir, `${record.freezeDigest.replace('sha256:', '').slice(0, 32)}.json`);
  if (fs.existsSync(filePath)) return { filePath, created: false };
  fs.mkdirSync(freezeDir, { recursive: true });
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') return { filePath, created: false };
    throw error;
  }
  return { filePath, created: true };
}

// Best-effort announcement through an injected notifier (createFeishuNotifier
// in production). A missing notifier or a throwing one is reported as
// undelivered — the freeze itself is already durable and must not be lost.
async function dispatchFreezeNotice({ record, notify = null, text = null }) {
  if (typeof notify !== 'function') {
    return { delivered: false, code: FREEZE_NOTICE_UNDELIVERED, reason: 'no notifier configured' };
  }
  const message = text ?? `${CAMPAIGN_FROZEN}: ${record.reason}${record.location?.code ? ` (${record.location.code})` : ''}`;
  try {
    await notify({ code: CAMPAIGN_FROZEN, record, text: message });
    return { delivered: true, code: null, reason: null };
  } catch (error) {
    return { delivered: false, code: FREEZE_NOTICE_UNDELIVERED, reason: error.message };
  }
}

module.exports = {
  CAMPAIGN_FROZEN,
  CampaignFreezeError,
  FREEZE_NOTICE_UNDELIVERED,
  buildFreezeRecord,
  dispatchFreezeNotice,
  persistFreeze,
};
