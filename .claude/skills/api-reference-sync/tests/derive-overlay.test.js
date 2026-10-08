'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { loadOverlayTree } = require('../src/sdk-doc-sync/derive/overlay-schema');
const { compileTrack } = require('../src/sdk-doc-sync/derive');

const CREATE_COLLECTION_MD = `# CreateCollection()

Creates a collection.

## Request Syntax

\`\`\`rust
let request = CreateCollectionRequest::builder().collection_name("books").build()?;
\`\`\`

**REQUEST FIELDS:**

- \`database_name: Option<String>\`

    Name of the target database.

- \`num_partitions: i64\`

    Number of partitions to create.

- \`properties: HashMap<String, String>\`

    Collection properties. See [guide](https://milvus.io/docs/guide.md).

**RETURNS:**

*Result<()>*

Returns an empty result indicating success.

## Example

\`\`\`rust
client.create_collection(request).await?;
\`\`\`
`;

const CONSISTENCY_MD = `# ConsistencyLevel

This enum specifies the consistency guarantee.

\`\`\`rust
pub enum ConsistencyLevel {
    Strong,
    Bounded,
}
\`\`\`

**VARIANTS:**

- \`Strong\`

    Strongest guarantee.

- \`Bounded\`

    Bounded staleness.

## Example

\`\`\`rust
let x = ConsistencyLevel::Strong;
\`\`\`
`;

const ABOUT_MD = `# About Milvus Rust SDK

## Installation

Install with cargo.

## Quick Start

Quick start prose.
`;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

// A tiny web-content stand-in: a temp git repo whose track path holds three
// pages; successive commits model upstream moves for the demo scenarios.
function buildBaseRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'derive-base-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'derive-test');
  const trackDir = path.join(dir, 'API_Reference', 'milvus-sdk-rust', 'v3.0.x');
  fs.mkdirSync(path.join(trackDir, 'Collections'), { recursive: true });
  fs.mkdirSync(path.join(trackDir, 'types'), { recursive: true });
  fs.writeFileSync(path.join(trackDir, 'Collections', 'CreateCollection.md'), CREATE_COLLECTION_MD);
  fs.writeFileSync(path.join(trackDir, 'types', 'ConsistencyLevel.md'), CONSISTENCY_MD);
  fs.writeFileSync(path.join(trackDir, 'About.md'), ABOUT_MD);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'c1: initial');
  const c1 = git(dir, 'rev-parse', 'HEAD').trim();

  // c2: upstream touches ONLY the enum page (demo two: isolation).
  fs.writeFileSync(path.join(trackDir, 'types', 'ConsistencyLevel.md'), CONSISTENCY_MD.replace('Bounded staleness.', 'Bounded staleness for lower latency.'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'c2: touch enum page only');
  const c2 = git(dir, 'rev-parse', 'HEAD').trim();

  // c3: upstream renames the anchored parameter (demo three: anchor miss).
  fs.writeFileSync(path.join(trackDir, 'Collections', 'CreateCollection.md'), CREATE_COLLECTION_MD.replace('num_partitions', 'partition_count'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'c3: rename num_partitions');
  const c3 = git(dir, 'rev-parse', 'HEAD').trim();

  // c4: the method page changes shape entirely (page-kind drift).
  fs.writeFileSync(path.join(trackDir, 'Collections', 'CreateCollection.md'), `# CreateCollection\n\nShape changed.\n\n**VARIANTS:**\n\n- \`A\`\n\n    one.\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'c4: page kind drift');
  const c4 = git(dir, 'rev-parse', 'HEAD').trim();

  return { dir, shas: { c1, c2, c3, c4 } };
}

function buildOverlayDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'derive-overlay-'));
  fs.mkdirSync(path.join(dir, 'patches'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'pages', 'volume'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, language: 'rust', track: 'v3.0.x' }, null, 2));
  fs.writeFileSync(path.join(dir, 'rules.json'), JSON.stringify({
    urlRewrites: [{ from: 'https://milvus.io/docs/', to: 'https://docs.zilliz.com/docs/' }],
    terminology: [],
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'targets.json'), JSON.stringify([
    { symbol: 'num_partitions', kind: 'param', targets: 'shared', evidence: 'fixture', decidedAt: '2026-10-08' },
  ], null, 2));
  fs.writeFileSync(path.join(dir, 'patches', 'Collections-CreateCollection.json'), JSON.stringify({
    page: 'Collections.CreateCollection',
    entries: [
      {
        id: 'cc-drill-1',
        expect: 'method',
        anchor: { kind: 'requestField', 'key': 'num_partitions' },
        action: 'insert-after',
        content: '- `quota_note: Option<String>`\n\n    Cloud-only drill bullet.',
        targets: ['zilliz'],
      },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'pages', 'volume', 'ListVolumes.md'), '# ListVolumes\n\nLists cloud volumes.\n');
  return dir;
}

function compile({ base, sha, overlayDir, previousArtifact }) {
  return compileTrack({
    webContentDir: base.dir,
    sdkName: 'milvus-sdk-rust',
    track: 'v3.0.x',
    baseSha: sha || base.shas.c1,
    overlayDir,
    previousArtifact,
  });
}

test('overlay schema rejects matrix violations, unknown fields, and bad content shapes', () => {
  const dir = buildOverlayDir();

  // anchor matrix violation: requestField on an enum page.
  const bad = JSON.parse(fs.readFileSync(path.join(dir, 'patches', 'Collections-CreateCollection.json'), 'utf8'));
  bad.entries[0].expect = 'enum';
  fs.writeFileSync(path.join(dir, 'patches', 'Collections-CreateCollection.json'), JSON.stringify(bad));
  let result = loadOverlayTree(dir);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'OVERLAY_SCHEMA_VIOLATION' && /not legal for pageKind enum/.test(e.message)));

  // unknown field.
  bad.entries[0].expect = 'method';
  bad.entries[0].surprise = 1;
  fs.writeFileSync(path.join(dir, 'patches', 'Collections-CreateCollection.json'), JSON.stringify(bad));
  result = loadOverlayTree(dir);
  assert.ok(result.errors.some((e) => /unknown field/.test(e.message)));

  // content shape: insert-after requestField must start with a field bullet.
  delete bad.entries[0].surprise;
  bad.entries[0].content = 'plain paragraph, not a bullet';
  fs.writeFileSync(path.join(dir, 'patches', 'Collections-CreateCollection.json'), JSON.stringify(bad));
  result = loadOverlayTree(dir);
  assert.ok(result.errors.some((e) => /must start with/.test(e.message)));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('demo one: same base sha + same overlay compile byte-identically, rules applied, overlay pages included', () => {
  const base = buildBaseRepo();
  const overlayDir = buildOverlayDir();
  try {
    const first = compile({ base, overlayDir });
    const second = compile({ base, overlayDir });
    assert.equal(first.ok, true);
    assert.equal(JSON.stringify(first.artifact), JSON.stringify(second.artifact));

    // About ships from base? No: the pilot skips base About (zilliz overview
    // becomes overlay-owned); the two content pages + overlay page remain.
    assert.deepEqual(first.pages.map((page) => page.identity).sort(),
      ['Collections.CreateCollection', 'types.ConsistencyLevel', 'volume.ListVolumes']);

    const create = first.pages.find((page) => page.identity === 'Collections.CreateCollection');
    assert.ok(/quota_note: Option<String>/.test(create.markdown), 'drill bullet inserted');
    assert.ok(create.markdown.indexOf('quota_note') > create.markdown.indexOf('num_partitions: i64'), 'inserted after the anchor');

    // rules: milvus.io links rewritten to docs.zilliz.com.
    assert.ok(/docs\.zilliz\.com\/docs\/guide\.md/.test(create.markdown));
    assert.ok(!/milvus\.io/.test(create.markdown));

    // targets gate: every declared field except the registered one is must-ask.
    const asked = first.mustAsk.map((item) => item.symbol).sort();
    assert.ok(!asked.includes('num_partitions'));
    assert.ok(asked.includes('database_name'));
    assert.ok(asked.includes('quota_note'));
  } finally {
    fs.rmSync(base.dir, { recursive: true, force: true });
    fs.rmSync(overlayDir, { recursive: true, force: true });
  }
});

test('demo two: an upstream change to one page leaves every other digest untouched', () => {
  const base = buildBaseRepo();
  const overlayDir = buildOverlayDir();
  try {
    const first = compile({ base, overlayDir });
    const second = compile({ base, sha: base.shas.c2, overlayDir, previousArtifact: first.artifact });
    assert.equal(second.ok, true);
    assert.deepEqual(second.diff.changed, ['types.ConsistencyLevel']);
    assert.deepEqual(second.diff.added, []);
    assert.deepEqual(second.diff.removed, []);
    assert.equal(second.diff.unchanged, first.pages.length - 1);
  } finally {
    fs.rmSync(base.dir, { recursive: true, force: true });
    fs.rmSync(overlayDir, { recursive: true, force: true });
  }
});

test('demo three: renaming the anchored parameter fails loudly with the entry id, and a one-line key fix recovers', () => {
  const base = buildBaseRepo();
  const overlayDir = buildOverlayDir();
  try {
    const broken = compile({ base, sha: base.shas.c3, overlayDir });
    assert.equal(broken.ok, false);
    assert.equal(broken.error.code, 'OVERLAY_ANCHOR_MISS');
    assert.equal(broken.error.id, 'cc-drill-1');
    assert.equal(broken.error.anchor.key, 'num_partitions');
    assert.equal(broken.error.page, 'Collections.CreateCollection');

    // Fix exactly one line in the overlay and the same base compiles again.
    const patchFile = path.join(overlayDir, 'patches', 'Collections-CreateCollection.json');
    const patch = JSON.parse(fs.readFileSync(patchFile, 'utf8'));
    patch.entries[0].anchor.key = 'partition_count';
    fs.writeFileSync(patchFile, JSON.stringify(patch, null, 2));
    const recovered = compile({ base, sha: base.shas.c3, overlayDir });
    assert.equal(recovered.ok, true);

    // Page-kind drift stays loud even when the anchor still resolves.
    const drifted = compile({ base, sha: base.shas.c4, overlayDir });
    assert.equal(drifted.ok, false);
    assert.equal(drifted.error.code, 'OVERLAY_PAGE_KIND_DRIFT');
    assert.deepEqual({ expect: drifted.error.expect, detected: drifted.error.detected }, { expect: 'method', detected: 'enum' });
  } finally {
    fs.rmSync(base.dir, { recursive: true, force: true });
    fs.rmSync(overlayDir, { recursive: true, force: true });
  }
});
