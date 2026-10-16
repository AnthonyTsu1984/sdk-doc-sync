'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  CAMPAIGN_RUN_PLAN_INVALID,
  PHASE_EXIT_NONZERO,
  PHASE_OUTCOME_UNREADABLE,
  SETTLE_FAILED,
  runCampaignPlan,
  validateCampaignRunPlan,
} = require('../src/sdk-doc-sync/campaign-runner');
const { buildNotifier } = require('../bin/campaign-run');
const { disposedWatermark, readLedger, recordFinding } = require('../src/sdk-doc-sync/findings-ledger');

const SKILL_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SKILL_ROOT, '..', '..', '..');
const CLI = path.join(SKILL_ROOT, 'bin', 'campaign-run.js');

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-run-'));
  return {
    dir,
    ledger: path.join(dir, 'pr-findings.jsonl'),
    freezeDir: path.join(dir, 'freezes'),
  };
}

function basePlan(ws, phases) {
  return {
    schemaVersion: 1,
    prNumber: 1181,
    language: 'python',
    campaignPlanDigest: `sha256:${'a'.repeat(64)}`,
    journalPath: 'tmp/execution-journal.jsonl',
    ledgerPath: ws.ledger,
    freezeDir: ws.freezeDir,
    phases,
  };
}

test('campaign run plan validation is fail-closed on shape', () => {
  assert.equal(validateCampaignRunPlan(null).valid, false);
  assert.equal(validateCampaignRunPlan({ schemaVersion: 1, prNumber: 0, phases: [] }).valid, false);
  const bad = validateCampaignRunPlan({ schemaVersion: 2, prNumber: 1, phases: [{ label: 'x', argv: 'node' }] });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some((error) => error.code === CAMPAIGN_RUN_PLAN_INVALID));
  const ok = validateCampaignRunPlan({ schemaVersion: 1, prNumber: 1181, phases: [{ label: 'execute', argv: ['node', '-e', '0'] }] });
  assert.deepEqual(ok, { valid: true, errors: [] });
});

test('all phases succeeding disposes the PR on the findings ledger (W-I)', async () => {
  const ws = workspace();
  recordFinding(ws.ledger, { prNumber: 1181, languages: ['python'] });
  const ran = [];
  const result = await runCampaignPlan({
    plan: basePlan(ws, [
      { label: 'execute', argv: ['node', '-e', '0'] },
      { label: 'close-session', argv: ['node', '-e', '0'] },
    ]),
    runPhase: async ({ label }) => { ran.push(label); return { exitCode: 0 }; },
    frozenAt: '2026-10-16T00:00:00.000Z',
  });
  assert.deepEqual(ran, ['execute', 'close-session']);
  assert.equal(result.status, 'disposed');
  assert.equal(result.exitCode, 0);
  assert.equal(disposedWatermark(readLedger(ws.ledger), 'python'), 1181);
});

test('a phase failure freezes the campaign, persists a record, and reports the doorbell (W-H)', async () => {
  const ws = workspace();
  const notices = [];
  const result = await runCampaignPlan({
    plan: basePlan(ws, [
      { label: 'execute', argv: ['node', '-e', '0'] },
      { label: 'close-session', argv: ['node', '-e', '1'] },
    ]),
    runPhase: async ({ label }) => ({ exitCode: label === 'close-session' ? 1 : 0 }),
    notify: async (payload) => notices.push(payload),
    frozenAt: '2026-10-16T00:00:00.000Z',
  });
  assert.equal(result.status, 'frozen');
  assert.equal(result.exitCode, 1);
  assert.match(result.failure.reason, /close-session/);
  assert.equal(result.failure.location.code, PHASE_EXIT_NONZERO);
  assert.match(result.settled.freezePath, /\.json$/);
  assert.ok(fs.existsSync(result.settled.freezePath));
  assert.equal(result.settled.noticeDelivered, true);
  assert.equal(notices[0].code, 'CAMPAIGN_FROZEN');
  // The failing phase stopped the campaign; the later phases never ran.
  assert.deepEqual(result.phases.map((phase) => phase.label), ['execute', 'close-session']);
  // No success → the watermark never moved.
  assert.equal(disposedWatermark(readLedger(ws.ledger), 'python'), 0);
});

test('a phase outcome artifact carries the located failure into the freeze record', async () => {
  const ws = workspace();
  const outcomeFile = path.join(ws.dir, 'exec-result.json');
  fs.writeFileSync(outcomeFile, JSON.stringify({
    status: 'PARTIAL',
    failedStep: 'patchDocument',
    diagnostics: [{ code: 'TARGET_LINK_MISSING', actionId: 'a1', message: 'target link absent' }],
  }));
  const result = await runCampaignPlan({
    plan: basePlan(ws, [{ label: 'execute', argv: ['node', '-e', '0'], outcomeFile }]),
    runPhase: async () => ({ exitCode: 0 }),
    frozenAt: '2026-10-16T00:00:00.000Z',
  });
  assert.equal(result.status, 'frozen');
  // PARTIAL mutated live state → the reason names the ruling's failure class.
  assert.match(result.failure.reason, /PARTIAL_FAILURE/);
  assert.equal(result.failure.location.code, 'TARGET_LINK_MISSING');
  const record = JSON.parse(fs.readFileSync(result.settled.freezePath, 'utf8'));
  assert.equal(record.code, 'CAMPAIGN_FROZEN');
  assert.equal(record.location.code, 'TARGET_LINK_MISSING');
  assert.equal(record.journalPath, 'tmp/execution-journal.jsonl');
});

test('a declared-but-unreadable outcome artifact fails closed', async () => {
  const ws = workspace();
  const result = await runCampaignPlan({
    plan: basePlan(ws, [{ label: 'execute', argv: ['node', '-e', '0'], outcomeFile: path.join(ws.dir, 'missing.json') }]),
    runPhase: async () => ({ exitCode: 0 }),
    frozenAt: '2026-10-16T00:00:00.000Z',
  });
  assert.equal(result.status, 'frozen');
  assert.equal(result.failure.location.code, PHASE_OUTCOME_UNREADABLE);
  assert.match(result.failure.reason, /unreadable/);
});

test('a success without a ledger path is undisposed (a caller bug, not a success)', async () => {
  const result = await runCampaignPlan({
    plan: { schemaVersion: 1, prNumber: 1181, phases: [{ label: 'execute', argv: ['node', '-e', '0'] }] },
    runPhase: async () => ({ exitCode: 0 }),
  });
  assert.equal(result.status, 'undisposed');
  assert.equal(result.exitCode, 2);
  assert.equal(result.settled.code, 'SETTLE_LEDGER_REQUIRED');
});

test('a malformed plan throws rather than half-running the campaign', async () => {
  await assert.rejects(
    () => runCampaignPlan({ plan: { schemaVersion: 1, prNumber: 1 }, runPhase: async () => ({ exitCode: 0 }) }),
    (error) => error.code === CAMPAIGN_RUN_PLAN_INVALID,
  );
});

test('the CLI disposes on a clean run and freezes on a failing phase', () => {
  const ws = workspace();
  recordFinding(ws.ledger, { prNumber: 1181, languages: ['python'] });
  const planPath = path.join(ws.dir, 'plan.json');

  // Clean run: two no-op phases → disposed.
  fs.writeFileSync(planPath, JSON.stringify(basePlan(ws, [
    { label: 'execute', argv: ['node', '-e', 'process.exit(0)'] },
    { label: 'close-session', argv: ['node', '-e', 'process.exit(0)'] },
  ])));
  const okRun = spawnSync(process.execPath, [CLI, '--plan', planPath, '--json'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(okRun.status, 0, okRun.stderr);
  const okResult = JSON.parse(okRun.stdout);
  assert.equal(okResult.status, 'disposed');
  assert.equal(disposedWatermark(readLedger(ws.ledger), 'python'), 1181);

  // Failing run: the second phase exits nonzero → frozen, freeze file on disk.
  fs.writeFileSync(planPath, JSON.stringify(basePlan(ws, [
    { label: 'execute', argv: ['node', '-e', 'process.exit(0)'] },
    { label: 'close-session', argv: ['node', '-e', 'process.exit(3)'] },
  ])));
  const frozenRun = spawnSync(process.execPath, [CLI, '--plan', planPath, '--json'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(frozenRun.status, 1, frozenRun.stderr);
  const frozenResult = JSON.parse(frozenRun.stdout);
  assert.equal(frozenResult.status, 'frozen');
  assert.equal(frozenResult.failure.location.exitCode, 3);
  assert.ok(fs.existsSync(frozenResult.settled.freezePath));
  assert.equal(frozenResult.settled.noticeDelivered, false, 'no notifier in a test run → undelivered, reported not hidden');
});

test('the CLI refuses a usage error with code 64', () => {
  const run = spawnSync(process.execPath, [CLI], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(run.status, 64);
  assert.match(run.stderr, /--plan is required/);
});

test('--json keeps stdout a single JSON document (child output goes to stderr)', () => {
  const ws = workspace();
  recordFinding(ws.ledger, { prNumber: 1181, languages: ['python'] });
  const planPath = path.join(ws.dir, 'plan.json');
  fs.writeFileSync(planPath, JSON.stringify(basePlan(ws, [
    { label: 'execute', argv: ['node', '-e', 'console.log("CHILD_NOISE")'] },
  ])));
  const run = spawnSync(process.execPath, [CLI, '--plan', planPath, '--json'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const parsed = JSON.parse(run.stdout); // throws if a child polluted stdout
  assert.equal(parsed.status, 'disposed');
  assert.match(run.stderr, /CHILD_NOISE/);
});

test('--dry-run --json prints the phase list without running it', () => {
  const ws = workspace();
  const planPath = path.join(ws.dir, 'plan.json');
  const marker = path.join(ws.dir, 'ran.txt');
  fs.writeFileSync(planPath, JSON.stringify(basePlan(ws, [
    { label: 'execute', argv: ['node', '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x')`] },
  ])));
  const run = spawnSync(process.execPath, [CLI, '--plan', planPath, '--dry-run', '--json'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.status, 'dry-run');
  assert.deepEqual(parsed.phases.map((phase) => phase.label), ['execute']);
  assert.equal(fs.existsSync(marker), false, 'a dry run must not execute the phase');
});

test('a success whose dispose is refused freezes instead of lying about W-H', async () => {
  const ws = workspace();
  // The PR is NOT on the ledger → markFinding throws MARK_TARGET_NOT_FOUND.
  const result = await runCampaignPlan({
    plan: basePlan(ws, [{ label: 'execute', argv: ['node', '-e', '0'] }]),
    runPhase: async () => ({ exitCode: 0 }),
    frozenAt: '2026-10-16T00:00:00.000Z',
  });
  assert.equal(result.status, 'frozen');
  assert.equal(result.exitCode, 1);
  assert.equal(result.failure.location.code, SETTLE_FAILED);
  assert.equal(result.failure.location.settleCode, 'MARK_TARGET_NOT_FOUND');
  assert.match(result.failure.reason, /MARK_TARGET_NOT_FOUND/);
  // The freeze is durable — not a bare exit code claiming one happened.
  assert.ok(fs.existsSync(result.settled.freezePath));
});

test('an EXECUTED outcome artifact passes the phase through and disposes', async () => {
  const ws = workspace();
  recordFinding(ws.ledger, { prNumber: 1181, languages: ['python'] });
  const outcomeFile = path.join(ws.dir, 'exec-result.json');
  fs.writeFileSync(outcomeFile, JSON.stringify({ status: 'EXECUTED', evidence: { mutatedLiveState: true } }));
  const result = await runCampaignPlan({
    plan: basePlan(ws, [{ label: 'execute', argv: ['node', '-e', '0'], outcomeFile }]),
    runPhase: async () => ({ exitCode: 0 }),
    frozenAt: '2026-10-16T00:00:00.000Z',
  });
  assert.equal(result.status, 'disposed');
  assert.equal(disposedWatermark(readLedger(ws.ledger), 'python'), 1181);
});

test('a nonzero exit alongside an EXECUTED artifact still freezes, naming the exit code', async () => {
  const ws = workspace();
  const outcomeFile = path.join(ws.dir, 'exec-result.json');
  fs.writeFileSync(outcomeFile, JSON.stringify({ status: 'EXECUTED' }));
  const result = await runCampaignPlan({
    plan: basePlan(ws, [{ label: 'execute', argv: ['node', '-e', '0'], outcomeFile }]),
    runPhase: async () => ({ exitCode: 7 }),
    frozenAt: '2026-10-16T00:00:00.000Z',
  });
  assert.equal(result.status, 'frozen');
  assert.match(result.failure.reason, /exited with code 7/);
  assert.equal(result.failure.location.exitCode, 7);
});

test('a located failure without a step keeps the phase label', async () => {
  const ws = workspace();
  const outcomeFile = path.join(ws.dir, 'exec-result.json');
  // BLOCKED + a diagnostic with no failedStep → locateFailure returns step:null.
  fs.writeFileSync(outcomeFile, JSON.stringify({ status: 'BLOCKED', diagnostics: [{ code: 'SOME_REFUSAL' }] }));
  const result = await runCampaignPlan({
    plan: basePlan(ws, [{ label: 'execute', argv: ['node', '-e', '0'], outcomeFile }]),
    runPhase: async () => ({ exitCode: 1 }),
    frozenAt: '2026-10-16T00:00:00.000Z',
  });
  assert.equal(result.status, 'frozen');
  assert.equal(result.failure.location.step, 'execute');
});

test('a malformed plan is refused by --dry-run too (a preflight never green-lights garbage)', () => {
  const ws = workspace();
  const planPath = path.join(ws.dir, 'plan.json');
  fs.writeFileSync(planPath, JSON.stringify({ schemaVersion: 1, prNumber: 1181, phases: 'garbage' }));
  const run = spawnSync(process.execPath, [CLI, '--plan', planPath, '--dry-run'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(run.status, 64);
  assert.match(run.stderr, /CAMPAIGN_RUN_PLAN_INVALID/);
});

test('an unknown notify kind is refused before any phase runs', () => {
  assert.throws(() => buildNotifier({ kind: 'carrier-pigeon' }, REPO_ROOT), (error) => error.code === CAMPAIGN_RUN_PLAN_INVALID);
  const ws = workspace();
  const planPath = path.join(ws.dir, 'plan.json');
  const marker = path.join(ws.dir, 'ran.txt');
  fs.writeFileSync(planPath, JSON.stringify({
    ...basePlan(ws, [{ label: 'execute', argv: ['node', '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x')`] }]),
    notify: { kind: 'carrier-pigeon' },
  }));
  const run = spawnSync(process.execPath, [CLI, '--plan', planPath], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(run.status, 64);
  assert.equal(fs.existsSync(marker), false, 'the notify kind is validated before phases run');
});
