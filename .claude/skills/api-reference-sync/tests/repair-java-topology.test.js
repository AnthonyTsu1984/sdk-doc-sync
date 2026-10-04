'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const { executePlan, buildPlan, planDigest } = require('../../../../scripts/repair-java-topology');
const {
    listLanguageTracks,
    trackBaseToken,
    trackReleaseRootToken,
} = require('../src/sdk-doc-sync/release-track-registry');

const SKILL_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SKILL_ROOT, '..', '..', '..');
const REGISTRY_PATH = path.join(SKILL_ROOT, 'config', 'release-tracks.json');

function javaTrackTokens() {
    const registry = require(REGISTRY_PATH);
    const byVersion = new Map(listLanguageTracks(registry, 'java')
        .map((track) => [track.version, { baseToken: trackBaseToken(track), rootToken: trackReleaseRootToken(track) }]));
    return { registry, byVersion };
}

// A part-D world: v2.6.x Vector holds the stray FunctionScore docx beside
// the FunctionScore folder that holds the retained copy; one record claims
// the stray. v3.0.x is in its post-disposition shape except the Collections/
// Function anchor (part E). v2.4.x/v2.5.x carry the dead-linked
// dropDatabaseProperties records (part F).
function partDDeps({
    pageLinkTokens = [],
    pageMarkdown = null,
    anchorState = 'beside',
    healthy24 = false,
    missingDbFolder = null,
    duplicateDead24 = false,
} = {}) {
    const { registry, byVersion } = javaTrackTokens();
    const v24 = byVersion.get('v2.4.x');
    const v25 = byVersion.get('v2.5.x');
    const v26 = byVersion.get('v2.6.x');
    const v30 = byVersion.get('v3.0.x');
    const entry = (token, name, type, parentFolderToken, extra = {}) => ({ token, name, type, parentFolderToken, ancestors: [], ...extra });
    const indexV24 = new Map([
        [v24.rootToken, entry(v24.rootToken, 'v2.4 root', 'folder', null)],
        ...((missingDbFolder === 'v2.4.x') ? [] : [['db24', entry('db24', 'Database', 'folder', v24.rootToken)]]),
        ['livePage24', entry('livePage24', 'dropDatabaseProperties()', 'docx', 'db24')],
    ]);
    const indexV25 = new Map([
        [v25.rootToken, entry(v25.rootToken, 'v2.5 root', 'folder', null)],
        ['db25', entry('db25', 'Database', 'folder', v25.rootToken)],
    ]);
    const indexV26 = new Map([
        [v26.rootToken, entry(v26.rootToken, 'v2.6 root', 'folder', null)],
        ['vec26', entry('vec26', 'Vector', 'folder', v26.rootToken)],
        ['scoreFolder26', entry('scoreFolder26', 'FunctionScore', 'folder', 'vec26')],
        ['strayScore', entry('strayScore', 'FunctionScore', 'docx', 'vec26')],
        ['inFolderScore', entry('inFolderScore', 'FunctionScore', 'docx', 'scoreFolder26')],
    ]);
    const indexV30 = new Map([
        [v30.rootToken, entry(v30.rootToken, 'v3.0 root', 'folder', null)],
        ['vec30', entry('vec30', 'Vector', 'folder', v30.rootToken)],
        ['chainUnderVector', entry('chainUnderVector', 'FunctionChain', 'folder', 'vec30')],
        ['scoreUnderVector', entry('scoreUnderVector', 'FunctionScore', 'folder', 'vec30')],
        ['collections30', entry('collections30', 'Collections', 'folder', v30.rootToken)],
        ['functionFolder30', entry('functionFolder30', 'Function', 'folder', 'collections30')],
        ...(anchorState === 'beside' || anchorState === 'both'
            ? [['functionAnchor30', entry('functionAnchor30', 'Function', 'docx', 'collections30')]]
            : []),
        ...(anchorState === 'inside' || anchorState === 'both'
            ? [['functionInside30', entry('functionInside30', 'Function', 'docx', 'functionFolder30')]]
            : []),
    ]);
    const deadRecord = (id) => ({
        record_id: id,
        fields: {
            Docs: { text: 'dropDatabaseProperties()', link: healthy24 && id === 'rec-dead-24'
                ? 'https://zilliverse.feishu.cn/docx/livePage24'
                : 'https://zilliverse.feishu.cn/docx/deadToken' },
            Slug: [{ text: 'v2-Database-dropDatabaseProperties' }],
            Type: 'Function',
        },
    });
    const recordsV24 = [deadRecord('rec-dead-24'), ...(duplicateDead24 ? [deadRecord('rec-dead-24b')] : [])];
    const recordsV25 = [deadRecord('rec-dead-25')];
    const recordsV26 = [{
        record_id: 'rec-claimant',
        fields: {
            Docs: { text: 'FunctionScore', link: 'https://zilliverse.feishu.cn/docx/strayScore' },
            Slug: [{ text: 'v2-Vector-FunctionScore' }],
            Type: 'Page',
        },
    }];
    const recordsV30 = [{
        record_id: 'rec-vnode-coll30',
        fields: {
            Docs: { text: 'Collections', link: 'https://zilliverse.feishu.cn/drive/folder/collections30' },
            Slug: [{ text: 'v2-Collections' }],
            Type: 'VirtualNode',
        },
    }];
    return {
        registry,
        pageLinkTokens,
        pageMarkdown,
        tokenFetcher: {},
        indexVersionRoot: async (fetcher, rootToken) => ({
            [v24.rootToken]: indexV24,
            [v25.rootToken]: indexV25,
            [v26.rootToken]: indexV26,
            [v30.rootToken]: indexV30,
        }[rootToken]),
        listBitableRecords: async (fetcher, baseToken) => ({
            [v24.baseToken]: recordsV24,
            [v25.baseToken]: recordsV25,
            [v26.baseToken]: recordsV26,
            [v30.baseToken]: recordsV30,
        }[baseToken]),
        listFolder: async () => [],
    };
}

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

test('part D repoints the claimant as {text, link} — never a bare-URL Docs string (2026-10-04 defect class)', async () => {
    const deps = partDDeps({ pageMarkdown: 'x' });
    const plan = await buildPlan(deps);
    const repoint = plan.actions.find((a) => a.kind === 'update-record-docs-text');
    assert.ok(repoint, 'the claimant repoint is planned');
    assert.equal(repoint.recordId, 'rec-claimant');
    assert.equal(repoint.text, 'FunctionScore');
    assert.equal(repoint.link, 'https://zilliverse.feishu.cn/docx/inFolderScore');
    assert.equal(plan.actions.some((a) => a.kind === 'update-record-field' && a.field === 'Docs'), false,
        'no generic field write may touch the Docs cell');
    const del = plan.actions.find((a) => a.kind === 'delete-document');
    assert.ok(del, 'the stray delete is planned');
    assert.equal(del.documentToken, 'strayScore');
    assert.equal(del.documentName, 'FunctionScore');
    assert.equal(del.parentFolderToken, 'vec26');
    assert.equal(del.duplicateOfToken, 'inFolderScore');
    assert.equal(del.duplicateOfParentToken, 'scoreFolder26');
});

test('part D refuses to plan when page blocks still reference the stray copy', async () => {
    await assert.rejects(
        buildPlan(partDDeps({ pageLinkTokens: ['strayScore'] })),
        /page blocks still reference the stray FunctionScore copy strayScore/,
    );
});

test('part D requires a page-links dump before any delete can be planned', async () => {
    const deps = partDDeps();
    delete deps.pageLinkTokens;
    await assert.rejects(
        buildPlan(deps),
        /part D requires --page-links-json/,
    );
});

test('update-record-field refuses Docs writes entirely (producer closed)', async () => {
    const journalPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'repair-java-topology-')), 'journal.json');
    const plan = {
        actions: [{
            kind: 'update-record-field', track: 'v2.6.x', recordId: 'rec-x', field: 'Docs',
            value: 'https://zilliverse.feishu.cn/docx/someToken',
        }],
    };
    await assert.rejects(
        executePlan({ plan, approvedDigest: planDigest(plan), journalPath, deps: javaTrackTokensFixture() }),
        (error) => error.code === 'REPAIR_DOCS_FIELD_FORBIDDEN',
    );
});

test('update-record-docs-text writes {text, link} via the raw records PUT and verifies a page-record slug form', async () => {
    const journalPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'repair-java-topology-')), 'journal.json');
    const larkCalls = [];
    const deps = {
        ...javaTrackTokensFixture(),
        resolveTableId: async () => 'tblTest',
        larkJson: async (args) => { larkCalls.push(args); return {}; },
        listBitableRecords: async () => [{
            record_id: 'rec-claimant',
            fields: {
                Docs: { text: 'FunctionScore', link: 'https://zilliverse.feishu.cn/docx/inFolderScore' },
                Slug: [{ text: 'v2-Vector-FunctionScore' }],
            },
        }],
    };
    const plan = {
        actions: [{
            kind: 'update-record-docs-text', track: 'v2.6.x', recordId: 'rec-claimant',
            text: 'FunctionScore', link: 'https://zilliverse.feishu.cn/docx/inFolderScore',
        }],
    };
    const result = await executePlan({ plan, approvedDigest: planDigest(plan), journalPath, deps });
    const put = larkCalls.find((args) => args[0] === 'api' && args[1] === 'PUT');
    assert.ok(put, 'the write goes through the raw records PUT');
    assert.match(put[2], /\/records\/rec-claimant$/);
    const payload = JSON.parse(put.find((arg, i) => put[i - 1] === '--data'));
    assert.deepEqual(payload, { fields: { Docs: { text: 'FunctionScore', link: 'https://zilliverse.feishu.cn/docx/inFolderScore' } } });
    assert.equal(larkCalls.some((args) => args[0] === 'base' && args[1] === '+record-batch-update'), false,
        'the Docs cell never goes through record-batch-update');
    assert.equal(result.journal, 1);
});

test('update-record-docs-text verification fails on a URL-shaped reread (poisoned-slug guard)', async () => {
    const journalPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'repair-java-topology-')), 'journal.json');
    const deps = {
        ...javaTrackTokensFixture(),
        resolveTableId: async () => 'tblTest',
        larkJson: async () => ({}),
        listBitableRecords: async () => [{
            record_id: 'rec-claimant',
            fields: { Docs: { text: 'https://zilliverse.feishu.cn/docx/inFolderScore', link: 'x' }, Slug: [{ text: 'v2-Vector-https://…' }] },
        }],
        // No-retry double: the first failed check must surface immediately.
        verifyWithRetry: async (check) => check(),
    };
    const plan = {
        actions: [{
            kind: 'update-record-docs-text', track: 'v2.6.x', recordId: 'rec-claimant',
            text: 'FunctionScore', link: 'https://zilliverse.feishu.cn/docx/inFolderScore',
        }],
    };
    await assert.rejects(
        executePlan({ plan, approvedDigest: planDigest(plan), journalPath, deps }),
        /not verifiable/,
    );
});

test('part E moves the v3.0.x Collections/Function anchor into its family folder', async () => {
    const plan = await buildPlan(partDDeps({ pageLinkTokens: [], pageMarkdown: 'x' }));
    const move = plan.actions.find((a) => a.ref === 'collections-function-anchor');
    assert.ok(move, 'the anchor move is planned');
    assert.equal(move.kind, 'move-document');
    assert.equal(move.documentToken, 'functionAnchor30');
    assert.equal(move.toFolderToken, 'functionFolder30');
});

function javaTrackTokensFixture() {
    const { registry } = javaTrackTokens();
    return { loadRegistry: () => registry, tokenFetcher: {} };
}

test('part F plans a governed create + linkRef repoint for each dead-linked record, and skips healthy links', async () => {
    const MARKDOWN = 'This operation resets the database properties.\n';
    const plan = await buildPlan(partDDeps({ pageLinkTokens: [], pageMarkdown: MARKDOWN }));
    const creates = plan.actions.filter((a) => a.kind === 'create-document');
    const repoints = plan.actions.filter((a) => a.kind === 'update-record-docs-text' && a.linkRef);
    assert.equal(creates.length, 2, 'v2.4.x and v2.5.x each get a restoration page');
    assert.deepEqual(creates.map((a) => a.track).sort(), ['v2.4.x', 'v2.5.x']);
    for (const create of creates) {
        assert.equal(create.markdown, MARKDOWN, 'the draft is inlined — content-bound by the batch digest');
        assert.equal(create.title, 'dropDatabaseProperties()');
        assert.ok(create.markdownSha256.startsWith('sha256:'));
    }
    assert.equal(repoints.length, 2);
    const repoint24 = repoints.find((a) => a.track === 'v2.4.x');
    assert.equal(repoint24.recordId, 'rec-dead-24');
    assert.equal(repoint24.linkRef, 'restore:v2.4.x');
    assert.equal(repoint24.expectedSlug, 'v2-Database-dropDatabaseProperties');

    // No draft supplied → the plan refuses rather than silently skipping.
    await assert.rejects(
        buildPlan(partDDeps({ pageLinkTokens: [] })),
        /no restoration draft was supplied/,
    );
});

test('part F skips a track whose record already points at a live in-tree page', async () => {
    const plan = await buildPlan(partDDeps({ pageLinkTokens: [], pageMarkdown: 'x', healthy24: true }));
    assert.equal(plan.actions.some((a) => a.kind === 'create-document' && a.track === 'v2.4.x'), false,
        'v2.4.x (healthy in-tree link) gets no restoration');
    assert.equal(plan.actions.some((a) => a.kind === 'create-document' && a.track === 'v2.5.x'), true,
        'v2.5.x (still dead-linked) is restored');
    assert.ok(plan.notes.some((note) => note.includes('v2.4.x') && note.includes('healthy or absent')));
});

test('part F refuses: duplicate dead records, or a missing Database folder', async () => {
    await assert.rejects(
        buildPlan(partDDeps({ pageLinkTokens: [], pageMarkdown: 'x', duplicateDead24: true })),
        /v2\.4\.x carries 2 v2-Database-dropDatabaseProperties records/,
    );
    await assert.rejects(
        buildPlan(partDDeps({ pageLinkTokens: [], pageMarkdown: 'x', missingDbFolder: 'v2.4.x' })),
        /v2\.4\.x has no Database folder under its release root — CREATE_FOLDER_THEN_REPOINT/,
    );
});

test('part E guards: dual anchors refused; already-inside is a note, not an action', async () => {
    await assert.rejects(
        buildPlan(partDDeps({ pageLinkTokens: [], pageMarkdown: 'x', anchorState: 'both' })),
        /BOTH beside and inside the family folder — duplicate class/,
    );
    const inside = await buildPlan(partDDeps({ pageLinkTokens: [], pageMarkdown: 'x', anchorState: 'inside' }));
    assert.equal(inside.actions.some((a) => a.ref === 'collections-function-anchor'), false);
    assert.ok(inside.notes.some((note) => note.includes('already inside the family folder')));
});

test('part F executes: governed create verified by roundtrip, then the repoint binds the new document', async () => {
    const MARKDOWN = 'This operation resets the database properties.\n';
    const journalPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'repair-java-topology-')), 'journal.json');
    const larkCalls = [];
    let governanceBound = 0;
    const deps = {
        ...javaTrackTokensFixture(),
        listFolder: async () => [],
        resolveTableId: async () => 'tblTest',
        larkJson: async (args) => { larkCalls.push(args); return {}; },
        listBitableRecords: async () => [{
            record_id: 'rec-dead-24',
            fields: {
                Docs: { text: 'dropDatabaseProperties()', link: 'https://zilliverse.feishu.cn/docx/newDoc24' },
                Slug: [{ text: 'v2-Database-dropDatabaseProperties' }],
            },
        }],
        verifyWithRetry: async (check) => check(),
        governanceFactory: ({ digest, actionCount }) => {
            governanceBound += 1;
            assert.ok(digest.startsWith('sha256:'));
            assert.equal(actionCount, 2);
            return { bound: true };
        },
        markdownWriterFactory: async (governance) => {
            assert.equal(governance.bound, true, 'the writer receives the governance envelope');
            return { push_markdown: async ({ markdown_content, title, folder_token }) => {
                assert.equal(markdown_content, MARKDOWN);
                assert.equal(title, 'dropDatabaseProperties()');
                assert.equal(folder_token, 'db24');
                return { document_id: 'newDoc24', blocks_created: 7 };
            } };
        },
        refetchMarkdown: async () => MARKDOWN,
    };
    const plan = {
        actions: [
            { kind: 'create-document', ref: 'restore:v2.4.x', track: 'v2.4.x', folderToken: 'db24', title: 'dropDatabaseProperties()', markdown: MARKDOWN, markdownSha256: planDigestOf(MARKDOWN) },
            { kind: 'update-record-docs-text', track: 'v2.4.x', recordId: 'rec-dead-24', text: 'dropDatabaseProperties()', linkRef: 'restore:v2.4.x', expectedSlug: 'v2-Database-dropDatabaseProperties' },
        ],
    };
    const result = await executePlan({ plan, approvedDigest: planDigest(plan), journalPath, deps });
    assert.equal(governanceBound, 1, 'governance binds once per run');
    const put = larkCalls.find((args) => args[0] === 'api' && args[1] === 'PUT');
    const payload = JSON.parse(put.find((arg, i) => put[i - 1] === '--data'));
    assert.deepEqual(payload, { fields: { Docs: { text: 'dropDatabaseProperties()', link: 'https://zilliverse.feishu.cn/docx/newDoc24' } } },
        'the repoint binds the freshly created document via linkRef');
    assert.equal(result.journal, 2);
});

test('part F roundtrip failure rolls the fresh copy back and fails the run', async () => {
    const MARKDOWN = 'draft bytes\n';
    const journalPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'repair-java-topology-')), 'journal.json');
    const larkCalls = [];
    const deps = {
        ...javaTrackTokensFixture(),
        listFolder: async () => [],
        larkJson: async (args) => { larkCalls.push(args); return {}; },
        governanceFactory: () => ({ bound: true }),
        markdownWriterFactory: async () => ({ push_markdown: async () => ({ document_id: 'newDoc24', blocks_created: 7 }) }),
        refetchMarkdown: async () => 'DIFFERENT live bytes\n',
    };
    const plan = {
        actions: [
            { kind: 'create-document', ref: 'restore:v2.4.x', track: 'v2.4.x', folderToken: 'db24', title: 't', markdown: MARKDOWN, markdownSha256: planDigestOf(MARKDOWN) },
        ],
    };
    await assert.rejects(
        executePlan({ plan, approvedDigest: planDigest(plan), journalPath, deps }),
        (error) => /failed round-trip verification.*rolled back/.test(error.message),
    );
    assert.ok(larkCalls.some((args) => args[0] === 'drive' && args[1] === '+delete' && args.includes('newDoc24')),
        'the failed copy is deleted (rollback)');
});

test('a tampered create-document markdown digest is refused before any write', async () => {
    const journalPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'repair-java-topology-')), 'journal.json');
    let writerTouched = false;
    const deps = {
        ...javaTrackTokensFixture(),
        governanceFactory: () => ({ bound: true }),
        markdownWriterFactory: async () => { writerTouched = true; return { push_markdown: async () => { throw new Error('must not run'); } }; },
    };
    const plan = {
        actions: [
            { kind: 'create-document', ref: 'r', track: 'v2.4.x', folderToken: 'db24', title: 't', markdown: 'real bytes\n', markdownSha256: 'sha256:' + '0'.repeat(64) },
        ],
    };
    await assert.rejects(
        executePlan({ plan, approvedDigest: planDigest(plan), journalPath, deps }),
        /markdown digest mismatch/,
    );
    assert.equal(writerTouched, false);
});

test('an expectedSlug mismatch refuses the repoint (the slug must not move)', async () => {
    const journalPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'repair-java-topology-')), 'journal.json');
    const deps = {
        ...javaTrackTokensFixture(),
        resolveTableId: async () => 'tblTest',
        larkJson: async () => ({}),
        listBitableRecords: async () => [{
            record_id: 'rec-dead-24',
            fields: { Docs: { text: 'dropDatabaseProperties()', link: 'x' }, Slug: [{ text: 'v2-Database-DIFFERENT' }] },
        }],
        verifyWithRetry: async (check) => check(),
    };
    const plan = {
        actions: [
            { kind: 'update-record-docs-text', track: 'v2.4.x', recordId: 'rec-dead-24', text: 'dropDatabaseProperties()', link: 'https://zilliverse.feishu.cn/docx/newDoc24', expectedSlug: 'v2-Database-dropDatabaseProperties' },
        ],
    };
    await assert.rejects(
        executePlan({ plan, approvedDigest: planDigest(plan), journalPath, deps }),
        /not verifiable/,
    );
});

test('create-document refuses a replay: a same-named page already in the target folder blocks the write', async () => {
    const journalPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'repair-java-topology-')), 'journal.json');
    let writerTouched = false;
    const deps = {
        ...javaTrackTokensFixture(),
        listFolder: async (folderToken) => (folderToken === 'db24'
            ? [{ token: 'existingCopy', name: 'dropDatabaseProperties()', type: 'docx' }]
            : []),
        governanceFactory: () => ({ bound: true }),
        markdownWriterFactory: async () => { writerTouched = true; return { push_markdown: async () => { throw new Error('must not run'); } }; },
    };
    const plan = {
        actions: [
            { kind: 'create-document', ref: 'restore:v2.4.x', track: 'v2.4.x', folderToken: 'db24', title: 'dropDatabaseProperties()', markdown: 'm', markdownSha256: planDigestOf('m') },
        ],
    };
    await assert.rejects(
        executePlan({ plan, approvedDigest: planDigest(plan), journalPath, deps }),
        /"dropDatabaseProperties\(\)" already exists in db24 \(existingCopy\) — replan/,
    );
    assert.equal(writerTouched, false, 'the writer is never called on a replay clash');
});

test('a refetch EXCEPTION rolls the fresh copy back (not only a mismatch)', async () => {
    const journalPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'repair-java-topology-')), 'journal.json');
    const larkCalls = [];
    const deps = {
        ...javaTrackTokensFixture(),
        listFolder: async () => [],
        larkJson: async (args) => { larkCalls.push(args); return {}; },
        governanceFactory: () => ({ bound: true }),
        markdownWriterFactory: async () => ({ push_markdown: async () => ({ document_id: 'newDoc24', blocks_created: 3 }) }),
        refetchMarkdown: async () => { throw new Error('HTTP 500 from blocks endpoint'); },
    };
    const plan = {
        actions: [
            { kind: 'create-document', ref: 'restore:v2.4.x', track: 'v2.4.x', folderToken: 'db24', title: 't', markdown: 'm', markdownSha256: planDigestOf('m') },
        ],
    };
    await assert.rejects(
        executePlan({ plan, approvedDigest: planDigest(plan), journalPath, deps }),
        (error) => /could not be re-read.*rolled back/.test(error.message),
    );
    assert.ok(larkCalls.some((args) => args[0] === 'drive' && args[1] === '+delete' && args.includes('newDoc24')),
        'the unreadable copy is deleted');
    // The journal records the failure honestly — ok:false with the rollback
    // detail, so a post-mortem never mistakes it for a clean run.
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    assert.equal(journal.journal[0].ok, false);
    assert.match(journal.journal[0].error, /could not be re-read/);
});

test('a repoint whose linkRef was never created is refused before any write', async () => {
    const journalPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'repair-java-topology-')), 'journal.json');
    const deps = {
        ...javaTrackTokensFixture(),
        resolveTableId: async () => 'tblTest',
        larkJson: async () => { throw new Error('must not be called'); },
    };
    const plan = {
        actions: [
            { kind: 'update-record-docs-text', track: 'v2.4.x', recordId: 'rec-x', text: 't()', linkRef: 'restore:v2.4.x' },
        ],
    };
    await assert.rejects(
        executePlan({ plan, approvedDigest: planDigest(plan), journalPath, deps }),
        /unresolved linkRef restore:v2\.4\.x/,
    );
});

test('defaultGovernanceFactory binds a real envelope + run manifest (construction smoke)', () => {
    const { defaultGovernanceFactory } = require('../../../../scripts/repair-java-topology');
    const digest = `sha256:${'a'.repeat(64)}`;
    const governance = defaultGovernanceFactory({ digest, actionCount: 2, targets: ['restore:v2.4.x', 'rec-x'] });
    assert.equal(typeof governance.assertMutationAllowed, 'function');
    // The binding itself is the contract under test: a malformed envelope or
    // manifest shape would have thrown inside bindApproval/bindRunManifest.
});

function planDigestOf(text) {
    const { sha256Digest } = require('../../doc-ops-core/src/digest');
    return sha256Digest(Buffer.from(text, 'utf8'));
}

function deleteAction(overrides = {}) {
    return {
        kind: 'delete-document', ref: 'stray:strayScore', documentToken: 'strayScore', documentName: 'FunctionScore',
        parentFolderToken: 'vec26', duplicateOfToken: 'inFolderScore', duplicateOfParentToken: 'scoreFolder26',
        detail: 'test',
        ...overrides,
    };
}

function deleteDeps({ strayPresent = true, duplicatePresent = true, records = [] } = {}) {
    const { registry } = javaTrackTokens();
    const folders = new Map([
        ['vec26', strayPresent ? [{ token: 'strayScore', name: 'FunctionScore' }] : []],
        ['scoreFolder26', duplicatePresent ? [{ token: 'inFolderScore', name: 'FunctionScore' }] : []],
    ]);
    const spy = [];
    return {
        loadRegistry: () => registry,
        tokenFetcher: {},
        listFolder: async (folderToken) => folders.get(folderToken) || [],
        listBitableRecords: async () => records,
        larkJson: async (args) => { spy.push(args); return {}; },
        larkJsonSpy: spy,
    };
}

test('delete-document re-verifies its premises against live state before firing', async () => {
    const journal = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'repair-java-topology-')), 'j.json');
    const happy = deleteDeps();
    const happyPlan = { actions: [deleteAction()] };
    await executePlan({ plan: happyPlan, approvedDigest: planDigest(happyPlan), journalPath: `${journal}1`, deps: happy });
    assert.ok(happy.larkJsonSpy.some((args) => args[0] === 'drive' && args[1] === '+delete'), 'the delete fires when every premise holds');

    const gone = deleteDeps({ strayPresent: false });
    const gonePlan = { actions: [deleteAction()] };
    await executePlan({ plan: gonePlan, approvedDigest: planDigest(gonePlan), journalPath: `${journal}2`, deps: gone });
    assert.equal(gone.larkJsonSpy.some((args) => args[1] === '+delete'), false, 'an already-absent stray is adopted, not re-deleted');

    const noDuplicate = deleteDeps({ duplicatePresent: false });
    const noDupPlan = { actions: [deleteAction()] };
    await assert.rejects(
        executePlan({ plan: noDupPlan, approvedDigest: planDigest(noDupPlan), journalPath: `${journal}3`, deps: noDuplicate }),
        /retained copy inFolderScore no longer exists/,
    );

    const claimantRecords = [{
        record_id: 'rec-stale',
        fields: { Docs: { text: 'FunctionScore', link: 'https://zilliverse.feishu.cn/docx/strayScore' } },
    }];
    const claimed = deleteDeps({ records: claimantRecords });
    const claimedPlan = { actions: [deleteAction()] };
    await assert.rejects(
        executePlan({ plan: claimedPlan, approvedDigest: planDigest(claimedPlan), journalPath: `${journal}4`, deps: claimed }),
        /record\(s\) still claim the stray strayScore/,
    );

    const drifted = deleteDeps();
    const folders = new Map([['vec26', [{ token: 'strayScore', name: 'SomethingElse' }]], ['scoreFolder26', [{ token: 'inFolderScore', name: 'FunctionScore' }]]]);
    drifted.listFolder = async (token) => folders.get(token) || [];
    const driftedPlan = { actions: [deleteAction()] };
    await assert.rejects(
        executePlan({ plan: driftedPlan, approvedDigest: planDigest(driftedPlan), journalPath: `${journal}5`, deps: drifted }),
        /name drifted/,
    );
});
