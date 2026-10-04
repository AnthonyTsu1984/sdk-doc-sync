'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
    TOPOLOGY_INVARIANT_ID,
    classifyTrackTopology,
    loadFallbackTopologyConfig,
    sectionForSlug,
} = require('../src/sdk-doc-sync/track-topology');

const SKILL_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SKILL_ROOT, '..', '..');

function makeIndexes(map) {
    // map: { version: { token: parentFolderToken } } — ancestors are derived
    // by walking the parent chain, mirroring indexVersionRoot semantics.
    const indexes = new Map();
    for (const [version, tokens] of Object.entries(map)) {
        const entries = new Map(Object.entries(tokens).map(([token, parentFolderToken]) => [token, { parentFolderToken }]));
        for (const [token, entry] of entries) {
            const ancestors = [];
            const seen = new Set([token]);
            let current = entry.parentFolderToken;
            while (current && !seen.has(current) && entries.has(current)) {
                ancestors.push(current);
                seen.add(current);
                current = entries.get(current).parentFolderToken;
            }
            if (current && !seen.has(current)) ancestors.push(current); // release root
            entry.ancestors = ancestors;
        }
        indexes.set(version, entries);
    }
    return indexes;
}

const CHAIN = ['v2.3.x', 'v2.4.x', 'v2.5.x', 'v2.6.x', 'v3.0.x'];
const SECTIONS = [
    { recordId: 's1', slug: 'v2-Authentication', token: 'authFolder30' },
    { recordId: 's2', slug: 'v2-Vector', token: 'vectorFolder26' }, // lives in the v2.6 tree — recorded fallback
];

test('in-tree and recorded-fallback section folders are both correct topology (grantPrivilege precedent)', () => {
    const result = classifyTrackTopology({
        sections: SECTIONS,
        pages: [],
        indexes: makeIndexes({
            'v3.0.x': { authFolder30: 'r30' },
            'v2.6.x': { vectorFolder26: 'r26' },
        }),
        chainVersions: CHAIN,
        ownVersion: 'v3.0.x',
    });
    assert.equal(result.invariantId, TOPOLOGY_INVARIANT_ID);
    assert.deepEqual(result.findings, []);
});

test('page-level fallback is the designed form: a page document in an OLDER tree is clean; a NEWER tree is a forward-cross error', () => {
    const fallback = classifyTrackTopology({
        sections: [{ recordId: 's1', slug: 'v2-Authentication', token: 'authFolder30' }],
        pages: [{ recordId: 'p1', slug: 'v2-Authentication-addPrivilegesToGroup', token: 'docOld' }],
        // v3.0 section claims the own-tree folder; the page document lives in
        // the v2.6 tree — fetch assembly resolves this, it is NOT a defect.
        indexes: makeIndexes({
            'v3.0.x': { authFolder30: 'r30' },
            'v2.6.x': { docOld: 'someV26Folder' },
        }),
        chainVersions: CHAIN,
        ownVersion: 'v3.0.x',
    });
    assert.deepEqual(fallback.findings, []);

    const forward = classifyTrackTopology({
        sections: [{ recordId: 's2', slug: 'v2-Vector', token: 'vectorFolder26' }],
        pages: [{ recordId: 'p2', slug: 'v2-Vector-search', token: 'docNew' }],
        indexes: makeIndexes({
            'v2.6.x': { vectorFolder26: 'r26' },
            'v3.0.x': { docNew: 'someV30Folder' },
        }),
        chainVersions: CHAIN,
        ownVersion: 'v2.6.x',
    });
    const finding = forward.findings.find((f) => f.code === 'TOPOLOGY_PAGE_OUTSIDE_SECTION');
    assert.ok(finding, 'forward cross is flagged');
    assert.match(finding.detail, /NEWER tree/);
});

test('record Slug fields carrying pasted URLs are flagged (the 2026-10-04 operator-confirmed defect class)', () => {
    const result = classifyTrackTopology({
        sections: [{ recordId: 'recX', slug: 'v2-https://zilliverse.feishu.cn/drive/folder/GBH2f7LY', token: 'dbFolder' }],
        pages: [
            { recordId: 'recY', slug: 'v2-https://zilliverse.feishu.cn/drive/folder/GBH2f7LY-createDatabase', token: 'docDb' },
            { recordId: 'recZ', slug: 'v2-Database-dropDatabase', token: 'docDb2' },
        ],
        indexes: makeIndexes({ 'v3.0.x': { dbFolder: 'r30', docDb: 'dbFolder', docDb2: 'dbFolder' } }),
        chainVersions: ['v3.0.x'],
        ownVersion: 'v3.0.x',
    });
    const urlFindings = result.findings.filter((f) => f.code === 'TOPOLOGY_RECORD_SLUG_URL');
    assert.equal(urlFindings.length, 2, 'section and page records both flagged');
    assert.equal(urlFindings.every((f) => f.severity === 'error'), true);
    assert.match(urlFindings[0].detail, /text=<section name>/);
});

test('file-anchor families are sanctioned: unclaimed slugs are info observations, and nested placement is clean', () => {
    const sections = [{ recordId: 's1', slug: 'v2-Vector', token: 'vectorFolder' }];
    const indexes = makeIndexes({
        'v3.0.x': {
            vectorFolder: 'r30',
            highlighterFolder: 'vectorFolder', // nested subdirectory (Vector/Highlighter)
            docNested: 'highlighterFolder',
            anchorDoc: 'vectorFolder',
        },
    });
    const nested = classifyTrackTopology({
        sections,
        pages: [{ recordId: 'p1', slug: 'v2-Vector-search', token: 'docNested' }],
        indexes, chainVersions: CHAIN, ownVersion: 'v3.0.x',
    });
    assert.deepEqual(nested.findings, []);

    // A family page whose slug claims no folder-recorded section: file
    // anchors are a sanctioned form, so this is an info observation.
    const fileAnchored = classifyTrackTopology({
        sections,
        pages: [{ recordId: 'p2', slug: 'Highlighter', token: 'anchorDoc' }],
        indexes, chainVersions: CHAIN, ownVersion: 'v3.0.x',
    });
    assert.deepEqual(fileAnchored.findings.map((f) => `${f.severity}:${f.code}`), ['info:TOPOLOGY_PAGE_SECTION_UNKNOWN']);
});

test('a section folder under a foreign (non-chain-older) tree is flagged', () => {
    const foreign = classifyTrackTopology({
        sections: [{ recordId: 's4', slug: 'v2-Client', token: 'clientFolder30' }],
        pages: [],
        indexes: makeIndexes({ 'v3.0.x': { clientFolder30: 'r30' } }),
        chainVersions: ['v2.6.x', 'v3.0.x'],
        ownVersion: 'v2.6.x', // a v2.6 section pointing into the NEWER v3.0 tree
    });
    assert.equal(foreign.findings[0]?.code, 'TOPOLOGY_SECTION_FOLDER_FOREIGN');
});

test('unresolved sections and documents are flagged distinctly; longest-prefix section matching works', () => {
    assert.equal(sectionForSlug('v2-DataImport-bulkImport', ['v2-Data', 'v2-DataImport']), 'v2-DataImport');
    const result = classifyTrackTopology({
        sections: [{ recordId: 's9', slug: 'v2-Ghost', token: 'ghostFolder' }],
        pages: [{ recordId: 'p9', slug: 'v2-Ghost-haunt', token: 'ghostDoc' }],
        indexes: makeIndexes({}),
        chainVersions: CHAIN,
        ownVersion: 'v3.0.x',
    });
    const codes = result.findings.map((f) => f.code).sort();
    assert.deepEqual(codes, ['TOPOLOGY_PAGE_UNRESOLVED', 'TOPOLOGY_SECTION_FOLDER_UNRESOLVED']);
    assert.equal(result.findings.every((f) => f.severity === 'error'), true);
});

test('the shipped decision table config loads and carries the grantPrivilege precedent', () => {
    const config = loadFallbackTopologyConfig(path.join(SKILL_ROOT, 'config', 'fallback-topology.json'));
    const recorded = config.decisionTable.find((entry) => entry.case === 'record-points-at-recorded-fallback-source');
    assert.equal(recorded.action, 'NONE');
    assert.match(recorded.note, /grantPrivilege/);
    assert.equal(config.languages.java.audit, true);
});

test('the decision table is load-bearing: a missing fallback-source NONE row or an unknown same-name policy is refused', () => {
    const sections = [{ recordId: 's1', slug: 'v2-Authentication', token: 'authFolder' }];
    const indexes = makeIndexes({ 'v3.0.x': { authFolder: 'r30' } });
    const base = { sections, pages: [], indexes, chainVersions: ['v3.0.x'], ownVersion: 'v3.0.x' };
    assert.throws(
        () => classifyTrackTopology({ ...base, decisionTable: [{ case: 'fallback-source-changed', action: 'COPY_PATCH_AND_REPOINT' }] }),
        /record-points-at-recorded-fallback-source.*NONE/,
    );
    assert.throws(
        () => classifyTrackTopology({ ...base, sameNamePolicy: 'sometimes-fine' }),
        /unsupported sameNameInOneDirectory policy/,
    );
});

test('sameNameInOneDirectory: a document beside a same-named folder is the stray-duplicate error class', () => {
    const indexes = makeIndexes({
        'v2.6.x': {
            vecFolder: 'r26',
            scoreFolder: 'vecFolder',
            strayScore: 'vecFolder',
            inFolderScore: 'scoreFolder',
        },
    });
    // Entries must carry name and type for the policy scan.
    indexes.get('v2.6.x').get('vecFolder').name = 'Vector';
    indexes.get('v2.6.x').get('vecFolder').type = 'folder';
    indexes.get('v2.6.x').get('scoreFolder').name = 'FunctionScore';
    indexes.get('v2.6.x').get('scoreFolder').type = 'folder';
    indexes.get('v2.6.x').get('strayScore').name = 'FunctionScore';
    indexes.get('v2.6.x').get('strayScore').type = 'docx';
    indexes.get('v2.6.x').get('inFolderScore').name = 'FunctionScore';
    indexes.get('v2.6.x').get('inFolderScore').type = 'docx';
    const result = classifyTrackTopology({
        sections: [], pages: [], indexes,
        chainVersions: ['v2.6.x'], ownVersion: 'v2.6.x',
        sameNamePolicy: 'always-a-defect',
    });
    const finding = result.findings.find((f) => f.code === 'TOPOLOGY_SAME_NAME_SIBLING');
    assert.ok(finding, 'the beside-the-folder copy is flagged');
    assert.equal(finding.severity, 'error');
    assert.equal(finding.identity, 'FunctionScore');
    assert.match(finding.detail, /strayScore/);
    assert.equal(result.findings.some((f) => f.code === 'TOPOLOGY_SAME_NAME_SIBLING' && /inFolderScore/.test(f.detail)), false,
        'the in-folder copy (different directory) is not flagged');
    // Without the policy the scan does not run.
    const withoutPolicy = classifyTrackTopology({ sections: [], pages: [], indexes, chainVersions: ['v2.6.x'], ownVersion: 'v2.6.x' });
    assert.deepEqual(withoutPolicy.findings, []);
});

test('recorded fallback sections are counted in the summary under the decision case', () => {
    const result = classifyTrackTopology({
        sections: SECTIONS, // s2 (v2-Vector) lives in the older v2.6 tree
        pages: [],
        indexes: makeIndexes({
            'v3.0.x': { authFolder30: 'r30' },
            'v2.6.x': { vectorFolder26: 'r26' },
        }),
        chainVersions: CHAIN,
        ownVersion: 'v3.0.x',
    });
    assert.deepEqual(result.findings, []);
    assert.equal(result.summary.fallbackSourceSections, 1);
});

test('an ownVersion outside the chain is refused instead of silently judging nothing', () => {
    assert.throws(
        () => classifyTrackTopology({
            sections: [], pages: [], indexes: makeIndexes({}),
            chainVersions: ['v2.6.x', 'v3.0.x'], ownVersion: 'v2.5.x',
        }),
        /ownVersion v2\.5\.x is not in the chain/,
    );
});

test('the audit CLI rejects an unknown argument and requires --language', () => {
    const script = path.join(SKILL_ROOT, 'scripts', 'audit-track-topology.js');
    const bad = spawnSync(process.execPath, [script, '--language', 'java', '--nope'], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /Unknown argument/);
    const missing = spawnSync(process.execPath, [script], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /--language is required/);
});
