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
