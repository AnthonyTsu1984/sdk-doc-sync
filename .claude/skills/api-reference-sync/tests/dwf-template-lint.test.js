'use strict';

// Batch 16 slice 5 closeout (design §9 dwf-template-lint): existence-level
// assertions on the canonical release-sync dwf template
// (.claude/skills/api-reference-sync/workflows/release-sync-campaign.dwf.ts).
//
// Honest scope (design §11.3): this is grep-grade STRUCTURAL lint, not a
// behavior test — the template's runtime behavior is only provable at
// engine-compile time (CreateWorkflow confirm diagnostics) plus ≥2 shadow
// campaigns. What lint CAN pin, so copy-drift can never silently return:
//   - the file exists on its tracked path and is substantial;
//   - the campaign-settle terminal call surface for BOTH outcomes (ok/frozen);
//   - the APPROVE_CAMPAIGN gate is bound and the retired APPROVE_DOCUMENT
//     gate never resurrects (2026-10-16 ruling: batch gates are deleted);
//   - every world.run args array ends with the NONCE tail (anti cache-replay
//     discipline — the seven-pit inheritance);
//   - no import/export/declare statements (engine: pure function body);
//   - frontmatter args are exactly {planPath, nonce, batchSize} (design §4).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TEMPLATE = path.resolve(__dirname, '..', 'workflows', 'release-sync-campaign.dwf.ts');
const REVISION_TEMPLATE = path.resolve(__dirname, '..', 'workflows', 'revision-campaign.dwf.ts');
const source = fs.readFileSync(TEMPLATE, 'utf8');
const lines = source.split('\n');
const revisionSource = fs.readFileSync(REVISION_TEMPLATE, 'utf8');
const revisionLines = revisionSource.split('\n');

// Slice 7 (2026-10-19 ruling (b)): the revision shape is parameterized by its
// own canonical template under the same engine contract. The structural
// assertions run against BOTH templates; the settle-ok terminal differs
// (revision units end executed, not finalized, so the ok settle is the same
// call — the difference is the intake face).
for (const [name, text] of [['release-sync', source], ['revision', revisionSource]]) {
  test(`[${name}] template exists on its tracked path and is substantial`, () => {
    assert.ok(text.length > 0, `${name} template empty`);
    assert.ok(text.split('\n').length > 500, `${name} template must be >500 lines, got ${text.split('\n').length}`);
  });
  test(`[${name}] carries the campaign-settle terminal call surface for BOTH outcomes`, () => {
    assert.ok((text.match(/campaign-settle/g) || []).length >= 2, `${name}: campaign-settle must appear at least twice`);
    assert.ok(text.includes('"--outcome", "ok"'), `${name}: --outcome ok settle missing`);
    assert.ok(text.includes('"--outcome", "frozen"'), `${name}: --outcome frozen settle missing`);
  });
  test(`[${name}] binds APPROVE_CAMPAIGN; the retired APPROVE_DOCUMENT never resurrects`, () => {
    assert.ok(text.includes('APPROVE_CAMPAIGN'), `${name}: APPROVE_CAMPAIGN binding missing`);
    assert.equal((text.match(/APPROVE_DOCUMENT/g) || []).length, 0, `${name}: APPROVE_DOCUMENT is retired and must not appear`);
  });
  test(`[${name}] every world.run args array ends with the NONCE tail`, () => {
    const calls = (text.match(/world\.run\("node", \[/g) || []).length;
    const nonceTails = (text.match(/, NONCE\], \{/g) || []).length;
    assert.ok(calls > 0, `${name}: no world.run calls`);
    assert.equal(nonceTails, calls, `${name}: ${calls} calls vs ${nonceTails} nonce tails`);
  });
  test(`[${name}] no import/export/declare statements`, () => {
    const offenders = text.split('\n')
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /^\s*(import\s|export\s|declare\s)/.test(line))
      .map(({ line, index }) => `line ${index + 1}: ${line.trim().slice(0, 80)}`);
    assert.deepEqual(offenders, []);
  });
  test(`[${name}] frontmatter args are exactly {planPath, nonce, batchSize${name === 'release-sync' ? ', rehearsal' : ''}}`, () => {
    const fmEnd = text.indexOf('*/');
    assert.ok(fmEnd > 0, `${name}: frontmatter terminator missing`);
    const frontmatter = text.slice(0, fmEnd);
    const argsStart = frontmatter.indexOf('\nargs:\n');
    assert.ok(argsStart > 0, `${name}: args block missing`);
    const argsBlock = frontmatter.slice(argsStart);
    const keys = [...argsBlock.matchAll(/^  ([A-Za-z]+):$/gm)].map((match) => match[1]).sort();
    const expectedKeys = name === 'release-sync' ? ['batchSize', 'nonce', 'planPath', 'rehearsal'] : ['batchSize', 'nonce', 'planPath'];
    assert.deepEqual(keys, expectedKeys);
    assert.ok(/planPath:\n    type: string\n    description:[^\n]*\n    required: true\n/.test(argsBlock), `${name}: planPath required`);
    assert.ok(/nonce:\n    type: string\n    description:[^\n]*\n    required: true\n/.test(argsBlock), `${name}: nonce required`);
    if (name === 'release-sync') {
      assert.ok(/rehearsal:\n    type: boolean\n    description:[^\n]*\n    required: false\n/.test(argsBlock), `${name}: rehearsal optional boolean`);
    }
  });
}

test('the canonical release-sync template exists on its tracked path and is substantial', () => {
  assert.ok(fs.existsSync(TEMPLATE), `template missing at ${TEMPLATE} — generation and engine runs fail closed without it`);
  assert.ok(lines.length > 500, `template must be >500 lines (a stub or a truncated copy is a red flag), got ${lines.length}`);
});

test('carries the campaign-settle terminal call surface for BOTH outcomes (ok and frozen)', () => {
  const settleHits = source.match(/campaign-settle/g) || [];
  assert.ok(settleHits.length >= 2, `campaign-settle must appear at least twice (ok + frozen anomaly path), got ${settleHits.length}`);
  assert.ok(source.includes('"--outcome", "ok"'), 'the --outcome ok settle call is missing (PR→disposed watermark never advances)');
  assert.ok(source.includes('"--outcome", "frozen"'), 'the --outcome frozen settle call is missing (fail-closed branches would have nowhere to go)');
});

test('binds the APPROVE_CAMPAIGN gate; the retired APPROVE_DOCUMENT gate never resurrects', () => {
  assert.ok(source.includes('APPROVE_CAMPAIGN'), 'the merged APPROVE_CAMPAIGN gate binding is missing');
  const retired = source.match(/APPROVE_DOCUMENT/g) || [];
  assert.equal(retired.length, 0, `APPROVE_DOCUMENT is retired (2026-10-16 ruling) and must not appear, found ${retired.length}`);
});

test('every world.run args array ends with the NONCE tail (anti cache-replay discipline)', () => {
  // Grep-grade and shape-tied by design: in this template every live call is
  // `world.run("node", [..., NONCE], { timeoutMs … })`, so the call count and
  // the `, NONCE], {` tail count must be EQUAL. A new world.run without the
  // nonce tail (or a hand edit that drops one) breaks the equality.
  const calls = (source.match(/world\.run\("node", \[/g) || []).length;
  const nonceTails = (source.match(/, NONCE\], \{/g) || []).length;
  assert.ok(calls > 0, 'no world.run calls found — the template cannot drive the world');
  assert.equal(nonceTails, calls, `every world.run args array must end with NONCE: ${calls} calls vs ${nonceTails} nonce tails`);
});

test('no import/export/declare statements (engine contract: pure function body)', () => {
  const offenders = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s*(import\s|export\s|declare\s)/.test(line))
    .map(({ line, index }) => `line ${index + 1}: ${line.trim().slice(0, 80)}`);
  assert.deepEqual(offenders, []);
});

test('frontmatter args are exactly {planPath, nonce, batchSize, rehearsal}', () => {
  const fmEnd = source.indexOf('*/');
  assert.ok(fmEnd > 0, 'frontmatter terminator missing');
  const frontmatter = source.slice(0, fmEnd);
  const argsStart = frontmatter.indexOf('\nargs:\n');
  assert.ok(argsStart > 0, 'frontmatter args block missing');
  const argsBlock = frontmatter.slice(argsStart);
  // Keys are the 2-space-indented `key:` lines of the args block (the 4-space
  // property lines all carry values, so they cannot match this shape).
  const keys = [...argsBlock.matchAll(/^  ([A-Za-z]+):$/gm)].map((match) => match[1]).sort();
  assert.deepEqual(keys, ['batchSize', 'nonce', 'planPath', 'rehearsal']);
  // The two identity args must be required: a missing planPath/nonce is the
  // WORKFLOW_ARGS_LOST hard failure, never a guessed default.
  assert.ok(/planPath:\n    type: string\n    description:[^\n]*\n    required: true\n/.test(argsBlock), 'planPath must be type string + required');
  assert.ok(/nonce:\n    type: string\n    description:[^\n]*\n    required: true\n/.test(argsBlock), 'nonce must be type string + required');
  assert.ok(/rehearsal:\n    type: boolean\n    description:[^\n]*\n    required: false\n/.test(argsBlock), 'rehearsal must be optional boolean');
});
