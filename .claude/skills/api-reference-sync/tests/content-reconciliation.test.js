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
