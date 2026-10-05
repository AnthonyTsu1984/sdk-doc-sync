'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    REVISION_RULING,
    buildRevisionScope,
    groupFindingsByToken,
} = require('../scripts/build-revision-scope');

function recordsFor(track, rows) {
    return rows.map((row) => ({
        recordId: row.recordId,
        title: row.title,
        link: `https://example.feishu.cn/docx/${row.token}`,
        documentToken: row.token,
        slug: row.slug || '',
        type: 'page',
        parentRecordIds: [],
        raw: {},
        track,
    }));
}

const BASE_RECORDS = () => new Map([
    ['v3.0.x', recordsFor('v3.0.x', [
        { recordId: 'recA', title: 'LexicalHighlighter', token: 'tokA', slug: 'v3-LexicalHighlighter' },
        { recordId: 'recB', title: 'Vector get', token: 'tokB', slug: 'v3-Vector-get' },
        { recordId: 'recC', title: 'Shared page', token: 'tokC', slug: 'v3-Shared' },
    ])],
    ['v2.6.x', recordsFor('v2.6.x', [
        { recordId: 'recD', title: 'Shared page', token: 'tokC', slug: 'v2-Shared' },
        { recordId: 'recE', title: 'Other track page', token: 'tokE', slug: 'v2-Other' },
    ])],
]);

const BASE_FINDINGS = () => [
    { severity: 'error', code: 'RETURNS_MIN_DEPTH', identity: 'tokA', detail: 'RETURNS section carries no response-fields PARAMETERS list' },
    { severity: 'error', code: 'LAYOUT_RETURN_TYPE_MISSING', identity: 'tokA', detail: 'no RETURN TYPE section' },
    { severity: 'error', code: 'FIRST_SENTENCE_REGISTER', identity: 'tokB', detail: 'first sentence not in a declared register' },
    { severity: 'error', code: 'INTERNAL_NOTE_LEAK', identity: 'tokC', detail: 'internal note text on page' },
    { severity: 'error', code: 'RETURNS_MIN_DEPTH', identity: 'tokE', detail: 'another track defect' },
    { severity: 'warn', code: 'SOME_WARN', identity: 'tokA', detail: 'warnings are excluded' },
];

test('buildRevisionScope groups findings per page and excludes other tracks', () => {
    const artifact = buildRevisionScope({
        sweep: { generatedAt: '2026-10-05T00:00:00.000Z', sameNameSiblings: { unresolvedTracks: [], summary: { orphanCopies: 0, misplacedCopies: 0, trackConflicts: 0 } } },
        findings: BASE_FINDINGS(),
        recordsByTrack: BASE_RECORDS(),
        track: 'v3.0.x',
        revision: 'v3.0.10',
        generatedAt: '2026-10-05T01:00:00.000Z',
    });

    assert.equal(artifact.kind, 'java-revision-scope');
    assert.equal(artifact.track, 'v3.0.x');
    assert.equal(artifact.actions.length, 3);
    assert.deepEqual(artifact.actions.map((action) => action.stableId), [
        'java:v3-LexicalHighlighter',
        'java:v3-Shared',
        'java:v3-Vector-get',
    ]);

    const lexical = artifact.actions[0];
    assert.equal(lexical.type, 'UPDATE');
    assert.equal(lexical.documentToken, 'tokA');
    assert.equal(lexical.reason, 'LAYOUT_RETURN_TYPE_MISSING,RETURNS_MIN_DEPTH');
    assert.deepEqual(lexical.defects.map((defect) => defect.code), ['LAYOUT_RETURN_TYPE_MISSING', 'RETURNS_MIN_DEPTH']);
    assert.equal(lexical.evidence[0].kind, 'conformance');
    assert.equal(lexical.evidence[0].locator, 'feishu-docx:tokA');
    assert.equal(lexical.source.revision, 'v3.0.10');

    assert.deepEqual(artifact.summary.byCode, {
        FIRST_SENTENCE_REGISTER: 1,
        INTERNAL_NOTE_LEAK: 1,
        LAYOUT_RETURN_TYPE_MISSING: 1,
        RETURNS_MIN_DEPTH: 1,
    });
    assert.equal(artifact.summary.pages, 3);
});

test('buildRevisionScope marks cross-track shared pages update-in-place', () => {
    const artifact = buildRevisionScope({
        sweep: { sameNameSiblings: { unresolvedTracks: [], summary: null } },
        findings: BASE_FINDINGS(),
        recordsByTrack: BASE_RECORDS(),
        track: 'v3.0.x',
        revision: 'v3.0.10',
        generatedAt: '2026-10-05T01:00:00.000Z',
    });

    const shared = artifact.actions.find((action) => action.documentToken === 'tokC');
    assert.equal(shared.shared, true);
    assert.deepEqual(shared.sharedWith, ['v2.6.x']);
    assert.deepEqual(artifact.sharedPages, [{ documentToken: 'tokC', tracks: ['v2.6.x'] }]);
    assert.equal(artifact.sharedPagesPolicy, 'update-in-place');
});

test('buildRevisionScope refuses a token matching multiple target-track records', () => {
    const recordsByTrack = BASE_RECORDS();
    recordsByTrack.get('v3.0.x').push(recordsFor('v3.0.x', [
        { recordId: 'recA2', title: 'LexicalHighlighter copy', token: 'tokA', slug: 'v3-LexicalHighlighter-copy' },
    ])[0]);

    assert.throws(() => buildRevisionScope({
        sweep: { sameNameSiblings: { unresolvedTracks: [], summary: null } },
        findings: BASE_FINDINGS(),
        recordsByTrack,
        track: 'v3.0.x',
        revision: 'v3.0.10',
        generatedAt: '2026-10-05T01:00:00.000Z',
    }), /matches 2 v3\.0\.x records/);
});

test('buildRevisionScope refuses a target-track record without a Slug', () => {
    const recordsByTrack = BASE_RECORDS();
    recordsByTrack.set('v3.0.x', recordsFor('v3.0.x', [
        { recordId: 'recA', title: 'No slug page', token: 'tokA', slug: '' },
    ]));

    assert.throws(() => buildRevisionScope({
        sweep: { sameNameSiblings: { unresolvedTracks: [], summary: null } },
        findings: BASE_FINDINGS(),
        recordsByTrack,
        track: 'v3.0.x',
        revision: 'v3.0.10',
        generatedAt: '2026-10-05T01:00:00.000Z',
    }), /has no Slug/);
});

test('groupFindingsByToken excludes warnings and sorts defects deterministically', () => {
    const grouped = groupFindingsByToken(BASE_FINDINGS());
    assert.deepEqual([...grouped.keys()].sort(), ['tokA', 'tokB', 'tokC', 'tokE']);
    assert.deepEqual(grouped.get('tokA').map((defect) => defect.code), ['LAYOUT_RETURN_TYPE_MISSING', 'RETURNS_MIN_DEPTH']);
});

test('buildRevisionScope carries the ruling and topology echo', () => {
    const artifact = buildRevisionScope({
        sweep: { sameNameSiblings: { invariantId: 'api.same-name-sibling-placement', unresolvedTracks: [], summary: { groups: 148, dualTrackPairs: 148, orphanCopies: 0, misplacedCopies: 0, trackConflicts: 0 } } },
        findings: BASE_FINDINGS(),
        recordsByTrack: BASE_RECORDS(),
        track: 'v3.0.x',
        revision: 'v3.0.10',
        generatedAt: '2026-10-05T01:00:00.000Z',
    });
    assert.equal(artifact.ruling, REVISION_RULING);
    assert.equal(artifact.topologyAudit.invariantId, 'api.same-name-sibling-placement');
    assert.deepEqual(artifact.topologyAudit.unresolvedTracks, []);
});
