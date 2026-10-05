'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { blocksToMarkdown } = require('../src/sdk-doc-sync/blocks-to-markdown');
const { extractSemanticMap } = require('../src/sdk-doc-sync/semantic-content-map');

const BLOCKS = [
    { block_type: 1, children: [
        { block_type: 2, text: { elements: [{ text_run: { content: 'This operation drops a specific role.' } }] } },
        { block_type: 14, code: { style: { language: 29 }, elements: [
            { text_run: { content: 'public Void dropRole(DropRoleReq request)\n' } },
        ] } },
        { block_type: 4, heading2: { elements: [{ text_run: { content: 'Request Syntax' } }] } },
        { block_type: 2, text: { elements: [{ text_run: { content: 'BUILDER METHODS:', text_element_style: { bold: true } } }] } },
        { block_type: 12, bullet: { elements: [{ text_run: { content: 'groupName(String groupName)', text_element_style: { inline_code: true } } }] }, children: [
            { block_type: 2, text: { elements: [{ text_run: { content: 'The name of the target group.' } }] } },
        ] },
        { block_type: 31, table: { property: { column_size: 2 }, cells: ['a', 'b'] } },
    ] },
];

test('blocksToMarkdown renders the authored structure the semantic map sees', () => {
    const md = blocksToMarkdown(BLOCKS);
    assert.equal(md, [
        'This operation drops a specific role.',
        '',
        '```java',
        'public Void dropRole(DropRoleReq request)',
        '```',
        '',
        '## Request Syntax',
        '',
        '**BUILDER METHODS:**',
        '',
        '- `groupName(String groupName)`',
        '    The name of the target group.',
        '',
        '| a | b |',
        '| --- | --- |',
        '',
    ].join('\n'));

    const map = extractSemanticMap(md);
    assert.equal(map.items.length, 1);
    assert.equal(map.items[0].section, 'MEMBER');
    assert.equal(map.codeBlocks.length, 1);
    assert.equal(map.codeBlocks[0].lang, 'java');
    assert.equal(map.tables.length, 1);
});

test('code element boundaries are not line breaks; interior blanks are real', () => {
    const md = blocksToMarkdown([
        { block_type: 14, code: { style: { language: 29 }, elements: [
            { text_run: { content: '.build()\n' } },
            { text_run: { content: ')' } },
        ] } },
    ]);
    // ".build()\n" + ")" = ".build()\n)" — the element boundary adds nothing.
    assert.ok(md.includes('.build()\n)'));
    assert.ok(!md.includes('.build()\n\n)'));

    const blanked = blocksToMarkdown([
        { block_type: 14, code: { style: { language: 29 }, elements: [
            { text_run: { content: 'a\n\nb' } },
        ] } },
    ]);
    // An interior blank line is real authored content and must survive.
    assert.ok(blanked.includes('a\n\nb'));
});
