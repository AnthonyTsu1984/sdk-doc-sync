'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    collectDocumentTokens,
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
