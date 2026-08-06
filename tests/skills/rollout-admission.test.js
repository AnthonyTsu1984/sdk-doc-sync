'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CANONICAL_SKILLS,
  DETERMINISTIC_COMMANDS,
  MODEL_EVAL_COMMANDS,
  assertNoPlannedAdapters,
  parseArgs,
  runAdmission,
} = require('../../scripts/run-skill-admission');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function writeManifests(root, statusBySkill = {}) {
  for (const skill of CANONICAL_SKILLS) {
    const directory = path.join(root, '.claude', 'skills', skill);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'capabilities.json'), `${JSON.stringify({
      adapterPolicy: {
        operations: [{ operation: `${skill}-operation`, status: statusBySkill[skill] || 'adopted' }],
      },
    })}\n`);
  }
}

test('rollout admission names every required deterministic and model-eval gate without live commands', () => {
  assert.deepEqual(DETERMINISTIC_COMMANDS.map(item => item.label), [
    'validate:skills',
    'test:skills',
    'test:doc-ops-core',
    'test:agent-team',
    'test:localized-doc-sync',
    'test:unit',
    'test:offline',
    'git diff --check',
  ]);
  assert.deepEqual(MODEL_EVAL_COMMANDS.map(item => item.label), [
    'eval:skills:routing',
    'eval:skills:behavior',
    'eval:skills:learning',
  ]);
  const allArgs = [...DETERMINISTIC_COMMANDS, ...MODEL_EVAL_COMMANDS]
    .flatMap(item => [item.command, ...item.args])
    .join(' ');
  assert.doesNotMatch(allArgs, /smoke:live|doc-agent:live-write|--allow-run/);
});

test('rollout admission rejects any remaining planned canonical adapter', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-admission-planned-'));
  writeManifests(root, { 'localized-doc-sync': 'planned' });
  assert.throws(
    () => assertNoPlannedAdapters({ repoRoot: root }),
    /PLANNED_ADAPTER_NOT_ADMITTED: localized-doc-sync:localized-doc-sync-operation/,
  );
});

test('model evaluations never run after a deterministic admission failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-admission-fail-'));
  writeManifests(root);
  const calls = [];
  const result = runAdmission({
    repoRoot: root,
    phase: 'test-failure',
    now: () => '2026-08-06T00:00:00.000Z',
    runCommand: (entry) => {
      calls.push(entry.label);
      return { status: entry.label === 'test:skills' ? 1 : 0, signal: null };
    },
  });

  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(calls, ['validate:skills', 'test:skills']);
  assert.equal(result.results.some(item => item.stage === 'model-eval'), false);
  assert.equal(fs.existsSync(result.outputPath), true);
});

test('successful admission records every gate in stage order', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-admission-pass-'));
  writeManifests(root);
  const calls = [];
  const result = runAdmission({
    repoRoot: root,
    phase: 'test-pass',
    now: () => '2026-08-06T00:00:00.000Z',
    runCommand: (entry) => {
      calls.push(entry.label);
      return { status: 0, signal: null };
    },
  });

  assert.equal(result.status, 'ADMITTED');
  assert.deepEqual(calls, [
    ...DETERMINISTIC_COMMANDS.map(item => item.label),
    ...MODEL_EVAL_COMMANDS.map(item => item.label),
  ]);
  assert.deepEqual(result.results.map(item => item.stage), [
    ...DETERMINISTIC_COMMANDS.map(() => 'deterministic'),
    ...MODEL_EVAL_COMMANDS.map(() => 'model-eval'),
  ]);
});

test('resume validates and preserves the passed prefix, then reruns from the first failed gate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-admission-resume-'));
  writeManifests(root);
  const firstCalls = [];
  const first = runAdmission({
    repoRoot: root,
    phase: 'resume-pass',
    now: () => '2026-08-06T00:00:00.000Z',
    runCommand: (entry) => {
      firstCalls.push(entry.label);
      return { status: entry.label === 'test:doc-ops-core' ? 1 : 0, signal: null };
    },
  });
  assert.equal(first.status, 'BLOCKED');
  assert.deepEqual(firstCalls, ['validate:skills', 'test:skills', 'test:doc-ops-core']);

  const resumedCalls = [];
  const resumed = runAdmission({
    repoRoot: root,
    phase: 'resume-pass',
    resume: true,
    now: () => '2026-08-06T01:00:00.000Z',
    runCommand: (entry) => {
      resumedCalls.push(entry.label);
      return { status: 0, signal: null };
    },
  });

  assert.equal(resumed.status, 'ADMITTED');
  assert.deepEqual(resumedCalls, [
    'test:doc-ops-core',
    'test:agent-team',
    'test:localized-doc-sync',
    'test:unit',
    'test:offline',
    'git diff --check',
    'eval:skills:routing',
    'eval:skills:behavior',
    'eval:skills:learning',
  ]);
  assert.deepEqual(resumed.results.slice(0, 2).map(item => item.label), ['validate:skills', 'test:skills']);
  assert.equal(resumed.results.every(item => item.passed), true);
});

test('CLI accepts an explicit resume flag only with a phase', () => {
  assert.deepEqual(parseArgs(['--phase', 'hardening', '--resume']), {
    phase: 'hardening',
    outputPath: null,
    resume: true,
  });
  assert.throws(() => parseArgs(['--resume']), /ADMISSION_PHASE_REQUIRED/);
});

test('CI publishes ignored admission evidence and contains no automatic live smoke', () => {
  const workflow = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'skill-admission.yml'), 'utf8');
  assert.match(workflow, /npm run admit:skills/);
  assert.match(workflow, /tmp\/skill-feedback-rollout/);
  assert.match(workflow, /SKILL_EVAL_API_KEY/);
  assert.doesNotMatch(workflow, /smoke:live|doc-agent:live-write|--allow-run/);
});
