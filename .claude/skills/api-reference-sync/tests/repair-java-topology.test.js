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
// the stray. v3.0.x is already in its post-disposition shape so parts A–C
// stay dormant.
function partDDeps({ pageLinkTokens = [] } = {}) {
    const { registry, byVersion } = javaTrackTokens();
    const v26 = byVersion.get('v2.6.x');
    const v30 = byVersion.get('v3.0.x');
    const entry = (token, name, type, parentFolderToken, extra = {}) => ({ token, name, type, parentFolderToken, ancestors: [], ...extra });
    const indexV26 = new Map([
        ['root26', entry('root26', 'v2.6 root', 'folder', null)],
        ['vec26', entry('vec26', 'Vector', 'folder', 'root26')],
        ['scoreFolder26', entry('scoreFolder26', 'FunctionScore', 'folder', 'vec26')],
        ['strayScore', entry('strayScore', 'FunctionScore', 'docx', 'vec26')],
        ['inFolderScore', entry('inFolderScore', 'FunctionScore', 'docx', 'scoreFolder26')],
    ]);
    const indexV30 = new Map([
        ['root30', entry('root30', 'v3.0 root', 'folder', null)],
        ['vec30', entry('vec30', 'Vector', 'folder', 'root30')],
        ['chainUnderVector', entry('chainUnderVector', 'FunctionChain', 'folder', 'vec30')],
        ['scoreUnderVector', entry('scoreUnderVector', 'FunctionScore', 'folder', 'vec30')],
    ]);
    const recordsV26 = [{
        record_id: 'rec-claimant',
        fields: {
            Docs: { text: 'FunctionScore', link: 'https://zilliverse.feishu.cn/docx/strayScore' },
            Slug: [{ text: 'v2-Vector-FunctionScore' }],
            Type: 'Page',
        },
    }];
    const recordsV30 = [];
    return {
        registry,
        pageLinkTokens,
        tokenFetcher: {},
        indexVersionRoot: async (fetcher, rootToken) => (rootToken === v26.rootToken ? indexV26 : indexV30),
        listBitableRecords: async (fetcher, baseToken) => (baseToken === v26.baseToken ? recordsV26 : recordsV30),
        listFolder: async () => [],
        // Exposed for executePlan-style assertions.
        indexV26, recordsV26, v26, v30,
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
    const deps = partDDeps();
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

function javaTrackTokensFixture() {
    const { registry } = javaTrackTokens();
    return { loadRegistry: () => registry, tokenFetcher: {} };
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
