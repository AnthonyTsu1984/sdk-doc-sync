'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

const DocxBlockWriter = require('../../.claude/skills/api-reference-sync/src/sdk-doc-sync/docx-block-writer');
const { createApprovalEnvelope } = require('../../.claude/skills/doc-ops-core/src/approval-guard');
const { createExceptionGovernance } = require('../../.claude/skills/doc-ops-core/src/legacy-quarantine');
const { stubRunManifest } = require('../../.claude/skills/doc-ops-core/src/run-manifest');

function gitRepo() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-block-writer-'));
    execSync('git init -q .', { cwd: root });
    execSync('git config user.email t@t && git config user.name t', { cwd: root });
    fs.writeFileSync(path.join(root, 'app.js'), 'v1\n');
    execSync('git add -A && git commit -qm init', { cwd: root });
    return root;
}

function transportLog() {
    const calls = [];
    const transport = async (method, endpoint, body) => {
        calls.push({ method, endpoint, body });
        return { code: 0, data: {} };
    };
    return { calls, transport };
}

function sanctionedDecision(entrypointPath) {
    return {
        quarantined: false,
        reason: 'exception-and-gate-present',
        entry: { path: entrypointPath },
        exceptionExpiresAt: '2099-01-01T00:00:00.000Z',
    };
}

test('a docx block mutation without governance is refused before any transport call', async () => {
    const { calls, transport } = transportLog();
    const writer = new DocxBlockWriter({ governance: null, transport });
    await assert.rejects(
        () => writer.batchUpdate('doc-1', [{ block_id: 'b1' }]),
        (error) => error.code === 'WRITER_ENVELOPE_REQUIRED',
    );
    assert.deepEqual(calls, []);
});

test('a governance with an approval but no run manifest is refused', async () => {
    const { calls, transport } = transportLog();
    // createExceptionGovernance always binds its own manifest; the bare form
    // (approval only) is what a pre-6.5 writer construction looked like.
    const { WriterGovernance } = require('../../.claude/skills/doc-ops-core/src/writer-governance');
    const bare = new WriterGovernance({ skill: 'api-reference-sync', operation: 'add-type-links' });
    bare.bindApproval({
        batchDigest: `sha256:${'a'.repeat(64)}`,
        actionCount: 1,
        targets: [],
        sideEffects: [],
        approval: createApprovalEnvelope({
            skill: 'api-reference-sync',
            operation: 'add-type-links',
            batchDigest: `sha256:${'a'.repeat(64)}`,
            actionCount: 1,
            targets: [],
            sideEffects: [],
            decision: 'approved',
        }),
    });
    const bareWriter = new DocxBlockWriter({ governance: bare, transport });
    await assert.rejects(
        () => bareWriter.batchUpdate('doc-1', [{ block_id: 'b1' }]),
        (error) => error.code === 'WRITER_RUN_MANIFEST_REQUIRED',
    );
    assert.deepEqual(calls, []);
});

test('an exception-governed batchUpdate reaches transport exactly once with the governed endpoint', async () => {
    const { calls, transport } = transportLog();
    const governance = createExceptionGovernance({
        skill: 'api-reference-sync',
        operation: 'add-type-links',
        decision: sanctionedDecision('scripts/add-type-links.js'),
        repoRoot: gitRepo(),
    });
    const writer = new DocxBlockWriter({ governance, transport });
    const requests = [{ block_id: 'b1', update_text_elements: { elements: [] } }];
    await writer.batchUpdate('DoXbLoCk', requests);
    assert.deepEqual(calls, [{
        method: 'PATCH',
        endpoint: '/open-apis/docx/v1/documents/DoXbLoCk/blocks/batch_update',
        body: { requests },
    }]);
});

test('a tree that drifts after binding is refused at the first governed mutation', async () => {
    const root = gitRepo();
    const { calls, transport } = transportLog();
    const governance = createExceptionGovernance({
        skill: 'api-reference-sync',
        operation: 'post-fix-links',
        decision: sanctionedDecision('scripts/post-fix-links.js'),
        repoRoot: root,
    });
    const writer = new DocxBlockWriter({ governance, transport });
    fs.writeFileSync(path.join(root, 'app.js'), 'v2-mid-run\n');
    await assert.rejects(
        () => writer.batchUpdate('doc-1', [{ block_id: 'b1' }]),
        (error) => error.code === 'RUN_MANIFEST_SOURCE_DRIFT',
    );
    assert.deepEqual(calls, []);
});

test('a writer without a transport function is a construction error', () => {
    assert.throws(() => new DocxBlockWriter({ governance: null, transport: null }), TypeError);
    void stubRunManifest;
});

test('the three exception post-actions route mutations through the governed writer', () => {
    const REPO_ROOT = path.resolve(__dirname, '..', '..');
    for (const name of ['add-type-links.js', 'fix-leading-spaces.js', 'post-fix-links.js']) {
        const source = fs.readFileSync(path.join(REPO_ROOT, '.claude', 'skills', 'api-reference-sync', 'scripts', name), 'utf8');
        assert.match(source, /createExceptionGovernance\(/, `${name} must mint its governance from the sanctioned exception decision`);
        assert.match(source, /repoRoot: require\('node:path'\)\.resolve/, `${name} must pass the repository root for the run manifest`);
        assert.match(source, /new DocxBlockWriter\(\{ governance: legacyGovernance/, `${name} must construct the governed block writer`);
        assert.doesNotMatch(source, /blocks\/batch_update/, `${name} must not carry the raw batch_update endpoint any more`);
    }
});
