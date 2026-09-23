'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    LAYOUT_INVARIANT_ID,
    pageFactsFromBlocks,
    checkLayoutConformance,
} = require('../src/sdk-doc-sync/layout-conformance');
const sdkLayoutProfiles = require('../src/renderers/sdk-layout-profiles');

test('pageFactsFromBlocks separates headings, body lines, and per-callout child lines', () => {
    const facts = pageFactsFromBlocks([
        { block_id: 'h', block_type: 3, heading1: { elements: [{ text_run: { content: 'AlterRole()' } }] } },
        {
            block_id: 'c',
            block_type: 19,
            children: [
                { block_id: 'c1', block_type: 2, text: { elements: [{ text_run: { content: 'Notes' } }] } },
                { block_id: 'c2', block_type: 2, text: { elements: [{ text_run: { content: 'Deprecated in v3.0.x.' } }] } },
            ],
        },
        { block_id: 't', block_type: 2, text: { elements: [{ text_run: { content: 'CreateAliasRequest& WithAlias()' } }] } },
    ]);
    assert.deepEqual(facts.headings, [{ level: 1, text: 'AlterRole()' }]);
    assert.deepEqual(facts.lines, ['AlterRole()', 'CreateAliasRequest& WithAlias()']);
    assert.deepEqual(facts.callouts, [{ lines: ['Notes', 'Deprecated in v3.0.x.'] }]);
});

test('cpp profile flags the forbidden builder prefix; java without the rule is clean', () => {
    const facts = { headings: [], lines: ['AlterAliasRequest& WithCollectionName(const std::string& name)'], callouts: [] };
    const cpp = checkLayoutConformance(sdkLayoutProfiles.cpp, facts);
    assert.equal(cpp.invariantId, 'api.sdk-page-layout');
    assert.equal(cpp.violations[0]?.code, 'LAYOUT_BUILDER_PREFIX_FORBIDDEN');
    assert.equal(checkLayoutConformance(sdkLayoutProfiles.java, facts).violations.length, 0);
});

test('a single request-type H3 violates multi-only; two request H3s conform', () => {
    const single = checkLayoutConformance(sdkLayoutProfiles.cpp, {
        headings: [{ level: 3, text: 'AlterRoleRequest' }],
        lines: [],
        callouts: [],
    });
    assert.equal(single.violations.some((violation) => violation.code === 'LAYOUT_SINGLE_REQUEST_H3'), true);
    const multi = checkLayoutConformance(sdkLayoutProfiles.cpp, {
        headings: [
            { level: 3, text: 'SearchRequest' },
            { level: 3, text: 'HybridSearchRequest' },
        ],
        lines: [],
        callouts: [],
    });
    assert.equal(multi.violations.length, 0);
});

test('deprecation must be a shaped callout; prose outside a callout is flagged', () => {
    const shaped = checkLayoutConformance(sdkLayoutProfiles.cpp, {
        headings: [],
        lines: [],
        callouts: [{ lines: ['Notes', 'Deprecated in v3.0.x. Use AddFunctionField().'] }],
    });
    assert.equal(shaped.violations.length, 0);
    const badShape = checkLayoutConformance(sdkLayoutProfiles.cpp, {
        headings: [],
        lines: [],
        callouts: [{ lines: ['Notes', 'Deprecated in v3.0.x.', 'extra residue line'] }],
    });
    assert.equal(badShape.violations[0]?.code, 'LAYOUT_DEPRECATION_CALLOUT_SHAPE');
    const unrelatedCallout = checkLayoutConformance(sdkLayoutProfiles.cpp, {
        headings: [],
        lines: [],
        callouts: [{ lines: ['Hint', 'Audience-specific note.'] }],
    });
    assert.equal(unrelatedCallout.violations.length, 0, 'non-deprecation callouts are exempt');
    const prose = checkLayoutConformance(sdkLayoutProfiles.cpp, {
        headings: [],
        lines: ['Deprecated in v3.0.x. Use AddFunctionField().'],
        callouts: [],
    });
    assert.equal(prose.violations[0]?.code, 'LAYOUT_DEPRECATION_NOT_CALLOUT');
});

test('a profile without layoutRules is not governed by the layout invariant', () => {
    const bare = { id: 'custom', version: 1, order: [], fences: {}, cardinality: {} };
    const result = checkLayoutConformance(bare, {
        headings: [{ level: 3, text: 'Anything' }],
        lines: ['Totally& Prefixed()'],
        callouts: [],
    });
    assert.deepEqual(result.violations, []);
});
