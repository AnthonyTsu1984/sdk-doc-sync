'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    SEMANTIC_MAP_VERSION,
    extractSemanticMap,
    compareSemanticContent,
    matchOrdered,
    normalizeSemanticText,
} = require('../src/sdk-doc-sync/semantic-content-map');

const PAGE = [
    '# get()',
    '',
    'This operation gets specific entities by their IDs.',
    '',
    '```Java',
    'public GetResp get(GetReq request)',
    '```',
    '',
    '**BUILDER METHODS:**',
    '',
    '- `databaseName(String databaseName)`',
    'The name of the database to which the target collection belongs.',
    '- `ids(List<Object> ids)`',
    'A specific entity ID or a list of entity IDs.',
    '',
    '**RETURN TYPE:**',
    '',
    '*GetResp*',
    '',
    '**RETURNS:**',
    '',
    'A **GetResp** object representing one or more queried entities.',
    '',
    '**PARAMETERS:**',
    '',
    '- **getResults** (*List\\\\<QueryResp.QueryResult\\\\>*)',
    'A list of **QueryResp.QueryResult** objects.',
    '',
    '**EXCEPTIONS:**',
    '',
    '- **MilvusClientExceptions**',
    'This exception will be raised when any error occurs during this operation.',
    '',
    '<include target="zilliz">Zilliz docs [z-url]</include><include target="milvus">Milvus docs [m-url]</include>',
].join('\n');

test('extraction inventories items, code, return type, prose presence, and include markers', () => {
    const map = extractSemanticMap(PAGE);
    assert.equal(map.mapVersion, SEMANTIC_MAP_VERSION);
    assert.deepEqual(map.items.filter((item) => item.section === 'MEMBER').map((item) => item.text), [
        'databaseName(String databaseName)',
        'ids(List<Object> ids)',
    ]);
    assert.deepEqual(map.items.filter((item) => item.section === 'PARAM').map((item) => item.text), [
        'getResults (List<QueryResp.QueryResult>)',
    ]);
    assert.deepEqual(map.items.filter((item) => item.section === 'EXCEPTION').map((item) => item.text), [
        'MilvusClientExceptions',
    ]);
    assert.equal(map.returnType, 'GetResp');
    assert.equal(map.returnsProseLines, 1);
    assert.equal(map.codeBlocks.length, 1);
    assert.deepEqual(map.codeBlocks[0].lines, ['public GetResp get(GetReq request)']);
    assert.equal(map.includeMarkers.length, 1);
    // Description WORDING is deliberately not retained — presence counts only.
    assert.ok(map.items.every((item) => !Object.prototype.hasOwnProperty.call(item, 'description')));
});

test('normalized item text absorbs markup, stacked escapes, and entities identically', () => {
    assert.equal(normalizeSemanticText('**getResults** (*List\\\\\\\\<T\\\\\\\\>*)'), 'getResults (List<T>)');
    assert.equal(normalizeSemanticText('**getResults** (*List\\<T\\>*)'), 'getResults (List<T>)');
    assert.equal(normalizeSemanticText('`ids(List<Object> ids)`'), 'ids(List<Object> ids)');
    assert.equal(normalizeSemanticText('*GetResp*'), 'GetResp');
    assert.equal(normalizeSemanticText('A &amp; B'), 'A & B');
});

test('semantically identical content passes even when format differs', () => {
    const reformatted = PAGE
        .replace('**BUILDER METHODS:**', '**REQUEST METHODS:**')
        .replace('# get()', '# get')
        .replace('A **GetResp** object representing one or more queried entities.', 'Returns the queried entities with their session timestamp.');
    const comparison = compareSemanticContent({ upstreamContent: PAGE, canonicalContent: reformatted });
    assert.equal(comparison.ok, true, JSON.stringify(comparison.diffs));
});

test('dropped items, altered code, and description loss are semantic failures', () => {
    const dropped = compareSemanticContent({
        upstreamContent: PAGE,
        canonicalContent: PAGE.replace('- `ids(List<Object> ids)`\nA specific entity ID or a list of entity IDs.\n', ''),
    });
    assert.equal(dropped.ok, false);
    assert.ok(dropped.diffs.some((diff) => diff.kind === 'MEMBER_ITEM_DROPPED' && diff.detail === 'ids(List<Object> ids)'));

    const codeAltered = compareSemanticContent({
        upstreamContent: PAGE,
        canonicalContent: PAGE.replace('public GetResp get(GetReq request)', 'public GetResp fetch(GetReq request)'),
    });
    assert.equal(codeAltered.ok, false);
    assert.ok(codeAltered.diffs.some((diff) => diff.kind === 'CODE_BLOCK_ALTERED'));

    const descriptionLost = compareSemanticContent({
        upstreamContent: PAGE,
        canonicalContent: PAGE.replace('The name of the database to which the target collection belongs.\n', ''),
    });
    assert.equal(descriptionLost.ok, false);
    assert.ok(descriptionLost.diffs.some((diff) => diff.kind === 'DESCRIPTION_DROPPED'));
});

test('return type and RETURNS prose are hard requirements once the upstream declares them', () => {
    const typeAltered = compareSemanticContent({
        upstreamContent: PAGE,
        canonicalContent: PAGE.replace('*GetResp*', '*GetIdsResp*'),
    });
    assert.ok(typeAltered.diffs.some((diff) => diff.kind === 'RETURN_TYPE_ALTERED'));
    const typeMissing = compareSemanticContent({
        upstreamContent: PAGE,
        canonicalContent: PAGE.replace('*GetResp*\n\n', ''),
    });
    assert.ok(typeMissing.diffs.some((diff) => diff.kind === 'RETURN_TYPE_MISSING'));
    const proseMissing = compareSemanticContent({
        upstreamContent: PAGE,
        canonicalContent: PAGE.replace('A **GetResp** object representing one or more queried entities.\n\n', ''),
    });
    assert.ok(proseMissing.diffs.some((diff) => diff.kind === 'RETURNS_PROSE_MISSING'));
});

test('canonical additions are format freedom: shape tables and extra sections pass', () => {
    const enriched = PAGE.replace(
        'A **GetResp** object representing one or more queried entities.',
        [
            'A **GetResp** object representing one or more queried entities.',
            '',
            '**RESPONSE SHAPE:**',
            '',
            '| field | type | description |',
            '| --- | --- | --- |',
            '| getResults | List<QueryResp.QueryResult> | A list of QueryResp.QueryResult objects. |',
        ].join('\n'),
    );
    const comparison = compareSemanticContent({ upstreamContent: PAGE, canonicalContent: enriched });
    assert.equal(comparison.ok, true, JSON.stringify(comparison.diffs));
    assert.equal(comparison.observed.tables, 1);
    assert.equal(comparison.expected.tables, 0);
});

test('code blocks can never be added by polish, and upstream tables must survive', () => {
    const codeAdded = compareSemanticContent({
        upstreamContent: PAGE,
        canonicalContent: `${PAGE}\n\n\`\`\`Java\nclient.get(req)\n\`\`\``,
    });
    assert.ok(codeAdded.diffs.some((diff) => diff.kind === 'CODE_BLOCK_ADDED'));

    const withTable = `${PAGE}\n\n| method | description |\n| --- | --- |\n| \`get(req)\` | gets entities |`;
    const tableDropped = compareSemanticContent({
        upstreamContent: withTable,
        canonicalContent: PAGE,
    });
    assert.ok(tableDropped.diffs.some((diff) => diff.kind === 'TABLE_ALTERED'));
});

test('include markers must survive exactly', () => {
    const comparison = compareSemanticContent({
        upstreamContent: PAGE,
        canonicalContent: PAGE.replace('<include target="milvus">Milvus docs [m-url]</include>', ''),
    });
    assert.equal(comparison.ok, false);
    assert.ok(comparison.diffs.some((diff) => diff.kind === 'INCLUDE_MARKER_CHANGED'));
});

test('plain external reference may be upgraded into dual-target includes (2026-10-07 ruling)', () => {
    const plainPage = [
        '# grant()',
        '',
        'This operation grants a privilege to a role.',
        '',
        'For details, refer to [Users and Roles](https://milvus.io/docs/users_and_roles.md).',
    ].join('\n');
    const wrappedPage = [
        '# grant()',
        '',
        'This operation grants a privilege to a role.',
        '',
        'For details, refer to <include target="milvus">[Users and Roles](https://milvus.io/docs/users_and_roles.md)</include><include target="zilliz">[Manage Cluster Roles(SDK)](https://docs.zilliz.com/docs/cluster-roles-sdk)</include>.',
    ].join('\n');
    const upgraded = compareSemanticContent({ upstreamContent: plainPage, canonicalContent: wrappedPage });
    assert.equal(upgraded.ok, true, JSON.stringify(upgraded.diffs));

    // The bound stays: an EXISTING include marker must survive verbatim.
    const withMarker = PAGE.replace('<include target="milvus">Milvus docs [m-url]</include>', '<include target="milvus">Milvus docs [m-url]</include><include target="zilliz">Z docs [z-url]</include>');
    const added = compareSemanticContent({ upstreamContent: PAGE, canonicalContent: withMarker });
    assert.equal(added.ok, true, JSON.stringify(added.diffs));
    const dropped = compareSemanticContent({
        upstreamContent: PAGE,
        canonicalContent: PAGE.replace('<include target="milvus">Milvus docs [m-url]</include>', ''),
    });
    assert.equal(dropped.ok, false);
    assert.ok(dropped.diffs.some((diff) => diff.kind === 'INCLUDE_MARKER_CHANGED'));

    // 2026-10-07 round-trip: the converter renders authored [text](url)
    // inside includes as real hyperlink runs, while the block-tree
    // reconstruction reads back display text only — an executed page's
    // baseline carries the bare-text form. Survival comparison normalizes
    // both sides to link text, so the executed page re-verifies against its
    // own baseline; an actually-dropped marker still fires.
    const baselineBare = wrappedPage.replace(
        '<include target="milvus">[Users and Roles](https://milvus.io/docs/users_and_roles.md)</include><include target="zilliz">[Manage Cluster Roles(SDK)](https://docs.zilliz.com/docs/cluster-roles-sdk)</include>',
        '<include target="milvus">Users and Roles</include><include target="zilliz">Manage Cluster Roles(SDK)</include>',
    );
    const roundTrip = compareSemanticContent({ upstreamContent: baselineBare, canonicalContent: wrappedPage });
    assert.equal(roundTrip.ok, true, JSON.stringify(roundTrip.diffs));
    const baselineDropped = baselineBare.replace('<include target="milvus">Users and Roles</include>', '');
    const droppedAfterExec = compareSemanticContent({ upstreamContent: baselineBare, canonicalContent: baselineDropped });
    assert.equal(droppedAfterExec.ok, false);
    assert.ok(droppedAfterExec.diffs.some((diff) => diff.kind === 'INCLUDE_MARKER_CHANGED'));
});

test('matchOrdered enforces strictly increasing ordered containment', () => {
    assert.deepEqual(matchOrdered(['a', 'b', 'c'], ['x', 'a', 'y', 'b', 'z', 'c']), [1, 3, 5]);
    // Greedy forward matching: 'a' takes the later slot, 'b' finds nothing after it.
    assert.deepEqual(matchOrdered(['a', 'b'], ['b', 'a']), [1, -1]);
    assert.deepEqual(matchOrdered([], ['a']), []);
});

test('a void page may retire its bare RETURNS stub entirely (2026-10-05 ruling)', () => {
    const voidPage = [
        '# dropRole()',
        '',
        'This operation drops a specific role.',
        '',
        '**RETURNS:**',
        'void',
        '',
        '**EXCEPTIONS:**',
        'MilvusClientExceptions',
    ].join('\n');
    const retired = [
        '# dropRole()',
        '',
        'This operation drops a specific role.',
        '',
        '**EXCEPTIONS:**',
        'MilvusClientExceptions',
    ].join('\n');
    const comparison = compareSemanticContent({ upstreamContent: voidPage, canonicalContent: retired });
    assert.equal(comparison.ok, true, JSON.stringify(comparison.diffs));

    // Widened 2026-10-06 (campaign page java:v2-Collections-dropFunctionField):
    // a void-equivalent stub — the void token (bare or italic) optionally plus
    // an explicit no-value sentence — may retire as one unit.
    const twoLineStub = voidPage.replace('void', '*void*\nThis operation does not return a value.');
    const twoLineRetired = compareSemanticContent({ upstreamContent: twoLineStub, canonicalContent: retired });
    assert.equal(twoLineRetired.ok, true, JSON.stringify(twoLineRetired.diffs));
    const sentenceOnlyStub = voidPage.replace('void', 'This operation returns nothing.');
    const sentenceRetired = compareSemanticContent({ upstreamContent: sentenceOnlyStub, canonicalContent: retired });
    assert.equal(sentenceRetired.ok, true, JSON.stringify(sentenceRetired.diffs));
    // 2026-10-07: 'no value' variant (campaign page java:v2-Authentication-alterRole).
    const noValueStub = voidPage.replace('void', 'This operation returns no value.');
    const noValueRetired = compareSemanticContent({ upstreamContent: noValueStub, canonicalContent: retired });
    assert.equal(noValueRetired.ok, true, JSON.stringify(noValueRetired.diffs));
    // 2026-10-07: bare 'None' stub (campaign page java:v2-Collections-dropCollectionFieldProperties).
    const noneStub = voidPage.replace('void', 'None');
    const noneRetired = compareSemanticContent({ upstreamContent: noneStub, canonicalContent: retired });
    assert.equal(noneRetired.ok, true, JSON.stringify(noneRetired.diffs));

    // The exemption stays bounded: RETURNS prose carrying real content cannot be dropped.
    const prosePage = voidPage.replace('void', 'Returns the number of deleted entities.');
    const dropped = compareSemanticContent({ upstreamContent: prosePage, canonicalContent: retired });
    assert.equal(dropped.ok, false);
    assert.ok(dropped.diffs.some((diff) => diff.kind === 'RETURNS_PROSE_MISSING'));

    // Nor a MIXED stub: a no-value sentence next to real content is not stub-shaped.
    const mixedStub = voidPage.replace('void', 'This operation returns nothing.\nReturns the collection id.');
    const mixedDropped = compareSemanticContent({ upstreamContent: mixedStub, canonicalContent: retired });
    assert.equal(mixedDropped.ok, false);
    assert.ok(mixedDropped.diffs.some((diff) => diff.kind === 'RETURNS_PROSE_MISSING'));

    // Widened 2026-10-07 (java:v2-LocalBulkWriter-commit): a live RETURN TYPE
    // section carrying only the void token retires with the stub (2026-10-05
    // ruling taken literally — void carries no return sections).
    const withVoidType = [
        '# commit()',
        '',
        'This operation commits pending rows.',
        '',
        '**RETURN TYPE:**',
        '',
        '*void*',
        '',
    ].join('\n');
    const voidTypeRetired = [
        '# commit()',
        '',
        'This operation commits pending rows.',
        '',
    ].join('\n');
    const voidTypeDropped = compareSemanticContent({ upstreamContent: withVoidType, canonicalContent: voidTypeRetired });
    assert.equal(voidTypeDropped.ok, true, JSON.stringify(voidTypeDropped.diffs));

    // A NON-void RETURN TYPE still cannot be dropped — real type information.
    const withRealType = voidPage.replace('**RETURNS:**', '**RETURN TYPE:**\nDescribeReplicasResp\n\n**RETURNS:**');
    const realTypeDropped = compareSemanticContent({ upstreamContent: withRealType, canonicalContent: retired });
    assert.equal(realTypeDropped.ok, false);
    assert.ok(realTypeDropped.diffs.some((diff) => diff.kind === 'RETURN_TYPE_MISSING'));
});

test('code-fence includes normalize to operator magic tags on both sides (2026-10-08 ruling)', () => {
    // Upstream (live page): literal <include> tags wrap code lines inside the
    // fence at their original indentation. Canonical (authored): the operator
    // magic-tag form. The code block must compare equal.
    const upstream = [
        '# createSchema()',
        '',
        'This operation creates a schema.',
        '',
        '```java',
        'CreateCollectionReq.CollectionSchema.builder()',
        '    .name(String name)',
        '<include target="milvus">',
        '    .elementType(DataType elementType)',
        '    .maxCapacity(Integer maxCapacity)',
        '</include>',
        '    .isNullable(Boolean isNullable)',
        '    .build();',
        '```',
        '',
        '**EXCEPTIONS:**',
        '',
        '- **MilvusClientException**',
        'This exception is raised when any error occurs.',
        '',
    ].join('\n');
    const canonical = upstream
        .replace('<include target="milvus">', '// include-start milvus')
        .replace('</include>', '// include-end milvus');
    const blockForm = compareSemanticContent({ upstreamContent: upstream, canonicalContent: canonical });
    assert.equal(blockForm.ok, true, JSON.stringify(blockForm.diffs));

    // The magic-tag form is self-consistent (idempotent) — an executed page
    // re-verifies against its own baseline.
    const idempotent = compareSemanticContent({ upstreamContent: canonical, canonicalContent: canonical });
    assert.equal(idempotent.ok, true, JSON.stringify(idempotent.diffs));

    // Whole-line single include ⇄ // include-nextline form.
    const upstreamNextline = upstream.replace(
        '    .isNullable(Boolean isNullable)',
        '<include target="zilliz">    .isNullable(Boolean isNullable)</include>'
    );
    const canonicalNextline = upstream.replace(
        '    .isNullable(Boolean isNullable)',
        '// include-nextline zilliz\n    .isNullable(Boolean isNullable)'
    );
    const nextline = compareSemanticContent({ upstreamContent: upstreamNextline, canonicalContent: canonicalNextline });
    assert.equal(nextline.ok, true, JSON.stringify(nextline.diffs));

    // A genuinely altered code line inside the wrap still fails.
    const altered = canonical.replace('.maxCapacity(Integer maxCapacity)', '.maxCapacity(Integer capacity)');
    const alteredResult = compareSemanticContent({ upstreamContent: upstream, canonicalContent: altered });
    assert.equal(alteredResult.ok, false);
    assert.ok(alteredResult.diffs.some((diff) => diff.kind === 'CODE_BLOCK_ALTERED'));

    // Behavior is unchanged for pages without code-fence includes.
    const plain = compareSemanticContent({ upstreamContent: PAGE, canonicalContent: PAGE });
    assert.equal(plain.ok, true, JSON.stringify(plain.diffs));
});

test('sanctioned include removals are operator-bound; code marker lines are not payload (2026-10-08 FieldSchema ruling)', () => {
    const STALE = '<include target="milvus">Available only in self-hosted Milvus.</include>';
    const upstream = [
        '# createSchema()',
        '',
        'This operation creates a schema.',
        '',
        '```java',
        'CreateCollectionReq.CollectionSchema.builder()',
        '    .name(String name)',
        '<include target="milvus">',
        '    .elementType(DataType elementType)',
        '</include>',
        '    .isNullable(Boolean isNullable)',
        '    .build();',
        '```',
        '',
        '- `elementType(DataType elementType)`',
        'The data type of elements in array fields. ' + STALE,
        '',
    ].join('\n');
    // Canonical: fence unwrapped (markers removed), prose note removed.
    const canonical = [
        '# createSchema()',
        '',
        'This operation creates a schema.',
        '',
        '```java',
        'CreateCollectionReq.CollectionSchema.builder()',
        '    .name(String name)',
        '    .elementType(DataType elementType)',
        '    .isNullable(Boolean isNullable)',
        '    .build();',
        '```',
        '',
        '- `elementType(DataType elementType)`',
        'The data type of elements in array fields.',
        '',
    ].join('\n');

    // Without sanction: both the prose unit drop and the code marker change fail.
    const unsanctioned = compareSemanticContent({ upstreamContent: upstream, canonicalContent: canonical });
    assert.equal(unsanctioned.ok, false);
    assert.ok(unsanctioned.diffs.some((diff) => diff.kind === 'INCLUDE_MARKER_CHANGED'));

    // With the operator-sanctioned unit: the removal passes…
    const sanctioned = compareSemanticContent({
        upstreamContent: upstream,
        canonicalContent: canonical,
        options: { sanctionedIncludeRemovals: [STALE] },
    });
    assert.equal(sanctioned.ok, true, JSON.stringify(sanctioned.diffs));

    // …but the wrapped CODE lines are still fully compared.
    const contentAltered = compareSemanticContent({
        upstreamContent: upstream,
        canonicalContent: canonical.replace('.elementType(DataType elementType)', '.elementType(DataType type)'),
        options: { sanctionedIncludeRemovals: [STALE] },
    });
    assert.equal(contentAltered.ok, false);
    assert.ok(contentAltered.diffs.some((diff) => diff.kind === 'CODE_BLOCK_ALTERED'));

    // An UNSANCTIONED prose unit elsewhere still cannot disappear.
    const otherStale = upstream.replace(
        'This operation creates a schema.',
        'This operation creates a schema. <include target="zilliz">Legacy note.</include>'
    );
    const mixed = compareSemanticContent({
        upstreamContent: otherStale,
        canonicalContent: canonical,
        options: { sanctionedIncludeRemovals: [STALE] },
    });
    assert.equal(mixed.ok, false);
    assert.ok(mixed.diffs.some((diff) => diff.kind === 'INCLUDE_MARKER_CHANGED'));
});

// 2026-10-08 (java revision campaign, operator consistency ruling):
// sanctionedItemEdits — a manifest-bound {from, to} list of exact item-label
// edits. The PAGE fixture's EXCEPTIONS bullet is the plural form; the
// canonical rewrites it to the campaign's accepted singular.
test('sanctionedItemEdits: listed label edits pass, unlisted or absent-target edits fail', () => {
    const canonical = PAGE.replace('- **MilvusClientExceptions**', '- **MilvusClientException**');
    const EDIT = { from: 'MilvusClientExceptions', to: 'MilvusClientException' };

    // Without sanction: the label edit reads as an upstream item drop.
    const unsanctioned = compareSemanticContent({ upstreamContent: PAGE, canonicalContent: canonical });
    assert.equal(unsanctioned.ok, false);
    assert.ok(unsanctioned.diffs.some((diff) => diff.kind === 'EXCEPTION_ITEM_DROPPED' && diff.detail === 'MilvusClientExceptions'));

    // With the operator-sanctioned edit: the rewrite passes (description preserved).
    const sanctioned = compareSemanticContent({
        upstreamContent: PAGE,
        canonicalContent: canonical,
        options: { sanctionedItemEdits: [EDIT] },
    });
    assert.equal(sanctioned.ok, true, JSON.stringify(sanctioned.diffs));

    // Fail-closed: an edit whose target text is absent from the canonical
    // still reports the drop — the sanction cannot smuggle a disappearance.
    const missingTarget = compareSemanticContent({
        upstreamContent: PAGE,
        canonicalContent: canonical.replace('- **MilvusClientException**\nThis exception will be raised when any error occurs during this operation.\n', ''),
        options: { sanctionedItemEdits: [EDIT] },
    });
    assert.equal(missingTarget.ok, false);
    assert.ok(missingTarget.diffs.some((diff) => diff.kind === 'EXCEPTION_ITEM_DROPPED'));
});

// 2026-10-09 (java revision campaign, operator example ruling):
// sanctionedCodeEdits — a manifest-bound {lang, before, after} list of exact
// code-block replacements (transferNode class: filling an EMPTY Example
// fence). The PAGE fixture's single Java block is emptied, then filled.
test('sanctionedCodeEdits: declared block replacement passes, undeclared or drifted fails', () => {
    const emptyExample = PAGE.replace('public GetResp get(GetReq request)', '');
    const filledLines = [
        'import io.milvus.v2.client.ConnectConfig;',
        'MilvusClientV2 client = new MilvusClientV2(ConnectConfig.builder()',
        '    .uri("http://localhost:19530")',
        '    .build());',
        'client.get(GetReq.builder().build());',
    ];
    const canonical = emptyExample.replace('```Java\n\n```', '```Java\n' + filledLines.join('\n') + '\n```');

    // Without sanction: filling the empty fence reads as a code change.
    const unsanctioned = compareSemanticContent({ upstreamContent: emptyExample, canonicalContent: canonical });
    assert.equal(unsanctioned.ok, false);
    assert.ok(unsanctioned.diffs.some((diff) => diff.kind === 'CODE_BLOCK_ALTERED' || diff.kind === 'CODE_BLOCK_DROPPED'));

    // With the operator-sanctioned replacement: the fill passes.
    const sanctioned = compareSemanticContent({
        upstreamContent: emptyExample,
        canonicalContent: canonical,
        options: { sanctionedCodeEdits: [{ lang: 'Java', before: [''], after: filledLines }] },
    });
    assert.equal(sanctioned.ok, true, JSON.stringify(sanctioned.diffs));

    // Fail-closed: the declared after block must be present verbatim — a
    // drifted fill still reports the change.
    const drifted = emptyExample.replace('```Java\n\n```', '```Java\n' + filledLines.join('\n').replace('19530', '19531') + '\n```');
    const driftedResult = compareSemanticContent({
        upstreamContent: emptyExample,
        canonicalContent: drifted,
        options: { sanctionedCodeEdits: [{ lang: 'Java', before: [''], after: filledLines }] },
    });
    assert.equal(driftedResult.ok, false);
});
