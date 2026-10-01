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

test('matchOrdered enforces strictly increasing ordered containment', () => {
    assert.deepEqual(matchOrdered(['a', 'b', 'c'], ['x', 'a', 'y', 'b', 'z', 'c']), [1, 3, 5]);
    // Greedy forward matching: 'a' takes the later slot, 'b' finds nothing after it.
    assert.deepEqual(matchOrdered(['a', 'b'], ['b', 'a']), [1, -1]);
    assert.deepEqual(matchOrdered([], ['a']), []);
});
