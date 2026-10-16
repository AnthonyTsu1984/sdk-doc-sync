'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  INCLUDE_FORM_AMBIGUOUS,
  INCLUDE_TARGET_INVALID,
  IncludeInjectionError,
  buildIncludeWrapping,
  includeFormForContent,
} = require('../src/sdk-doc-sync/include-injection');
const { main } = require('../scripts/inject-includes');

test('includeFormForContent mandates inline for one line and block for two or more', () => {
  assert.equal(includeFormForContent('one line'), 'inline');
  assert.equal(includeFormForContent('one line\n\n\n'), 'inline', 'blank lines do not count');
  assert.equal(includeFormForContent('line one\nline two'), 'block');
  assert.equal(includeFormForContent('- a\n- b\n- c'), 'block');
});

test('single-line content wraps inline in the literal form', () => {
  const w = buildIncludeWrapping({ content: 'See [Zilliz docs](https://docs.zilliz.com).', target: 'zilliz' });
  assert.equal(w.form, 'inline');
  assert.equal(w.markdown, '<include target="zilliz">See [Zilliz docs](https://docs.zilliz.com).</include>');
});

test('multi-line content wraps in the block form with tags on their own lines', () => {
  const w = buildIncludeWrapping({ content: '- `a`: first\n- `b`: second', target: 'milvus' });
  assert.equal(w.form, 'block');
  assert.equal(w.markdown, ['<include target="milvus">', '- `a`: first', '- `b`: second', '</include>'].join('\n'));
});

test('a code fence uses the comment magic-tag form (2026-10-08 ruling)', () => {
  const block = buildIncludeWrapping({ content: 'code line 1\ncode line 2', target: 'milvus', inCodeFence: true });
  assert.equal(block.markdown, ['// include-start milvus', 'code line 1', 'code line 2', '// include-end milvus'].join('\n'));

  const inline = buildIncludeWrapping({ content: 'const x = 1;', target: 'zilliz', inCodeFence: true });
  assert.equal(inline.markdown, ['// include-nextline zilliz', 'const x = 1;'].join('\n'));
});

test('a custom line comment is honoured inside a fence', () => {
  const w = buildIncludeWrapping({ content: 'print(1)\nprint(2)', target: 'zilliz', inCodeFence: true, lineComment: '#' });
  assert.equal(w.markdown, ['# include-start zilliz', 'print(1)', 'print(2)', '# include-end zilliz'].join('\n'));
});

test('forcing a form the content cannot honour is refused, never silently reshaped', () => {
  assert.throws(
    () => buildIncludeWrapping({ content: 'line one\nline two', target: 'zilliz', form: 'inline' }),
    (error) => error instanceof IncludeInjectionError && error.code === INCLUDE_FORM_AMBIGUOUS && error.details.decided === 'block',
  );
  assert.throws(
    () => buildIncludeWrapping({ content: 'just one line', target: 'zilliz', form: 'block' }),
    (error) => error.code === INCLUDE_FORM_AMBIGUOUS && error.details.decided === 'inline',
  );
  // The matching form is accepted.
  assert.equal(buildIncludeWrapping({ content: 'just one line', target: 'zilliz', form: 'inline' }).form, 'inline');
});

test('target and content are validated', () => {
  assert.throws(() => buildIncludeWrapping({ content: 'x', target: 'kafka' }), (error) => error.code === INCLUDE_TARGET_INVALID);
  assert.throws(() => buildIncludeWrapping({ content: '   ', target: 'zilliz' }), (error) => error.code === 'INCLUDE_CONTENT_EMPTY');
});

test('the CLI wraps a single request and a batch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-includes-'));
  const requestPath = path.join(dir, 'req.json');
  fs.writeFileSync(requestPath, JSON.stringify({ target: 'zilliz', content: 'one line only' }));

  const writes = [];
  const io = { stdout: { write: (t) => writes.push(t) }, stderr: { write: () => {} } };
  assert.equal(main(['node', 'inject-includes.js', '--request', requestPath, '--json'], io), 0);
  const single = JSON.parse(writes.join(''));
  assert.equal(single.results[0].markdown, '<include target="zilliz">one line only</include>');

  const batchPath = path.join(dir, 'batch.json');
  fs.writeFileSync(batchPath, JSON.stringify({ target: 'milvus', items: [{ content: 'a\nb', inCodeFence: true }, { content: 'single' }] }));
  const writes2 = [];
  const io2 = { stdout: { write: (t) => writes2.push(t) }, stderr: { write: () => {} } };
  assert.equal(main(['node', 'inject-includes.js', '--request', batchPath, '--json'], io2), 0);
  const batch = JSON.parse(writes2.join(''));
  assert.equal(batch.results.length, 2);
  assert.match(batch.results[0].markdown, /^\/\/ include-start milvus/);
  assert.equal(batch.results[1].markdown, '<include target="milvus">single</include>');
});
