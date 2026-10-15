'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SKILL_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SKILL_ROOT, '..', '..');
const SCRIPT = path.join(SKILL_ROOT, 'scripts', 'intake-preflight.js');

function makeContextEntry(overrides = {}) {
    const entry = {
        repository: 'milvus-io/milvus-sdk-java',
        revision: 'r1',
        category: 'v2-Authentication',
        symbolName: 'describeRole',
        kind: 'method',
        title: 'describeRole()',
        summary: 'This operation describes a role.',
        notes: '',
        pr: 'https://github.com/milvus-io/milvus-sdk-java/pull/1',
        reasons: [],
        reviewedEvidence: [{ kind: 'pr', locator: 'API_Reference/x.md', confidence: 'direct' }],
        sourceVariants: [],
        examples: '',
        exceptions: '',
        documentationOwnership: 'owned',
        verbatimContent: 'This operation describes a role.\n',
    };
    return { ...entry, ...overrides };
}

function runPreflight(contexts, extraArgs = []) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-preflight-'));
    const file = path.join(temp, 'contexts.json');
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, contexts }));
    const result = spawnSync(process.execPath, [SCRIPT, '--contexts', file, ...extraArgs], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    });
    return { result, file };
}

test('a compliant context entry passes with zero findings', () => {
    const { result } = runPreflight({ 'java:v2-Authentication:describeRole': makeContextEntry() });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 context entr\(ies\): 0 error\(s\)/);
});

test('the intake failure modes from the campaign retrospective are all flagged', () => {
    const { result } = runPreflight({
        'java:c:chineseSummary': makeContextEntry({ summary: '该操作查询实体。' }),
        'java:c:notesLeak': makeContextEntry({ notes: 'scouting record' }),
        'java:c:verbFirst': makeContextEntry({ summary: 'Deletes entities from the collection.' }),
        'java:c:emptyVerbatim': makeContextEntry({ verbatimContent: '' }),
        'java:c:bareNotesVerbatim': makeContextEntry({ verbatimContent: 'This operation deletes entities.\nNotes\n' }),
        'java:c:missingKeys': (() => { const entry = makeContextEntry(); delete entry.repository; delete entry.summary; return entry; })(),
    });
    assert.notEqual(result.status, 0);
    const codes = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.split(' ')[1]);
    for (const code of [
        'CONTENT_CJK_MIXING',
        'INTAKE_NOTES_KEY_NONEMPTY',
        'INTAKE_SUMMARY_REGISTER',
        'INTAKE_VERBATIM_EMPTY',
        'INTAKE_VERBATIM_BARE_NOTES',
        'INTAKE_CONTEXT_KEYS_MISSING',
    ]) {
        assert.ok(codes.includes(code), `expected ${code} in ${JSON.stringify(codes)}`);
    }
});

test('--allow-missing-verbatim downgrades the empty-verbatim finding; missing PR evidence is a warning', () => {
    const { result } = runPreflight({
        'java:c:noVerbatim': makeContextEntry({ verbatimContent: '', pr: '', reviewedEvidence: [] }),
    }, ['--allow-missing-verbatim']);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /\[warn\] INTAKE_PR_MISSING/);
    assert.doesNotMatch(result.stdout, /INTAKE_VERBATIM_EMPTY/);
});

test('--json emits the schemaVersion 1 report with byCode summary', () => {
    const { result } = runPreflight({ 'java:c:verbFirst': makeContextEntry({ summary: 'Deletes.' }) }, ['--json']);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.summary.byCode.INTAKE_SUMMARY_REGISTER, 1);
});

test('adapter-consumed optional keys (params/result/signature/typeUrls) are not unexpected (review r1)', () => {
    const entry = makeContextEntry({
        params: [{ name: 'collectionName', type: 'String', description: 'The target collection.' }],
        result: { type: 'void', description: '', fields: [] },
        signature: 'void delete(String collectionName)',
        typeUrls: { DataType: 'https://zilliverse.feishu.cn/docx/data-type' },
    });
    const { result } = runPreflight({ 'java:v2-Collections:delete': entry });
    assert.equal(result.status, 0, result.stdout);
    assert.doesNotMatch(result.stdout, /INTAKE_CONTEXT_KEYS_UNEXPECTED/);
});

// Campaign-control hardening batch 3: the style-mirror allowlist. "Accepted
// ≠ correct template" — the v3.0 compact defect spread into v2.6 through
// mirroring accepted-but-defective pages, so a context entry may only
// mirror operator-designated exemplar pages (declared in styleMirrors).
test('a declared style mirror inside the allowlist passes; outside it is refused', () => {
    const { result } = runPreflight({
        'java:v2-Collections:mirrorOk': makeContextEntry({ styleMirrors: ['describeReplicas'] }),
        'java:v2-Collections:mirrorBad': makeContextEntry({ styleMirrors: ['compact'] }),
    });
    assert.notEqual(result.status, 0);
    const codes = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.split(' ')[1]);
    assert.ok(codes.includes('STYLE_MIRROR_SOURCE_NOT_ALLOWLISTED'), JSON.stringify(codes));
    assert.equal(codes.filter((code) => code === 'STYLE_MIRROR_SOURCE_NOT_ALLOWLISTED').length, 1);
    assert.match(result.stdout, /mirror source compact is not in the java style-mirror allowlist/);
});

test('a malformed styleMirrors declaration is its own finding, not a silent pass', () => {
    const { result } = runPreflight({
        'java:v2-Collections:mirrorShape': makeContextEntry({ styleMirrors: ['describeReplicas', 42] }),
        'java:v2-Collections:mirrorType': makeContextEntry({ styleMirrors: 'describeReplicas' }),
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /STYLE_MIRROR_ENTRY_INVALID/);
    // The valid source beside the invalid entry is still judged on its own
    assert.doesNotMatch(result.stdout, /STYLE_MIRROR_SOURCE_NOT_ALLOWLISTED[^\n]*describeReplicas/);
});

test('a malformed allowlist config aborts the run fail-closed (never "everything allowed")', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-preflight-allowlist-'));
    const allowlist = path.join(temp, 'allowlist.json');
    fs.writeFileSync(allowlist, JSON.stringify({ schemaVersion: 1, languages: { java: {} } }));
    const { result } = runPreflight(
        { 'java:v2-Collections:mirror': makeContextEntry({ styleMirrors: ['describeReplicas'] }) },
        ['--mirror-allowlist', allowlist],
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /STYLE_MIRROR_ALLOWLIST_MALFORMED/);
    // The first missing language section is named (profile order), any of them
    assert.match(result.stderr, /languages\.\w+ must carry an allowlist array/);
});

test('entries without styleMirrors never load the allowlist (absence is the reviewed default)', () => {
    // A garbage allowlist must not break campaigns that declare no mirrors
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-preflight-allowlist-'));
    const allowlist = path.join(temp, 'allowlist.json');
    fs.writeFileSync(allowlist, '{ not json');
    const { result } = runPreflight(
        { 'java:v2-Authentication:describeRole': makeContextEntry() },
        ['--mirror-allowlist', allowlist],
    );
    assert.equal(result.status, 0, result.stderr);
});

// --- INTAKE_RELATIVE_LINK_URL (api.absolute-link-urls v2 intake mount) ---
// Failure bytes are the go-v30 campaign's real relative-link family: the
// cross-directory and same-directory forms that blocked b19/b36, the cpp
// same-directory sibling, and the structured-route residue found in
// requestVariants[].inputs[].name / callableMembers[].signature after the
// campaign closed. Fenced code that only SHOWS link syntax stays exempt.

test('relative markdown links are refused at intake across verbatim, summary, and nested structured fields', () => {
    const { result } = runPreflight({
        'go:File:ListFileResources': makeContextEntry({
            repository: 'milvus-io/milvus-sdk-go',
            category: 'File',
            symbolName: 'ListFileResources',
            summary: 'This operation lists file resources. See [guide](../Collection/FunctionScore.md).',
            verbatimContent: '# ListFileResources\n\nSee [search](SearchAggregation.md) and [chain](FunctionChain.md).\n',
        }),
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /INTAKE_RELATIVE_LINK_URL[^\n]*\.\.\/Collection\/FunctionScore\.md/);
    assert.match(result.stdout, /INTAKE_RELATIVE_LINK_URL[^\n]*SearchAggregation\.md/);
    assert.match(result.stdout, /INTAKE_RELATIVE_LINK_URL[^\n]*FunctionChain\.md/);
    // The finding names the field path so the fix is mechanically locatable
    assert.match(result.stdout, /INTAKE_RELATIVE_LINK_URL go:File:ListFileResources — summary line 1:/);
});

test('absolute http(s) links and fenced code that displays link syntax pass clean', () => {
    const { result } = runPreflight({
        'go:File:ListFileResources': makeContextEntry({
            repository: 'milvus-io/milvus-sdk-go',
            category: 'File',
            symbolName: 'ListFileResources',
            summary: 'This operation lists file resources. See [Milvus](https://milvus.io/docs) and the [KB page](https://zilliverse.feishu.cn/docx/AAA).',
            verbatimContent: '# ListFileResources\n\n```java\n// demo: [x](relative-in-code.md)\n```\n',
        }),
    });
    assert.equal(result.status, 0, result.stdout);
});

test('structured-route residue (requestVariants/callableMembers link text) is flagged by the deep walk', () => {
    const { result } = runPreflight({
        'go:Client:DropAlias': makeContextEntry({
            repository: 'milvus-io/milvus-sdk-go',
            category: 'Client',
            symbolName: 'DropAlias',
            verbatimContent: '',
            requestVariants: [{ inputs: [{ name: '[alias](Alias.md)', type: 'string' }] }],
            callableMembers: [{ signature: 'WithDataType(dataType [FieldType](FieldType.md))' }],
        }),
    }, ['--route', 'structured', '--allow-missing-verbatim']);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /INTAKE_RELATIVE_LINK_URL[^\n]*requestVariants\[0\]\.inputs\[0\]\.name[^\n]*Alias\.md/);
    assert.match(result.stdout, /INTAKE_RELATIVE_LINK_URL[^\n]*callableMembers\[0\]\.signature[^\n]*FieldType\.md/);
});

test('builder organization keys on a stateful-class entry are not unexpected', () => {
    const entry = makeContextEntry({
        organization: {
            schemaVersion: 1,
            profileId: 'node-stateful-class',
            profileVersion: 1,
            reviewed: true,
            groupingChange: false,
            classRecord: { stableId: 'node:DataImport:BulkWriter', title: 'BulkWriter', recordId: 'recx', recordType: 'Class', docsResourceType: 'docx', parentRecordType: 'VirtualNode', virtualNode: false, parentRecordId: 'recvn' },
            drive: { layout: 'same_named_class_folder', folderName: 'BulkWriter', folderRef: 'res:folder-BulkWriter', landingDocumentInside: true, methodDocumentsInside: true },
            methodInventory: { complete: true, publicMethodStableIds: ['node:DataImport:BulkWriter:append'] },
            methods: [{ stableId: 'node:DataImport:BulkWriter:append', recordType: 'Function', parentRecordId: 'recx' }],
        },
        organizationInventory: { classStableId: 'node:DataImport:BulkWriter' },
    });
    const { result } = runPreflight({ 'node:DataImport:BulkWriter': entry });
    assert.equal(result.status, 0, result.stdout);
    assert.doesNotMatch(result.stdout, /INTAKE_CONTEXT_KEYS_UNEXPECTED/);
});

// --- §9 route discovery: --route auto is the default, judged per entry ---
// go/python preflights failed structured-route files because the verbatim
// default judged the nine structured keys unexpected; the node campaign
// legitimately ships mixed files, so the verdict is per entry.

function makeStructuredEntry(overrides = {}) {
    // The structured contract: no kind/pr/verbatimContent, planning evidence instead.
    const entry = makeContextEntry();
    delete entry.kind;
    delete entry.pr;
    delete entry.verbatimContent;
    return {
        ...entry,
        target: { version: 'v3.0.x', parentRecordId: 'rec-parent', folderToken: 'folder-x', versionRootToken: 'root-x', ancestryVerified: true },
        current: { version: 'v2.6.x', recordId: 'rec-a', documentToken: 'docx-a', folderToken: 'folder-a', ancestryVerified: true },
        placementWalk: { digest: 'sha256:walk', collectedAt: '2026-10-15T00:00:00.000Z' },
        ...overrides,
    };
}

test('auto (the default) routes a structured entry by its structured keys and passes it clean', () => {
    const { result } = runPreflight({ 'go:Client:ListFileResources': makeStructuredEntry() });
    assert.equal(result.status, 0, result.stdout);
    assert.doesNotMatch(result.stdout, /INTAKE_CONTEXT_KEYS_UNEXPECTED/);
    assert.doesNotMatch(result.stdout, /INTAKE_VERBATIM_EMPTY/);
    assert.match(result.stdout, /route \(auto\): 1 structured, 0 verbatim/);
});

test('the same structured file under explicit --route verbatim keeps the legacy refusal', () => {
    const { result } = runPreflight(
        { 'go:Client:ListFileResources': makeStructuredEntry() },
        ['--route', 'verbatim'],
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /INTAKE_CONTEXT_KEYS_UNEXPECTED[^\n]*unexpected current, placementWalk, target/);
    assert.match(result.stdout, /INTAKE_CONTEXT_KEYS_MISSING[^\n]*missing kind, pr, verbatimContent/);
});

test('a verbatim entry under auto still requires the verbatim contract', () => {
    const { result } = runPreflight({
        'go:Client:DropAlias': makeContextEntry({ verbatimContent: '' }),
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /INTAKE_VERBATIM_EMPTY/);
    assert.match(result.stdout, /route \(auto\): 0 structured, 1 verbatim/);
});

test('a mixed file (node 139+20 shape) is judged per entry and both routes pass', () => {
    const entries = {};
    for (let index = 0; index < 2; index += 1) {
        entries[`go:Client:structured${index}`] = makeStructuredEntry();
    }
    entries['go:Client:verbatimFallback'] = makeContextEntry();
    const { result, file } = runPreflight(entries, ['--json']);
    assert.equal(result.status, 0, result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.route, 'auto');
    assert.deepEqual(report.entryRoutes, {
        'go:Client:structured0': 'structured',
        'go:Client:structured1': 'structured',
        'go:Client:verbatimFallback': 'verbatim',
    });
    assert.deepEqual(report.summary.routes, { mode: 'auto', structured: 2, verbatim: 1 });
    assert.equal(report.summary.errors, 0);
    // The mixed verdict only holds for this file; nothing else was read.
    assert.ok(fs.existsSync(file));
});

test('findings carry the route that judged their entry', () => {
    const { result } = runPreflight({
        'go:Client:structured': makeStructuredEntry({ notes: 'scouting record' }),
        'go:Client:verbatim': makeContextEntry({ verbatimContent: '' }),
    }, ['--json']);
    const report = JSON.parse(result.stdout);
    assert.notEqual(result.status, 0);
    const byIdentity = Object.fromEntries(report.findings.map((finding) => [finding.identity, finding]));
    assert.equal(byIdentity['go:Client:structured'].route, 'structured');
    assert.equal(byIdentity['go:Client:verbatim'].route, 'verbatim');
    assert.equal(byIdentity['go:Client:structured'].code, 'INTAKE_NOTES_KEY_NONEMPTY');
    assert.equal(byIdentity['go:Client:verbatim'].code, 'INTAKE_VERBATIM_EMPTY');
});

test('--route auto is accepted explicitly and an unknown route value is refused', () => {
    const { result } = runPreflight({ 'java:v2-Authentication:describeRole': makeContextEntry() }, ['--route', 'auto']);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /route \(auto\): 0 structured, 1 verbatim/);

    const bad = runPreflight({ 'java:v2-Authentication:describeRole': makeContextEntry() }, ['--route', 'magic']);
    assert.equal(bad.result.status, 1);
    assert.match(bad.result.stderr, /--route must be auto, verbatim, or structured/);
});
