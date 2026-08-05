'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canonicalize,
  canonicalStringify,
  splitSemanticEnvelope,
} = require('../src/canonical-json');

test('canonical JSON recursively sorts keys and emits exactly one trailing newline', () => {
  const value = { z: 1, a: { d: 4, b: 2 }, omitted: undefined };
  assert.equal(canonicalStringify(value), '{"a":{"b":2,"d":4},"z":1}\n');
  assert.equal(canonicalStringify(value), canonicalStringify(value));
});

test('canonicalization applies declared stable array sort keys without mutating input', () => {
  const input = { diagnostics: [{ code: 'Z', target: 'b' }, { code: 'A', target: 'c' }, { code: 'A', target: 'a' }] };
  const normalized = canonicalize(input, { arraySortKeys: { '$.diagnostics': ['code', 'target'] } });
  assert.deepEqual(normalized.diagnostics.map(item => `${item.code}:${item.target}`), ['A:a', 'A:c', 'Z:b']);
  assert.equal(input.diagnostics[0].code, 'Z');
});

test('semantic envelopes exclude runtime-only metadata from semantic content', () => {
  const envelope = splitSemanticEnvelope({
    semantic: { status: 'READY', items: [1, 2] },
    runtime: { timestamp: '2026-08-02T00:00:00Z', pid: 42 },
  });
  assert.deepEqual(envelope.semantic, { items: [1, 2], status: 'READY' });
  assert.deepEqual(envelope.runtime, { pid: 42, timestamp: '2026-08-02T00:00:00Z' });
});

test('canonicalization rejects circular structures', () => {
  const value = {};
  value.self = value;
  assert.throws(() => canonicalStringify(value), /circular/i);
});
