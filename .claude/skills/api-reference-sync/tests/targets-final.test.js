'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TARGETS_FINAL,
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
