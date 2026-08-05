'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createFaultInjector } = require('../harness/fault-injector');

for (const point of ['before_mutation', 'after_mutation', 'during_refetch', 'before_completion']) {
  test(`fault injector interrupts at ${point}`, async () => {
    const injector = createFaultInjector({ failAt: point });
    await assert.rejects(() => injector.checkpoint(point, 'a'), error => error.code === 'INJECTED_FAILURE');
    await assert.doesNotReject(() => injector.checkpoint(point, 'a'));
  });
}
