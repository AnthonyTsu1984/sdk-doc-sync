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
});
