'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  TARGETS_FINAL,
  TargetsCategoryError,
  loadTargetsCategories,
  targetsFinalForReviewUnit,
} = require('../src/sdk-doc-sync/review-session-store');

test('KB-wide final Targets stays the Milvus+Zilliz pair', () => {
  assert.deepEqual([...TARGETS_FINAL], ['Milvus', 'Zilliz']);
});

test('targetsFinalForReviewUnit defaults to the KB-wide pair', () => {
  assert.deepEqual(targetsFinalForReviewUnit('review:go:Management:Segment'), ['Milvus', 'Zilliz']);
  assert.deepEqual(targetsFinalForReviewUnit('review:go:Partitions:HasPartition'), ['Milvus', 'Zilliz']);
});

test('ResourceGroup units resolve to the Milvus-only override (2026-10-09 ruling)', () => {
  assert.deepEqual(targetsFinalForReviewUnit('review:go:ResourceGroup:DescribeReplica'), ['Milvus']);
  assert.deepEqual(targetsFinalForReviewUnit('review:go:ResourceGroup:CreateResourceGroup'), ['Milvus']);
});

test('malformed or missing unit ids fall back to the KB-wide pair', () => {
  assert.deepEqual(targetsFinalForReviewUnit('weird'), ['Milvus', 'Zilliz']);
  assert.deepEqual(targetsFinalForReviewUnit(null), ['Milvus', 'Zilliz']);
  assert.deepEqual(targetsFinalForReviewUnit(undefined), ['Milvus', 'Zilliz']);
});

test('returned arrays are fresh copies, not shared references', () => {
  const first = targetsFinalForReviewUnit('review:go:ResourceGroup:DescribeReplica');
  first.push('Zilliz');
  assert.deepEqual(targetsFinalForReviewUnit('review:go:ResourceGroup:DescribeReplica'), ['Milvus']);
});

test('the shipped targets-categories table loads (batch 18 W-F)', () => {
  const loaded = loadTargetsCategories();
  assert.deepEqual(loaded.defaultTargets, ['Milvus', 'Zilliz']);
  assert.deepEqual([...loaded.categories.entries()], [['ResourceGroup', ['Milvus']]]);
});

test('a malformed targets-categories table refuses with TARGETS_CATEGORY_INVALID', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'targets-categories-'));
  const write = (value) => { const p = path.join(dir, `${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value)); return p; };

  assert.throws(() => loadTargetsCategories(write({ schemaVersion: 1 })), (e) => e instanceof TargetsCategoryError && e.code === 'TARGETS_CATEGORY_INVALID');
  assert.throws(() => loadTargetsCategories(write({ schemaVersion: 2, default: ['Milvus'] })), (e) => e.code === 'TARGETS_CATEGORY_INVALID');
  assert.throws(() => loadTargetsCategories(write({ schemaVersion: 1, default: ['Milvus', 'Zilliz', 'Kafka'] })), (e) => e.code === 'TARGETS_CATEGORY_INVALID');
  assert.throws(() => loadTargetsCategories(write({ schemaVersion: 1, default: [] })), (e) => e.code === 'TARGETS_CATEGORY_INVALID');
  assert.throws(() => loadTargetsCategories(write({ schemaVersion: 1, default: ['Milvus'], categories: { Bad: ['Nope'] } })), (e) => e.code === 'TARGETS_CATEGORY_INVALID');
  assert.throws(() => loadTargetsCategories(write('not json')), (e) => e.code === 'TARGETS_CATEGORY_INVALID');
  assert.throws(() => loadTargetsCategories(path.join(dir, 'missing.json')), (e) => e.code === 'TARGETS_CATEGORY_INVALID');
});
