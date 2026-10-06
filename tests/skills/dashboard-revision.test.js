'use strict';
// Batch-10 revision campaigns: worklist-driven cards (discovery, live-scope
// reconciliation, per-page apply-review progress, grouping gate) and the
// /attach handoff brief for a flow that has no review session. Fixtures in
// os.tmpdir().

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildRevisionCards } = require('../../scripts/dashboard/ledger.js');
const {
  buildRevisionBrief,
  resolveRevisionTarget,
} = require('../../scripts/dashboard/attach-brief.js');

function makeFixtureTree(prefix) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const write = (relative, content) => {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    return abs;
  };
  return { root, write };
}

function worklistFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAt: '2026-10-04T20:00:00.000Z',
    language: 'java',
    ruling: '2026-10-04: scope v3.0.x only; shared pages in-place',
    pagesInScope: 150,
    summary: { RETURNS_MIN_DEPTH: 100 },
    items: [
      { page: 'Vector', documentToken: 'T1', code: 'RETURNS_MIN_DEPTH', detail: 'no response-fields', shared: false },
      { page: 'Vector', documentToken: 'T1', code: 'FIRST_SENTENCE_REGISTER', detail: 'register style', shared: false },
      { page: 'Client', documentToken: 'T2', code: 'INTERNAL_NOTE_LEAK', detail: 'notes leak', shared: false },
    ],
    ...overrides,
  };
}

test('revision card: live scope wins, progress reconciles apply-review manifests', (t) => {
  const { root, write } = makeFixtureTree('dash-rev-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write('tmp/api-reference-sync/java-revision-worklist.json', worklistFixture());
  // Live scope linked by the gate manifest — newer than the worklist.
  write('tmp/api-reference-sync/revision-scope-java-v30-2026-10-05.json', {
    schemaVersion: 1, generatedAt: '2026-10-05T12:00:00.000Z',
    ruling: '2026-10-05 live-scan ruling',
    summary: { pages: 204, byCode: { RETURNS_MIN_DEPTH: 178 } },
    sharedPages: [{ documentToken: 'X', tracks: ['v2.6.x'] }],
  });
  write('tmp/api-reference-sync/gate-manifest-grouping-java-v30-revision.json', {
    gate: 'GROUPING', digest: 'sha256:' + '7'.repeat(64), title: '范围工件',
    links: [{ label: 'scope', url: 'tmp/api-reference-sync/revision-scope-java-v30-2026-10-05.json' }],
  });
  write('tmp/api-reference-sync/run-manifest-revision-apply-review-java-v3-LexicalHighlighter.json', { schemaVersion: 1 });
  write('tmp/api-reference-sync/run-manifest-pr-polish-apply-review-java-v2-Client-startTelemetry.json', { schemaVersion: 1 });
  // Suffix-less run manifests (campaign flows) must not count as written pages.
  write('tmp/api-reference-sync/run-manifest-sha256-aaaa.json', { schemaVersion: 1 });

  const [card] = buildRevisionCards([{ id: 'main', label: '主检出', root }]);
  assert.ok(card, 'worklist discovered');
  assert.equal(card.kind, 'revision');
  assert.equal(card.checkout, 'main');
  assert.equal(card.scope.pages, 204, 'live scope supersedes the worklist count');
  assert.equal(card.scope.findings, 3);
  assert.equal(card.scope.uniquePages, 2);
  assert.equal(card.ruling, '2026-10-05 live-scan ruling');
  assert.equal(card.groupingGate.digest, 'sha256:' + '7'.repeat(64));
  assert.equal(card.writtenPages, 2);
  assert.equal(card.groupingApproved, true, 'pages written → grouping necessarily approved');
  assert.equal(card.remainingPages, 202);
  assert.deepEqual(
    card.pages.map((p) => `${p.page}:${p.codes.length}`),
    ['Client:1', 'Vector:2'],
    'per-page rollup carries page/token/codes for the unified detail table',
  );
  assert.equal(card.status, 'in_progress');
  const flows = card.written.map((w) => w.flow).sort();
  assert.deepEqual(flows, ['pr-polish', 'revision']);
  assert.ok(card.written.every((w) => w.manifest.startsWith('tmp/api-reference-sync/run-manifest-')));
});

test('revision dedupe: stale copies in earlier checkouts lose to the live one', (t) => {
  const stale = makeFixtureTree('dash-rev-stale-');
  const live = makeFixtureTree('dash-rev-live-');
  t.after(() => {
    fs.rmSync(stale.root, { recursive: true, force: true });
    fs.rmSync(live.root, { recursive: true, force: true });
  });
  stale.write('tmp/api-reference-sync/java-revision-worklist.json', worklistFixture({ generatedAt: '2026-10-04T20:00:00.000Z' }));
  stale.write('tmp/api-reference-sync/run-manifest-revision-apply-review-java-v3-OnlyOne.json', { schemaVersion: 1 });
  live.write('tmp/api-reference-sync/java-revision-worklist.json', worklistFixture({ generatedAt: '2026-10-04T20:00:00.000Z' }));
  live.write('tmp/api-reference-sync/run-manifest-revision-apply-review-java-v3-Alpha.json', { schemaVersion: 1 });
  live.write('tmp/api-reference-sync/run-manifest-revision-apply-review-java-v3-Beta.json', { schemaVersion: 1 });

  const cards = buildRevisionCards([
    { id: 'main', label: '主检出', root: stale.root },
    { id: 'wt', label: 'wt', root: live.root },
  ]);
  assert.equal(cards.length, 1, 'one card per worklist stem');
  assert.equal(cards[0].checkout, 'wt', 'the copy further along is the live campaign');
  assert.equal(cards[0].writtenPages, 2);
});

test('resolveRevisionTarget + buildRevisionBrief determinism and content', (t) => {
  const { root, write } = makeFixtureTree('dash-rev-br-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write('tmp/api-reference-sync/java-revision-worklist.json', worklistFixture());
  write('tmp/api-reference-sync/run-manifest-revision-apply-review-java-v3-LexicalHighlighter.json', { schemaVersion: 1 });
  const checkouts = [{ id: 'main', label: '主检出', root }];

  const byStem = resolveRevisionTarget(checkouts, 'java-revision-worklist');
  assert.ok(byStem.card);
  const byRevPrefix = resolveRevisionTarget(checkouts, 'rev:java-revision-worklist');
  assert.equal(byRevPrefix.card.sessionKey, byStem.card.sessionKey);
  const byFullKey = resolveRevisionTarget(checkouts, byStem.card.sessionKey);
  assert.ok(byFullKey.card);
  const none = resolveRevisionTarget(checkouts, 'nope');
  assert.equal(none.error !== undefined, true);
  assert.deepEqual(none.available, ['java-revision-worklist']);

  const brief = buildRevisionBrief(byStem.card, new Date('2026-10-05T15:00:00Z'));
  assert.equal(brief.ok, true);
  assert.match(brief.text, /## 修订战役简报 · java · java-revision-worklist/);
  assert.match(brief.text, /工作树: 主检出/);
  assert.match(brief.text, /工作单: `tmp\/api-reference-sync\/java-revision-worklist\.json`（3 项发现 \/ 唯一页 2；活体 scope 口径 150 页/);
  assert.match(brief.text, /已写页面（run-manifest 对账，1\/150）:/);
  assert.match(brief.text, /java-v3-LexicalHighlighter（revision/);
  assert.match(brief.text, /待写: 约 149 页/);
  assert.match(brief.text, /governed writer/);
  assert.match(brief.text, /铁律/);
  const again = buildRevisionBrief(byStem.card, new Date('2026-10-05T15:00:00Z'));
  assert.equal(again.text, brief.text, 'same tree in, same brief out');

  // Zero pages written → grouping still pending (honest gate state).
  const empty = makeFixtureTree('dash-rev-empty-');
  t.after(() => fs.rmSync(empty.root, { recursive: true, force: true }));
  empty.write('tmp/api-reference-sync/fresh-revision-worklist.json', worklistFixture({ language: 'go' }));
  const [fresh] = buildRevisionCards([{ id: 'main', label: '主检出', root: empty.root }]);
  assert.equal(fresh.groupingApproved, false, 'nothing written yet → grouping still pending');
});


// ---------- intake grouping gates (batch 11) ----------

test('intake cards surface grouping manifests with approval transitions', (t) => {
  const main = makeFixtureTree('dash-intake-main-');
  const sib = makeFixtureTree('dash-intake-sib-');
  t.after(() => {
    fs.rmSync(main.root, { recursive: true, force: true });
    fs.rmSync(sib.root, { recursive: true, force: true });
  });
  // api-reference-sync style (revision flow) — approved via written pages.
  main.write('tmp/api-reference-sync/gate-manifest-grouping-java-rev.json', {
    gate: 'GROUPING', digest: 'sha256:' + '1'.repeat(64),
    title: 'java v3.0.x 修订战役 — 范围工件', run: 'run line',
    links: [{ label: 'scope', url: `file://${main.root}/tmp/api-reference-sync/x.json` }],
  });
  main.write('tmp/api-reference-sync/java-revision-worklist.json', worklistFixture({ language: 'java' }));
  main.write('tmp/api-reference-sync/run-manifest-revision-apply-review-java-v3-Alpha.json', { schemaVersion: 1 });
  // sdk-release-scout style (go flow) — awaiting, no session yet.
  sib.write('tmp/sdk-release-scout/go-v30-grouping-gate-manifest.json', {
    gate: 'APPROVE_GROUPING', digest: 'sha256:' + '2'.repeat(64),
    title: 'go v3.0.0 分组门 v2', run: 'go intake run',
  });

  const { buildIntakeCards, buildLedger } = require('../../scripts/dashboard/ledger.js');
  const checkouts = [
    { id: 'main', label: '主检出', root: main.root },
    { id: 'sib', label: 'sib', root: sib.root },
  ];
  // No campaigns, no revisions yet → both awaiting.
  let cards = buildIntakeCards(checkouts, [], []);
  assert.equal(cards.length, 2);
  const goCard = cards.find((c) => c.language === 'go');
  assert.equal(goCard.approved, false);
  assert.equal(goCard.digest, 'sha256:' + '2'.repeat(64));

  // Full ledger: the java revision card (1 page written) proves its gate approved.
  const ledger = buildLedger({ repoRoot: main.root, checkouts });
  const jv = ledger.intakes.find((c) => c.language === 'java');
  assert.equal(jv.approved, true, 'revision pages written after the gate prove approval');
  assert.equal(ledger.intakes.find((c) => c.language === 'go').approved, false);

  // Two-gate proof: a session created after the gate in the same checkout.
  sib.write('tmp/sdk-release-scout/go-v30-session.json', {
    schemaVersion: 1, status: 'in_progress', language: 'go', track: 'v3.0.x',
    reviewUnitManifest: { units: [{ reviewUnitId: 'u1' }] }, acceptedReviewUnits: [],
    pendingExecutions: [], artifacts: {}, createdAt: '2026-10-06T10:00:00.000Z', updatedAt: '2026-10-06T10:00:00.000Z',
  });
  const ledger2 = buildLedger({ repoRoot: main.root, checkouts });
  assert.equal(ledger2.intakes.find((c) => c.language === 'go').approved, true, 'session built after the gate proves approval');
});

// ---------- durable grouping receipts (grouping-governance flow) ----------

test('intake cards take the durable receipt keyed by the gate digest as direct approval evidence', (t) => {
  const main = makeFixtureTree('dash-receipt-');
  t.after(() => fs.rmSync(main.root, { recursive: true, force: true }));
  const digest = 'sha256:' + 'a'.repeat(64);
  main.write('tmp/sdk-release-scout/go-v30-grouping-gate-manifest.json', {
    gate: 'APPROVE_GROUPING', digest, title: 'go v3.0.0 分组门 v3', run: 'go run',
  });
  main.write(`tmp/api-reference-sync/grouping-approvals/${digest}.json`, {
    schemaVersion: 1, gate: 'APPROVE_GROUPING', proposalDigest: digest,
    approvalCommand: `APPROVE_GROUPING ${digest}`,
    language: 'go', sdkName: 'milvus', track: 'v3.0.x',
    releaseRange: 'client/v3.0.0-beta..client/v3.0.0',
    lineage: { scopeDigest: 'sha256:' + 'b'.repeat(64), identityMapDigest: 'sha256:' + 'c'.repeat(64) },
    approvedAt: '2026-10-06T09:00:00.000Z',
  });
  // A decoy receipt for a different digest must not approve anything.
  const other = 'sha256:' + 'f'.repeat(64);
  main.write(`tmp/api-reference-sync/grouping-approvals/${other}.json`, {
    schemaVersion: 1, gate: 'APPROVE_GROUPING', proposalDigest: other,
    approvalCommand: `APPROVE_GROUPING ${other}`,
    language: 'java', sdkName: 'milvus', track: 'v3.0.x', releaseRange: 'r',
    lineage: { scopeDigest: 'sha256:' + 'e'.repeat(64) }, approvedAt: '2026-10-06T09:00:00.000Z',
  });

  const { buildIntakeCards, buildLedger, readGroupingReceipts } = require('../../scripts/dashboard/ledger.js');
  const checkouts = [{ id: 'main', label: '主检出', root: main.root }];
  const receipts = readGroupingReceipts(checkouts);
  assert.equal(receipts.length, 2, 'receipts from every checkout are enumerated');
  const [card] = buildIntakeCards(checkouts, [], [], receipts);
  assert.equal(card.approved, true, 'the receipt keyed by the gate digest proves approval directly');
  assert.equal(card.approvalEvidence, 'receipt');
  assert.equal(card.receipt.path, `tmp/api-reference-sync/grouping-approvals/${digest}.json`);
  assert.equal(card.receipt.scopeDigest, 'sha256:' + 'b'.repeat(64));

  const ledger = buildLedger({ repoRoot: main.root, checkouts });
  assert.equal(ledger.groupingReceipts.length, 2);
  assert.equal(ledger.intakes[0].approved, true);
  assert.equal(ledger.intakes[0].approvalEvidence, 'receipt');
});

test('a receipt is checkout-scoped: main\'s receipt never approves a sibling\'s same-digest gate', (t) => {
  const main = makeFixtureTree('dash-receipt-a-');
  const sib = makeFixtureTree('dash-receipt-b-');
  t.after(() => {
    fs.rmSync(main.root, { recursive: true, force: true });
    fs.rmSync(sib.root, { recursive: true, force: true });
  });
  const digest = 'sha256:' + '9'.repeat(64);
  for (const tree of [main, sib]) {
    tree.write('tmp/sdk-release-scout/go-v30-grouping-gate-manifest.json', {
      gate: 'APPROVE_GROUPING', digest, title: 'same digest, two checkouts', run: 'r',
    });
  }
  // Receipt recorded in MAIN only.
  main.write(`tmp/api-reference-sync/grouping-approvals/${digest}.json`, {
    schemaVersion: 1, gate: 'APPROVE_GROUPING', proposalDigest: digest,
    approvalCommand: `APPROVE_GROUPING ${digest}`,
    language: 'go', sdkName: 'milvus', track: 'v3.0.x', releaseRange: 'r',
    lineage: { scopeDigest: 'sha256:' + '8'.repeat(64) }, approvedAt: '2026-10-06T10:00:00.000Z',
  });

  const { buildIntakeCards, readGroupingReceipts } = require('../../scripts/dashboard/ledger.js');
  const checkouts = [
    { id: 'main', label: '主检出', root: main.root },
    { id: 'sib', label: 'sib', root: sib.root },
  ];
  const receipts = readGroupingReceipts(checkouts);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].checkout, 'main');
  const cards = buildIntakeCards(checkouts, [], [], receipts);
  assert.equal(cards.find((c) => c.checkout === 'main').approved, true);
  const sibling = cards.find((c) => c.checkout === 'sib');
  assert.equal(sibling.approved, false, 'a sibling worktree presenting the same digest stays pending until its own receipt exists');
  assert.equal(sibling.receipt, null);
});

test('a session bound to the proposal digest is approval evidence even when created before the gate page', (t) => {
  const main = makeFixtureTree('dash-bind-');
  t.after(() => fs.rmSync(main.root, { recursive: true, force: true }));
  const digest = 'sha256:' + 'd'.repeat(64);
  main.write('tmp/sdk-release-scout/go-v30-grouping-gate-manifest.json', {
    gate: 'APPROVE_GROUPING', digest, title: 'go 分组门', run: 'r',
  });
  // Created BEFORE the manifest's mtime (the legacy heuristic must miss),
  // but its groupingApproval binding names the gate's exact digest.
  main.write('tmp/sdk-release-scout/go-v30-session.json', {
    schemaVersion: 1, status: 'in_progress', language: 'go', track: 'v3.0.x',
    groupingApproval: {
      schemaVersion: 1, gate: 'APPROVE_GROUPING', proposalDigest: digest,
      approvalCommand: `APPROVE_GROUPING ${digest}`,
      language: 'go', sdkName: 'milvus', track: 'v3.0.x', releaseRange: 'r',
      lineage: { scopeDigest: 'sha256:' + 'e'.repeat(64) }, approvedAt: '2026-10-06T09:30:00.000Z',
    },
    reviewUnitManifest: { units: [] }, acceptedReviewUnits: [], pendingExecutions: [],
    artifacts: {}, createdAt: '2026-10-05T08:00:00.000Z', updatedAt: '2026-10-05T08:00:00.000Z',
  });

  const { buildLedger } = require('../../scripts/dashboard/ledger.js');
  const checkouts = [{ id: 'main', label: '主检出', root: main.root }];
  const ledger = buildLedger({ repoRoot: main.root, checkouts });
  assert.equal(ledger.campaigns[0].groupingApproval.proposalDigest, digest, 'campaign card carries the binding');
  assert.equal(ledger.intakes[0].approved, true);
  assert.equal(ledger.intakes[0].approvalEvidence, 'session-binding');
});
