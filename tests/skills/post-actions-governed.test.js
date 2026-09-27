'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

const DocxBlockWriter = require('../../.claude/skills/api-reference-sync/src/sdk-doc-sync/docx-block-writer');
const {
  GovernedPostActionBatch,
  GovernedPostActionError,
  isPolicyError,
  verifyBlockRequests,
} = require('../../.claude/skills/api-reference-sync/src/sdk-doc-sync/governed-post-actions');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DIGEST = `sha256:${'a'.repeat(64)}`;

function gitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'post-actions-'));
  execSync('git init -q .', { cwd: root });
  execSync('git config user.email t@t && git config user.name t', { cwd: root });
  // Mirror production: tmp/ is gitignored, so evidence files (run manifest,
  // journal) created inside the repo never enter the untracked fingerprint.
  fs.writeFileSync(path.join(root, '.gitignore'), 'tmp/\n');
  fs.writeFileSync(path.join(root, 'app.js'), 'v1\n');
  execSync('git add -A && git commit -qm init', { cwd: root });
  return root;
}

function transportLog() {
  const calls = [];
  return { calls, transport: async (method, endpoint, body) => { calls.push({ method, endpoint, body }); return { code: 0 }; } };
}

const ACTIONS = [
  { documentId: 'docB', requests: [{ block_id: 'b2', update_text_elements: { elements: [] } }] },
  { documentId: 'docA', requests: [{ block_id: 'b1', update_text_elements: { elements: [] } }, { block_id: 'b3', update_text_elements: { elements: [] } }] },
];

test('the batch digest is deterministic over the exact document/request set', () => {
  const first = new GovernedPostActionBatch({ operation: 'add-type-links', actions: ACTIONS });
  const second = new GovernedPostActionBatch({ operation: 'add-type-links', actions: [...ACTIONS].reverse() });
  assert.equal(first.batchDigest, second.batchDigest, 'submission order must not change the digest');
  assert.deepEqual(first.targets, ['docA', 'docB']);
  assert.equal(first.actionCount, 2);

  const altered = new GovernedPostActionBatch({
    operation: 'add-type-links',
    actions: [{ documentId: 'docA', requests: [{ block_id: 'b1', update_text_elements: { elements: [{ text_run: { content: 'x' } }] } }] }],
  });
  assert.notEqual(altered.batchDigest, first.batchDigest, 'a payload change must change the digest');
});

test('approval requires the exact digest — missing and mismatched digests are typed refusals', () => {
  const batch = new GovernedPostActionBatch({ operation: 'add-type-links', actions: ACTIONS });
  assert.throws(() => batch.assertApproved(null), (error) => error.code === 'GOVERNED_POST_ACTION_APPROVAL_REQUIRED');
  assert.throws(() => batch.assertApproved(`sha256:${'b'.repeat(64)}`), (error) => error.code === 'GOVERNED_POST_ACTION_APPROVAL_MISMATCH');
  assert.equal(batch.assertApproved(batch.batchDigest), true);
});

test('the reviewer counterexample is closed: an approved batch refuses other documents and payloads', async () => {
  const root = gitRepo();
  const batch = new GovernedPostActionBatch({ operation: 'add-type-links', actions: ACTIONS });
  batch.assertApproved(batch.batchDigest);
  const { governance, journal } = batch.bind({ repoRoot: root, approvedDigest: batch.batchDigest });
  const { calls, transport } = transportLog();
  const writer = new DocxBlockWriter({ governance, transport, batch });

  // Approved action reaches transport exactly once, with the governed endpoint.
  await writer.batchUpdate('docA', ACTIONS[1].requests);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, '/open-apis/docx/v1/documents/docA/blocks/batch_update');

  // An unapproved documentId — the reviewer's `unapproved-doc-A` — is refused
  // at the envelope target check (enforceTargets) with zero transport calls;
  // the batch itself refuses it at its own layer too.
  await assert.rejects(
    () => writer.batchUpdate('unapproved-doc-A', [{ block_id: 'x', update_text_elements: { elements: [] } }]),
    (error) => error.code === 'WRITER_TARGET_NOT_IN_ENVELOPE',
  );
  assert.equal(calls.length, 1);
  assert.throws(
    () => batch.assertAction('unapproved-doc-A', [{ block_id: 'x', update_text_elements: { elements: [] } }]),
    (error) => error.code === 'GOVERNED_POST_ACTION_TARGET_NOT_APPROVED',
  );

  // A payload swap on an APPROVED documentId is refused too.
  const tampered = JSON.parse(JSON.stringify(ACTIONS[1].requests));
  tampered[0].update_text_elements.elements.push({ text_run: { content: 'tampered' } });
  await assert.rejects(
    () => writer.batchUpdate('docA', tampered),
    (error) => error.code === 'GOVERNED_POST_ACTION_PAYLOAD_MISMATCH',
  );
  assert.equal(calls.length, 1);

  // Replay of an already-executed planned action is refused (one-shot).
  await assert.rejects(
    () => writer.batchUpdate('docA', ACTIONS[1].requests),
    (error) => error.code === 'GOVERNED_POST_ACTION_ACTION_ALREADY_EXECUTED',
  );
  assert.equal(calls.length, 1);

  // The second planned action still executes.
  await writer.batchUpdate('docB', ACTIONS[0].requests);
  assert.equal(calls.length, 2);
  void journal;
});

test('bind structurally requires the approved digest — skipping assertApproved cannot mint an envelope', async () => {
  const root = gitRepo();
  const batch = new GovernedPostActionBatch({ operation: 'add-type-links', actions: ACTIONS });
  // The round-4 counterexample: never call assertApproved, just bind. The
  // bind must refuse — no envelope, no manifest, no journal.
  assert.throws(() => batch.bind({ repoRoot: root }), (error) => error.code === 'GOVERNED_POST_ACTION_APPROVAL_REQUIRED');
  assert.throws(
    () => batch.bind({ repoRoot: root, approvedDigest: `sha256:${'b'.repeat(64)}` }),
    (error) => error.code === 'GOVERNED_POST_ACTION_APPROVAL_MISMATCH',
  );
  const { calls, transport } = transportLog();
  const writer = new DocxBlockWriter({ governance: null, transport, batch });
  await assert.rejects(
    () => writer.batchUpdate('docA', ACTIONS[1].requests),
    (error) => error.code === 'WRITER_ENVELOPE_REQUIRED',
  );
  assert.deepEqual(calls, [], 'zero transport calls without a structurally approved bind');

  // A batch binds at most once.
  const approved = new GovernedPostActionBatch({ operation: 'add-type-links', actions: ACTIONS });
  approved.bind({ repoRoot: root, approvedDigest: approved.batchDigest });
  assert.throws(
    () => approved.bind({ repoRoot: root, approvedDigest: approved.batchDigest }),
    (error) => error.code === 'GOVERNED_POST_ACTION_ALREADY_BOUND',
  );
});

test('verifyBlockRequests treats a PATCH response as evidence only after element comparison', () => {
  const getElementsContainer = (block) => block.text ?? null;
  const requests = [{ block_id: 'b1', update_text_elements: { elements: [{ text_run: { content: 'A' } }] } }];
  const matching = [{ block_id: 'b1', text: { elements: [{ text_run: { content: 'A' } }] } }];
  const drifted = [{ block_id: 'b1', text: { elements: [{ text_run: { content: 'changed remotely' } }] } }];
  const missing = [{ block_id: 'other', text: { elements: [] } }];
  assert.deepEqual(verifyBlockRequests({ blocks: matching, requests, getElementsContainer }), { verified: true, mismatches: [] });
  assert.deepEqual(verifyBlockRequests({ blocks: drifted, requests, getElementsContainer }), { verified: false, mismatches: ['b1'] });
  assert.deepEqual(verifyBlockRequests({ blocks: missing, requests, getElementsContainer }), { verified: false, mismatches: ['b1'] });
});

test('bind pins approval and manifest to the batch digest and journals each action', async () => {
  const root = gitRepo();
  const batch = new GovernedPostActionBatch({ operation: 'post-fix-links', actions: ACTIONS });
  const { governance, journal, artifactPath, journalPath } = batch.bind({ repoRoot: root, approvedDigest: batch.batchDigest });

  assert.equal(governance.bound.batchDigest, batch.batchDigest);
  assert.equal(governance.run.batchDigest, batch.batchDigest);
  assert.equal(governance.bound.enforceTargets, true);
  assert.deepEqual(governance.bound.targets, ['docA', 'docB']);
  assert.equal(fs.existsSync(artifactPath), true, 'run manifest artifact must be persisted fail-closed');

  for (const action of batch.actions) {
    journal.prepared({ actionId: action.actionId });
    journal.observed({ actionId: action.actionId, status: 'success', verified: true });
  }
  journal.complete();
  const entries = fs.readFileSync(journalPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(entries.filter(entry => entry.type === 'prepared').length, 2);
  assert.equal(entries.filter(entry => entry.type === 'observed').length, 2);
  assert.equal(entries.filter(entry => entry.type === 'completion' && entry.completionSentinel).length, 1);
});

test('policy errors are classified for immediate rethrow (non-zero exit contract)', () => {
  const { WriterGovernanceError } = require('../../.claude/skills/doc-ops-core/src/writer-governance');
  const { RunManifestError } = require('../../.claude/skills/doc-ops-core/src/run-manifest');
  const writer = new WriterGovernanceError('WRITER_RUN_MANIFEST_REQUIRED', 'x');
  const manifestError = new RunManifestError('RUN_MANIFEST_SOURCE_DRIFT', 'x');
  const plain = new Error('Feishu API: boom (code 99991663)');
  assert.equal(isPolicyError(writer), true);
  assert.equal(isPolicyError(manifestError), true);
  assert.equal(isPolicyError(new GovernedPostActionError('GOVERNED_POST_ACTION_TARGET_NOT_APPROVED', 'x')), true);
  assert.equal(isPolicyError(plain), false, 'per-batch API failures must stay retryable, not aborting');
});

test('the three post-actions are canonical: digest approval, no guard, no raw endpoint', () => {
  for (const name of ['add-type-links.js', 'fix-leading-spaces.js', 'post-fix-links.js']) {
    const source = fs.readFileSync(path.join(REPO_ROOT, '.claude', 'skills', 'api-reference-sync', 'scripts', name), 'utf8');
    assert.match(source, /--approve-batch-digest/, `${name} must require the operator digest`);
    assert.match(source, /const approvedDigest = argValue\('--approve-batch-digest'\)/, `${name} must read the operator digest once`);
    assert.match(source, /assertApproved\(approvedDigest\)/, `${name} must assert the digest before binding`);
    assert.match(source, /bind\(\{ repoRoot, approvedDigest \}\)/, `${name} must pass the digest into bind structurally`);
    assert.match(source, /new GovernedPostActionBatch\(/, `${name} must plan through the governed batch`);
    assert.match(source, /isPolicyError\(e\)/, `${name} must rethrow policy refusals immediately`);
    assert.match(source, /journal\.complete\(\)/, `${name} must close its journal with the completion sentinel`);
    assert.doesNotMatch(source, /enforceLegacyQuarantine|createExceptionGovernance/, `${name} must not carry the legacy guard any more`);
    assert.doesNotMatch(source, /blocks\/batch_update/, `${name} must not carry the raw endpoint any more`);
  }
});
