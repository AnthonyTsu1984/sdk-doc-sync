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
    assert.equal(landed.canonicalVersion, 4);
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

test('canonicalization v4 absorbs exactly the tokens the raw_content serializer cannot carry', () => {
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
    assert.equal(landed.ok, true, `expected v4 to absorb serializer-only tokens: ${JSON.stringify(landed.diffs.slice(0, 3))}`);
    assert.equal(landed.canonicalVersion, 4);

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

test('canonicalization normalizes the symmetric HTML-bracket escapes on both sides', () => {
  // The java authoring side escapes generics as List\<String\>; the converter
  // unescapes both directions, and the fidelity comparison must normalize the
  // pair identically — a one-sided stray backslash (the pre-fix asymmetric
  // converter output) no longer diverges, and a fully-clean page matches too.
  const expected = 'A list.\n\n*List\\<String\\>*\n';
  const observedAsymmetric = 'ListRoles()\nA list.\nList\\<String>\n';
  const observedClean = 'ListRoles()\nA list.\nList<String>\n';
  assert.equal(compareVerbatimContent({ expectedContent: expected, rawContent: observedAsymmetric }).ok, true);
  assert.equal(compareVerbatimContent({ expectedContent: expected, rawContent: observedClean }).ok, true);
  // A real content difference is still caught.
  assert.equal(compareVerbatimContent({ expectedContent: expected, rawContent: 'ListRoles()\nA list.\nList<Integer>\n' }).ok, false);
});

test('alert-callout wrapper lines normalize away on both sides', () => {
  // PR-verbatim authored content carries web-content alert markup; the live
  // side renders the enclosed prose as a callout block (no wrapper lines).
  const expected = 'Intro line.\n<div class="alert note">\nA collection alias is an additional name.\nIn Milvus, globally unique.\n</div>\n';
  const observed = 'listRoles()\nIntro line.\nA collection alias is an additional name.\nIn Milvus, globally unique.\n';
  const result = compareVerbatimContent({ expectedContent: expected, rawContent: observed });
  assert.equal(result.ok, true, JSON.stringify(result.diffs || result));
  // A real prose difference inside the alert still diverges.
  const divergent = 'listRoles()\nIntro line.\nA collection alias is an extra name.\nIn Milvus, globally unique.\n';
  assert.equal(compareVerbatimContent({ expectedContent: expected, rawContent: divergent }).ok, false);
});

test('canonicalization v4 strips inline-code markers inside code on both sides', () => {
  // Real-world fixture: java alterCollectionField (milvus-docs PR-verbatim)
  // carries a fenced code comment whose text contains escaped backticks.
  // raw_content never emits the fence, so the observed side always ran the
  // markup strip and lost the backtick pair; v3 kept the expected side
  // fence-protected and false-failed the line. Built from char codes to keep
  // the backslash/backtick bytes explicit.
  const BS = String.fromCharCode(92);
  const BT = String.fromCharCode(96);
  const esc = (word) => BS + BT + word + BS + BT;
  const commentLine = `// 2. Alter the ${esc('max_length')} property of a VarChar field named ${esc('varchar')}`;
  const codeLine = 'properties.put("max_length", "512");';
  const upstream = [
    '# alterCollectionField()',
    '',
    '```java',
    commentLine,
    codeLine,
    '```',
  ].join('\n');
  const landedFull = ['alterCollectionField()', commentLine, codeLine].join('\n');
  assert.equal(compareVerbatimContent({ expectedContent: upstream, rawContent: landedFull }).ok, true);
  // The transient render right after the rebuild surfaced the same line with
  // the backtick pair already consumed by the serializer; the channel cannot
  // distinguish that lag from a landed page, so both compare equal.
  const landedTransient = [
    'alterCollectionField()',
    `// 2. Alter the ${BS}max_length${BS} property of a VarChar field named ${BS}varchar${BS}`,
    codeLine,
  ].join('\n');
  assert.equal(compareVerbatimContent({ expectedContent: upstream, rawContent: landedTransient }).ok, true);
  // A genuinely altered code line still fails.
  const drifted = landedFull.replace('max_length", "512', 'max_length", "256');
  assert.equal(compareVerbatimContent({ expectedContent: upstream, rawContent: drifted }).ok, false);
});
