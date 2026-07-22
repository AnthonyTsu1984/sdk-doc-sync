'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { descriptionDiagnostics } = require('../src/sdk-reference-ir/prose-quality');

test('accepts readable article-led and plural-led descriptions', () => {
  assert.deepEqual(descriptionDiagnostics('The name of the target collection.'), []);
  assert.deepEqual(descriptionDiagnostics('Files containing the data to import.'), []);
  assert.deepEqual(descriptionDiagnostics('Additional options forwarded to the HTTP request.'), []);
});

test('rejects identifier-derived fragments and vague cloud labels', () => {
  assert.deepEqual(descriptionDiagnostics('url of the server.').map((item) => item.code), [
    'DESCRIPTION_FRAGMENT',
    'DESCRIPTION_START',
  ]);
  assert.ok(descriptionDiagnostics('The ID of a project(cloud).')
    .some((item) => item.code === 'VAGUE_PLATFORM_MARKER'));
});

test('requires terminal punctuation and normal parenthesis spacing', () => {
  assert.ok(descriptionDiagnostics('The target collection')
    .some((item) => item.code === 'DESCRIPTION_PUNCTUATION'));
  assert.ok(descriptionDiagnostics('The project(cloud).')
    .some((item) => item.code === 'DESCRIPTION_SPACING'));
});

test('allows callable names and signatures inside inline code', () => {
  assert.deepEqual(
    descriptionDiagnostics('The message ID returned by `get_replicate_info()`.'),
    [],
  );
});
