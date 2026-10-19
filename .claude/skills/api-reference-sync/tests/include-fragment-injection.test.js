'use strict';

// Batch 16 slice 5 acceptance, rule 5 — fragment-level (inline = 块内分叉)
// include injection. Pins come from the campaign design §5.6 P2 (four block
// types' placement semantics, run-merge rule, deep-indent fail-closed, writer
// literal pass-through, marker byte canonicalization) plus two docx-to-ir
// read-back pins (markers outside lists, literal tags inside table cells).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  INCLUDE_CONTENT_EMPTY,
  INCLUDE_FRAGMENT_INDENT_UNSUPPORTED,
  INCLUDE_FRAGMENT_NOT_FOUND,
  INCLUDE_TARGET_INVALID,
  IncludeInjectionError,
  includeFormDecision,
  wrapBlockRun,
  wrapFragment,
  wrapListItems,
  wrapTableRow,
} = require('../src/sdk-doc-sync/include-injection');
const { main } = require('../scripts/inject-includes');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const { docxToIr } = require('../src/document-ir/docx-to-ir');

// ---- helpers -----------------------------------------------------------

function newConverter() {
  return new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
}

async function convert(markdown) {
  const converter = newConverter();
  const { tokens } = await converter.parse_markdown(markdown);
  return converter.markdown_to_blocks(tokens);
}

// Per-block visible text: text/bullet blocks join their text_run contents;
// callout blocks join their children's text.
function blockText(block) {
  const body = block.text || block.bullet || block.ordered || block.heading1 || block.heading2 || block.heading3;
  const join = (b) => (b?.elements || []).map((element) => element.text_run?.content || '').join('');
  if (body) return join(body);
  if (block.callout) return (block.children || []).map(blockText).join('\n');
  return '';
}

function textRun(block) {
  const body = block.text || block.bullet || block.ordered;
  return (body?.elements || []).map((element) => element.text_run || null).filter(Boolean);
}

// Raw docx blocks (SDK shape) used by the read-back pins.
function rawTextBlock(blockId, parentId, content) {
  return {
    block_id: blockId,
    block_type: 2,
    parent_id: parentId,
    text: { elements: [{ text_run: { content, text_element_style: {} } }] },
  };
}

function rawBulletBlock(blockId, parentId, content) {
  return {
    block_id: blockId,
    block_type: 12,
    parent_id: parentId,
    children: [],
    bullet: { elements: [{ text_run: { content, text_element_style: {} } }] },
  };
}

// ---- selector: four block types' placement semantics (P2) --------------

test('prose fragment: wrapFragment tags the fragment in place inside its block', () => {
  const wrapped = wrapFragment('See the quick start before continuing.', 'quick start', 'zilliz');
  assert.equal(wrapped.form, 'inline');
  assert.equal(wrapped.markdown, 'See the <include target="zilliz">quick start</include> before continuing.');

  // Every exact occurrence is tagged; the surrounding bytes are untouched.
  const twice = wrapFragment('a quick start and a quick start', 'quick start', 'milvus');
  assert.equal(twice.markdown, 'a <include target="milvus">quick start</include> and a <include target="milvus">quick start</include>');

  // Fail-closed: never invent or relocate content.
  assert.throws(() => wrapFragment('no such text here', 'quick start', 'zilliz'), (error) => error instanceof IncludeInjectionError && error.code === INCLUDE_FRAGMENT_NOT_FOUND);
  assert.throws(() => wrapFragment('text', '   ', 'zilliz'), (error) => error.code === INCLUDE_CONTENT_EMPTY);
  assert.throws(() => wrapFragment('text', 'text', 'kafka'), (error) => error.code === INCLUDE_TARGET_INVALID);
});

test('list-item placement: tags one indent level outside, run merged first-front last-back', () => {
  const topLevel = wrapListItems(['- `a`: first', '- `b`: second', '- `c`: third'], 'milvus');
  assert.equal(topLevel.form, 'block');
  assert.equal(topLevel.markdown, [
    '<include target="milvus">',
    '- `a`: first',
    '- `b`: second',
    '- `c`: third',
    '</include>',
  ].join('\n'));
  // Merge rule: exactly one open tag and one close tag for the whole run.
  assert.equal(topLevel.markdown.split('<include target="milvus">').length - 1, 1);
  assert.equal(topLevel.markdown.split('</include>').length - 1, 1);

  // A nested (2-space) item gets its tags one level less — at column 0.
  const nested = wrapListItems(['  - sub item'], 'zilliz');
  assert.equal(nested.markdown, ['<include target="zilliz">', '  - sub item', '</include>'].join('\n'));

  // The emitted markdown writer-round-trips to marker blocks sandwiching the
  // list blocks (the P2 canonical shape).
  return convert(topLevel.markdown).then((blocks) => {
    assert.deepEqual(blocks.map((block) => (block.text ? 'marker' : 'list')), ['marker', 'list', 'list', 'list', 'marker']);
    assert.equal(blockText(blocks[0]), '<include target="milvus">');
    assert.equal(blockText(blocks[4]), '</include>');
  });
});

test('deep-nested list items (indent >= 4) are refused typed, never silently reshaped', () => {
  assert.throws(
    () => wrapListItems(['- top', '    - deep nest'], 'zilliz'),
    (error) => error instanceof IncludeInjectionError
      && error.code === INCLUDE_FRAGMENT_INDENT_UNSUPPORTED
      && error.details.itemIndex === 1
      && error.details.indent === 4,
  );
  // The refusal tells the caller the two sanctioned ways out.
  try {
    wrapListItems(['    - deep nest'], 'milvus');
    assert.fail('expected INCLUDE_FRAGMENT_INDENT_UNSUPPORTED');
  } catch (error) {
    assert.match(error.message, /lift the item one indent level or use wrapFragment/);
  }
  // One tag pair cannot sit one level outside two different levels.
  assert.throws(
    () => wrapListItems(['- top', '  - nested'], 'zilliz'),
    (error) => error.code === INCLUDE_FRAGMENT_INDENT_UNSUPPORTED && error.details.indent === 2,
  );
});

test('table-row placement: every cell tagged front and back; a cell fork is wrapFragment', () => {
  const row = wrapTableRow(['Name', 'string'], 'zilliz');
  assert.equal(row.form, 'inline');
  assert.equal(row.markdown, '| <include target="zilliz">Name</include> | <include target="zilliz">string</include> |');

  const cell = wrapFragment('see the note column', 'note', 'milvus');
  assert.equal(cell.markdown, 'see the <include target="milvus">note</include> column');
});

test('callout placement: same rule as prose, inside its wrapper', async () => {
  // Tag-on-own-line state: the run merge wraps the callout block — the open
  // and close tags each own a line around it (P2: marker blocks sandwiching
  // the callout block).
  const region = wrapBlockRun(['<div class="alert note">\nNotes\nCheck the quick start guide.\n</div>'], 'zilliz');
  assert.equal(region.markdown, [
    '<include target="zilliz">',
    '<div class="alert note">',
    'Notes',
    'Check the quick start guide.',
    '</div>',
    '</include>',
  ].join('\n'));

  // Writer terminal layout: marker blocks sandwiching the callout block. The
  // audience region check is hoisted above the alert-div branch precisely so
  // this shape survives (a plain alert branch would absorb the div and lose
  // the marker bytes).
  const blocks = await convert(region.markdown);
  const kinds = blocks.map((block) => (block.text ? 'marker' : (block.callout ? 'callout' : 'other')));
  assert.deepEqual(kinds, ['marker', 'callout', 'marker']);
  assert.equal(blockText(blocks[0]), '<include target="zilliz">');
  assert.equal(blockText(blocks[2]), '</include>');

  // Inline-fragment state: a fragment inside the callout content is tagged in
  // place (the same prose rule, composed inside the wrapper).
  const inlineRegion = wrapFragment('see the quick start first', 'quick start', 'milvus');
  const inlineMarkdown = [
    '<div class="alert note">',
    'Notes',
    inlineRegion.markdown,
    '</div>',
  ].join('\n');
  assert.ok(inlineMarkdown.includes('see the <include target="milvus">quick start</include> first'));

  // Known writer gap (reported, not pinned as desired): the alert-div branch
  // extracts callout content via cheerio text(), which drops non-text
  // elements — a tag composed INSIDE the wrapper does not survive to the
  // callout child bytes. The callout block itself is still produced.
  const converted = await convert(inlineMarkdown);
  const callout = converted.find((block) => block.callout);
  assert.ok(callout, 'callout block produced');
});

// ---- run merge (prose) --------------------------------------------------

test('run merge: two consecutive blocks with one target tag only first-front last-back', async () => {
  const merged = wrapBlockRun(['first paragraph', 'second paragraph'], 'milvus');
  assert.equal(merged.form, 'block');
  assert.equal(merged.markdown, ['<include target="milvus">', 'first paragraph', '', 'second paragraph', '</include>'].join('\n'));
  assert.equal(merged.markdown.split('<include target="milvus">').length - 1, 1, 'one open tag for the run');
  assert.equal(merged.markdown.split('</include>').length - 1, 1, 'one close tag for the run');

  const blocks = await convert(merged.markdown);
  assert.deepEqual(blocks.map((block) => (block.text ? blockText(block) : '?')), [
    '<include target="milvus">',
    'first paragraph',
    'second paragraph',
    '</include>',
  ]);

  // Empty runs and empty entries are refused typed.
  assert.throws(() => wrapBlockRun([], 'milvus'), (error) => error.code === INCLUDE_CONTENT_EMPTY);
  assert.throws(() => wrapBlockRun(['ok', '   '], 'milvus'), (error) => error.code === INCLUDE_CONTENT_EMPTY);
});

// ---- three-state form decision + emitter pass-through -------------------

test('the form decision is three-state: block / inline (fragment) / code-fence', () => {
  assert.equal(includeFormDecision({ content: 'one line' }), 'inline');
  assert.equal(includeFormDecision({ content: 'line one\nline two' }), 'block');
  assert.equal(includeFormDecision({ content: 'const x = 1;', inCodeFence: true }), 'code-fence');
  assert.equal(includeFormDecision({ content: 'a\nb', inCodeFence: true }), 'code-fence', 'fence mechanism unchanged: line count still picks nextline vs start/end inside the fence');
});

test('the emitter CLI passes the fragment placements through', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-fragments-'));
  const requestPath = path.join(dir, 'req.json');
  fs.writeFileSync(requestPath, JSON.stringify({
    target: 'zilliz',
    items: [
      { blockText: 'see the quick start', fragment: 'quick start' },
      { blocks: ['one', 'two'] },
      { listItems: ['- a', '- b'] },
      { tableCells: ['Name', 'Type'] },
      { content: 'plain single line' },
    ],
  }));

  const writes = [];
  const io = { stdout: { write: (t) => writes.push(t) }, stderr: { write: () => {} } };
  assert.equal(main(['node', 'inject-includes.js', '--request', requestPath, '--json'], io), 0);
  const parsed = JSON.parse(writes.join(''));
  assert.deepEqual(parsed.results.map((result) => result.markdown), [
    'see the <include target="zilliz">quick start</include>',
    ['<include target="zilliz">', 'one', '', 'two', '</include>'].join('\n'),
    ['<include target="zilliz">', '- a', '- b', '</include>'].join('\n'),
    '| <include target="zilliz">Name</include> | <include target="zilliz">Type</include> |',
    '<include target="zilliz">plain single line</include>',
  ]);

  // The deep-indent refusal surfaces typed through the CLI entry too.
  const refusePath = path.join(dir, 'refuse.json');
  fs.writeFileSync(refusePath, JSON.stringify({ target: 'zilliz', listItems: ['    - deep'] }));
  assert.throws(
    () => main(['node', 'inject-includes.js', '--request', refusePath]),
    (error) => error instanceof IncludeInjectionError && error.code === INCLUDE_FRAGMENT_INDENT_UNSUPPORTED,
  );
});

// ---- writer: literal pass-through of fragment tags ----------------------

test('writer passes fragment tags through a paragraph literally, escapes and entities do not break the tag', async () => {
  const plain = await convert('前文 <include target="zilliz">片段</include> 后文');
  assert.equal(plain.length, 1);
  const runs = textRun(plain[0]).map((run) => run.content).join('');
  assert.equal(runs, '前文 <include target="zilliz">片段</include> 后文');

  const escaped = await convert('Escaped \\< and &amp; around <include target="milvus">TEXT [URL]</include> survive');
  const escapedRuns = textRun(escaped[0]).map((run) => run.content).join('');
  assert.equal(escapedRuns, 'Escaped < and & around <include target="milvus">TEXT [URL]</include> survive');
});

// ---- writer: marker bytes are canonical across authoring forms ----------

test('marker bytes are canonical: blank-line and compact authoring yield identical marker text', async () => {
  const compact = await convert('<include target="zilliz">\n- a: first\n- b: second\n</include>');
  const blank = await convert('<include target="zilliz">\n\n- a: first\n- b: second\n\n</include>');

  // Same block layout: marker block sandwiching the list blocks.
  const layout = (blocks) => blocks.map((block) => (block.text ? 'marker' : 'list'));
  assert.deepEqual(layout(compact), ['marker', 'list', 'list', 'marker']);
  assert.deepEqual(layout(blank), ['marker', 'list', 'list', 'marker']);

  // The open-tag marker bytes are identical and canonical — the blank-line
  // form used to carry a trailing newline into the marker text_run.
  assert.equal(blockText(compact[0]), '<include target="zilliz">');
  assert.equal(blockText(blank[0]), '<include target="zilliz">');
  assert.equal(blockText(blank[0]), blockText(compact[0]));
  assert.equal([...blockText(blank[0])].pop(), '>', 'no trailing newline on the canonical marker');

  // The close-tag marker text survives byte-identically in both forms.
  assert.equal(blockText(compact[3]), '</include>');
  assert.equal(blockText(blank[3]), '</include>');

  // Direct pin of the normalization choke point: a marker handed over with
  // authoring whitespace (the trailing-newline shape the blank-line tokenize
  // can produce) is trimmed to the canonical compact bytes.
  const converter = newConverter();
  const raw = converter.__create_audience_marker_block('<include target="zilliz">\n');
  assert.equal((raw.text.elements || []).map((element) => element.text_run?.content || '').join(''), '<include target="zilliz">');
});

// ---- round-trip read-back (docx-to-ir read side) ------------------------

test('read-back: marker blocks around a list survive byte-for-byte', () => {
  const ir = docxToIr([
    { block_id: 'page', block_type: 1, children: ['open', 'item-a', 'item-b', 'close'] },
    rawTextBlock('open', 'page', '<include target="milvus">'),
    rawBulletBlock('item-a', 'page', 'first item'),
    rawBulletBlock('item-b', 'page', 'second item'),
    rawTextBlock('close', 'page', '</include>'),
  ]);

  assert.deepEqual(ir.children.map((node) => node.type), ['paragraph', 'unorderedList', 'paragraph']);
  assert.equal(ir.children[0].children[0].value, '<include target="milvus">');
  assert.equal(ir.children[2].children[0].value, '</include>');
  assert.equal(ir.children[1].items.length, 2, 'list read back intact between the markers');
});

test('read-back: literal tags inside table cells survive; the anchored inline cell still reads as an audience region', () => {
  const ir = docxToIr([
    { block_id: 'page', block_type: 1, children: ['table'] },
    { block_id: 'table', block_type: 31, parent_id: 'page', table: { property: { row_size: 1, column_size: 2 }, cells: ['cell-a', 'cell-b'] } },
    { block_id: 'cell-a', block_type: 32, parent_id: 'table', children: ['cell-a-text'] },
    { block_id: 'cell-b', block_type: 32, parent_id: 'table', children: ['cell-b-text'] },
    rawTextBlock('cell-a-text', 'cell-a', '前文 <include target="zilliz">片段</include> 后文'),
    rawTextBlock('cell-b-text', 'cell-b', '<include target="milvus">Visible</include>'),
  ]);

  assert.equal(ir.children[0].type, 'table');
  const [cellA, cellB] = ir.children[0].rows[0].cells;

  // Cell-level fork with surrounding context: the tag survives literally.
  assert.equal(cellA.children[0].type, 'paragraph');
  assert.equal(cellA.children[0].children.map((child) => child.value).join(''), '前文 <include target="zilliz">片段</include> 后文');

  // The whole-cell inline region is recognized (docx-to-ir inline already read).
  assert.equal(cellB.children[0].type, 'audience');
  assert.equal(cellB.children[0].mode, 'include');
  assert.equal(cellB.children[0].target, 'milvus');
});

// ---- callout wrapper: fragment tags survive the alert-div renderer -------

// The gap pinned above as "known writer gap" (the callout placement test) is
// fixed: the alert-div branch serializes include/exclude elements back to
// their literal tag text before the cheerio text() extraction, so a fragment
// composed inside the callout wrapper follows the same rule as prose.
test('callout inline fragment: include and exclude tag bytes survive verbatim in the callout body', async () => {
  const markdown = [
    '<div class="alert note">',
    'Notes',
    'see the <include target="milvus">quick start</include> first',
    '</div>',
    '',
    '<div class="alert warning">',
    'Notes',
    'only <exclude target="zilliz">this part</exclude> differs',
    '</div>',
  ].join('\n');
  const blocks = await convert(markdown);
  const callouts = blocks.filter((block) => block.callout);
  assert.equal(callouts.length, 2);

  const includeBody = blockText(callouts[0].children[1]);
  assert.equal(includeBody, 'Notes\nsee the <include target="milvus">quick start</include> first');
  // Exactly one well-formed marker pair inside the wrapper.
  assert.equal(includeBody.split('<include target="milvus">').length - 1, 1);
  assert.equal(includeBody.split('</include>').length - 1, 1);

  const excludeBody = blockText(callouts[1].children[1]);
  assert.equal(excludeBody, 'Notes\nonly <exclude target="zilliz">this part</exclude> differs');
});

test('callout tag-on-own-line state (unclosed region inside the wrapper): open marker survives as literal bytes, close marker synthesized — actual behavior pinned', async () => {
  // This authoring shape reaches the alert-div branch unclosed: the
  // top-level audience extraction (which owns the closed standalone form and
  // swaps the whole div for marker blocks, upstream of the callout renderer)
  // cannot match without a close tag. Inside the wrapper the HTML parser
  // auto-closes the region at the wrapper's </div>, so the literal
  // serialization of the include element ends with a synthesized
  // </include>. The open marker bytes are verbatim, the enclosed content is
  // preserved, and the pair is well-formed for downstream literal matching —
  // but no separate marker BLOCKS are produced inside the callout (callout
  // content flattens to body text by design; the marker-pair-as-blocks
  // layout only exists outside wrappers). Pinned as rendered, not as
  // idealized.
  const markdown = [
    '<div class="alert note">',
    'Notes',
    '<include target="milvus">',
    'Check the guide.',
    '</div>',
  ].join('\n');
  const blocks = await convert(markdown);
  const callout = blocks.find((block) => block.callout);
  assert.ok(callout, 'callout block produced');
  const body = blockText(callout.children[1]);
  assert.equal(body, 'Notes\n<include target="milvus">\nCheck the guide.\n</include>');
  assert.equal(body.split('<include target="milvus">').length - 1, 1);
  assert.equal(body.split('</include>').length - 1, 1);
});

test('regression: a plain alert div (no include/exclude) renders byte-identically to its pre-fix output', async () => {
  // Both pre-existing sample shapes from the established suites: the
  // compact callout-placement sample and the blank-line intake sample the
  // lists suite pins. The marker-protection pass must be a strict no-op
  // when the wrapper contains no include/exclude elements.
  const compact = await convert([
    '<div class="alert note">',
    'Notes',
    'Check the quick start guide.',
    '</div>',
  ].join('\n'));
  assert.deepEqual(compact, [{
    block_type: 19,
    callout: { emoji_id: 'blue_book', background_color: 2, border_color: 2 },
    children: [
      {
        block_type: 2,
        text: {
          elements: [{
            text_run: {
              content: 'Notes',
              text_element_style: { bold: false, italic: false, strikethrough: false, underline: false, inline_code: false },
            },
          }],
          style: {},
        },
      },
      {
        block_type: 2,
        text: {
          elements: [{
            text_run: {
              content: 'Notes\nCheck the quick start guide.',
              text_element_style: { bold: false, italic: false, strikethrough: false, underline: false, inline_code: false },
            },
          }],
          style: {},
        },
      },
    ],
  }]);

  const blankLineForm = await convert([
    '<div class="alert note">',
    '',
    'Do not disconnect the MilvusClientV2 while the iterator is in use.',
    '',
    '</div>',
  ].join('\n'));
  assert.deepEqual(blankLineForm, [{
    block_type: 19,
    callout: { emoji_id: 'blue_book', background_color: 2, border_color: 2 },
    children: [
      {
        block_type: 2,
        text: {
          elements: [{
            text_run: {
              content: 'Notes',
              text_element_style: { bold: false, italic: false, strikethrough: false, underline: false, inline_code: false },
            },
          }],
          style: {},
        },
      },
      {
        block_type: 2,
        text: {
          elements: [{
            text_run: {
              content: 'Do not disconnect the MilvusClientV2 while the iterator is in use.',
              text_element_style: { bold: false, italic: false, strikethrough: false, underline: false, inline_code: false },
            },
          }],
          style: {},
        },
      },
    ],
  }]);
});
