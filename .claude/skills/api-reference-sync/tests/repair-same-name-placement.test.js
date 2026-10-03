'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildPlanFromFacts, planDigest, parseArgs, executePlan } = require('../../../../scripts/repair-same-name-placement');

function liveFacts() {
    return {
        tracks: [
            { version: 'v2.6.x', releaseRootToken: 'root-v26' },
            { version: 'v3.0.x', releaseRootToken: 'root-v30' },
        ],
        // categoryFolders keys are normalized (no spaces, lowercase).
        categoryFolders: {
            'v2.6.x': [
                { key: 'partitions', token: 'folderv26partitions0000', name: 'Partitions' },
            ],
            'v3.0.x': [
                { key: 'database', token: 'folderv30database000000', name: 'Database' },
                { key: 'partitions', token: 'folderv30partitions0000', name: 'Partitions' },
                // ResourceGroup is missing from the newer tree -> folder-create.
            ],
        },
        folderEntries: [
            // Correct pair member (older track's own copy): never moves.
            { token: 'docoldpartition000000001', name: 'loadPartitions()', parentToken: 'folderv26partitions0000', roots: ['root-v26'] },
            // Misplaced: v3.0-pointed copy sitting in the older directory.
            { token: 'docnewpartition000000001', name: 'loadPartitions()', parentToken: 'folderv26partitions0000', roots: ['root-v26'] },
            // Misplaced: v3.0-pointed Database copy in an older tree, whose
            // category folder exists in the newer tree.
            { token: 'docnewdatabase00000000001', name: 'dropDatabase()', parentToken: 'folderolddatabase000000', roots: ['root-v26'] },
            { token: 'docolddatabase00000000001', name: 'dropDatabase()', parentToken: 'folderolddatabase000000', roots: ['root-v26'] },
            // Zero-row orphan: reported by the classifier, never repaired here.
            { token: 'docindexorphan00000000001', name: 'DescribeIndex()', parentToken: 'folderoldmgmt000000000', roots: ['root-v26'] },
            { token: 'docindextwin00000000001', name: 'DescribeIndex()', parentToken: 'folderoldmgmt000000000', roots: ['root-v26'] },
        ],
        records: [
            { recordId: 'rec-old-p', slug: 'v2-Partitions-loadPartitions', documentToken: 'docoldpartition000000001', track: 'v2.6.x' },
            { recordId: 'rec-new-p', slug: 'v2-Partitions-loadPartitions', documentToken: 'docnewpartition000000001', track: 'v3.0.x' },
            { recordId: 'rec-old-db', slug: 'v2-Database-dropDatabase', documentToken: 'docolddatabase00000000001', track: 'v2.6.x' },
            { recordId: 'rec-new-db', slug: 'v2-Database-dropDatabase', documentToken: 'docnewdatabase00000000001', track: 'v3.0.x' },
            { recordId: 'rec-index-twin', slug: 'v2-Management-DescribeIndex', documentToken: 'docindextwin00000000001', track: 'v2.6.x' },
        ],
        virtualNodes: {
            'v2.6.x': [
                { recordId: 'rec-vnode-p26', slug: 'v2-Partitions', categoryFolderToken: 'folderv26partitions0000' },
            ],
            // The v3.0 Partitions node still points at the older directory —
            // the navigation half of the failure mode.
            'v3.0.x': [
                { recordId: 'rec-vnode-p30', slug: 'v2-Partitions', categoryFolderToken: 'folderv26partitions0000' },
            ],
        },
    };
}

test('repair plan derives moves, folder creates, and node repoints from live facts', () => {
    const plan = buildPlanFromFacts({ language: 'java', facts: liveFacts() });
    assert.equal(plan.misplacedCopies, 2);

    const kinds = plan.actions.map((action) => action.kind);
    // Ordering: folder creates first, then moves, then node repoints.
    assert.deepEqual(kinds, ['move-document', 'move-document', 'repoint-category-node']);

    const partitionsMove = plan.actions.find((a) => a.documentToken === 'docnewpartition000000001');
    assert.equal(partitionsMove.track, 'v3.0.x');
    assert.equal(partitionsMove.toFolderToken, 'folderv30partitions0000');
    const databaseMove = plan.actions.find((a) => a.documentToken === 'docnewdatabase00000000001');
    assert.equal(databaseMove.toFolderToken, 'folderv30database000000');

    const repoint = plan.actions.find((a) => a.kind === 'repoint-category-node');
    assert.equal(repoint.recordId, 'rec-vnode-p30');
    assert.equal(repoint.fromFolderToken, 'folderv26partitions0000');
    assert.equal(repoint.toFolderToken, 'folderv30partitions0000');

    // The orphan copy and the older-track copy never appear as moves.
    const movedTokens = plan.actions.filter((a) => a.kind === 'move-document').map((a) => a.documentToken);
    assert.deepEqual(movedTokens.sort(), ['docnewdatabase00000000001', 'docnewpartition000000001']);

    // No orphan-disposal action is ever planned here: disposal requires a
    // separate operator-approved flow.
    assert.equal(plan.actions.some((a) => a.kind === 'delete-document'), false);
});

test('repair plan creates a missing newer-tree category folder before moving into it', () => {
    const facts = liveFacts();
    // Drop the v3.0 Database category folder: the repair must plan a
    // folder-create and reference it from the move + repoint.
    facts.categoryFolders['v3.0.x'] = [];
    const plan = buildPlanFromFacts({ language: 'java', facts });
    const create = plan.actions.find((a) => a.kind === 'create-folder');
    assert.ok(create, 'folder-create planned');
    assert.equal(create.name, 'Database');
    assert.equal(create.parentFolderToken, 'root-v30');
    assert.equal(create.ref, 'folder-create:v3.0.x:database');
    const move = plan.actions.find((a) => a.documentToken === 'docnewdatabase00000000001');
    assert.equal(move.toFolderRef, 'folder-create:v3.0.x:database');
    const repoint = plan.actions.find((a) => a.kind === 'repoint-category-node');
    // The only VirtualNode in the fixture is the v3.0 Partitions node, so its
    // repoint follows the partitions folder-create, not the database one.
    assert.equal(repoint.toFolderRef, 'folder-create:v3.0.x:partitions');
});

test('plan digest is deterministic and approval-refusal happens before any mutation', () => {
    const plan = buildPlanFromFacts({ language: 'java', facts: liveFacts() });
    const digest = planDigest(plan);
    assert.match(digest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(planDigest(buildPlanFromFacts({ language: 'java', facts: liveFacts() })), digest);

    const args = parseArgs(['node', 'repair', '--language', 'java', '--mode', 'execute',
        '--plan', '/tmp/plan.json', '--approve-batch-digest', 'sha256:deadbeef']);
    assert.equal(args.approvedDigest, 'sha256:deadbeef');

    assert.throws(() => parseArgs(['node', 'repair', '--language', 'java', '--mode', 'execute', '--plan', '/tmp/plan.json']),
        /--approve-batch-digest/);
});

// --- executePlan (P1 review hardening: the approval gate and per-action
// behavior are pinned, not just the parser) ---

function journalPath() {
    return path.join(os.tmpdir(), `repair-execute-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

test('executePlan refuses a digest mismatch before any external call', async () => {
    let externalCalls = 0;
    const plan = {
        language: 'java',
        actions: [{ kind: 'move-document', ref: 'move:x', documentToken: 'docx1', toFolderToken: 'fold1' }],
    };
    await assert.rejects(
        executePlan({
            plan,
            approvedDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
            journalPath: journalPath(),
            deps: {
                larkJson: async () => { externalCalls += 1; return {}; },
                listFolder: async () => [],
            },
        }),
        /REFUSED.*digest/,
    );
    assert.equal(externalCalls, 0);
});

test('create-folder is refused when an exact-name folder already exists under the parent', async () => {
    const larkCalls = [];
    const plan = {
        language: 'java',
        actions: [{
            kind: 'create-folder', ref: 'folder-create:v3.0.x:database', track: 'v3.0.x',
            category: 'Database', name: 'Database', parentFolderToken: 'rootv30',
        }],
    };
    const journalFile = journalPath();
    await assert.rejects(
        executePlan({
            plan,
            approvedDigest: planDigest(plan),
            journalPath: journalFile,
            deps: {
                larkJson: async (args) => { larkCalls.push(args.join(' ')); return { data: { token: 'newfolder' } }; },
                listFolder: async () => [{ name: 'Database', token: 'existingfolder', type: 'folder' }],
            },
        }),
        /REFUSED: folder Database already exists/,
    );
    assert.deepEqual(larkCalls, []);
    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
    assert.equal(journal.journal[0].ok, false);
    assert.match(journal.journal[0].error, /already exists/);
});

test('a failing action aborts the batch and journals the failure', async () => {
    let moveCalls = 0;
    const plan = {
        language: 'java',
        actions: [
            { kind: 'move-document', ref: 'move:a', documentToken: 'doca', toFolderToken: 'fold1' },
            { kind: 'move-document', ref: 'move:b', documentToken: 'docb', toFolderToken: 'fold1' },
        ],
    };
    const journalFile = journalPath();
    await assert.rejects(
        executePlan({
            plan,
            approvedDigest: planDigest(plan),
            journalPath: journalFile,
            deps: {
                larkJson: async () => { moveCalls += 1; if (moveCalls === 1) throw new Error('move exploded'); return {}; },
                // Action 1 (doca) is already placed, so it issues no move call;
                // the first move call belongs to action 2 and fails.
                listFolder: async () => [{ token: 'doca', type: 'docx' }],
            },
        }),
        /action 2\/2 \(move-document move:b\) failed: move exploded/,
    );
    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
    assert.equal(journal.journal.length, 2);
    assert.equal(journal.journal[0].ok, true);
    assert.equal(journal.journal[1].ok, false);
});

test('moves and repoints already in place are verified and skipped without writes', async () => {
    const larkCalls = [];
    const plan = {
        language: 'java',
        actions: [
            { kind: 'move-document', ref: 'move:a', documentToken: 'doca', toFolderToken: 'fold1' },
            { kind: 'repoint-category-node', ref: 'repoint:r1', track: 'v3.0.x', category: 'Database', recordId: 'rec1', toFolderToken: 'fold1' },
        ],
    };
    const result = await executePlan({
        plan,
        approvedDigest: planDigest(plan),
        journalPath: journalPath(),
        deps: {
            larkJson: async (args) => { larkCalls.push(args.join(' ')); return { data: { tables: [{ id: 'tbl1' }] } }; },
            listFolder: async () => [{ token: 'doca', type: 'docx' }],
            listRecords: async () => [{ record_id: 'rec1', fields: { Docs: { link: 'https://zilliverse.feishu.cn/drive/folder/fold1' } } }],
        },
    });
    assert.equal(result.journal[0].result.alreadyPlaced, true);
    assert.equal(result.journal[1].result.alreadyRepointed, true);
    assert.deepEqual(larkCalls, []);
});

test('a copy claimed by two tracks is reported as a problem, never placed by sort order', () => {
    const facts = liveFacts();
    // Claim the misplaced Partition copy from TWO tracks: the rootless
    // v2.5.x one and the v3.0.x one. The copy sits in the v2.6 tree, so the
    // only judgeable claim (v3.0) still finds it misplaced — and placing it
    // by lexicographic order would silently absorb the ambiguity.
    facts.records = facts.records.map((r) => (
        r.documentToken === 'docnewpartition000000001' ? { ...r, track: 'v2.5.x' } : r
    ));
    facts.records.push({ recordId: 'rec-new-p-2', slug: 'v2-Partitions-loadPartitions', documentToken: 'docnewpartition000000001', track: 'v3.0.x' });
    // The rootless track needs slots in every per-track map.
    facts.tracks.push({ version: 'v2.5.x', releaseRootToken: null });
    facts.categoryFolders['v2.5.x'] = [];
    facts.virtualNodes['v2.5.x'] = [];
    const plan = buildPlanFromFacts({ language: 'java', facts });
    const problem = plan.problems.find((p) => p.code === 'MULTI_TRACK_CLAIM');
    assert.ok(problem, 'MULTI_TRACK_CLAIM problem emitted');
    assert.equal(problem.token, 'docnewpartition000000001');
    assert.deepEqual([...problem.tracks].sort(), ['v2.5.x', 'v3.0.x']);
    assert.equal(plan.actions.some((a) => a.kind === 'move-document' && a.documentToken === 'docnewpartition000000001'), false);
});

test('repoints are derived independently of moves via in-tree claimed presence', () => {
    // Every copy is correctly placed (no misplaced tokens), yet the v3.0
    // Database node still points at the older tree's folder while the v3.0
    // in-tree Database folder holds a v3.0-claimed document: the repoint
    // must be planned even though the move list is empty.
    const facts = liveFacts();
    // Drop the misplaced copies so the plan has nothing to move.
    facts.folderEntries = facts.folderEntries.filter((e) => e.token !== 'docnewpartition000000001' && e.token !== 'docnewdatabase00000000001');
    facts.records = facts.records.filter((r) => r.documentToken !== 'docnewpartition000000001' && r.documentToken !== 'docnewdatabase00000000001');
    // Correctly placed Database pair: old copy in the v2.6 tree, new copy in
    // the v3.0 tree, each claimed by its own track.
    facts.folderEntries.push(
        { token: 'docolddatabase00000000001', name: 'dropDatabase()', parentToken: 'folderolddatabase000000', roots: ['root-v26'] },
        { token: 'docnewdatabase00000000001', name: 'dropDatabase()', parentToken: 'folderv30database000000', roots: ['root-v30'] },
    );
    facts.records.push(
        { recordId: 'rec-new-db', slug: 'v2-Database-dropDatabase', documentToken: 'docnewdatabase00000000001', track: 'v3.0.x' },
    );
    // The stale v3.0 Database VirtualNode.
    facts.virtualNodes['v3.0.x'].push({ recordId: 'rec-vnode-db30', slug: 'v2-Database', categoryFolderToken: 'folderolddatabase000000' });
    const plan = buildPlanFromFacts({ language: 'java', facts });
    assert.equal(plan.summary.moveDocument, 0);
    assert.equal(plan.actions.filter((a) => a.kind === 'move-document').length, 0);
    const repoint = plan.actions.find((a) => a.kind === 'repoint-category-node' && a.recordId === 'rec-vnode-db30');
    assert.ok(repoint, 'stale node repointed without any move');
    assert.equal(repoint.toFolderToken, 'folderv30database000000');
    // The correctly-pointed v2.6/v3.0 Partitions nodes stay untouched.
    assert.equal(plan.actions.filter((a) => a.kind === 'repoint-category-node').length, 1);
});

test('inherited navigation without in-tree claimed presence is never repointed', () => {
    // The v3.0 Database node points at the older tree, and the v3.0 in-tree
    // Database folder exists but holds nothing claimed by v3.0 records (the
    // unchanged interfaces legitimately live in the older tree): repointing
    // would hide them, so no action may be planned.
    const facts = liveFacts();
    // Remove every misplaced copy: only the correctly placed pair remains.
    facts.folderEntries = facts.folderEntries.filter((e) => e.token !== 'docnewpartition000000001' && e.token !== 'docnewdatabase00000000001');
    facts.records = facts.records.filter((r) => r.documentToken !== 'docnewpartition000000001' && r.documentToken !== 'docnewdatabase00000000001');
    facts.virtualNodes['v3.0.x'].push({ recordId: 'rec-vnode-db30', slug: 'v2-Database', categoryFolderToken: 'folderolddatabase000000' });
    const plan = buildPlanFromFacts({ language: 'java', facts });
    assert.deepEqual(plan.actions, []);
    assert.equal(plan.summary.repointCategoryNode, 0);
});
