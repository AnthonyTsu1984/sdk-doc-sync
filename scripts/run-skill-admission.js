#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const CANONICAL_SKILLS = Object.freeze([
  'api-reference-sync',
  'localized-doc-sync',
  'procedure-code-sync',
  'verified-doc-authoring',
  'doc-code-verify',
]);

const DETERMINISTIC_COMMANDS = Object.freeze([
  { label: 'validate:skills', command: 'npm', args: ['run', 'validate:skills'] },
  { label: 'test:skills', command: 'npm', args: ['run', 'test:skills'] },
  { label: 'test:doc-ops-core', command: 'npm', args: ['run', 'test:doc-ops-core'] },
  { label: 'test:agent-team', command: 'npm', args: ['run', 'test:agent-team'] },
  { label: 'test:localized-doc-sync', command: 'npm', args: ['run', 'test:localized-doc-sync'] },
  { label: 'test:unit', command: 'npm', args: ['run', 'test:unit'] },
  { label: 'test:offline', command: 'npm', args: ['run', 'test:offline'] },
  { label: 'git diff --check', command: 'git', args: ['diff', '--check'] },
]);

const MODEL_EVAL_COMMANDS = Object.freeze([
  { label: 'eval:skills:routing', command: 'npm', args: ['run', 'eval:skills:routing'], outputName: 'routing.json' },
  { label: 'eval:skills:behavior', command: 'npm', args: ['run', 'eval:skills:behavior'], outputName: 'behavior.json' },
  { label: 'eval:skills:learning', command: 'npm', args: ['run', 'eval:skills:learning'], outputName: 'learning.json' },
]);

function safePhase(value) {
  const phase = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(phase)) {
    throw new Error('ADMISSION_PHASE_INVALID');
  }
  return phase;
}

function adapterInventory({ repoRoot = REPO_ROOT } = {}) {
  const inventory = [];
  for (const skill of CANONICAL_SKILLS) {
    const manifestPath = path.join(repoRoot, '.claude', 'skills', skill, 'capabilities.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const operation of manifest?.adapterPolicy?.operations || []) {
      inventory.push({
        skill,
        operation: operation.operation,
        status: operation.status,
        productionEntrypoint: operation.productionEntrypoint || null,
        focusedTest: operation.focusedTest || null,
      });
    }
  }
  return inventory;
}

function assertNoPlannedAdapters(options = {}) {
  const inventory = adapterInventory(options);
  const planned = inventory.filter(item => item.status === 'planned');
  if (planned.length > 0) {
    const summary = planned.map(item => `${item.skill}:${item.operation}`).join(', ');
    throw new Error(`PLANNED_ADAPTER_NOT_ADMITTED: ${summary}`);
  }
  return inventory;
}

function defaultRunCommand(entry, { repoRoot, env }) {
  return spawnSync(entry.command, entry.args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });
}

function writeResult(outputPath, result) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}

function collectAdmissionInputFiles(repoRoot) {
  const files = [];
  const addPath = (relativePath) => {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(absolutePath)) return;
    const stat = fs.statSync(absolutePath);
    if (stat.isFile()) {
      files.push(relativePath);
      return;
    }
    for (const name of fs.readdirSync(absolutePath).sort()) {
      addPath(path.join(relativePath, name));
    }
  };
  for (const relativePath of [
    '.claude/skills',
    '.claude/agent-team',
    'evals/skills',
    'tests/skills',
    '.github/workflows/skill-admission.yml',
    'scripts/validate-skills.js',
    'package.json',
    'package-lock.json',
  ]) addPath(relativePath);
  const scriptsRoot = path.join(repoRoot, 'scripts');
  if (fs.existsSync(scriptsRoot)) {
    for (const name of fs.readdirSync(scriptsRoot).sort()) {
      if (name.startsWith('run-skill-') && name.endsWith('.js')) addPath(path.join('scripts', name));
    }
  }
  return [...new Set(files)].sort();
}

function admissionSourceFingerprint({ repoRoot = REPO_ROOT } = {}) {
  const hash = crypto.createHash('sha256');
  for (const relativePath of collectAdmissionInputFiles(repoRoot)) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(repoRoot, relativePath)));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function admissionEntries(rolloutRoot) {
  return [
    ...DETERMINISTIC_COMMANDS.map(definition => ({ stage: 'deterministic', definition })),
    ...MODEL_EVAL_COMMANDS.map(definition => ({ stage: 'model-eval', definition })),
  ].map(({ stage, definition }) => {
    const entry = { ...definition, args: [...definition.args] };
    if (definition.outputName) {
      entry.args.push('--', '--output', path.join(rolloutRoot, definition.outputName));
    }
    return { stage, entry };
  });
}

function matchingResultRecord(record, planned) {
  return record?.stage === planned.stage
    && record?.label === planned.entry.label
    && JSON.stringify(record?.command) === JSON.stringify([planned.entry.command, ...planned.entry.args]);
}

function runAdmission({
  repoRoot = REPO_ROOT,
  phase,
  outputPath = null,
  resume = false,
  env = process.env,
  now = () => new Date().toISOString(),
  runCommand = defaultRunCommand,
} = {}) {
  const normalizedPhase = safePhase(phase);
  const rolloutRoot = path.join(repoRoot, 'tmp', 'skill-feedback-rollout', normalizedPhase);
  const resultPath = outputPath || path.join(rolloutRoot, 'results.json');
  const sourceFingerprint = admissionSourceFingerprint({ repoRoot });
  const result = {
    schemaVersion: 1,
    phase: normalizedPhase,
    generatedAt: now(),
    sourceFingerprint,
    status: 'BLOCKED',
    liveExecutionPerformed: false,
    adapterInventory: [],
    results: [],
    blocker: null,
    outputPath: resultPath,
  };

  const plannedEntries = admissionEntries(rolloutRoot);
  let startIndex = 0;
  if (resume) {
    if (!fs.existsSync(resultPath)) {
      result.blocker = 'ADMISSION_RESUME_EVIDENCE_MISSING';
      writeResult(resultPath, result);
      return result;
    }
    const previous = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    if (previous.phase !== normalizedPhase || previous.sourceFingerprint !== sourceFingerprint) {
      result.blocker = 'ADMISSION_RESUME_SOURCE_CHANGED';
      writeResult(resultPath, result);
      return result;
    }
    result.generatedAt = previous.generatedAt;
    result.resumedAt = now();
    for (let index = 0; index < previous.results.length && index < plannedEntries.length; index += 1) {
      const record = previous.results[index];
      if (!matchingResultRecord(record, plannedEntries[index])) {
        result.blocker = `ADMISSION_RESUME_EVIDENCE_INVALID: ${record?.label || index}`;
        writeResult(resultPath, result);
        return result;
      }
      if (!record.passed) break;
      result.results.push(record);
      startIndex = index + 1;
    }
  }

  try {
    result.adapterInventory = assertNoPlannedAdapters({ repoRoot });
  } catch (error) {
    result.blocker = error.message;
    writeResult(resultPath, result);
    return result;
  }

  for (let index = startIndex; index < plannedEntries.length; index += 1) {
    const { stage, entry } = plannedEntries[index];
    const startedAt = Date.now();
    const execution = runCommand(entry, { repoRoot, env });
    if (execution.stdout) process.stdout.write(execution.stdout);
    if (execution.stderr) process.stderr.write(execution.stderr);
    const record = {
      stage,
      label: entry.label,
      command: [entry.command, ...entry.args],
      exitCode: Number.isInteger(execution.status) ? execution.status : null,
      signal: execution.signal || null,
      durationMs: Date.now() - startedAt,
      passed: execution.status === 0,
    };
    result.results.push(record);
    writeResult(resultPath, result);
    if (!record.passed) {
      result.blocker = `ADMISSION_COMMAND_FAILED: ${entry.label}`;
      writeResult(resultPath, result);
      return result;
    }
  }

  result.status = 'ADMITTED';
  result.blocker = null;
  result.completedAt = now();
  writeResult(resultPath, result);
  return result;
}

function parseArgs(argv) {
  const options = { phase: null, outputPath: null, resume: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--phase') options.phase = argv[++index];
    else if (arg === '--output') options.outputPath = path.resolve(argv[++index]);
    else if (arg === '--resume') options.resume = true;
    else if (arg === '--help') options.help = true;
    else throw new Error(`ADMISSION_ARGUMENT_UNKNOWN: ${arg}`);
  }
  if (!options.help && !options.phase) throw new Error('ADMISSION_PHASE_REQUIRED');
  return options;
}

function printHelp() {
  process.stdout.write('Usage: npm run admit:skills -- --phase <phase> [--output <results.json>] [--resume]\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  const result = runAdmission({ phase: options.phase, outputPath: options.outputPath, resume: options.resume });
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    phase: result.phase,
    outputPath: result.outputPath,
    blocker: result.blocker,
  }, null, 2)}\n`);
  if (result.status !== 'ADMITTED') process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CANONICAL_SKILLS,
  DETERMINISTIC_COMMANDS,
  MODEL_EVAL_COMMANDS,
  admissionSourceFingerprint,
  adapterInventory,
  assertNoPlannedAdapters,
  parseArgs,
  runAdmission,
};
