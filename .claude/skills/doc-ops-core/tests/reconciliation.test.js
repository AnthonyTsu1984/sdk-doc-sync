'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { reconcileActions } = require('../src/reconciliation');

test('reconciliation classifies verified, applied, divergent, unknown, and not-started actions', async () => {
  const actions = ['verified', 'applied', 'divergent', 'unknown', 'not-started'].map(actionId => ({ actionId }));
  const entries = [
    { type: 'prepared', actionId: 'verified' },
    { type: 'observed', actionId: 'verified', status: 'success', verified: true },
    { type: 'prepared', actionId: 'applied' },
    { type: 'prepared', actionId: 'divergent' },
    { type: 'prepared', actionId: 'unknown' },
  ];
  const result = await reconcileActions({
    actions,
    journalEntries: entries,
    observe: async action => ({ state: action.actionId === 'applied' ? 'applied' : action.actionId }),
  });
  assert.deepEqual(Object.fromEntries(result.actions.map(item => [item.actionId, item.classification])), {
    applied: 'applied',
    divergent: 'divergent',
    'not-started': 'not_started',
    unknown: 'unknown',
    verified: 'verified',
  });
  assert.deepEqual(result.resumableActionIds, ['not-started']);
  assert.equal(result.blocked, true);
});
