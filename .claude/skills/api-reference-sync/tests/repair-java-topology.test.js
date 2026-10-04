'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const { executePlan, planDigest } = require('../../../../scripts/repair-java-topology');

const SKILL_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SKILL_ROOT, '..', '..', '..');

test('plan digest is deterministic and content-bound', () => {
    const plan = { actions: [{ kind: 'move-folder', ref: 'x', folderToken: 'a', toFolderToken: 'b' }] };
    const same = { actions: [{ kind: 'move-folder', ref: 'x', folderToken: 'a', toFolderToken: 'b' }] };
    const different = { actions: [{ kind: 'move-folder', ref: 'x', folderToken: 'a', toFolderToken: 'c' }] };
    assert.equal(planDigest(plan), planDigest(same));
    assert.notEqual(planDigest(plan), planDigest(different));
});

test('execute refuses a digest mismatch before any external call', async () => {
    const journalPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'repair-java-topology-')), 'journal.json');
    await assert.rejects(
        executePlan({
            plan: { actions: [{ kind: 'create-folder', ref: 'x', name: 'y', parentFolderToken: 'z' }] },
            approvedDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
            journalPath,
        }),
        (error) => error.code === 'REPAIR_PLAN_APPROVAL_MISMATCH',
    );
    assert.equal(fs.existsSync(journalPath), false, 'no journal is written on refusal');
});

test('the CLI requires the approval digest for execute', () => {
    const script = path.join(REPO_ROOT, 'scripts', 'repair-java-topology.js');
    const result = spawnSync(process.execPath, [script, 'execute', '--plan-json', '/dev/null'], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--approve-batch-digest/);
});
