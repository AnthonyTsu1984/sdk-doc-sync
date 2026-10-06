'use strict';
// Batch-8 multi-checkout awareness: sibling worktrees run campaigns of their
// own (each with its own tmp/ and scan-state), and the board must discover
// them without letting same-relative-path sessions collide across checkouts.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveStatusTarget } = require('../../scripts/dashboard/server.js');
const {
  attributeKeyFor,
  buildLedger,
  deriveRunningSessions,
  parseWorktreeList,
  resolveSessionTarget,
} = require('../../scripts/dashboard/ledger.js');

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

function sessionFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    sessionId: 'sdk-doc-sync:go:milvus-sdk-go:v3.0.x:sha256:1',
    language: 'go',
    sdkName: 'milvus-sdk-go',
    track: 'v3.0.x',
    acceptanceFlow: 'two-gate',
    status: 'in_progress',
    reviewUnitManifest: { units: [{ reviewUnitId: 'u1' }, { reviewUnitId: 'u2' }] },
    acceptedReviewUnits: [],
    pendingExecutions: [],
    activeExecution: null,
    activeRollback: null,
    rollbackReceipts: [],
    artifacts: {},
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T01:00:00.000Z',
    ...overrides,
  };
}

test('parseWorktreeList: main labeled, siblings by basename, bare skipped', () => {
  const main = '/Users/x/proj';
  const porcelain = [
    `worktree ${main}`,
    'HEAD aaa',
    'branch refs/heads/master',
    '',
    `worktree ${main}-go-scan`,
    'HEAD bbb',
    `branch refs/heads/feat/go`,
    '',
    'worktree /Users/x/proj.git',
    'bare',
    '',
  ].join('\n');
  const checkouts = parseWorktreeList(porcelain, main);
  assert.deepEqual(checkouts, [
    { id: 'main', label: '主检出', root: main },
    { id: 'proj-go-scan', label: 'proj-go-scan', root: `${main}-go-scan` },
  ]);
});

test('buildLedger discovers sibling-worktree campaigns with collision-free keys', (t) => {
  const main = makeFixtureTree('dash-co-main-');
  const sibling = makeFixtureTree('dash-co-sib-');
  t.after(() => {
    fs.rmSync(main.root, { recursive: true, force: true });
    fs.rmSync(sibling.root, { recursive: true, force: true });
  });
  // Same relative path in BOTH checkouts — must never collide.
  main.write('tmp/sdk-release-scout/go-v30-session.json', sessionFixture({ status: 'finalized', language: 'go' }));
  sibling.write('tmp/sdk-release-scout/go-v30-session.json', sessionFixture({ language: 'go' }));
  // Sibling scan-state differs (zombie detection is per-checkout).
  sibling.write('.claude/skills/api-reference-sync/scan-state.json', { 'go-v30': { lastScannedTag: 'v3.0.1' } });
  main.write('.claude/skills/api-reference-sync/config/release-tracks.json', {
    languages: { go: { sdkName: 'milvus-sdk-go', tracks: [{ version: 'v3.0.x' }] } },
  });

  const checkouts = [
    { id: 'main', label: '主检出', root: main.root },
    { id: 'sib', label: 'sib', root: sibling.root },
  ];
  const ledger = buildLedger({ repoRoot: main.root, checkouts, now: new Date('2026-10-05T12:00:00Z') });
  assert.equal(ledger.campaigns.length, 2);
  const keys = ledger.campaigns.map((c) => c.sessionKey);
  assert.deepEqual(keys.sort(), ['main::tmp/sdk-release-scout/go-v30-session.json', 'sib::tmp/sdk-release-scout/go-v30-session.json']);
  const sib = ledger.campaigns.find((c) => c.checkout === 'sib');
  assert.equal(sib.checkoutLabel, 'sib');
  assert.equal(sib.health, 'active');
  const mainCard = ledger.campaigns.find((c) => c.checkout === 'main');
  assert.equal(mainCard.health, 'finalized');
  // Track counting spans checkouts: one finalized + one active on go-v30.
  const go = ledger.skillTracks.languages.find((l) => l.name === 'go');
  assert.equal(go.tracks[0].campaigns.total, 2);
  assert.equal(go.tracks[0].campaigns.active, 1);
});

test('attribution: absolute sessionRef resolves inside its own checkout only', (t) => {
  const main = makeFixtureTree('dash-attr-main-');
  const sibling = makeFixtureTree('dash-attr-sib-');
  t.after(() => {
    fs.rmSync(main.root, { recursive: true, force: true });
    fs.rmSync(sibling.root, { recursive: true, force: true });
  });
  main.write('tmp/sdk-release-scout/s-session.json', sessionFixture());
  sibling.write('tmp/sdk-release-scout/s-session.json', sessionFixture());
  main.write('tmp/dashboard-events/events-2026-10-05.jsonl', [
    JSON.stringify({ v: 1, ts: '2026-10-05T11:00:00Z', kind: 'tool', sessionId: 'sessA', tool: 'Bash', sessionRef: `${sibling.root}/tmp/sdk-release-scout/s-session.json`, summary: 'work' }),
    JSON.stringify({ v: 1, ts: '2026-10-05T11:01:00Z', kind: 'tool', sessionId: 'sessB', tool: 'Edit', sessionRef: 'tmp/sdk-release-scout/s-session.json', summary: 'main work' }),
  ].join('\n') + '\n');

  const checkouts = [
    { id: 'main', label: '主检出', root: main.root },
    { id: 'sib', label: 'sib', root: sibling.root },
  ];
  const ledger = buildLedger({ repoRoot: main.root, checkouts, now: new Date('2026-10-05T12:00:00Z') });
  const sib = ledger.campaigns.find((c) => c.checkout === 'sib');
  const mainCard = ledger.campaigns.find((c) => c.checkout === 'main');
  assert.equal(sib.activityCount, 1, 'absolute ref into the sibling attributes to the sibling card');
  assert.equal(mainCard.activityCount, 1, 'relative ref defaults to main');

  // Unit-level helper.
  assert.equal(attributeKeyFor(`${sibling.root}/tmp/x-session.json`, checkouts), 'sib::tmp/x-session.json');
  assert.equal(attributeKeyFor('tmp/x-session.json', checkouts), 'main::tmp/x-session.json');
  assert.equal(attributeKeyFor('/elsewhere/tmp/x-session.json', checkouts), 'main::tmp/x-session.json');
  assert.equal(attributeKeyFor(null, checkouts), null);
});

test('deriveRunningSessions: window, checkout guess, campaign rollup', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  const mainRoot = '/repo';
  const sibRoot = '/repo-java-v30';
  const checkouts = [
    { id: 'main', label: '主检出', root: mainRoot },
    { id: 'repo-java-v30', label: 'repo-java-v30', root: sibRoot },
  ];
  const activity = [
    { ts: '2026-10-05T11:58:00Z', kind: 'tool', tool: 'Edit', sessionId: 'sessA', summary: `${sibRoot}/tmp/api-reference-sync/run-manifest-x.json`, campaign: null },
    { ts: '2026-10-05T11:59:00Z', kind: 'tool', tool: 'Bash', sessionId: 'sessA', summary: `cd ${mainRoot} && ls`, campaign: 'main::tmp/sdk-release-scout/s-session.json' },
    { ts: '2026-10-05T11:15:00Z', kind: 'tool', tool: 'Bash', sessionId: 'sessOld', summary: 'stale', campaign: null },
  ];
  const running = deriveRunningSessions(activity, checkouts, now);
  assert.equal(running.length, 1, '30-min window drops the stale session');
  const a = running[0];
  assert.equal(a.sessionId, 'sessA');
  assert.equal(a.checkout, 'repo-java-v30', 'checkout guessed from the worktree path in summaries');
  assert.equal(a.campaign, 'main::tmp/sdk-release-scout/s-session.json');
  assert.deepEqual(a.tools, ['Edit×1', 'Bash×1']);
});

test('resolveSessionTarget: keys, plain paths, unknown checkouts', () => {
  const checkouts = [
    { id: 'main', label: '主检出', root: '/repo' },
    { id: 'sib', label: 'sib', root: '/repo-sib' },
  ];
  assert.deepEqual(resolveSessionTarget('sib::tmp/sdk-release-scout/s-session.json', checkouts), { checkout: checkouts[1], relative: 'tmp/sdk-release-scout/s-session.json' });
  assert.deepEqual(resolveSessionTarget('tmp/sdk-release-scout/s-session.json', checkouts), { checkout: checkouts[0], relative: 'tmp/sdk-release-scout/s-session.json' });
  assert.equal(resolveSessionTarget('nope::x', checkouts).error, 'unknown checkout: nope');
  assert.equal(resolveSessionTarget('', checkouts).error, 'missing target');
});


// ---------- status-target resolution (worktree gate enrichment) ----------

test('resolveStatusTarget probes worktree cards inside their own checkout', () => {
  const checkouts = [
    { id: 'main', label: '主检出', root: '/repo' },
    { id: 'wt', label: 'wt', root: '/repo-wt' },
  ];
  // Same relative path in both checkouts — the card's checkout decides.
  const wtCard = { checkout: 'wt', sessionPath: 'tmp/sdk-release-scout/go-v30-session.json' };
  assert.deepEqual(resolveStatusTarget(wtCard, checkouts), {
    root: '/repo-wt',
    sessionPath: 'tmp/sdk-release-scout/go-v30-session.json',
  });
  const mainCard = { checkout: 'main', sessionPath: 'tmp/sdk-release-scout/go-v30-session.json' };
  assert.equal(resolveStatusTarget(mainCard, checkouts).root, '/repo');
  // Legacy cards without a checkout field default to main.
  const legacy = { sessionPath: 'tmp/x-session.json' };
  assert.equal(resolveStatusTarget(legacy, checkouts).root, '/repo');
});


// ---------- gate-presentation presence per checkout ----------

test('gate presentations detected in every checkout, absolute for worktrees', (t) => {
  const main = makeFixtureTree('dash-gp-main-');
  const sibling = makeFixtureTree('dash-gp-sib-');
  t.after(() => {
    fs.rmSync(main.root, { recursive: true, force: true });
    fs.rmSync(sibling.root, { recursive: true, force: true });
  });
  sibling.write('tmp/api-reference-sync/gate-presentation/latest.html', '<html></html>');

  const { buildLedger, readGatePresentations } = require('../../scripts/dashboard/ledger.js');
  const checkouts = [
    { id: 'main', label: '主检出', root: main.root },
    { id: 'sib', label: 'sib', root: sibling.root },
  ];
  const list = readGatePresentations(checkouts);
  const sib = list.find((g) => g.checkout === 'sib');
  assert.equal(sib.present, true);
  assert.equal(sib.path, `${sibling.root}/tmp/api-reference-sync/gate-presentation/latest.html`);
  assert.equal(list.find((g) => g.checkout === 'main').present, false);

  // Full ledger carries the list alongside the legacy main-only field.
  const ledger = buildLedger({ repoRoot: main.root, checkouts });
  assert.equal(ledger.gatePresentations.find((g) => g.checkout === 'sib').present, true);
  assert.equal(ledger.admission.gatePresentation.present, false);
});
