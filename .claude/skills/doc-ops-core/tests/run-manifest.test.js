'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

const {
    FINGERPRINT_SCOPE,
    assertRunManifest,
    createRunManifest,
    productionInputFingerprint,
    runManifestDigest,
    stubRunManifest,
    verifyRunManifestSource,
    writeRunManifestArtifact,
} = require('../src/run-manifest');
const { WriterGovernance, WriterGovernanceError } = require('../src/writer-governance');
const { createApprovalEnvelope } = require('../src/approval-guard');

function gitRepo(files = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-manifest-'));
    execSync('git init -q .', { cwd: root });
    execSync('git config user.email t@t && git config user.name t', { cwd: root });
    for (const [name, body] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
        fs.writeFileSync(path.join(root, name), body);
    }
    if (Object.keys(files).length > 0) execSync('git add -A && git commit -qm init', { cwd: root });
    return root;
}

const SHA = (hex) => `sha256:${hex.repeat(64).slice(0, 64)}`;

test('createRunManifest requires identity, version, batch digest, and a source fingerprint', () => {
    assert.throws(() => createRunManifest({ skill: '', skillVersion: '1', batchDigest: SHA('a'), sourceFingerprint: SHA('b') }), /RUN_MANIFEST_FIELD_REQUIRED/);
    assert.throws(() => createRunManifest({ skill: 's', skillVersion: '', batchDigest: SHA('a'), sourceFingerprint: SHA('b') }), /RUN_MANIFEST_FIELD_REQUIRED/);
    assert.throws(() => createRunManifest({ skill: 's', skillVersion: '1', batchDigest: 'not-a-digest', sourceFingerprint: SHA('b') }), /RUN_MANIFEST_FIELD_REQUIRED/);
    assert.throws(() => createRunManifest({ skill: 's', skillVersion: '1', batchDigest: SHA('a') }), /RUN_MANIFEST_FIELD_REQUIRED/);
    const manifest = createRunManifest({ skill: 's', skillVersion: '1', batchDigest: SHA('a'), sourceFingerprint: SHA('b'), sessionDigest: 'session-1' });
    assert.equal(manifest.fingerprintScope, FINGERPRINT_SCOPE);
    assert.equal(manifest.manifestDigest, runManifestDigest(manifest));
    assert.ok(assertRunManifest(manifest));
});

test('the production input fingerprint binds untracked file CONTENT (6.9 O1)', () => {
    const root = gitRepo({ 'tracked.js': 'module.exports = 1;\n' });
    fs.writeFileSync(path.join(root, 'untracked-note.md'), 'content-A');
    const before = productionInputFingerprint({ repoRoot: root });
    // Same untracked PATH, different CONTENT must change the fingerprint.
    fs.writeFileSync(path.join(root, 'untracked-note.md'), 'content-B-different');
    const after = productionInputFingerprint({ repoRoot: root });
    assert.notEqual(before, after);
    // gitignored output stays out of scope.
    fs.writeFileSync(path.join(root, '.gitignore'), 'build-out\n');
    execSync('git add .gitignore && git commit -qm ignore', { cwd: root });
    const scoped = productionInputFingerprint({ repoRoot: root });
    fs.writeFileSync(path.join(root, 'build-out'), 'ignored bytes');
    assert.equal(productionInputFingerprint({ repoRoot: root }), scoped);
});

test('the production input scope covers the whole working tree, wider than any loaded subset (6.9 O2)', () => {
    const root = gitRepo({ 'lib/a.js': 'a\n', 'scripts/b.js': 'b\n', 'tests/c.js': 'c\n' });
    const before = productionInputFingerprint({ repoRoot: root });
    fs.mkdirSync(path.join(root, 'docs', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'deep', 'nested.md'), 'doc change far from any entrypoint');
    const after = productionInputFingerprint({ repoRoot: root });
    assert.notEqual(before, after);
});

test('verifyRunManifestSource refuses a tree that drifted since binding', () => {
    const root = gitRepo({ 'app.js': 'v1\n' });
    const manifest = createRunManifest({ skill: 's', skillVersion: '1', repoRoot: root, batchDigest: SHA('a') });
    assert.ok(verifyRunManifestSource(manifest, { repoRoot: root }));
    fs.writeFileSync(path.join(root, 'app.js'), 'v2\n');
    assert.throws(
        () => verifyRunManifestSource(manifest, { repoRoot: root }),
        (error) => error.code === 'RUN_MANIFEST_SOURCE_DRIFT' && /no longer matches/.test(error.message),
    );
});

test('an edited manifest no longer matches its manifestDigest (tamper-evident)', () => {
    const manifest = stubRunManifest();
    const tampered = { ...manifest, skillVersion: '9.9.9' };
    assert.throws(() => assertRunManifest(tampered), (error) => error.code === 'RUN_MANIFEST_DIGEST_MISMATCH');
});

test('writer mutations refuse without a run manifest, then pass with one bound', () => {
    const governance = new WriterGovernance({ skill: 's', operation: 'op' });
    const approval = createApprovalEnvelope({ skill: 's', operation: 'op', batchDigest: SHA('a'), actionCount: 1, targets: ['record:1'], sideEffects: ['record:update'], decision: 'approved' });
    governance.bindApproval({ batchDigest: SHA('a'), actionCount: 1, targets: ['record:1'], sideEffects: ['record:update'], approval });
    assert.throws(
        () => governance.assertMutationAllowed({ method: 'BitableWriter.updateRecord', target: 'record:1' }),
        (error) => error.code === 'WRITER_RUN_MANIFEST_REQUIRED',
    );
    governance.bindRunManifest(stubRunManifest({ skill: 's', batchDigest: SHA('a') }));
    assert.equal(governance.assertMutationAllowed({ method: 'BitableWriter.updateRecord', target: 'record:1' }), true);
});

test('the bound run manifest must name this governance\'s skill and the bound batch', () => {
    const governance = new WriterGovernance({ skill: 's', operation: 'op' });
    const approval = createApprovalEnvelope({ skill: 's', operation: 'op', batchDigest: SHA('a'), actionCount: 1, targets: [], sideEffects: [], decision: 'approved' });
    governance.bindApproval({ batchDigest: SHA('a'), actionCount: 1, targets: [], sideEffects: [], approval });
    assert.throws(() => governance.bindRunManifest(stubRunManifest({ skill: 'other-skill' })), (error) => error.code === 'WRITER_RUN_MANIFEST_SKILL_MISMATCH');
    assert.throws(() => governance.bindRunManifest(stubRunManifest({ skill: 's', batchDigest: SHA('b') })), (error) => error.code === 'WRITER_RUN_MANIFEST_BATCH_MISMATCH');
});

test('a tree that drifts after binding is refused at the first mutation', () => {
    const root = gitRepo({ 'app.js': 'v1\n' });
    const governance = new WriterGovernance({ skill: 's', operation: 'op' });
    const approval = createApprovalEnvelope({ skill: 's', operation: 'op', batchDigest: SHA('a'), actionCount: 1, targets: [], sideEffects: [], decision: 'approved' });
    governance.bindApproval({ batchDigest: SHA('a'), actionCount: 1, targets: [], sideEffects: [], approval });
    governance.bindRunManifest(createRunManifest({ skill: 's', skillVersion: '1', repoRoot: root, batchDigest: SHA('a') }), { repoRoot: root });
    fs.writeFileSync(path.join(root, 'app.js'), 'v2-mid-run\n');
    assert.throws(
        () => governance.assertMutationAllowed({ method: 'BitableWriter.updateRecord' }),
        (error) => error.code === 'RUN_MANIFEST_SOURCE_DRIFT',
    );
});

test('writeRunManifestArtifact persists the verified manifest for the evidence trail', () => {
    const manifest = stubRunManifest({ skill: 'evidence', sessionDigest: 'session-42' });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'run-manifest-artifact-'));
    const artifact = writeRunManifestArtifact(manifest, { filePath: path.join(directory, 'run-manifest.json') });
    const roundTripped = JSON.parse(fs.readFileSync(artifact.path, 'utf8'));
    assert.ok(assertRunManifest(roundTripped));
    assert.equal(roundTripped.sessionDigest, 'session-42');
    assert.throws(() => writeRunManifestArtifact({ ...manifest, sessionDigest: 'swapped' }, { filePath: path.join(directory, 'x.json') }), /RUN_MANIFEST_DIGEST_MISMATCH/);
});

test('policy attestations ride inside the manifest digest', () => {
    const withAttestation = stubRunManifest({
        policyAttestations: [{ id: 'api.record-description-scope', version: 1, inputDigest: SHA('c'), decision: 'enforced' }],
    });
    assert.ok(assertRunManifest(withAttestation));
    assert.throws(
        () => assertRunManifest({ ...withAttestation, policyAttestations: [{ id: 'api.record-description-scope', version: 1, inputDigest: SHA('d'), decision: 'enforced' }] }),
        /RUN_MANIFEST_DIGEST_MISMATCH/,
    );
    assert.throws(
        () => createRunManifest({ skill: 's', skillVersion: '1', batchDigest: SHA('a'), sourceFingerprint: SHA('b'), policyAttestations: [{ id: 'x', version: 0, inputDigest: SHA('c'), decision: 'd' }] }),
        /WRITER_INVARIANT_ATTESTATION_MALFORMED/,
    );
});
