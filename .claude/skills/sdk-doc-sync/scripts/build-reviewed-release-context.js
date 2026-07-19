#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateReleaseScope } = require('../src/sdk-doc-sync/release-scope/schema');

function parseArgs(argv = process.argv) {
  const args = {};
  const valueOptions = new Set(['--release-scope', '--candidate-spec', '--output-scope', '--output-context']);
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (!valueOptions.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    const key = arg.replace(/^--/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    args[key] = value;
    index += 1;
  }
  return args;
}

function usage() {
  return `Usage: build-reviewed-release-context --release-scope <file> --candidate-spec <file> --output-scope <file> --output-context <file>

Filters a release-scout artifact to reviewed user-facing candidates and builds
the --reference-context JSON required for schema-first dry-runs.
`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function required(value, message) {
  if (value === undefined || value === null || value === '') throw new Error(message);
  return value;
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function titleFor(action) {
  return action.symbol.includes('.') ? `${action.symbol}()` : `${action.symbol}()`;
}

function evidenceFor(action, spec, releaseScope) {
  const source = action.source || {};
  return [{
    kind: 'source',
    locator: `${source.file}:${source.line}`,
    revision: source.revision || releaseScope.targetCommit,
    confidence: spec.evidenceConfidence || 'reviewed',
  }];
}

function expandCandidateSpec(candidateSpec) {
  const candidates = {};
  for (const [canonicalSlug, spec] of Object.entries(candidateSpec.candidates || {})) {
    candidates[canonicalSlug] = { ...spec, canonicalSlug };
  }

  for (const group of candidateSpec.groups || []) {
    for (const canonicalSlug of group.canonicalSlugs || []) {
      candidates[canonicalSlug] = {
        ...group,
        ...(group.overrides?.[canonicalSlug] || {}),
        canonicalSlug,
      };
      delete candidates[canonicalSlug].canonicalSlugs;
      delete candidates[canonicalSlug].overrides;
    }
  }
  return candidates;
}

function defaultExceptions(action, spec, evidence) {
  if (spec.exceptions) return spec.exceptions.map((item) => ({ ...item, evidence: clone(item.evidence) || evidence }));
  return [{
    name: spec.exceptionName || 'MilvusException',
    condition: spec.exceptionCondition || 'Raised when the server rejects the request or the RPC fails.',
    description: spec.exceptionDescription || 'Inspect the server error message for the exact failure reason.',
    evidence,
  }];
}

function exampleFor(action, spec, evidence) {
  const examples = spec.examples || (spec.example ? [spec.example] : []);
  if (examples.length === 0) {
    throw new Error(`Candidate ${action.canonicalSlug} is missing a reviewed example`);
  }
  return examples.map((example) => ({
    title: example.title || `${action.symbol} example`,
    description: example.description || `Shows a typical ${action.symbol} call for the ${spec.version || 'target'} API.`,
    language: example.language || spec.language || 'python',
    code: required(example.code, `Candidate ${action.canonicalSlug} example is missing code`),
    evidence: clone(example.evidence) || evidence,
  }));
}

function buildReviewedReleaseContext({ releaseScope, candidateSpec }) {
  if (candidateSpec.language && candidateSpec.language !== releaseScope.language) {
    throw new Error(`Candidate spec language ${candidateSpec.language} does not match release scope language ${releaseScope.language}`);
  }
  if (candidateSpec.track && candidateSpec.track !== releaseScope.track) {
    throw new Error(`Candidate spec track ${candidateSpec.track} does not match release scope track ${releaseScope.track}`);
  }

  const candidates = expandCandidateSpec(candidateSpec);
  const configuredSlugs = Object.keys(candidates).sort();
  if (configuredSlugs.length === 0) {
    throw new Error('Candidate spec must configure at least one candidate');
  }
  const selected = [];
  const selectedSlugs = new Set();
  const contexts = {};
  const target = required(candidateSpec.target, 'Candidate spec is missing target');
  const version = required(target.version || releaseScope.track, 'Candidate spec target is missing version');
  const versionRootToken = required(target.versionRootToken, 'Candidate spec target is missing versionRootToken');
  const folders = required(target.folders, 'Candidate spec target is missing folders');

  for (const action of releaseScope.actions || []) {
    const spec = candidates[action.canonicalSlug];
    if (!spec) continue;
    selectedSlugs.add(action.canonicalSlug);

    const category = required(spec.category, `Candidate ${action.canonicalSlug} is missing category`);
    const folderToken = required(spec.folderToken || folders[category], `Candidate ${action.canonicalSlug} has no folder token for category ${category}`);
    const evidence = evidenceFor(action, spec, releaseScope);
    const selectedAction = {
      ...action,
      planningContext: {
        ...(action.planningContext || {}),
        target: {
          version,
          folderToken,
          versionRootToken,
          ancestryVerified: true,
        },
        tokenReferencedByOlderVersions: action.type === 'UPDATE',
      },
    };
    selected.push(selectedAction);
    contexts[action.stableId] = {
      repository: spec.repository || candidateSpec.repository || action.source?.repository || releaseScope.sdkName,
      revision: spec.revision || releaseScope.targetCommit,
      category,
      title: spec.title || titleFor(action),
      summary: required(spec.summary, `Candidate ${action.canonicalSlug} is missing summary`),
      reviewedEvidence: evidence,
      result: clone(spec.result),
      exceptions: defaultExceptions(action, spec, evidence),
      examples: exampleFor(action, { ...candidateSpec.defaults, ...spec, version }, evidence),
      notes: spec.notes || candidateSpec.notes || [`Reviewed for ${releaseScope.sdkName} ${releaseScope.releaseRange}.`],
    };
  }

  const missing = configuredSlugs.filter((canonicalSlug) => !selectedSlugs.has(canonicalSlug));
  if (missing.length > 0) {
    throw new Error(`Candidate spec includes ${missing.length} entries not present in release scope: ${missing.join(', ')}`);
  }
  if (selected.length === 0) {
    throw new Error('Candidate spec did not match any release-scope actions');
  }

  const filteredScope = {
    ...releaseScope,
    actions: selected,
    scannerDiagnostics: [
      ...(releaseScope.scannerDiagnostics || []).filter((item) => item.code !== 'FILTERED_USER_FACING_SCOPE'),
      {
        level: 'info',
        code: 'FILTERED_USER_FACING_SCOPE',
        message: `Filtered to ${selected.length} reviewed user-facing ${releaseScope.language} ${releaseScope.track} documentation candidates; configured scanner noise excluded.`,
      },
    ],
    writesPerformed: false,
    scanStateUpdated: false,
  };
  const validation = validateReleaseScope(filteredScope);
  if (!validation.valid) {
    throw new Error(`Filtered release scope is invalid: ${JSON.stringify(validation.errors)}`);
  }

  return {
    filteredScope,
    referenceContext: {
      schemaVersion: 1,
      releaseRange: releaseScope.releaseRange,
      targetTag: releaseScope.targetTag,
      contexts,
    },
    selectedCount: selected.length,
  };
}

function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  for (const name of ['releaseScope', 'candidateSpec', 'outputScope', 'outputContext']) {
    if (!args[name]) throw new Error(`Missing required --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }

  const result = buildReviewedReleaseContext({
    releaseScope: readJson(args.releaseScope),
    candidateSpec: readJson(args.candidateSpec),
  });
  writeJson(args.outputScope, result.filteredScope);
  writeJson(args.outputContext, result.referenceContext);
  console.log(JSON.stringify({
    selectedCount: result.selectedCount,
    outputScope: args.outputScope,
    outputContext: args.outputContext,
  }, null, 2));
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildReviewedReleaseContext,
  expandCandidateSpec,
  parseArgs,
};
