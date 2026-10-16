'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  disposedWatermark,
  foldLedger,
  markFinding,
  pendingFindings,
  readLedger,
  recordFinding,
} = require('../src/sdk-doc-sync/findings-ledger');
const { buildFreezeRecord, dispatchFreezeNotice, persistFreeze } = require('../src/sdk-doc-sync/campaign-freeze');
const { settleCampaign } = require('../src/sdk-doc-sync/campaign-completion');

function tmpLedger() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'findings-ledger-')), 'pr-findings.jsonl');
}

test('recording a finding is idempotent and unions languages', () => {
  const ledger = tmpLedger();
  assert.equal(recordFinding(ledger, { prNumber: 1181, languages: ['python'] }).created, true);
  // The same PR from another language's scan unions the language set.
  assert.equal(recordFinding(ledger, { prNumber: 1181, languages: ['node'] }).created, true);
  const same = recordFinding(ledger, { prNumber: 1181, languages: ['node'] });
  assert.equal(same.created, false, 'an identical re-record appends nothing');
  // The folded state is one PR carrying both languages — no duplicate identity.
  const folded = foldLedger(readLedger(ledger)).filter((state) => state.prNumber === 1181);
  assert.equal(folded.length, 1);
  assert.deepEqual(folded[0].languages, ['node', 'python']);
});

test('marking is the only watermark advance; conflicts fail closed', () => {
  const ledger = tmpLedger();
  recordFinding(ledger, { prNumber: 1180, languages: ['python'] });
  recordFinding(ledger, { prNumber: 1181, languages: ['python'] });
  assert.equal(disposedWatermark(readLedger(ledger), 'python'), 0);

  assert.throws(() => markFinding(ledger, { prNumber: 9999, verb: 'disposed' }), (e) => e.code === 'MARK_TARGET_NOT_FOUND');
  assert.equal(markFinding(ledger, { prNumber: 1180, verb: 'disposed' }).created, true);
  assert.equal(disposedWatermark(readLedger(ledger), 'python'), 1180);
  // Same-state re-mark is an idempotent no-op.
  assert.equal(markFinding(ledger, { prNumber: 1180, verb: 'disposed' }).created, false);
  // A different terminal mark is refused.
  assert.throws(() => markFinding(ledger, { prNumber: 1180, verb: 'ignored' }), (e) => e.code === 'MARK_STATUS_CONFLICT');

  // 1181 is above the watermark and still pending.
  assert.deepEqual(pendingFindings(readLedger(ledger), 'python').map((s) => s.prNumber), [1181]);
  markFinding(ledger, { prNumber: 1181, verb: 'ignored', reasonCode: 'FEISHU_ROUNDTRIP' });
  assert.equal(disposedWatermark(readLedger(ledger), 'python'), 1181);
  assert.deepEqual(pendingFindings(readLedger(ledger), 'python'), []);
});

test('a freeze record is durable and idempotent by digest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-freeze-'));
  assert.throws(() => buildFreezeRecord({}), (e) => e.code === 'CAMPAIGN_FROZEN');
  const record = buildFreezeRecord({
    campaignPlanDigest: `sha256:${'a'.repeat(64)}`,
    reason: 'post-write verification failed',
    location: { code: 'TARGET_LINK', step: 'verify' },
    journalPath: 'tmp/j.jsonl',
    frozenAt: '2026-10-16T00:00:00.000Z',
  });
  assert.match(record.freezeDigest, /^sha256:[0-9a-f]{64}$/);
  const first = persistFreeze({ record, freezeDir: dir });
  assert.equal(first.created, true);
  assert.equal(persistFreeze({ record, freezeDir: dir }).created, false);
  assert.match(fs.readFileSync(first.filePath, 'utf8'), /TARGET_LINK/);
});

test('a freeze notice is best-effort: an absent or failing notifier never masks the freeze', async () => {
  const record = buildFreezeRecord({ reason: 'frozen' });
  assert.deepEqual(await dispatchFreezeNotice({ record }), { delivered: false, code: 'FREEZE_NOTICE_UNDELIVERED', reason: 'no notifier configured' });
  const failing = await dispatchFreezeNotice({ record, notify: async () => { throw new Error('p2p down'); } });
  assert.equal(failing.delivered, false);
  assert.equal(failing.reason, 'p2p down');
  const sent = [];
  const ok = await dispatchFreezeNotice({ record, notify: async (payload) => sent.push(payload) });
  assert.equal(ok.delivered, true);
  assert.equal(sent[0].code, 'CAMPAIGN_FROZEN');
});

test('settleCampaign disposes on success and freezes on failure (W-I + W-H)', async () => {
  const ledger = tmpLedger();
  const freezeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settle-freeze-'));
  recordFinding(ledger, { prNumber: 1181, languages: ['python'] });

  const disposed = await settleCampaign({ outcome: { ok: true }, prNumber: 1181, language: 'python', ledgerPath: ledger });
  assert.equal(disposed.status, 'disposed');
  assert.equal(disposedWatermark(readLedger(ledger), 'python'), 1181);

  // A success with no PR names a caller bug instead of silently no-oping.
  const undisposed = await settleCampaign({ outcome: { ok: true }, ledgerPath: ledger });
  assert.equal(undisposed.status, 'undisposed');
  assert.equal(undisposed.code, 'SETTLE_PR_REQUIRED');

  const notices = [];
  const frozen = await settleCampaign({
    outcome: { ok: false, frozen: true, reason: 'retry exhausted', location: { code: 'LAYOUT_RETURNS_MISSING' }, journalPath: 'tmp/j.jsonl' },
    freezeDir,
    notify: async (payload) => notices.push(payload),
  });
  assert.equal(frozen.status, 'frozen');
  assert.equal(frozen.noticeDelivered, true);
  assert.equal(notices.length, 1);
  assert.ok(fs.existsSync(frozen.freezePath));
  assert.equal(fs.readdirSync(freezeDir).length, 1);
});

test('settleCampaign reports an undelivered notice instead of hiding it', async () => {
  const result = await settleCampaign({ outcome: { ok: false, frozen: true, reason: 'x' } });
  assert.equal(result.status, 'frozen');
  assert.equal(result.noticeDelivered, false);
  assert.equal(result.noticeReason, 'no notifier configured');
  await assert.rejects(() => settleCampaign({}), TypeError);
});
