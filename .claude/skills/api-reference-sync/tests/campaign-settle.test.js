'use strict';

// campaign-settle CLI tests (batch 16 slice 3, design §6/§9). Mirrors the
// campaign-run.test.js branches: ok+pr → disposed, ok+tag → ledger untouched,
// frozen → freeze + doorbell, settle-throws → SETTLE_FAILED freeze, usage →
// 64. All offline: every plan artifact points into a mkdtemp workspace and the
// doorbell is an injected collector.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  CAMPAIGN_SETTLE_USAGE,
  CampaignSettleError,
  parseReason,
  runCli,
} = require('../scripts/campaign-settle');
const { CAMPAIGN_PLAN_INVALID, validateCampaignPlan } = require('../src/sdk-doc-sync/campaign-plan');
const { CAMPAIGN_RUN_PLAN_INVALID } = require('../src/sdk-doc-sync/campaign-runner');
const { disposedWatermark, readLedger, recordFinding } = require('../src/sdk-doc-sync/findings-ledger');

const SKILL_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SKILL_ROOT, '..', '..', '..');
const CLI = path.join(SKILL_ROOT, 'scripts', 'campaign-settle.js');

const DIGEST = `sha256:${'a'.repeat(64)}`;

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-settle-'));
  return {
    dir,
    ledger: path.join(dir, 'pr-findings.jsonl'),
    freezeDir: path.join(dir, 'freezes'),
    journal: path.join(dir, 'execution-journal.jsonl'),
  };
}

// A full legal v2 campaign plan (campaign-plan.js schema, design §3) with every
// run artifact inside the workspace so tests stay offline and disposable.
function fixturePlan(ws, overrides = {}) {
  return {
    schemaVersion: 2,
    campaignId: 'java-v30-sync',
    kind: 'release-sync',
    campaignPlanDigest: DIGEST,
    template: { path: '.claude/skills/api-reference-sync/workflows/release-sync-campaign.dwf.ts', sha256: DIGEST },
    identity: { language: 'java', sdkName: 'milvus-sdk-java', track: 'v3.0.x' },
    trigger: { kind: 'pr', prNumber: 1181 },
    feishu: { host: 'feishu.example', baseToken: 'baseTokenFixture', tableId: 'tableIdFixture', rootToken: 'rootTokenFixture' },
    paths: {
      sdkDir: 'repos/milvus-sdk-java',
      campaignDir: 'tmp/api-reference-sync/campaigns/java-v30-sync',
      sessionPath: 'tmp/api-reference-sync/campaigns/java-v30-sync/session.json',
      scopePath: 'tmp/api-reference-sync/campaigns/java-v30-sync/scope.json',
      groupingPath: 'tmp/api-reference-sync/campaigns/java-v30-sync/grouping.json',
      candidateSpecPath: 'tmp/api-reference-sync/campaigns/java-v30-sync/candidate-spec.json',
      referenceContext: 'tmp/api-reference-sync/campaigns/java-v30-sync/reviewed-context',
      targetsJson: 'tmp/api-reference-sync/campaigns/java-v30-sync/targets.json',
      identityMap: 'tmp/api-reference-sync/campaigns/java-v30-sync/identity.json',
    },
    run: {
      journalPath: ws.journal,
      ledgerPath: ws.ledger,
      freezeDir: ws.freezeDir,
      note: 'batch 16 slice 3 fixture',
      phases: [{ label: 'close-session', argv: ['node', '-e', '0'] }],
    },
    terminal: { scanStateKey: 'java:v3.0.x', scanStateEntryPath: 'tmp/api-reference-sync/scan-state/java-v30.json' },
    batch: { defaultSize: 3, cap: 40, firstBatchK1: false },
    crossTrack: { peerTag: 'v2.6.x-latest' },
    seats: { a1: { pagesPerWriter: 12, maxRounds: 3 }, a2: {}, a3: {} },
    ...overrides,
  };
}

function writePlan(ws, plan, name = 'plan.json') {
  const planPath = path.join(ws.dir, name);
  fs.writeFileSync(planPath, JSON.stringify(plan));
  return planPath;
}

function spawnCli(argv) {
  return spawnSync(process.execPath, [CLI, ...argv], { cwd: REPO_ROOT, encoding: 'utf8' });
}

test('the fixture plan is legal v2 and the v1 shell plan is refused by campaign-plan validation', () => {
  const ws = workspace();
  assert.deepEqual(validateCampaignPlan(fixturePlan(ws)), { valid: true, errors: [] });
  const shell = { schemaVersion: 1, prNumber: 1181, phases: [{ label: 'execute', argv: ['node', '-e', '0'] }] };
  const rejected = validateCampaignPlan(shell);
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.some((error) => error.code === CAMPAIGN_PLAN_INVALID));
});

test('an ok settle with a pr trigger disposes the PR on the findings ledger (W-I)', () => {
  const ws = workspace();
  recordFinding(ws.ledger, { prNumber: 1181, languages: ['java'] });
  const planPath = writePlan(ws, fixturePlan(ws));
  const run = spawnCli(['--plan', planPath, '--outcome', 'ok', '--json']);
  assert.equal(run.status, 0, run.stderr);
  const parsed = JSON.parse(run.stdout); // throws if anything polluted stdout
  assert.equal(parsed.status, 'disposed');
  assert.equal(parsed.exitCode, 0);
  assert.equal(parsed.settled.prNumber, 1181);
  assert.equal(disposedWatermark(readLedger(ws.ledger), 'java'), 1181);
});

test('a relative --plan resolves against --repo-root', () => {
  const ws = workspace();
  recordFinding(ws.ledger, { prNumber: 1181, languages: ['java'] });
  writePlan(ws, fixturePlan(ws));
  const run = spawnCli(['--plan', 'plan.json', '--repo-root', ws.dir, '--outcome', 'ok', '--json']);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).status, 'disposed');
  assert.equal(disposedWatermark(readLedger(ws.ledger), 'java'), 1181);
});

test('an ok settle with a tag trigger skips the findings ledger (the two watermarks stay separate)', () => {
  const ws = workspace();
  const planPath = writePlan(ws, fixturePlan(ws, { trigger: { kind: 'tag', baselineTag: 'v2.6.25', targetTag: 'v3.0.25' } }));
  const run = spawnCli(['--plan', planPath, '--outcome', 'ok', '--json']);
  assert.equal(run.status, 0, run.stderr);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.status, 'skipped');
  assert.equal(parsed.exitCode, 0);
  assert.match(parsed.detail, /close-session/);
  assert.equal(fs.existsSync(ws.ledger), false, 'a tag settle must not write the findings ledger');
});

test('a frozen settle persists a freeze record and delivers the doorbell (W-H)', async () => {
  const ws = workspace();
  const planPath = writePlan(ws, fixturePlan(ws));
  const notices = [];
  const reason = { code: 'VERIFY_EXHAUSTED', message: 'writer output failed verification 3 times', step: 'execute' };
  const result = await runCli({
    argv: [process.execPath, CLI, '--plan', planPath, '--outcome', 'frozen', '--reason', JSON.stringify(reason)],
    dependencies: {
      onStdout: () => {},
      notify: async (payload) => notices.push(payload),
      frozenAt: '2026-10-16T00:00:00.000Z',
    },
  });
  assert.equal(result.status, 'frozen');
  assert.equal(result.exitCode, 1);
  // The reason string prefers the human message; the reason object rides whole
  // as the location.
  assert.equal(result.failure.reason, 'writer output failed verification 3 times');
  assert.equal(result.failure.location.code, 'VERIFY_EXHAUSTED');
  assert.equal(result.settled.noticeDelivered, true);
  assert.equal(notices[0].code, 'CAMPAIGN_FROZEN');
  // The freeze is durable and carries the plan's journal pointer + digest.
  assert.ok(fs.existsSync(result.settled.freezePath));
  const record = JSON.parse(fs.readFileSync(result.settled.freezePath, 'utf8'));
  assert.equal(record.code, 'CAMPAIGN_FROZEN');
  assert.equal(record.location.code, 'VERIFY_EXHAUSTED');
  assert.equal(record.journalPath, ws.journal);
  assert.equal(record.campaignPlanDigest, DIGEST);
  assert.equal(record.frozenAt, '2026-10-16T00:00:00.000Z');
});

test('a frozen settle through the CLI reads --reason from a file and reports the undelivered doorbell', () => {
  const ws = workspace();
  const planPath = writePlan(ws, fixturePlan(ws));
  const reasonPath = path.join(ws.dir, 'reason.json');
  fs.writeFileSync(reasonPath, JSON.stringify({ code: 'PHASE_EXIT_NONZERO', step: 'close-session', exitCode: 3 }));
  const run = spawnCli(['--plan', planPath, '--outcome', 'frozen', '--reason', reasonPath, '--json']);
  assert.equal(run.status, 1, run.stderr);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.status, 'frozen');
  assert.equal(parsed.failure.reason, 'PHASE_EXIT_NONZERO', 'no message field → the code is the reason');
  assert.equal(parsed.failure.location.exitCode, 3);
  assert.ok(fs.existsSync(parsed.settled.freezePath));
  assert.equal(parsed.settled.noticeDelivered, false, 'no notifier in a CLI run → undelivered, reported not hidden');
  assert.match(parsed.settled.noticeReason, /no notifier/);
});

test('a settle that throws freezes as SETTLE_FAILED instead of escaping bare (MARK_TARGET_NOT_FOUND)', () => {
  const ws = workspace();
  // The PR is NOT on the findings ledger → markFinding refuses the dispose.
  const planPath = writePlan(ws, fixturePlan(ws));
  const run = spawnCli(['--plan', planPath, '--outcome', 'ok', '--json']);
  assert.equal(run.status, 1, run.stderr);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.status, 'frozen');
  assert.equal(parsed.exitCode, 1);
  assert.equal(parsed.failure.location.code, 'SETTLE_FAILED');
  assert.equal(parsed.failure.location.settleCode, 'MARK_TARGET_NOT_FOUND');
  assert.match(parsed.failure.reason, /MARK_TARGET_NOT_FOUND/);
  // The freeze is durable — not a bare exit code claiming W-H ran.
  const record = JSON.parse(fs.readFileSync(parsed.settled.freezePath, 'utf8'));
  assert.equal(record.code, 'CAMPAIGN_FROZEN');
  assert.equal(record.location.code, 'SETTLE_FAILED');
  assert.equal(record.location.settleCode, 'MARK_TARGET_NOT_FOUND');
  assert.equal(record.journalPath, ws.journal);
  // And the ledger was never moved: nothing disposed.
  assert.equal(disposedWatermark(readLedger(ws.ledger), 'java'), 0);
});

test('usage errors exit 64 before anything settles', () => {
  const ws = workspace();
  const planPath = writePlan(ws, fixturePlan(ws));
  const garbagePlan = path.join(ws.dir, 'garbage-plan.json');
  fs.writeFileSync(garbagePlan, 'not json at all');
  const badReasonFile = path.join(ws.dir, 'bad-reason.json');
  fs.writeFileSync(badReasonFile, '{oops');
  const cases = [
    { argv: [], stderr: /--plan is required/ },
    { argv: ['--plan', planPath], stderr: /--outcome is required/ },
    { argv: ['--plan', planPath, '--outcome', 'reopened'], stderr: /--outcome is required/ },
    { argv: ['--plan', planPath, '--outcome', 'ok', '--bogus'], stderr: /unknown argument/ },
    { argv: ['--plan', path.join(ws.dir, 'missing.json'), '--outcome', 'ok'], stderr: /plan not found/ },
    { argv: ['--plan', garbagePlan, '--outcome', 'ok'], stderr: /plan is not valid JSON/ },
    { argv: ['--plan', planPath, '--outcome', 'frozen'], stderr: /--reason is required/ },
    { argv: ['--plan', planPath, '--outcome', 'frozen', '--reason', '17'], stderr: /--reason must be a JSON object/ },
    { argv: ['--plan', planPath, '--outcome', 'frozen', '--reason', path.join(ws.dir, 'nope.json')], stderr: /neither inline JSON nor a readable file/ },
    { argv: ['--plan', planPath, '--outcome', 'frozen', '--reason', badReasonFile], stderr: /--reason file is not valid JSON/ },
  ];
  for (const item of cases) {
    const run = spawnCli(item.argv);
    assert.equal(run.status, 64, `${JSON.stringify(item.argv)} → ${run.stderr}`);
    assert.match(run.stderr, item.stderr);
  }
});

test('a v1 shell plan is refused by campaign-plan validation with exit 64', () => {
  const ws = workspace();
  const planPath = writePlan(ws, { schemaVersion: 1, prNumber: 1181, phases: [{ label: 'execute', argv: ['node', '-e', '0'] }] }, 'v1-plan.json');
  const run = spawnCli(['--plan', planPath, '--outcome', 'ok']);
  assert.equal(run.status, 64, run.stderr);
  assert.match(run.stderr, /CAMPAIGN_PLAN_INVALID/);
  assert.match(run.stderr, /schemaVersion/);
});

test('--help prints usage and exits 0', () => {
  const run = spawnCli(['--help']);
  assert.equal(run.status, 0);
  assert.match(run.stdout, /Usage: campaign-settle/);
});

test('an unknown notify kind is refused before anything settles', async () => {
  const ws = workspace();
  const planPath = writePlan(ws, { ...fixturePlan(ws), notify: { kind: 'carrier-pigeon' } });
  const calls = [];
  await assert.rejects(
    () => runCli({
      argv: [process.execPath, CLI, '--plan', planPath, '--outcome', 'ok'],
      dependencies: { settle: async (input) => calls.push(input) },
    }),
    (error) => error.code === CAMPAIGN_RUN_PLAN_INVALID,
  );
  assert.equal(calls.length, 0, 'the doorbell kind is validated before the settle runs');
});

// --- runCli unit branches with injected dependencies (campaign-run style) ---

test('runCli passes exactly the v2 plan fields to settleCampaign (injected settle)', async () => {
  const ws = workspace();
  recordFinding(ws.ledger, { prNumber: 1181, languages: ['java'] });
  const planPath = writePlan(ws, fixturePlan(ws));
  const calls = [];
  const result = await runCli({
    argv: [process.execPath, CLI, '--plan', planPath, '--outcome', 'ok'],
    dependencies: {
      onStdout: () => {},
      settle: async (input) => { calls.push(input); return { status: 'disposed', created: true, prNumber: input.prNumber, language: input.language }; },
      frozenAt: '2026-10-16T00:00:00.000Z',
    },
  });
  assert.equal(result.status, 'disposed');
  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    outcome: { ok: true },
    prNumber: 1181,
    language: 'java',
    ledgerPath: ws.ledger,
    campaignPlanDigest: DIGEST,
    note: 'batch 16 slice 3 fixture',
    frozenAt: '2026-10-16T00:00:00.000Z',
  });
  // The injected settle decided — the real ledger was not touched.
  assert.equal(disposedWatermark(readLedger(ws.ledger), 'java'), 0);
});

test('runCli reports an undisposed success honestly with exit 2 (a caller bug)', async () => {
  const ws = workspace();
  const planPath = writePlan(ws, fixturePlan(ws));
  const result = await runCli({
    argv: [process.execPath, CLI, '--plan', planPath, '--outcome', 'ok'],
    dependencies: {
      onStdout: () => {},
      settle: async () => ({ status: 'undisposed', code: 'SETTLE_LEDGER_REQUIRED', reason: 'a successful campaign needs the findings ledger path' }),
    },
  });
  assert.equal(result.status, 'undisposed');
  assert.equal(result.exitCode, 2);
  assert.equal(result.settled.code, 'SETTLE_LEDGER_REQUIRED');
});

test('a tag-trigger ok settle never calls settle (injected settle stays cold)', async () => {
  const ws = workspace();
  const planPath = writePlan(ws, fixturePlan(ws, { trigger: { kind: 'tag', baselineTag: 'v2.6.25', targetTag: 'v3.0.25' } }));
  const calls = [];
  const lines = [];
  const result = await runCli({
    argv: [process.execPath, CLI, '--plan', planPath, '--outcome', 'ok'],
    dependencies: {
      settle: async (input) => { calls.push(input); return { status: 'disposed' }; },
      onStdout: (line) => lines.push(line),
    },
  });
  assert.equal(result.status, 'skipped');
  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 0, 'a tag settle has no findings-ledger watermark to advance');
  assert.match(lines.join('\n'), /close-session/);
});

test('the frozen reason prefers message, then code, then the plain verdict', async () => {
  const ws = workspace();
  const planPath = writePlan(ws, fixturePlan(ws));
  const outcomes = [];
  const settle = async (input) => { outcomes.push(input.outcome); return { status: 'frozen', code: 'CAMPAIGN_FROZEN', freezePath: null, noticeDelivered: false, noticeReason: 'no notifier configured' }; };
  const frozenWith = async (reason) => runCli({
    argv: [process.execPath, CLI, '--plan', planPath, '--outcome', 'frozen', '--reason', JSON.stringify(reason)],
    dependencies: { onStdout: () => {}, settle },
  });

  await frozenWith({ code: 'X', message: 'boom', step: 'execute' });
  await frozenWith({ code: 'X', step: 'execute' });
  await frozenWith({ note: 'neither message nor code' });

  assert.deepEqual(outcomes.map((outcome) => outcome.reason), ['boom', 'X', 'campaign frozen']);
  assert.equal(outcomes[0].location.code, 'X');
  assert.equal(outcomes[0].frozen, true);
});

test('parseReason is typed on every refusal', () => {
  assert.throws(() => parseReason('17'), (error) => error instanceof CampaignSettleError && error.code === CAMPAIGN_SETTLE_USAGE);
  assert.throws(() => parseReason('null'), (error) => error.code === CAMPAIGN_SETTLE_USAGE);
  assert.throws(() => parseReason('[1,2]'), (error) => error.code === CAMPAIGN_SETTLE_USAGE);
  assert.throws(() => parseReason('definitely/not/a/file'), (error) => error.code === CAMPAIGN_SETTLE_USAGE);
  assert.deepEqual(parseReason('{"code":"X"}'), { code: 'X' });
});
