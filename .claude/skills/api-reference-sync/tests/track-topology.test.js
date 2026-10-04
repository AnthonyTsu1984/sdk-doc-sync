'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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
const ROOTS = { 'v2.3.x': 'r23', 'v2.4.x': 'r24', 'v2.5.x': 'r25', 'v2.6.x': 'r26', 'v3.0.x': 'r30' };
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

test('a section folder under a foreign (non-chain-older) tree is flagged', () => {
    const result = classifyTrackTopology({
        sections: [{ recordId: 's3', slug: 'v2-Client', token: 'clientFolder25' }],
        pages: [],
        indexes: makeIndexes({ 'v2.5.x': { clientFolder25: 'r25' } }),
        chainVersions: CHAIN,
        ownVersion: 'v3.0.x',
    });
    // v2.5.x IS chain-older than v3.0.x, so this is also a recorded fallback —
    // correctness comes from the chain, not from the adjacent track only.
    assert.deepEqual(result.findings, []);
    const foreign = classifyTrackTopology({
        sections: [{ recordId: 's4', slug: 'v2-Client', token: 'cppFolder' }],
        pages: [],
        indexes: makeIndexes({ 'v3.0.x': { cppFolder: 'r30' } }),
        chainVersions: ['v3.0.x'],
        ownVersion: 'v2.6.x', // a v2.6 section pointing into the NEWER v3.0 tree
    });
    assert.equal(foreign.findings[0]?.code, 'TOPOLOGY_SECTION_FOLDER_FOREIGN');
});

test('pages are placed against their claiming section folder, with longest-prefix section matching', () => {
    assert.equal(sectionForSlug('v2-DataImport-bulkImport', ['v2-Data', 'v2-DataImport']), 'v2-DataImport');
    const authOnly = [SECTIONS[0]];
    const placed = classifyTrackTopology({
        sections: authOnly,
        pages: [{ recordId: 'p1', slug: 'v2-Authentication-addPrivilegesToGroup', token: 'doc1' }],
        indexes: makeIndexes({ 'v3.0.x': { authFolder30: 'r30', doc1: 'authFolder30' } }),
        chainVersions: CHAIN,
        ownVersion: 'v3.0.x',
    });
    assert.deepEqual(placed.findings, []);
    const misplaced = classifyTrackTopology({
        sections: authOnly,
        pages: [{ recordId: 'p2', slug: 'v2-Authentication-createRole', token: 'doc2' }],
        indexes: makeIndexes({
            'v3.0.x': { authFolder30: 'r30', rootLevel: 'r30' },
            'v2.6.x': { vectorFolder26: 'r26', doc2: 'rootLevel' },
        }),
        chainVersions: CHAIN,
        ownVersion: 'v3.0.x',
    });
    const finding = misplaced.findings.find((f) => f.code === 'TOPOLOGY_PAGE_OUTSIDE_SECTION');
    assert.ok(finding, 'misplaced page is flagged');
    assert.match(finding.detail, /v2-Authentication claims authFolder30/);
    // An explicitly exempted page (operator disposition) is surfaced as info.
    const exempted = classifyTrackTopology({
        sections: authOnly,
        pages: [{ recordId: 'p2', slug: 'v2-Authentication-createRole', token: 'doc2' }],
        indexes: makeIndexes({
            'v3.0.x': { authFolder30: 'r30', rootLevel: 'r30' },
            'v2.6.x': { doc2: 'rootLevel' },
        }),
        chainVersions: CHAIN,
        ownVersion: 'v3.0.x',
        pageExemptions: ['v2-Authentication-createRole'],
    });
    assert.deepEqual(
        exempted.findings.map((f) => f.code),
        ['TOPOLOGY_PAGE_EXEMPTED'],
    );
    assert.equal(exempted.findings[0].severity, 'info');
});

test('unresolved sections and pages, and pages with no claiming section, are flagged distinctly', () => {
    const result = classifyTrackTopology({
        sections: [{ recordId: 's9', slug: 'v2-Ghost', token: 'ghostFolder' }],
        pages: [
            { recordId: 'p9', slug: 'v2-Ghost-haunt', token: 'ghostDoc' },
            { recordId: 'p10', slug: 'no-section-prefix', token: 'doc10' },
        ],
        indexes: makeIndexes({}),
        chainVersions: CHAIN,
        ownVersion: 'v3.0.x',
    });
    const codes = result.findings.map((f) => f.code).sort();
    assert.deepEqual(codes, ['TOPOLOGY_PAGE_SECTION_UNKNOWN', 'TOPOLOGY_PAGE_UNRESOLVED', 'TOPOLOGY_SECTION_FOLDER_UNRESOLVED']);
});

test('the shipped decision table config loads and carries the grantPrivilege precedent', () => {
    const config = loadFallbackTopologyConfig(path.join(SKILL_ROOT, 'config', 'fallback-topology.json'));
    const recorded = config.decisionTable.find((entry) => entry.case === 'record-points-at-recorded-fallback-source');
    assert.equal(recorded.action, 'NONE');
    assert.match(recorded.note, /grantPrivilege/);
    assert.equal(config.languages.java.audit, true);
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

test('nested placement under the claiming section folder is correct topology; slug mismatch with correct placement downgrades to info', () => {
    const sections = [{ recordId: 's1', slug: 'v2-Vector', token: 'vectorFolder' }];
    const indexes = makeIndexes({
        'v3.0.x': {
            vectorFolder: 'r30',
            highlighterFolder: 'vectorFolder', // nested subdirectory (Vector/Highlighter)
            docNested: 'highlighterFolder',
            docPlain: 'vectorFolder',
            docElsewhere: 'r30',
        },
    });
    const nested = classifyTrackTopology({
        sections,
        pages: [
            { recordId: 'p1', slug: 'v2-Vector-search', token: 'docNested' },
            { recordId: 'p2', slug: 'v2-Vector-query', token: 'docPlain' },
        ],
        indexes, chainVersions: CHAIN, ownVersion: 'v3.0.x',
    });
    assert.deepEqual(nested.findings, [], 'direct and nested placement both conform');

    const mismatch = classifyTrackTopology({
        sections,
        pages: [{ recordId: 'p3', slug: 'Highlighter', token: 'docPlain' }],
        indexes, chainVersions: CHAIN, ownVersion: 'v3.0.x',
    });
    assert.deepEqual(mismatch.findings.map((f) => `${f.severity}:${f.code}`), ['info:TOPOLOGY_PAGE_SECTION_SLUG_MISMATCH']);

    const unknown = classifyTrackTopology({
        sections,
        pages: [{ recordId: 'p4', slug: 'Highlighter', token: 'docElsewhere' }],
        indexes, chainVersions: CHAIN, ownVersion: 'v3.0.x',
    });
    assert.equal(unknown.findings[0]?.code, 'TOPOLOGY_PAGE_SECTION_UNKNOWN');
});
