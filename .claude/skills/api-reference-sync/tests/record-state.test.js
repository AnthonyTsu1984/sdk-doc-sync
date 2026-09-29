'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  executionTargetsBaseline,
  normalizedTargetsValue,
} = require('../src/sdk-doc-sync/record-state');

test('normalizedTargetsValue canonicalizes every observed Targets shape to a sorted string list', () => {
  assert.deepEqual(normalizedTargetsValue(undefined), []);
  assert.deepEqual(normalizedTargetsValue(null), []);
  assert.deepEqual(normalizedTargetsValue(''), []);
  assert.deepEqual(normalizedTargetsValue([]), []);
  assert.deepEqual(normalizedTargetsValue(['Milvus']), ['Milvus']);
  // Live readers may hand back single values or {text} option objects.
  assert.deepEqual(normalizedTargetsValue('Milvus'), ['Milvus']);
  assert.deepEqual(normalizedTargetsValue([{ text: 'Zilliz' }, 'Milvus']), ['Milvus', 'Zilliz']);
  assert.deepEqual(normalizedTargetsValue([' Milvus ', '', null, { value: 'Zilliz' }]), ['Milvus', 'Zilliz']);
});

test('executionTargetsBaseline derives per-action Targets only from journal rollback capsules', () => {
  const entries = [
    { type: 'prepared', actionId: 'action-a', rollbackCapsule: { beforeRecord: { recordId: 'rec-a', rawFields: { Targets: ['Milvus'] } } } },
    { type: 'prepared', actionId: 'action-b', rollbackCapsule: { beforeRecord: { recordId: 'rec-b', rawFields: {} } } },
    // Record-creating actions carry no beforeRecord and are not baselined.
    { type: 'prepared', actionId: 'action-c', rollbackCapsule: {} },
    { type: 'observed', actionId: 'action-a', status: 'success', verified: true },
    { type: 'completion', completionSentinel: true },
  ];
  const baseline = executionTargetsBaseline(entries);
  assert.deepEqual(baseline.get('action-a'), ['Milvus']);
  assert.deepEqual(baseline.get('action-b'), []);
  assert.equal(baseline.has('action-c'), false);
  assert.deepEqual(executionTargetsBaseline(null), new Map());
  assert.deepEqual(executionTargetsBaseline([]), new Map());
});
