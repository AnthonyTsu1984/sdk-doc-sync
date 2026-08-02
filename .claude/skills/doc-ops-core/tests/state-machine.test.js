'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { assertTransition, nextStates } = require('../src/state-machine');

test('shared state machine permits declared forward transitions', () => {
  assert.doesNotThrow(() => assertTransition('DISCOVER', 'PLAN'));
  assert.deepEqual(nextStates('PLAN'), ['BLOCKED', 'READY']);
  assert.doesNotThrow(() => assertTransition('VERIFIED', 'COMPLETE'));
});

test('shared state machine rejects skipped and backward transitions', () => {
  assert.throws(() => assertTransition('DISCOVER', 'APPROVED'), /INVALID_STATE_TRANSITION/);
  assert.throws(() => assertTransition('EXECUTED', 'PLAN'), /INVALID_STATE_TRANSITION/);
});
