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
    assert.equal(landed.canonicalVersion, 3);
    assert.deepEqual(landed.diffs, []);

    // Code content lines compare exactly: a changed line that landed as code
    // text must fail even though the serializer drops the fence delimiters.
    const rawFenced = `${rawLanded}\nold();`;
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

test('the raw_content title line is dropped even when the caller cannot name it', () => {
    const comparison = compareVerbatimContent({
        expectedContent: 'first\nsecond',
        rawContent: 'the-page-title\nfirst\nsecond',
    });
    assert.equal(comparison.ok, true);
});

test('canonicalization v3 absorbs exactly the tokens the raw_content serializer cannot carry', () => {
    // Landed-shape fixture derived from the first real code-bearing verbatim
    // unit (cpp Management/ListRefreshExternalCollectionJobs, PR #1151): the
    // upstream markdown carries fences, bold labels, backticked builders,
    // indented descriptions, and blank lines — the serializer carries none of
    // them, so canonicalization v3 ignores those tokens on both sides.
    const upstream = [
        '# ListRefreshExternalCollectionJobs()',
        '',
        'This operation lists refresh jobs for external collections.',
        '',
        '```cpp',
        'Status ListRefreshExternalCollectionJobs(const ListRefreshExternalCollectionJobsRequest& request)',
        '```',
        '',
        '## Request Syntax',
        '',
        '```cpp',
        'auto request = milvus::ListRefreshExternalCollectionJobsRequest()',
        '    .WithDatabaseName(db_name)',
        '    .WithCollectionName(collection_name);',
        '```',
        '',
        '**REQUEST METHODS:**',
        '',
        '- `WithDatabaseName(const std::string& db_name)`',
        '',
        '    Sets the target database name. The default database applies if it is empty.',
        '',
        '**RETURNS:**',
        '',
        '*Status*',
        '',
        '## Example',
        '',
        '```cpp',
        'auto status = client->ListRefreshExternalCollectionJobs(request, response);',
        '    std::cout << status.Message() << std::endl;',
        '```',
    ].join('\n');
    const rawLanded = [
        'ListRefreshExternalCollectionJobs()',
        'This operation lists refresh jobs for external collections.',
        'Status ListRefreshExternalCollectionJobs(const ListRefreshExternalCollectionJobsRequest& request)',
        'Request Syntax',
        'auto request = milvus::ListRefreshExternalCollectionJobsRequest()',
        '.WithDatabaseName(db_name)',
        '.WithCollectionName(collection_name);',
        'REQUEST METHODS:',
        'WithDatabaseName(const std::string& db_name)',
        'Sets the target database name. The default database applies if it is empty.',
        'RETURNS:',
        'Status',
        'Example',
        'auto status = client->ListRefreshExternalCollectionJobs(request, response);',
        'std::cout << status.Message() << std::endl;',
    ].join('\n');
    const landed = compareVerbatimContent({ expectedContent: upstream, rawContent: rawLanded });
    assert.equal(landed.ok, true, `expected v3 to absorb serializer-only tokens: ${JSON.stringify(landed.diffs.slice(0, 3))}`);
    assert.equal(landed.canonicalVersion, 3);

    // A genuinely missing content line still fails: drop the builder row.
    const missingBuilder = compareVerbatimContent({
        expectedContent: upstream,
        rawContent: rawLanded
            .replace('WithDatabaseName(const std::string& db_name)\n', '')
            .replace('Sets the target database name. The default database applies if it is empty.\n', ''),
    });
    assert.equal(missingBuilder.ok, false);
    assert.ok(missingBuilder.diffs.length > 0);

    // A genuinely altered code line still fails.
    const alteredCode = compareVerbatimContent({
        expectedContent: upstream,
        rawContent: rawLanded.replace('auto status = client->ListRefreshExternalCollectionJobs(request, response);', 'auto status = client->ListRefreshExternalCollectionJobs(request);'),
    });
    assert.equal(alteredCode.ok, false);
    assert.ok(alteredCode.diffs.length > 0);
});
