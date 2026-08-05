'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createActionBatch } = require('../../.claude/skills/doc-ops-core/src/action-batch');

const SKILL_OPERATIONS = new Map([
  ['api-reference-sync', 'sync'],
  ['procedure-code-sync', 'patch'],
  ['doc-code-verify', 'verify'],
  ['verified-doc-authoring', 'author'],
  ['localized-doc-sync', 'localize'],
]);

test('five canonical skills produce 3/3 identical action sets and digests from equivalent dry-runs', () => {
  const canonicalActions = [
    { actionId: 'a:inspect', target: 'fixture:a', dependsOn: [], sideEffects: [] },
    { actionId: 'b:plan', target: 'fixture:b', dependsOn: ['a:inspect'], sideEffects: [] },
    { actionId: 'c:write', target: 'fixture:c', dependsOn: ['b:plan'], sideEffects: ['simulated.external.write'] },
  ];
  const permutations = [
    canonicalActions,
    [canonicalActions[2], canonicalActions[0], canonicalActions[1]],
    [canonicalActions[1], canonicalActions[2], canonicalActions[0]],
  ];

  for (const [skill, operation] of SKILL_OPERATIONS) {
    const runs = permutations.map(actions => createActionBatch({ skill, operation, actions }));
    const actionSets = runs.map(run => run.actions.map(action => action.actionId));
    const digests = runs.map(run => run.batchDigest);

    assert.deepEqual(actionSets, [actionSets[0], actionSets[0], actionSets[0]], `${skill} action set drifted`);
    assert.deepEqual(digests, [digests[0], digests[0], digests[0]], `${skill} digest drifted`);
    assert.match(digests[0], /^sha256:[a-f0-9]{64}$/);
  }
});
