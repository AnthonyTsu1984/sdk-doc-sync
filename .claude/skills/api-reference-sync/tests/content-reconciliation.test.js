'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    classifySameNameSiblings,
    collectDocumentTokens,
    normalizeSiblingTitle,
    reconcileContentInventory,
    reconcileCalloutBlocks,
    reconcileContextVerbatim,
} = require('../src/sdk-doc-sync/content-reconciliation');
const { verbatimContentDigest } = require('../src/sdk-doc-sync/verbatim-content');

test('collectDocumentTokens extracts docx tokens from percent-encoded link payloads', () => {
    const tokens = collectDocumentTokens({
        elements: [{
            text_run: {
                content: 'See FunctionChain.',
                text_element_style: {
                    link: { url: 'https://zilliverse.feishu.cn/docx/AbCdEf123456AbCdEf1234%3Fidx%3D1' },
                },
            },
        }],
    });
    assert.deepEqual([...tokens], ['AbCdEf123456AbCdEf1234']);
});

test('collectDocumentTokens keeps tokens containing hyphens and underscores', () => {
    const tokens = collectDocumentTokens(
        'https://zilliverse.feishu.cn/wiki/AbCdEf-12345_AbCdEf123456',
    );
    assert.deepEqual([...tokens], ['AbCdEf-12345_AbCdEf123456']);
});

test('reconcileContentInventory reports only unreferenced documents as orphan candidates', () => {
    const { findings } = reconcileContentInventory({
        records: [{ recordId: 'rec-1', documentToken: 'DOCA' }, { recordId: 'rec-2', documentToken: 'DOCB' }],
        folderDocuments: ['DOCA', 'DOCB', 'DOCORPHAN', 'DOCB'],
        pageLinkTokens: [],
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'CONTENT_ORPHAN_DOCUMENT');
    assert.equal(findings[0].severity, 'warning');
    assert.equal(findings[0].identity, 'DOCORPHAN');
});

test('reconcileContentInventory honours exceptTokens and cross-track pointers', () => {
    // Cross-track shared document: pointed by the other track's record, so
    // language-wide pointers keep it out of the orphan report.
    const shared = reconcileContentInventory({
        records: [{ recordId: 'rec-26', track: 'v2.6.x', documentToken: 'DOCSHARED' }],
        folderDocuments: ['DOCSHARED', 'DOCLOOSE'],
        pageLinkTokens: [],
    });
    assert.deepEqual(shared.findings.map((finding) => finding.identity), ['DOCLOOSE']);

    // exceptTokens: tokens already reported by the same-name classifier are
    // not double-reported as generic orphans.
    const excepted = reconcileContentInventory({
        records: [],
        folderDocuments: ['DOCSAME', 'DOCLOOSE'],
        pageLinkTokens: [],
        exceptTokens: ['DOCSAME'],
    });
    assert.deepEqual(excepted.findings.map((finding) => finding.identity), ['DOCLOOSE']);
});

test('normalizeSiblingTitle collapses whitespace and keeps case-significant method names', () => {
    assert.equal(normalizeSiblingTitle('  DropIndex()  '), 'DropIndex()');
    assert.equal(normalizeSiblingTitle('Drop\n Index()\t'), 'Drop Index()');
    assert.notEqual(normalizeSiblingTitle('hasPartition'), normalizeSiblingTitle('HasPartition'));
});

test('classifySameNameSiblings protects correctly placed cross-track pairs', () => {
    const { findings, groups } = classifySameNameSiblings({
        folderEntries: [
            { token: 'OLDSHARED000000000000001', name: 'FlushAll()', parentToken: 'folder-mgmt-v26', roots: ['root-v26'] },
            { token: 'NEWSHARED000000000000001', name: 'FlushAll()', parentToken: 'folder-mgmt-v30', roots: ['root-v30'] },
        ],
        records: [
            { recordId: 'rec-26', track: 'v2.6.x', documentToken: 'OLDSHARED000000000000001' },
            { recordId: 'rec-30', track: 'v3.0.x', documentToken: 'NEWSHARED000000000000001' },
        ],
        pageLinkTokens: [],
        trackRoots: [
            { version: 'v2.6.x', releaseRootToken: 'root-v26' },
            { version: 'v3.0.x', releaseRootToken: 'root-v30' },
        ],
    });
    assert.deepEqual(findings, []);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].state, 'multi-track-pair');
    assert.ok(groups[0].disposition.includes('never a dedup or cleanup candidate'));
});

test('classifySameNameSiblings flags a newer-track copy copied into the older tree', () => {
    // The v3.0-pointed copy of the pair landed next to the original in the
    // v2.6.x folder — the 2026-10-03 copy-patch placement hole.
    const { findings, groups } = classifySameNameSiblings({
        folderEntries: [
            { token: 'OLDDB0000000000000000001', name: 'DropDatabase()', parentToken: 'folder-db-v26', roots: ['root-v26'] },
            { token: 'NEWDB0000000000000000001', name: 'DropDatabase()', parentToken: 'folder-db-v26', roots: ['root-v26'] },
        ],
        records: [
            { recordId: 'rec-26', track: 'v2.6.x', documentToken: 'OLDDB0000000000000000001' },
            { recordId: 'rec-30', track: 'v3.0.x', documentToken: 'NEWDB0000000000000000001' },
        ],
        pageLinkTokens: [],
        trackRoots: [
            { version: 'v2.6.x', releaseRootToken: 'root-v26' },
            { version: 'v3.0.x', releaseRootToken: 'root-v30' },
        ],
    });
    assert.deepEqual(findings.map((finding) => finding.code), ['SAME_NAME_COPY_MISPLACED']);
    assert.equal(findings[0].severity, 'warning');
    assert.equal(findings[0].identity, 'NEWDB0000000000000000001');
    assert.equal(groups[0].state, 'misplaced-copy');
});

test('classifySameNameSiblings reports zero-row copies as orphan candidates', () => {
    const { findings } = classifySameNameSiblings({
        folderEntries: [
            { token: 'INDEXPOINTED00000000001', name: 'DescribeIndex()', parentToken: 'folder-mgmt-v25', roots: ['root-v26'] },
            { token: 'INDEXORPHAN000000000001', name: 'DescribeIndex()', parentToken: 'folder-mgmt-v25', roots: ['root-v26'] },
        ],
        records: [{ recordId: 'rec-26', track: 'v2.6.x', documentToken: 'INDEXPOINTED00000000001' }],
        pageLinkTokens: [],
        trackRoots: [{ version: 'v2.6.x', releaseRootToken: 'root-v26' }],
    });
    assert.deepEqual(findings.map((finding) => finding.code), ['SAME_NAME_SIBLING_ORPHAN']);
    assert.equal(findings[0].identity, 'INDEXORPHAN000000000001');
    assert.ok(findings[0].detail.includes('operator approval'));
});

test('classifySameNameSiblings flags within-track duplicates only under one parent', () => {
    const { findings, groups } = classifySameNameSiblings({
        folderEntries: [
            { token: 'DUPA00000000000000000001', name: 'FlushAll()', parentToken: 'folder-mgmt', roots: ['root-v26'] },
            { token: 'DUPB00000000000000000001', name: 'FlushAll()', parentToken: 'folder-mgmt', roots: ['root-v26'] },
            // Same title under a different parent is a distinct page set —
            // one track claiming one copy there is not a conflict.
            { token: 'DUPC00000000000000000001', name: 'FlushAll()', parentToken: 'folder-other', roots: ['root-v26'] },
        ],
        records: [
            { recordId: 'rec-a', track: 'v2.6.x', documentToken: 'DUPA00000000000000000001' },
            { recordId: 'rec-b', track: 'v2.6.x', documentToken: 'DUPB00000000000000000001' },
            { recordId: 'rec-c', track: 'v2.6.x', documentToken: 'DUPC00000000000000000001' },
        ],
        pageLinkTokens: [],
        trackRoots: [{ version: 'v2.6.x', releaseRootToken: 'root-v26' }],
    });
    assert.deepEqual(findings.map((finding) => finding.code).sort(), [
        'SAME_NAME_TRACK_CONFLICT',
        'SAME_NAME_TRACK_CONFLICT',
    ]);
    assert.deepEqual(findings.map((finding) => finding.identity).sort(), [
        'DUPA00000000000000000001',
        'DUPB00000000000000000001',
    ]);
    assert.equal(groups[0].state, 'track-conflict');
});

test('classifySameNameSiblings counts page block links as pointers and skips single-copy titles', () => {
    const { findings, groups } = classifySameNameSiblings({
        folderEntries: [
            { token: 'LISTREC000000000000000001', name: 'ListPartitions()', parentToken: 'folder-p-v26', roots: ['root-v26'] },
            { token: 'LISTLINK00000000000000001', name: 'ListPartitions()', parentToken: 'folder-p-v30', roots: ['root-v30'] },
            { token: 'UNPAIRED00000000000000001', name: 'GetRefresh()', parentToken: 'folder-p-v26', roots: ['root-v26'] },
        ],
        records: [{ recordId: 'rec-26', track: 'v2.6.x', documentToken: 'LISTREC000000000000000001' }],
        pageLinkTokens: ['LISTLINK00000000000000001'],
        trackRoots: [
            { version: 'v2.6.x', releaseRootToken: 'root-v26' },
            { version: 'v3.0.x', releaseRootToken: 'root-v30' },
        ],
    });
    assert.deepEqual(findings, []);
    assert.equal(groups.length, 1);
    const linked = groups[0].copies.find((copy) => copy.token === 'LISTLINK00000000000000001');
    assert.equal(linked.pointed, true);
    assert.equal(linked.blockLinkPointed, true);
});

test('reconcileCalloutBlocks flags empty text children and passes clean callouts', () => {
    const { findings } = reconcileCalloutBlocks([
        {
            block_id: 'callout-1',
            block_type: 19,
            children: [
                { block_id: 'n', block_type: 2, text: { elements: [{ text_run: { content: 'Notes' } }] } },
                { block_id: 'blank', block_type: 2, text: { elements: [{ text_run: { content: '  ' } }] } },
            ],
        },
        {
            block_id: 'callout-2',
            block_type: 19,
            children: [{ block_id: 'body', block_type: 2, text: { elements: [{ text_run: { content: 'body' } }] } }],
        },
        { block_id: 'plain', block_type: 2, text: { elements: [] } },
    ]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'CALLOUT_EMPTY_CHILD');
    assert.equal(findings[0].identity, 'blank');
});

test('reconcileContextVerbatim detects digest mismatch and live divergence', () => {
    const content = 'Verbatim body.\n';
    const { findings } = reconcileContextVerbatim({
        contexts: [
            { contextId: 'digest-drift', content, contentDigest: verbatimContentDigest('Other body.\n') },
            {
                contextId: 'live-drift',
                content,
                contentDigest: verbatimContentDigest(content),
                title: 'X()',
                rawContent: 'X()\nDifferent body.\n',
            },
            { contextId: 'clean', content, contentDigest: verbatimContentDigest(content) },
        ],
    });
    assert.deepEqual(findings.map((finding) => finding.code).sort(), [
        'CONTENT_CONTEXT_DIGEST_MISMATCH',
        'CONTENT_CONTEXT_LIVE_DIVERGENT',
    ]);
});

test('reconcileContextVerbatim binds a sanctioned polish chain to its terminal content', () => {
    const { applyPolishManifest } = require('../src/sdk-doc-sync/pr-polish');
    const base = 'This method grants a role. See the [guide](https://example.com/g).\n';
    const manifest = {
        schemaVersion: 1,
        unit: 'u1',
        baseContentDigest: verbatimContentDigest(base),
        edits: [{ anchor: 'This method grants a role.', replacement: 'Grants a role to a user.' }],
    };
    const { polishedContent } = applyPolishManifest({ manifest, baseContent: base });

    // Polished live page against a valid chain: no finding, even though the
    // live bytes no longer equal the recorded verbatim base.
    const polishedLive = reconcileContextVerbatim({
        contexts: [{
            contextId: 'polished',
            content: base,
            contentDigest: verbatimContentDigest(base),
            polish: { manifest, polishedContent },
            title: 'GrantRole()',
            rawContent: 'GrantRole()\nGrants a role to a user. See the guide.\n',
        }],
    });
    assert.deepEqual(polishedLive.findings, []);

    // A live page that still equals the verbatim BASE diverges from the
    // recorded terminal content — the chain says the page was polished.
    const regressed = reconcileContextVerbatim({
        contexts: [{
            contextId: 'regressed',
            content: base,
            contentDigest: verbatimContentDigest(base),
            polish: { manifest, polishedContent },
            title: 'GrantRole()',
            rawContent: 'GrantRole()\nThis method grants a role. See the guide.\n',
        }],
    });
    assert.deepEqual(regressed.findings.map((finding) => finding.code), ['CONTENT_CONTEXT_LIVE_DIVERGENT']);

    // A recorded polish that no longer reproduces the terminal bytes is a
    // broken chain, reported even without a live snapshot.
    const broken = reconcileContextVerbatim({
        contexts: [{
            contextId: 'broken',
            content: base,
            contentDigest: verbatimContentDigest(base),
            polish: { manifest, polishedContent: `${polishedContent}tampered` },
        }],
    });
    assert.deepEqual(broken.findings.map((finding) => finding.code), ['CONTENT_POLISH_CHAIN_INVALID']);
    assert.equal(broken.findings[0].severity, 'error');
    assert.equal(broken.findings[0].invariantId, 'api.pr-polish-governed');

    // A stale recorded provenance is a broken chain even when manifest and
    // polishedContent are internally consistent.
    const realProvenance = applyPolishManifest({ manifest, baseContent: base }).provenance;
    const stale = reconcileContextVerbatim({
        contexts: [{
            contextId: 'stale-provenance',
            content: base,
            contentDigest: verbatimContentDigest(base),
            polish: { manifest, polishedContent, provenance: { ...realProvenance, editCount: 99 } },
        }],
    });
    assert.deepEqual(stale.findings.map((finding) => finding.code), ['CONTENT_POLISH_CHAIN_INVALID']);

    // The real provenance round-trips clean.
    const clean = reconcileContextVerbatim({
        contexts: [{
            contextId: 'with-provenance',
            content: base,
            contentDigest: verbatimContentDigest(base),
            polish: { manifest, polishedContent, provenance: realProvenance },
            title: 'GrantRole()',
            rawContent: 'GrantRole()\nGrants a role to a user. See the guide.\n',
        }],
    });
    assert.deepEqual(clean.findings, []);
});

test('classifySameNameSiblings skips placement judgment for copies claimed only by rootless tracks', () => {
    // A track with an unresolvable release root cannot host placement
    // judgments: its claimed copies must not surface as false misplacements.
    const { findings, groups } = classifySameNameSiblings({
        folderEntries: [
            { token: 'ROOTLESSCLAIM0000000001', name: 'FlushAll()', parentToken: 'folder-legacy', roots: ['legacy-root'] },
            // A twin gives the same-title set its second member.
            { token: 'ROOTLESSTWIN00000000001', name: 'FlushAll()', parentToken: 'folder-legacy', roots: ['legacy-root'] },
        ],
        records: [
            { recordId: 'rec-25', track: 'v2.5.x', documentToken: 'ROOTLESSCLAIM0000000001' },
            { recordId: 'rec-26', track: 'v2.6.x', documentToken: 'ROOTLESSTWIN00000000001' },
        ],
        pageLinkTokens: [],
        trackRoots: [
            // v2.5.x has no resolved release root (registry 'unresolved').
            { version: 'v2.5.x', releaseRootToken: null },
        ],
    });
    assert.deepEqual(findings, []);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].misplacedTokens.length, 0);
});

test('classifySameNameSiblings judges against resolvable claiming tracks only', () => {
    // Mixed claims: v3.0 (resolvable) and v2.5.x (rootless). The copy sits
    // under the v3.0 root, so the v3.0 half satisfies placement even though
    // the rootless half cannot be judged.
    const { findings } = classifySameNameSiblings({
        folderEntries: [
            { token: 'MIXEDCLAIM00000000001', name: 'FlushAll()', parentToken: 'folder-mgmt-v30', roots: ['root-v30'] },
            { token: 'MIXEDTWIN000000000001', name: 'FlushAll()', parentToken: 'folder-mgmt-v26', roots: ['root-v26'] },
        ],
        records: [
            { recordId: 'rec-30', track: 'v3.0.x', documentToken: 'MIXEDCLAIM00000000001' },
            { recordId: 'rec-25', track: 'v2.5.x', documentToken: 'MIXEDCLAIM00000000001' },
            { recordId: 'rec-26', track: 'v2.6.x', documentToken: 'MIXEDTWIN000000000001' },
        ],
        pageLinkTokens: [],
        trackRoots: [
            { version: 'v2.5.x', releaseRootToken: null },
            { version: 'v2.6.x', releaseRootToken: 'root-v26' },
            { version: 'v3.0.x', releaseRootToken: 'root-v30' },
        ],
    });
    assert.deepEqual(findings, []);
});
