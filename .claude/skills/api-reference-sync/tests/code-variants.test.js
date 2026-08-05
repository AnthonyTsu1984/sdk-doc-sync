'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { composeCodeVariants } = require('../src/renderers/code-variants');

test('composes complete audience regions in one Python code block', () => {
  assert.equal(composeCodeVariants([
    { audience: 'milvus', code: 'bulk_import(url="http://localhost:19530")' },
    { audience: 'zilliz', code: 'bulk_import(url="https://api.cloud.zilliz.com")' },
  ], { lineComment: '#' }), [
    '# include-start milvus',
    'bulk_import(url="http://localhost:19530")',
    '# include-end',
    '# include-start zilliz',
    'bulk_import(url="https://api.cloud.zilliz.com")',
    '# include-end',
  ].join('\n'));
});

test('leaves one shared code variant directive-free', () => {
  assert.equal(composeCodeVariants([
    { audience: 'shared', code: 'client.flush()' },
  ], { lineComment: '#' }), 'client.flush()');
});

test('rejects mixed shared and platform-specific code variants', () => {
  assert.throws(() => composeCodeVariants([
    { audience: 'shared', code: 'shared_call()' },
    { audience: 'milvus', code: 'milvus_call()' },
  ], { lineComment: '#' }), /shared code variant cannot be combined/);
});
