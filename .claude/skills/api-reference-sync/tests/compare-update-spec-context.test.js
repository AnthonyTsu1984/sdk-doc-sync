'use strict';

// P0-1 UPDATE fidelity assertion (2026-10-21): the compare-update-spec-context
// CLI proves every UPDATE unit's reviewed-context entry is byte-faithful to
// its candidate-spec source bytes — the mechanical replacement for the
// model reviewer's "compare summary/result verbatim against the PR page" step.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  compareUpdateSpecContext,
  stripEvidence,
  stripResultEnrichment,
} = require('../scripts/compare-update-spec-context');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'compare-update-spec-context.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function makeSpec() {
  return {
    language: 'python',
    track: 'v3.0.x',
    candidates: {
      'Authentication-create_role': {
        docIdentity: { category: 'Authentication', stableId: 'python:Authentication:create_role', canonicalSlug: 'Authentication-create_role', symbol: 'create_role' },
        reviewedActionType: 'UPDATE',
        summary: 'This operation creates a role for role-based access control.',
        summaryCallouts: [],
        signature: 'create_role(role_name: str) -> None',
        params: [{ name: 'role_name', type: 'str', description: 'The role name to create.', required: true }],
        requestVariants: [],
        result: { type: 'None', description: 'This operation returns no value.' },
        exceptions: [
          { name: 'MilvusException', condition: 'Raised when any error occurs.', description: 'Raised when any error occurs.' },
        ],
        examples: [
          { title: 'create_role example', description: '', audience: 'shared', language: 'python', code: 'client.create_role(role_name="analytics_reader")' },
        ],
      },
      'Collections-describe_collection': {
        docIdentity: { category: 'Collections', stableId: 'python:Collections:describe_collection', canonicalSlug: 'Collections-describe_collection', symbol: 'describe_collection' },
        reviewedActionType: 'UPDATE',
        summary: 'This operation describes a collection.',
        summaryCallouts: [],
        signature: 'describe_collection(collection_name: str) -> dict',
        params: [{ name: 'collection_name', type: 'str', description: 'The name of the collection.', required: true }],
        requestVariants: [],
        result: {
          type: 'dict',
          description: 'A dictionary that contains detailed information about the specified collection.',
          fields: [{ name: 'collection_name', type: 'str', required: false, audience: 'shared', description: 'The collection name.' }],
        },
        exceptions: [],
        examples: [
          { title: 'describe_collection example', description: '', audience: 'shared', language: 'python', code: 'client.describe_collection("test")' },
        ],
      },
      'Authentication-create_user': {
        docIdentity: { category: 'Authentication', stableId: 'python:Authentication:create_user', canonicalSlug: 'Authentication-create_user', symbol: 'create_user' },
        reviewedActionType: 'CREATE', // model-writing surface — NOT asserted
        summary: 'This operation creates a user.',
        summaryCallouts: [],
        signature: 'create_user(user_name: str, password: str) -> None',
        params: [],
        requestVariants: [],
        result: { type: 'None', description: 'This operation returns no value.' },
        exceptions: [],
        examples: [],
      },
    },
  };
}

// The same-round reviewed-context the intake chain (build-reviewed-release-context)
// emits: content bytes copied from candidate-spec, mechanical enrichment added
// (evidence[] on exceptions/examples, fields kept, schemaCode on result).
function makeContext(spec) {
  const contexts = {};
  for (const [candidateKey, candidate] of Object.entries(spec.candidates)) {
    const stableId = candidate.docIdentity.stableId;
    // Deep-clone content bytes so the context is an independent copy (a shared
    // reference would alias test mutations to both sides of the comparison).
    const clone = (value) => (value === null || typeof value !== 'object' ? value
      : Array.isArray(value) ? value.map(clone)
      : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)])));
    contexts[stableId] = {
      repository: 'milvus-sdk-python',
      revision: 'abc1234',
      category: candidate.docIdentity.category,
      symbolName: candidate.docIdentity.symbol,
      kind: 'method',
      title: `${candidate.docIdentity.symbol}()`,
      summary: candidate.summary,
      summaryCallouts: clone(candidate.summaryCallouts),
      signature: candidate.signature,
      params: clone(candidate.params),
      requestVariants: clone(candidate.requestVariants),
      reviewedEvidence: [{ kind: 'pr', locator: `API_Reference/pymilvus/v3.0.x/MilvusClient/${candidateKey}.md`, confidence: 'direct' }],
      result: { ...clone(candidate.result), schemaCode: `{'collection_name': 'test'}` },
      exceptions: candidate.exceptions.map((item) => ({ ...clone(item), evidence: [{ kind: 'pr', confidence: 'direct' }] })),
      examples: candidate.examples.map((item) => ({ ...clone(item), evidence: [{ kind: 'pr', confidence: 'direct' }] })),
      reviewedActionType: candidate.reviewedActionType,
      current: undefined,
      target: { version: 'v3.0.x' },
    };
  }
  return { schemaVersion: 1, releaseRange: 'v2.6.x..v3.0.x', targetTag: 'v3.0.1', resources: [], contexts };
}

test('faithful same-round context passes byte-faithful assertion for UPDATE units', () => {
  const spec = makeSpec();
  const ctx = makeContext(spec);
  const result = compareUpdateSpecContext({ candidateSpec: spec, reviewedContext: ctx });
  assert.equal(result.ok, true);
  assert.deepEqual(result.units.sort(), ['python:Authentication:create_role', 'python:Collections:describe_collection']);
  assert.equal(result.drift.length, 0);
  // The CREATE unit is not asserted (model-writing surface).
  assert.ok(!result.units.includes('python:Authentication:create_user'));
});

test('mechanical enrichment (evidence/schemaCode) does not trip the assertion', () => {
  const spec = makeSpec();
  const ctx = makeContext(spec);
  // evidence arrays differ from candidate-spec (CLI derives them) — must not drift.
  ctx.contexts['python:Authentication:create_role'].exceptions[0].evidence = [{ kind: 'source', locator: 'milvus_client/milvus_client.py:1793', confidence: 'direct' }];
  ctx.contexts['python:Collections:describe_collection'].result.schemaCode = `{'collection_name': 'DIFFERENT'}`;
  const result = compareUpdateSpecContext({ candidateSpec: spec, reviewedContext: ctx });
  assert.equal(result.ok, true);
});

test('a corrupted UPDATE summary is caught as drift', () => {
  const spec = makeSpec();
  const ctx = makeContext(spec);
  ctx.contexts['python:Authentication:create_role'].summary = 'This operation creates a **CollectionSchema** object.';
  const result = compareUpdateSpecContext({ candidateSpec: spec, reviewedContext: ctx });
  assert.equal(result.ok, false);
  assert.equal(result.drift.length, 1);
  assert.equal(result.drift[0].stableId, 'python:Authentication:create_role');
  assert.equal(result.drift[0].field, 'summary');
});

test('content drift inside result.fields is caught', () => {
  const spec = makeSpec();
  const ctx = makeContext(spec);
  ctx.contexts['python:Collections:describe_collection'].result.fields[0].description = 'A DIFFERENT description.';
  const result = compareUpdateSpecContext({ candidateSpec: spec, reviewedContext: ctx });
  assert.equal(result.ok, false);
  assert.equal(result.drift[0].field, 'result');
});

test('missing reviewed-context entry is a fail-closed drift', () => {
  const spec = makeSpec();
  const ctx = makeContext(spec);
  delete ctx.contexts['python:Collections:describe_collection'];
  const result = compareUpdateSpecContext({ candidateSpec: spec, reviewedContext: ctx });
  assert.equal(result.ok, false);
  assert.ok(result.drift.some((item) => item.field === '__entry__' && item.stableId === 'python:Collections:describe_collection'));
});

test('non-UPDATE actionIntent candidates are skipped', () => {
  const spec = makeSpec();
  spec.candidates['Authentication-create_user'].reviewedActionType = 'BACKFILL';
  const ctx = makeContext(spec);
  const result = compareUpdateSpecContext({ candidateSpec: spec, reviewedContext: ctx });
  assert.equal(result.ok, true);
  assert.deepEqual(result.units, ['python:Authentication:create_role', 'python:Collections:describe_collection']);
});

test('stripEvidence removes only the evidence key, preserving content', () => {
  const stripped = stripEvidence({ name: 'MilvusException', condition: 'Raised.', evidence: [{ kind: 'pr' }] });
  assert.deepEqual(stripped, { name: 'MilvusException', condition: 'Raised.' });
  const array = stripEvidence([{ code: 'x', evidence: [] }, { code: 'y' }]);
  assert.deepEqual(array, [{ code: 'x' }, { code: 'y' }]);
});

test('stripResultEnrichment removes schemaCode, preserving type/description/fields', () => {
  const stripped = stripResultEnrichment({ type: 'dict', description: 'd', fields: [{ name: 'a' }], schemaCode: 'x' });
  assert.deepEqual(stripped, { type: 'dict', description: 'd', fields: [{ name: 'a' }] });
});

test('CLI exits 0 on faithful artifacts and 1 on drift', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-update-spec-context-'));
  const specPath = path.join(temp, 'spec.json');
  const okPath = path.join(temp, 'ok.json');
  const driftPath = path.join(temp, 'drift.json');
  const spec = makeSpec();
  fs.writeFileSync(specPath, JSON.stringify(spec));
  fs.writeFileSync(okPath, JSON.stringify(makeContext(spec)));

  const run = (ctxFile) => spawnSync(process.execPath, [SCRIPT, '--candidate-spec', specPath, '--reviewed-context', ctxFile], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

  const ok = run(okPath);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /OK: 2 UPDATE units byte-faithful/);

  const driftCtx = makeContext(spec);
  driftCtx.contexts['python:Authentication:create_role'].summary = 'corrupted';
  const driftPath2 = path.join(temp, 'drift.json');
  fs.writeFileSync(driftPath2, JSON.stringify(driftCtx));
  const failed = run(driftPath2);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /DRIFT: 1 UPDATE content field/);

  // --json emits a machine-readable report
  const jsonRun = spawnSync(process.execPath, [SCRIPT, '--candidate-spec', specPath, '--reviewed-context', driftPath2, '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(jsonRun.status, 1);
  const report = JSON.parse(jsonRun.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.driftCount, 1);
  assert.equal(report.drift[0].field, 'summary');
});
