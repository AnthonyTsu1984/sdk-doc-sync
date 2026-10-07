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
        { kind: 'bullet', text: '**cost** (*long*) - The query cost.', boldName: false },
    ]);
});

test('pageFactsFromBlocks resolves callout children from the flat list-blocks payload', () => {
    // The live /documents/{id}/blocks payload is flat: `children` holds
    // block-ID strings and every block sits at top level. The callout child
    // lines must still read as callout content — a governed deprecation
    // callout's "Notes" line must never leak into the page-level line scan.
    const flat = [
        { block_id: 'root', block_type: 1, parent_id: '', page: {}, children: ['c', 'n', 'p'] },
        { block_id: 'c', block_type: 19, parent_id: 'root', callout: { emoji_id: 'blue_book' }, children: ['n', 'p'] },
        { block_id: 'n', block_type: 2, parent_id: 'c', text: { elements: [{ text_run: { content: 'Notes' } }] } },
        { block_id: 'p', block_type: 2, parent_id: 'c', text: { elements: [{ text_run: { content: 'This interface is deprecated, use GrantPrivilegeV2() instead.' } }] } },
        { block_id: 't', block_type: 2, parent_id: 'root', text: { elements: [{ text_run: { content: 'This operation grants a privilege to a role.' } }] } },
    ];
    const facts = pageFactsFromBlocks(flat);
    assert.deepEqual(facts.callouts, [{ lines: ['Notes', 'This interface is deprecated, use GrantPrivilegeV2() instead.'] }]);
    assert.deepEqual(facts.lines, ['This operation grants a privilege to a role.']);
    assert.equal(facts.stream.some((entry) => /^notes:?$/i.test(entry.text)), false);
    const { violations } = checkLayoutConformance(sdkLayoutProfiles.go, facts);
    assert.equal(violations.some((violation) => violation.code === 'INTERNAL_NOTE_LEAK'), false);
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

test('returnsResponseFieldsExemptTypes: declared data exempts single-error RETURNS from RETURNS_MIN_DEPTH', () => {
    // Operator ruling 2026-10-06 (go): a sole `error` return is the void
    // equivalent — RETURNS renders prose only, no response-fields list.
    const bareErrorLines = [
        'This operation adds one or more privileges to an existing privilege group.',
        'RETURN TYPE:', '*error*',
        'RETURNS:', 'Returns nil on success, or an error describing what went wrong.',
    ];
    // go declares the exemption; the bare-error page conforms.
    assert.deepEqual(
        checkLayoutConformance(sdkLayoutProfiles.go, { headings: [], lines: bareErrorLines, callouts: [] }).violations,
        [],
        'go exempts its declared single-error return type',
    );
    // A multi-value return stays bound: no PARAMETERS list still fails go.
    const multiValue = checkLayoutConformance(sdkLayoutProfiles.go, {
        headings: [],
        lines: [
            'This operation describes a role.',
            'RETURN TYPE:', '*entity.Role, error*',
            'RETURNS:', 'The role description including the role name, description, and privileges.',
        ],
        callouts: [],
    });
    assert.equal(
        multiValue.violations.some((violation) => violation.code === 'RETURNS_MIN_DEPTH'),
        true,
        'the exemption covers exactly the declared tokens, not every go page',
    );
    // Profiles without the declaration stay bound for the same page shape.
    assert.equal(
        checkLayoutConformance(sdkLayoutProfiles.java, { headings: [], lines: bareErrorLines, callouts: [] })
            .violations.some((violation) => violation.code === 'RETURNS_MIN_DEPTH'),
        true,
        'java has not declared the exemption',
    );
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

test('2026-10-04 adjudication: operation and class registers are both accepted; getter/instance phrasings are not', () => {
    const profile = sdkLayoutProfiles.java;
    const code = (lines, name) => checkLayoutConformance(profile, { headings: [], lines, callouts: [] })
        .violations.find((violation) => violation.code === name)?.code || null;

    // Operation register (getters included): "This operation returns …".
    assert.deepEqual(checkLayoutConformance(profile, {
        headings: [], lines: ['This operation returns the parameters of this request.'], callouts: [],
    }).violations, []);
    // Class register (2026-10-04 revised form): "A Xxx instance is …".
    assert.deepEqual(checkLayoutConformance(profile, {
        headings: [], lines: ['A FunctionScore instance is a scoring function expression.'], callouts: [],
    }).violations, []);
    // Unregistered forms still fail: "This getter returns …", the earlier
    // "This class initiates …" draft form.
    assert.equal(code(['This getter returns the parameters of this request.'], 'FIRST_SENTENCE_REGISTER'), 'FIRST_SENTENCE_REGISTER');
    assert.equal(code(['This class initiates a MilvusClientV2 instance that connects to a Milvus deployment.'], 'FIRST_SENTENCE_REGISTER'), 'FIRST_SENTENCE_REGISTER');
});

test('block-path parameter bullets are judged by bold style, not literal markers (review r1 P1)', () => {
    const profile = sdkLayoutProfiles.java;
    // Feishu bold is a style: name run carries text_element_style.bold.
    const facts = pageFactsFromBlocks([
        { block_id: 'p', block_type: 2, text: { elements: [{ text_run: { content: 'This operation waits for a bulk import.' } }] } },
        { block_id: 'l', block_type: 2, text: { elements: [{ text_run: { content: 'PARAMETERS:' } }] } },
        { block_id: 'b1', block_type: 12, bullet: { elements: [
            { text_run: { content: 'maxWaitSeconds', text_element_style: { bold: true } } },
            { text_run: { content: ' (long) -' } },
        ] } },
        { block_id: 'b2', block_type: 12, bullet: { elements: [
            { text_run: { content: 'collectionName', text_element_style: { bold: true } } },
            { text_run: { content: ' (String) - The target collection.' } },
        ] } },
        { block_id: 'b3', block_type: 12, bullet: { elements: [
            { text_run: { content: 'A plain prose bullet, not a parameter.' } },
        ] } },
    ]);
    const violations = checkLayoutConformance(profile, facts).violations;
    assert.equal(
        violations.filter((violation) => violation.code === 'PARAM_DESC_REQUIRED').length,
        1,
        'only the description-less bold-name bullet is flagged',
    );
    assert.match(violations.find((violation) => violation.code === 'PARAM_DESC_REQUIRED').detail, /maxWaitSeconds/);
});

test('markdown linked-type parameter bullets with no description are flagged (review r1 P1)', () => {
    const profile = sdkLayoutProfiles.java;
    const flagged = checkMarkdownContentQuality([
        'This operation searches vectors.',
        '**PARAMETERS:**',
        '- **collection_name** ([str](https://zilliverse.feishu.cn/docx/str)) -',
    ].join('\n'), profile).violations;
    assert.equal(flagged.find((violation) => violation.code === 'PARAM_DESC_REQUIRED')?.code, 'PARAM_DESC_REQUIRED');
    const clean = checkMarkdownContentQuality([
        'This operation searches vectors.',
        '**PARAMETERS:**',
        '- **collection_name** ([str](https://zilliverse.feishu.cn/docx/str)) - The name of the target collection.',
    ].join('\n'), profile).violations;
    assert.deepEqual(clean, []);
});

test('markdown governed Admonition interiors are exempt from the Notes-leak rule (review r1 P0)', () => {
    const profile = sdkLayoutProfiles.java;
    assert.deepEqual(checkMarkdownContentQuality([
        'This operation deletes entities from a collection.',
        '<Admonition icon="📘">',
        'Notes',
        'Deprecated in v3.0.x. Use deleteAsync().',
        '</Admonition>',
    ].join('\n'), profile).violations, []);
    const bare = checkMarkdownContentQuality('This operation deletes entities.\nNotes\n', profile).violations;
    assert.equal(bare.find((violation) => violation.code === 'INTERNAL_NOTE_LEAK')?.code, 'INTERNAL_NOTE_LEAK');
});
