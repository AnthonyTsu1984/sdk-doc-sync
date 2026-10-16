'use strict';

// Campaign-completion hook (batch 18 W-H + W-I). The runner — the dwf execution
// loop, or the optional node shell — calls this exactly once when a campaign
// settles, and the two answers are host-agnostic:
//
//   * SUCCESS  → mark the PR disposed on the findings ledger (W-I). "Disposed"
//                is a campaign fact, not a scan fact: the scanner merely SEEING
//                a PR never advances the watermark, only this call does.
//   * FROZEN   → persist the freeze record and ring the doorbell (W-H). A
//                failed notice is reported, never hidden.
//
// Everything is injected so the hook is testable without a runner, a ledger, or
// a network: the caller supplies the paths and the notifier.

const { buildFreezeRecord, dispatchFreezeNotice, persistFreeze } = require('./campaign-freeze');
const { markFinding } = require('./findings-ledger');

// outcome is the retry loop's verdict ({ ok, frozen, code, reason, location })
// or any object with a boolean `ok`. A success without a prNumber is a caller
// bug (nothing to dispose) and is reported, not silently skipped.
async function settleCampaign({
  outcome,
  prNumber = null,
  language = null,
  ledgerPath = null,
  freezeDir = null,
  notify = null,
  campaignPlanDigest = null,
  journalPath = null,
  note = null,
  frozenAt = null,
} = {}) {
  if (!outcome || typeof outcome.ok !== 'boolean') {
    throw new TypeError('settleCampaign requires an outcome with a boolean ok');
  }

  if (outcome.ok) {
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      return { status: 'undisposed', code: 'SETTLE_PR_REQUIRED', reason: 'a successful campaign must name the PR it disposes' };
    }
    if (!ledgerPath) {
      return { status: 'undisposed', code: 'SETTLE_LEDGER_REQUIRED', reason: 'a successful campaign needs the findings ledger path' };
    }
    const marked = markFinding(ledgerPath, {
      prNumber,
      verb: 'disposed',
      note: note || `campaign settled for ${language || 'unknown'}`,
      at: frozenAt,
    });
    return { status: 'disposed', created: marked.created, prNumber, language };
  }

  const record = buildFreezeRecord({
    campaignPlanDigest,
    reason: outcome.reason || outcome.code || 'campaign frozen',
    location: outcome.location ?? null,
    journalPath,
    frozenAt,
  });
  const persisted = freezeDir ? persistFreeze({ record, freezeDir }) : { filePath: null, created: false };
  const notice = await dispatchFreezeNotice({ record, notify });
  return {
    status: 'frozen',
    code: record.code,
    freezeDigest: record.freezeDigest,
    freezePath: persisted.filePath,
    noticeDelivered: notice.delivered,
    noticeReason: notice.reason,
  };
}

module.exports = { settleCampaign };
