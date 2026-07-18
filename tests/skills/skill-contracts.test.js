const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function skill(name) {
  return fs.readFileSync(path.join(REPO_ROOT, '.claude', 'skills', name, 'SKILL.md'), 'utf8');
}

test('sdk-doc-sync documents a valid required-argument quick start', () => {
  const content = skill('sdk-doc-sync');
  assert.match(content, /--language python\b/);
  assert.match(content, /--sdk-name\s+\S+/);
  assert.doesNotMatch(content, /--language=python/);
});

test('sdk-doc-sync never instructs routine version sync to delete historical documents', () => {
  const content = skill('sdk-doc-sync');
  assert.match(content, /Keep (?:the )?older-version doc as a historical snapshot/i);
  assert.doesNotMatch(content, /Delete old doc/);
});

test('localization-docs uses current table-aware translator options', () => {
  const content = skill('localization-docs');
  assert.match(content, /--source-table\s+\S+/);
  assert.match(content, /--target-table\s+\S+/);
  assert.doesNotMatch(content, /parses base tokens but not table IDs/i);
  assert.doesNotMatch(content, /until it is patched or wrapped with table-aware readers/i);
});

for (const name of ['draft-verified-docs', 'localization-docs', 'patch-feishu-code', 'sdk-doc-sync']) {
  test(`${name} requires preview, explicit approval, write, and refetch verification`, () => {
    const content = skill(name);
    assert.match(content, /dry[- ]run/i);
    assert.match(content, /explicit approval/i);
    assert.match(content, /(?:write|patch|update|execute)/i);
    assert.match(content, /refetch/i);
  });
}

test('draft-verified-docs gates skill self-updates on an explicit request', () => {
  const content = skill('draft-verified-docs');
  assert.match(content, /Update this skill or its workflow notes only when the user explicitly asks\./);
});

test('patch-code-blocks remains an internal dry-run-only tool package', () => {
  const toolRoot = path.join(REPO_ROOT, '.claude', 'skills', 'patch-code-blocks');
  assert.equal(fs.existsSync(path.join(toolRoot, 'SKILL.md')), false);
  const cli = fs.readFileSync(path.join(toolRoot, 'bin', 'patch-code-blocks.js'), 'utf8');
  assert.match(cli, /Apply mode is not implemented yet/);
});

test('large skills route detailed operational material into direct references', () => {
  const sdk = skill('sdk-doc-sync');
  assert.ok(sdk.split(/\r?\n/).length < 300, 'sdk-doc-sync/SKILL.md must stay under 300 lines');
  assert.doesNotMatch(sdk, /^## CLI Tools$/m);
  assert.doesNotMatch(sdk, /^## Known Issues & Patterns$/m);
  for (const reference of [
    'references/versioning.md',
    'references/post-write-verification.md',
    'references/cli.md',
    'references/troubleshooting.md',
  ]) {
    assert.match(sdk, new RegExp(reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(fs.existsSync(path.join(REPO_ROOT, '.claude', 'skills', 'sdk-doc-sync', reference)), true);
  }

  const verifier = skill('feishu-code-verify');
  assert.doesNotMatch(verifier, /^## Manta Runtime Verification$/m);
  assert.match(verifier, /references\/manta-runtime\.md/);
  assert.equal(
    fs.existsSync(path.join(REPO_ROOT, '.claude', 'skills', 'feishu-code-verify', 'references', 'manta-runtime.md')),
    true,
  );

  const patchSkill = skill('patch-feishu-code');
  assert.doesNotMatch(patchSkill, /^## Feature-Specific Notes From Prior Runs$/m);
  assert.match(patchSkill, /references\/feature-cases\.md/);

  const development = fs.readFileSync(
    path.join(REPO_ROOT, '.claude', 'skills', 'localization-docs', 'references', 'development-alignment.md'),
    'utf8',
  );
  assert.doesNotMatch(development, /^## Status Snapshot$/m);
  assert.doesNotMatch(development, /^## Created Localized Docs$/m);
  assert.match(development, /development-snapshot-2026-07-03\.md/);
});
