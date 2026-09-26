'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TOOLCHAIN_MANIFEST_PATH = path.join(__dirname, 'toolchain-manifest.json');

function loadToolchainManifest(manifestPath = TOOLCHAIN_MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function defaultProbe(command, args) {
  const execution = spawnSync(command, args, { encoding: 'utf8', timeout: 30000 });
  if (execution.error) return { ok: false, output: '', detail: execution.error.message };
  return {
    ok: execution.status === 0,
    output: `${execution.stdout || ''}\n${execution.stderr || ''}`.trim(),
  };
}

function parseMajorVersion(output) {
  const match = String(output || '').match(/(\d+)\.\d+/);
  return match ? Number(match[1]) : null;
}

function checkTool(entry, probe) {
  let lastObserved = null;
  for (const probeSpec of entry.probes || []) {
    const attempt = probe(probeSpec.command, probeSpec.args || []);
    lastObserved = attempt.output || attempt.detail || null;
    if (!attempt.ok) continue;
    if (entry.minMajor == null) {
      return { id: entry.id, ok: true, observed: lastObserved };
    }
    const major = parseMajorVersion(lastObserved);
    if (major != null && major >= entry.minMajor) {
      return { id: entry.id, ok: true, observed: lastObserved };
    }
    return {
      id: entry.id,
      ok: false,
      status: 'TOOLCHAIN_VERSION_TOO_LOW',
      requiredMinMajor: entry.minMajor,
      hint: entry.hint || null,
      observed: lastObserved,
    };
  }
  return {
    id: entry.id,
    ok: false,
    status: 'TOOLCHAIN_MISSING',
    hint: entry.hint || null,
    observed: lastObserved,
  };
}

function runToolchainPreflight({ manifest, probe = defaultProbe } = {}) {
  if (!manifest || !Array.isArray(manifest.tools)) {
    return {
      ok: false,
      checks: [],
      failures: [{ id: 'toolchain-manifest', ok: false, status: 'TOOLCHAIN_MANIFEST_INVALID', hint: TOOLCHAIN_MANIFEST_PATH, observed: null }],
    };
  }
  const checks = manifest.tools.map(entry => checkTool(entry, probe));
  const failures = checks.filter(check => !check.ok);
  return { ok: failures.length === 0, checks, failures };
}

module.exports = {
  TOOLCHAIN_MANIFEST_PATH,
  defaultProbe,
  loadToolchainManifest,
  parseMajorVersion,
  runToolchainPreflight,
};
