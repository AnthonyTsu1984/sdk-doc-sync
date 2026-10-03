'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    LAYOUT_INVARIANT_ID,
    pageFactsFromBlocks,
    checkLayoutConformance,
    checkMarkdownContentQuality,
} = require('../src/sdk-doc-sync/layout-conformance');
const sdkLayoutProfiles = require('../src/renderers/sdk-layout-profiles');

test('pageFactsFromBlocks separates headings, body lines, callout child lines, and bullets', () => {
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
        { block_id: 'b', block_type: 12, bullet: { elements: [{ text_run: { content: '**cost** (*long*) - The query cost.' } }] } },
    ]);
    assert.deepEqual(facts.headings, [{ level: 1, text: 'AlterRole()' }]);
    assert.deepEqual(facts.lines, ['AlterRole()', 'CreateAliasRequest& WithAlias()']);
    assert.deepEqual(facts.callouts, [{ lines: ['Notes', 'Deprecated in v3.0.x.'] }]);
    assert.deepEqual(facts.bullets, ['**cost** (*long*) - The query cost.']);
    assert.deepEqual(facts.stream, [
        { kind: 'heading', text: 'AlterRole()' },
        { kind: 'text', text: 'CreateAliasRequest& WithAlias()' },
        { kind: 'bullet', text: '**cost** (*long*) - The query cost.' },
    ]);
});

test('cpp profile flags the forbidden builder prefix; a register-compliant body line stays clean', () => {
    const facts = { headings: [], lines: ['AlterAliasRequest& WithCollectionName(const std::string& name)'], callouts: [] };
    const cpp = checkLayoutConformance(sdkLayoutProfiles.cpp, facts);
    assert.equal(cpp.invariantId, 'api.sdk-page-layout');
    assert.equal(cpp.violations[0]?.code, 'LAYOUT_BUILDER_PREFIX_FORBIDDEN');
    const clean = checkLayoutConformance(sdkLayoutProfiles.java, {
        headings: [],
        lines: ['This operation alters an alias through the builder methods below.'],
        callouts: [],
    });
    assert.deepEqual(clean.violations, []);
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

test('headings inside callouts count for neither heading checks nor body lines', () => {
  const facts = pageFactsFromBlocks([
    {
      block_id: 'callout',
      block_type: 19,
      children: [
        { block_id: 'ch', block_type: 5, heading3: { elements: [{ text_run: { content: 'RoleRequest' } }] } },
        { block_id: 'cb', block_type: 2, text: { elements: [{ text_run: { content: 'body' } }] } },
      ],
    },
  ]);
  assert.deepEqual(facts.headings, [], 'callout headings are callout content');
  assert.deepEqual(facts.lines, [], 'callout body stays out of the line scan');
  assert.deepEqual(facts.callouts, [{ lines: ['body'] }]);
  const result = checkLayoutConformance(sdkLayoutProfiles.cpp, facts);
  assert.equal(result.violations.length, 0);
});

test('java return-section rules flag the merged/missing-section failure modes', () => {
  const code = (lines, name) => checkLayoutConformance(sdkLayoutProfiles.java, { headings: [], lines, callouts: [] })
    .violations.find((violation) => violation.code === name)?.code || null;

  // The rejected-batch failure: RETURNS present, no RETURN TYPE section.
  assert.equal(code(['RETURNS:', 'A GetResp object.'], 'LAYOUT_RETURN_TYPE_MISSING'), 'LAYOUT_RETURN_TYPE_MISSING');
  assert.equal(code(['RETURN TYPE:', 'GetResp'], 'LAYOUT_RETURNS_MISSING'), 'LAYOUT_RETURNS_MISSING');
});

test('the return type token must not repeat inside RETURNS, and RETURNS carries prose', () => {
  const violations = checkLayoutConformance(sdkLayoutProfiles.java, {
    headings: [],
    lines: ['RETURN TYPE:', 'GetResp', 'RETURNS:', 'GetResp', 'Entities by ID.'],
    callouts: [],
  }).violations;
  assert.equal(violations.find((violation) => violation.code === 'LAYOUT_RETURNS_TYPE_ROW')?.code, 'LAYOUT_RETURNS_TYPE_ROW');

  const noProse = checkLayoutConformance(sdkLayoutProfiles.java, {
    headings: [],
    lines: ['RETURN TYPE:', 'GetResp', 'RETURNS:'],
    callouts: [],
  }).violations;
  assert.equal(noProse.find((violation) => violation.code === 'LAYOUT_RETURNS_PROSE_MISSING')?.code, 'LAYOUT_RETURNS_PROSE_MISSING');
});

test('split return sections conform with described response fields; profiles without the split declaration stay unbound for it', () => {
    const clean = checkLayoutConformance(sdkLayoutProfiles.java, {
        headings: [],
        lines: [
            'This operation queries entities by ID.',
            'RETURN TYPE:', 'GetResp',
            'RETURNS:', 'A GetResp object representing the queried entities.',
            'PARAMETERS:', '- **entities** (*List<Object>*) - The queried entities by ID.',
        ],
        callouts: [],
    });
    assert.deepEqual(clean.violations, []);
    const cppUnbound = checkLayoutConformance(sdkLayoutProfiles.cpp, {
        headings: [],
        lines: ['This operation queries entities by ID.', 'RETURNS:', 'A GetResp object.'],
        callouts: [],
    });
    assert.equal(
        cppUnbound.violations.some((violation) => violation.code === 'LAYOUT_RETURN_TYPE_MISSING'
            || violation.code === 'LAYOUT_RETURNS_MISSING'),
        false,
        'cpp has not declared returnSections split',
    );
    assert.equal(
        cppUnbound.violations.some((violation) => violation.code === 'RETURNS_MIN_DEPTH'),
        true,
        'the 2026-10-03 global content rules bind every track that declares them',
    );
    const neitherLabel = checkLayoutConformance(sdkLayoutProfiles.java, {
        headings: [],
        lines: ['This operation deletes entities.'],
        callouts: [],
    });
    assert.deepEqual(neitherLabel.violations, [], 'pages with neither label are not bound');
});

test('the five 2026-10-03 global content rules flag their failure modes and pass a compliant page', () => {
    const code = (lines, name) => checkLayoutConformance(sdkLayoutProfiles.java, { headings: [], lines, callouts: [] })
        .violations.find((violation) => violation.code === name)?.code || null;

    // CJK residue in the page body.
    assert.equal(code(['This operation 查询实体。'], 'CONTENT_CJK_MIXING'), 'CONTENT_CJK_MIXING');
    // First sentence outside the declared register.
    assert.equal(code(['Deletes entities from the collection.'], 'FIRST_SENTENCE_REGISTER'), 'FIRST_SENTENCE_REGISTER');
    // RETURNS section without a response-fields PARAMETERS list (strong form).
    assert.equal(code([
        'This operation queries entities by ID.',
        'RETURN TYPE:', 'GetResp',
        'RETURNS:', 'A GetResp object representing the queried entities.',
    ], 'RETURNS_MIN_DEPTH'), 'RETURNS_MIN_DEPTH');
    // PARAMETERS list present but empty of field bullets.
    assert.equal(code([
        'This operation queries entities by ID.',
        'RETURN TYPE:', 'GetResp',
        'RETURNS:', 'A GetResp object representing the queried entities.',
        'PARAMETERS:',
    ], 'RETURNS_MIN_DEPTH'), 'RETURNS_MIN_DEPTH');
    // Parameter bullet without a description (the maxWaitSeconds failure).
    assert.equal(code([
        'This operation waits for a bulk import to finish.',
        'PARAMETERS:', '- **maxWaitSeconds** (*long*)',
    ], 'PARAM_DESC_REQUIRED'), 'PARAM_DESC_REQUIRED');
    // Bare Notes line outside a governed callout.
    assert.equal(code([
        'This operation deletes entities.',
        'Notes', 'Internal scouting residue.',
    ], 'INTERNAL_NOTE_LEAK'), 'INTERNAL_NOTE_LEAK');

    // Compliant page: registered first sentence, described response fields,
    // described request parameters, notes only in the governed callout.
    const clean = checkLayoutConformance(sdkLayoutProfiles.java, {
        headings: [],
        lines: [
            'This operation queries entities by ID.',
            'PARAMETERS:', '- **ids** (*List<Object>*) - The entity IDs to query.',
            'RETURN TYPE:', 'GetResp',
            'RETURNS:', 'A GetResp object representing the queried entities.',
            'PARAMETERS:', '- **entities** (*List<Object>*) - The queried entities by ID.',
        ],
        callouts: [{ lines: ['Notes', 'Deprecated in v3.0.x. Use queryAsync().'] }],
    });
    assert.deepEqual(clean.violations, []);
});

test('checkMarkdownContentQuality runs the five rules over preview markdown, skipping fenced code', () => {
    const profile = sdkLayoutProfiles.java;
    const code = (markdown, name) => checkMarkdownContentQuality(markdown, profile)
        .violations.find((violation) => violation.code === name)?.code || null;

    // Compliant preview: registered first sentence, bold labels, described fields.
    assert.deepEqual(checkMarkdownContentQuality([
        'This operation queries entities by ID.',
        '',
        '**PARAMETERS:**',
        '- **ids** (*List<Object>*) - The entity IDs to query.',
        '',
        '**RETURN TYPE:**',
        'GetResp',
        '',
        '**RETURNS:**',
        'A GetResp object representing the queried entities.',
        '**PARAMETERS:**',
        '- **entities** (*List<Object>*) - The queried entities.',
    ].join('\n'), profile).violations, []);

    // Failure modes: CJK, register, returns depth, param description, bare notes.
    assert.equal(code('该操作查询实体。', 'CONTENT_CJK_MIXING'), 'CONTENT_CJK_MIXING');
    assert.equal(code('Deletes entities.', 'FIRST_SENTENCE_REGISTER'), 'FIRST_SENTENCE_REGISTER');
    assert.equal(code('This operation queries entities.\n**RETURNS:**\nA GetResp object.', 'RETURNS_MIN_DEPTH'), 'RETURNS_MIN_DEPTH');
    assert.equal(code('This operation waits.\n**PARAMETERS:**\n- **maxWaitSeconds** (*long*)', 'PARAM_DESC_REQUIRED'), 'PARAM_DESC_REQUIRED');
    assert.equal(code('This operation deletes entities.\nNotes\n', 'INTERNAL_NOTE_LEAK'), 'INTERNAL_NOTE_LEAK');

    // Fenced code is prose-exempt: CJK comments, dash lines, and Notes strings
    // inside example code never count.
    assert.deepEqual(checkMarkdownContentQuality([
        'This operation searches vectors.',
        '```java',
        '// 按 ID 查询',
        'client.query(ids); // Notes',
        '- not-a-param-bullet',
        '```',
    ].join('\n'), profile).violations, []);

    // A profile without content rules stays unbound.
    const bare = { id: 'custom', version: 1, order: [], fences: {}, cardinality: {} };
    assert.deepEqual(checkMarkdownContentQuality('Deletes entities.', bare).violations, []);
});
