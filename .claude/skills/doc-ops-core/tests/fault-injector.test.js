'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createFaultInjector, InjectedFailure, FAULT_POINTS } = require('../harness/fault-injector');

test('fault injector interrupts at every canonical seam exactly `times` times', async () => {
  assert.deepEqual(FAULT_POINTS, [
    'before_mutation',
    'after_mutation',
    'during_refetch',
    'before_completion',
    'after_completion',
  ]);
  for (const point of FAULT_POINTS) {
    const injector = createFaultInjector({ failAt: point, times: 2 });
    await assert.rejects(() => injector.checkpoint(point, 'a'), error => error.code === 'INJECTED_FAILURE');
    await assert.rejects(() => injector.checkpoint(point, 'a'), error => error.code === 'INJECTED_FAILURE');
    await assert.doesNotReject(() => injector.checkpoint(point, 'a'));
  }
});

test('fault injector records every hit for crash-window assertions', async () => {
  const injector = createFaultInjector({ failAt: 'before_completion' });
  await injector.checkpoint('before_mutation', 'a');
  await injector.checkpoint('before_completion', 'a').catch(() => {});
  await injector.checkpoint('after_completion', null);
  assert.deepEqual(injector.hits, [
    { point: 'before_mutation', actionId: 'a' },
    { point: 'before_completion', actionId: 'a' },
    { point: 'after_completion', actionId: null },
  ]);
});

test('InjectedFailure names the seam and the action', () => {
  const error = new InjectedFailure('after_mutation', 'node:Collections:a');
  assert.equal(error.code, 'INJECTED_FAILURE');
  assert.equal(error.point, 'after_mutation');
  assert.equal(error.actionId, 'node:Collections:a');
  assert.match(error.message, /after_mutation:node:Collections:a/);
});
