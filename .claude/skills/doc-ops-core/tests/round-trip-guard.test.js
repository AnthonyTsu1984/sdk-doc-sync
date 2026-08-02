'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { inventoryDocument, compareRoundTrip } = require('../src/round-trip-guard');

test('round-trip guard inventories rich and opaque block families deterministically', () => {
  const inventory = inventoryDocument({ blocks: [
    { id: 'h', type: 'heading' },
    { id: 'c', type: 'code' },
    { id: 'f', type: 'figma' },
    { id: 's', type: 'supademo' },
    { id: 'o', type: 'opaque' },
  ] });
  assert.deepEqual(inventory.counts, { code: 1, figma: 1, heading: 1, opaque: 1, supademo: 1 });
  assert.deepEqual(inventory.protectedIds, ['f', 'o', 's']);
});

test('round-trip guard blocks unapproved protected content loss', () => {
  const before = inventoryDocument({ blocks: [{ id: 'f', type: 'figma' }, { id: 'c', type: 'code' }] });
  const after = inventoryDocument({ blocks: [{ id: 'c', type: 'code' }] });
  const blocked = compareRoundTrip({ before, after });
  assert.equal(blocked.valid, false);
  assert.deepEqual(blocked.errors.map(error => error.code), ['PROTECTED_BLOCK_LOST']);
  const approved = compareRoundTrip({ before, after, approvedLosses: ['f'] });
  assert.deepEqual(approved, { valid: true, errors: [] });
});
