'use strict';

// 6.9 admitted-fingerprint binding: the admission records the exact widened
// whole-tree fingerprint it proved, and a governed writer in a production
// shell (DOC_OPS_REQUIRE_ADMITTED_FINGERPRINT=1) refuses any mutation whose
// bound fingerprint has no ADMITTED record. Dev/test runs (env unset) are
// not gated.

const test = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    assertFingerprintAdmitted,
    findAdmittedRecord,
    recordAdmittedFingerprint,
} = require('../src/admitted-fingerprint');
const { createApprovalEnvelope } = require('../src/approval-guard');
const { createRunManifest, productionInputFingerprint } = require('../src/run-manifest');
const { WriterGovernance } = require('../src/writer-governance');

function tempRepo({ file = 'placeholder.txt' } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'admitted-fingerprint-'));
    execSync('git init -q .', { cwd: root });
    fs.writeFileSync(path.join(root, file), 'content\n');
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\ntmp\n');
    execSync('git add -A', { cwd: root });
    execSync('git -c user.email=t@t -c user.name=t commit -qm init', { cwd: root });
    return root;
}

function governedWriter(repoRoot, fingerprint, { admittedEnv = null } = {}) {
    const governance = new WriterGovernance({ skill: 'doc-ops-core', operation: 'test' });
    governance.bindApproval({
        batchDigest: 'sha256:'.padEnd(71, 'b'),
        actionCount: 1,
        targets: ['target:one'],
        sideEffects: [],
        approval: createApprovalEnvelope({
            skill: 'doc-ops-core', operation: 'test', batchDigest: 'sha256:'.padEnd(71, 'b'),
            actionCount: 1, targets: ['target:one'], sideEffects: [], decision: 'approved',
        }),
        invariantAttestations: [],
    });
    governance.bindRunManifest(createRunManifest({
        skill: 'doc-ops-core',
        skillVersion: 'test@1',
        repoRoot,
        sourceFingerprint: fingerprint,
        batchDigest: 'sha256:'.padEnd(71, 'b'),
        sessionDigest: 'test-session',
    }), { repoRoot, admittedEnv });
    return governance;
}

test('bindRunManifest refuses an admittedEnv that would silently neutralize the gate', () => {
    const root = tempRepo();
    const fingerprint = productionInputFingerprint({ repoRoot: root });
    for (const bad of [{}, 7, 'flag']) {
        assert.throws(
            () => governedWriter(root, fingerprint, { admittedEnv: bad }),
            (error) => error.code === 'ADMITTED_ENV_INVALID',
        );
    }
    // null inherits process.env — the production default.
    assert.doesNotThrow(() => governedWriter(root, fingerprint, { admittedEnv: null }));
});

test('dirty-tree admissions are recorded with an explicit dirtyTree marker', () => {
    const root = tempRepo();
    const fingerprint = productionInputFingerprint({ repoRoot: root });
    recordAdmittedFingerprint({ repoRoot: root, sourceFingerprint: fingerprint, phase: 'dirty-phase', dirtyTree: true });
    const record = findAdmittedRecord({ repoRoot: root, sourceFingerprint: fingerprint });
    assert.equal(record.dirtyTree, true, 'the record is distinguishable from a clean release-grade admission');
});

test('admission records bind the same widened fingerprint run manifests use (O1/O2 parity)', () => {
    const root = tempRepo();
    const fingerprint = productionInputFingerprint({ repoRoot: root });
    const record = recordAdmittedFingerprint({
        repoRoot: root, sourceFingerprint: fingerprint, phase: 'test-phase', deterministicOnly: true,
    });
    assert.equal(record.status, 'ADMITTED');
    assert.equal(record.deterministicOnly, true);
    assert.equal(findAdmittedRecord({ repoRoot: root, sourceFingerprint: fingerprint }).phase, 'test-phase');

    // O1: untracked file CONTENT joins the fingerprint — editing an untracked
    // file yields a different fingerprint, so the stale record no longer
    // matches and the production gate would refuse the drifted tree.
    fs.writeFileSync(path.join(root, 'untracked.txt'), 'v1\n');
    const withUntracked = productionInputFingerprint({ repoRoot: root });
    assert.notEqual(withUntracked, fingerprint);
    assert.equal(findAdmittedRecord({ repoRoot: root, sourceFingerprint: withUntracked }), null);
    fs.writeFileSync(path.join(root, 'untracked.txt'), 'v2\n');
    assert.notEqual(productionInputFingerprint({ repoRoot: root }), withUntracked);
});

test('writer gate is a no-op in dev/test shells (env unset) even with no ledger', () => {
    const root = tempRepo();
    const governance = governedWriter(root, productionInputFingerprint({ repoRoot: root }));
    assert.doesNotThrow(() => governance.assertMutationAllowed({ method: 'update', target: 'target:one' }));
});

test('writer gate refuses typed when production mode is on and no ADMITTED record matches', () => {
    const root = tempRepo();
    const governance = governedWriter(root, productionInputFingerprint({ repoRoot: root }), {
        admittedEnv: { DOC_OPS_REQUIRE_ADMITTED_FINGERPRINT: '1' },
    });
    assert.throws(
        () => governance.assertMutationAllowed({ method: 'update', target: 'target:one' }),
        (error) => error.code === 'RUN_NOT_ADMITTED',
    );
});

test('writer gate allows the mutation when the bound fingerprint has an exact ADMITTED record', () => {
    const root = tempRepo();
    const fingerprint = productionInputFingerprint({ repoRoot: root });
    recordAdmittedFingerprint({ repoRoot: root, sourceFingerprint: fingerprint, phase: 'test-phase' });
    const env = { DOC_OPS_REQUIRE_ADMITTED_FINGERPRINT: '1' };
    const governance = governedWriter(root, fingerprint, { admittedEnv: env });
    assert.doesNotThrow(() => governance.assertMutationAllowed({ method: 'update', target: 'target:one' }));
    const record = assertFingerprintAdmitted({ repoRoot: root, sourceFingerprint: fingerprint, env });
    assert.equal(record.phase, 'test-phase');
    // Same tree, different fingerprint (any source edit) → refused again.
    fs.writeFileSync(path.join(root, 'new-file.txt'), 'x\n');
    const drifted = productionInputFingerprint({ repoRoot: root });
    assert.notEqual(drifted, fingerprint);
    assert.throws(
        () => assertFingerprintAdmitted({ repoRoot: root, sourceFingerprint: drifted, env }),
        (error) => error.code === 'RUN_NOT_ADMITTED',
    );
    const driftedGovernance = governedWriter(root, drifted, { admittedEnv: env });
    assert.throws(
        () => driftedGovernance.assertMutationAllowed({ method: 'update', target: 'target:one' }),
        (error) => error.code === 'RUN_NOT_ADMITTED',
    );
});
