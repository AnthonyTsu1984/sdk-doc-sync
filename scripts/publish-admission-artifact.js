#!/usr/bin/env node
'use strict';

// 6.11 admission artifact publication: assemble one self-describing release
// artifact from an admission results.json — the full gate record, the
// production input fingerprint, and the matching admitted-fingerprint ledger
// records — digest-stamped for out-of-tree preservation (release notes /
// tag annotation; committing it would change the very fingerprint it binds).

const fs = require('node:fs');
const path = require('node:path');

const { digestSemantic } = require('../.claude/skills/doc-ops-core/src/digest');
const { findAdmittedRecord, readAdmittedLedger } = require('../.claude/skills/doc-ops-core/src/admitted-fingerprint');

function buildAdmissionArtifact({ resultsPath, repoRoot, includeLedger = true }) {
  const resolved = path.resolve(resultsPath);
  if (!fs.existsSync(resolved)) {
    throw Object.assign(new Error(`admission results artifact does not exist: ${resolved}`), { code: 'ADMISSION_ARTIFACT_RESULTS_MISSING' });
  }
  const results = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (results.status !== 'ADMITTED') {
    throw Object.assign(new Error(`refusing to publish a non-ADMITTED admission artifact (status ${results.status}); blocked evidence is preserved beside the results file instead`), {
      code: 'ADMISSION_ARTIFACT_NOT_ADMITTED',
    });
  }
  const root = repoRoot || path.resolve(__dirname, '..');
  const productionInputFingerprint = results.productionInputFingerprint || null;
  if (productionInputFingerprint && typeof results.outputPath === 'string') {
    results.outputPath = path.relative(root, results.outputPath) || results.outputPath;
  }
  let ledgerRecords = [];
  if (includeLedger && productionInputFingerprint) {
    const record = findAdmittedRecord({ repoRoot: root, sourceFingerprint: productionInputFingerprint });
    if (record) {
      ledgerRecords = readAdmittedLedger(root).filter((entry) => entry.sourceFingerprint === productionInputFingerprint);
    }
  }
  const artifact = {
    schemaVersion: 1,
    kind: 'admission-artifact',
    artifactDigest: null,
    admission: results,
    productionInputFingerprint,
    admittedLedgerRecords: ledgerRecords,
  };
  const { artifactDigest: omitted, ...digestible } = artifact;
  artifact.artifactDigest = digestSemantic(digestible);
  return artifact;
}

function main(argv = process.argv) {
  const args = { results: null, output: null, repoRoot: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--results') args.results = path.resolve(argv[++index]);
    else if (arg === '--output') args.output = path.resolve(argv[++index]);
    else if (arg === '--repo-root') args.repoRoot = path.resolve(argv[++index]);
    else if (arg === '--no-ledger') args.includeLedger = false;
    else throw Object.assign(new Error(`ADMISSION_PUBLISH_ARGUMENT_UNKNOWN: ${arg}`), { code: 'ADMISSION_PUBLISH_ARGUMENT_UNKNOWN' });
  }
  if (!args.results) throw Object.assign(new Error('--results <results.json> is required'), { code: 'ADMISSION_PUBLISH_RESULTS_REQUIRED' });
  const artifact = buildAdmissionArtifact({ resultsPath: args.results, repoRoot: args.repoRoot, includeLedger: args.includeLedger !== false });
  const body = `${JSON.stringify(artifact, null, 2)}\n`;
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, body);
    process.stdout.write(`${JSON.stringify({ artifactDigest: artifact.artifactDigest, output: args.output, productionInputFingerprint: artifact.productionInputFingerprint })}\n`);
  } else {
    process.stdout.write(body);
  }
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.code || 'ADMISSION_PUBLISH_FAILED'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildAdmissionArtifact, main };
