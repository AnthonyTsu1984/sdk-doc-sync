'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeVerbatimContent,
    verbatimCarriesIncludeMarker,
    verbatimContentDigest,
    compareVerbatimContent,
} = require('../src/sdk-doc-sync/verbatim-content');

test('normalizeVerbatimContent strips the leading H1 and web-content footer idempotently', () => {
    const upstream = [
        '# AlterRole()',
        '',
        'Body paragraph.',
        '',
        '<!-- category: milvus-sdk-cpp; action: update; addedSince: v3.0.x -->',
    ].join('\n');
    const once = normalizeVerbatimContent(upstream);
    assert.equal(once.startsWith('#'), false);
    assert.ok(once.includes('Body paragraph.'), 'body must survive');
    assert.equal(once.includes('category:'), false, 'web-content footer must be stripped');
    assert.equal(once.endsWith('\n'), true);
    assert.equal(normalizeVerbatimContent(once), once, 'normalization must be idempotent');
});

test('verbatim content digests are stable and marker-sensitive', () => {
    const a = verbatimContentDigest('Body.\n');
    assert.match(a, /^sha256:[0-9a-f]{64}$/);
    assert.equal(a, verbatimContentDigest('Body.\n'));
    assert.notEqual(a, verbatimContentDigest('Body changed.\n'));
});

test('include markers are detected in verbatim content', () => {
    assert.equal(verbatimCarriesIncludeMarker('x <include target="zilliz">T</include>'), true);
    assert.equal(verbatimCarriesIncludeMarker('plain body'), false);
});

test('compareVerbatimContent reconciles rendered raw_content through the declared canonicalization', () => {
    const upstream = [
        '# X()',
        '',
        '## Request Syntax',
        '',
        '- See the [docs](https://zilliverse.feishu.cn/docx/AAA).',
        '| a | b |',
        '| --- | --- |',
        '| membership\\_match | x |',
    ].join('\n');
    const rawLanded = [
        'X()',
        '',
        'Request Syntax',
        '',
        '• See the docs.',
        '| a<br> | b<br> |',
        '| --- | --- |',
        '| membership\\_match<br> | x<br> |',
    ].join('\n');
    const landed = compareVerbatimContent({ expectedContent: upstream, rawContent: rawLanded, pageTitle: 'X()' });
    assert.equal(landed.ok, true);
    assert.equal(landed.invariantId, 'api.pr-verbatim-content');
    assert.deepEqual(landed.diffs, []);

    // Code fences stay verbatim: a changed line inside a fence must fail.
    const rawFenced = `${rawLanded}\n\n\`\`\`cpp\nold();\n\`\`\``;
    const driftedFence = compareVerbatimContent({
        expectedContent: `${upstream}\n\n\`\`\`cpp\nnew();\n\`\`\``,
        rawContent: rawFenced,
        pageTitle: 'X()',
    });
    assert.equal(driftedFence.ok, false);
    assert.ok(driftedFence.diffs.length > 0);
});

test('compareVerbatimContent reports drifted text with line-accurate diffs', () => {
    const comparison = compareVerbatimContent({
        expectedContent: 'first\nsecond\nthird',
        rawContent: 'title\nfirst\nCHANGED\nthird',
        pageTitle: 'title',
    });
    assert.equal(comparison.ok, false);
    assert.equal(comparison.diffs[0].line, 2);
    assert.equal(comparison.diffs[0].expected, 'second');
    assert.equal(comparison.diffs[0].observed, 'CHANGED');
});
