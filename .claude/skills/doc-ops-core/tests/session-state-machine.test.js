'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { SAME_STATE, SessionStateMachineError, defineSessionMachine } = require('../src/session-state-machine');

function reviewMachine() {
  return defineSessionMachine({
    name: 'review:test',
    initial: 'in_progress',
    terminal: 'finalized',
    transitions: {
      recordExecution: { from: ['in_progress', 'acceptance_pending'], to: SAME_STATE },
      buildAcceptance: { from: ['in_progress'], to: 'acceptance_pending' },
      rollBack: { from: ['in_progress', 'acceptance_pending'], to: 'in_progress' },
      finalize: { from: ['acceptance_pending'], to: 'finalized' },
    },
  });
}

test('defineSessionMachine rejects malformed tables at definition time', () => {
  assert.throws(() => defineSessionMachine({ terminal: 'done', transitions: {} }), TypeError);
  assert.throws(() => defineSessionMachine({ name: 'm', initial: 'a', transitions: {} }), TypeError);
  assert.throws(() => defineSessionMachine({ name: 'm', initial: 'a', terminal: 'z', transitions: { go: { from: [], to: 'b' } } }), TypeError);
  assert.throws(() => defineSessionMachine({ name: 'm', initial: 'a', terminal: 'z', transitions: { go: { from: ['a'] } } }), TypeError);
  // No transition may originate in the terminal state — nothing revives it.
  assert.throws(
    () => defineSessionMachine({
      name: 'm', initial: 'a', terminal: 'z',
      transitions: { revive: { from: ['z'], to: 'a' }, start: { from: ['a'], to: '@self' } },
    }),
    TypeError,
  );
  // The initial state must be a source of at least one transition.
  assert.throws(
    () => defineSessionMachine({
      name: 'm', initial: 'orphan', terminal: 'z',
      transitions: { go: { from: ['a'], to: 'z' } },
    }),
    TypeError,
  );
});

test('assertTransition refuses unknown transitions, terminal sessions, and illegal sources', () => {
  const machine = reviewMachine();
  const session = { sessionId: 's1', status: 'in_progress' };

  assert.throws(
    () => machine.assertTransition('nope', session),
    (error) => error instanceof SessionStateMachineError && error.code === 'UNKNOWN_TRANSITION',
  );

  assert.throws(
    () => machine.assertTransition('recordExecution', { sessionId: 's2', status: 'finalized' }),
    (error) => error instanceof SessionStateMachineError && error.code === 'SESSION_TERMINAL'
      && error.details.terminal === 'finalized' && error.details.sessionId === 's2',
  );

  assert.throws(
    () => machine.assertTransition('finalize', session),
    (error) => error instanceof SessionStateMachineError && error.code === 'INVALID_TRANSITION_SOURCE'
      && error.details.from === 'in_progress'
      && assert.deepEqual(error.details.expected, ['acceptance_pending']) === undefined,
  );

  // Legal from both named sources.
  assert.equal(machine.assertTransition('rollBack', { status: 'in_progress' }).to, 'in_progress');
  assert.equal(machine.assertTransition('rollBack', { status: 'acceptance_pending' }).to, 'in_progress');
});

test('apply returns a frozen successor with the transition status, patch, and updatedAt stamp', () => {
  const machine = reviewMachine();
  const session = Object.freeze({
    schemaVersion: 1,
    sessionId: 's1',
    status: 'in_progress',
    accepted: [],
    nested: { deep: { value: 1 } },
  });

  const built = machine.apply('buildAcceptance', session, { acceptanceManifestDigest: 'sha256:x' }, { timestamp: '2026-09-27T00:00:00.000Z' });
  assert.equal(built.status, 'acceptance_pending');
  assert.equal(built.updatedAt, '2026-09-27T00:00:00.000Z');
  assert.equal(built.acceptanceManifestDigest, 'sha256:x');
  assert.equal(Object.isFrozen(built), true);
  // The predecessor is untouched, the successor does not share its state.
  assert.equal(session.status, 'in_progress');
  assert.notEqual(built.nested, session.nested);
  built.nested.deep.value = 999;
  assert.equal(session.nested.deep.value, 1);

  // '@self' transitions append evidence without changing the status.
  const executing = machine.apply('recordExecution', built, { journalDigest: 'sha256:j' }, { timestamp: '2026-09-27T00:01:00.000Z' });
  assert.equal(executing.status, 'acceptance_pending');
  assert.equal(executing.journalDigest, 'sha256:j');

  // Timestamps default to now and parse as ISO.
  const stamped = machine.apply('finalize', executing, {});
  assert.equal(stamped.status, 'finalized');
  assert.equal(Number.isNaN(Date.parse(stamped.updatedAt)), false);

  // The machine is the only way in: a terminal session refuses every apply.
  assert.throws(
    () => machine.apply('rollBack', stamped, {}),
    (error) => error instanceof SessionStateMachineError && error.code === 'SESSION_TERMINAL',
  );
});

test('apply keeps caller-owned patch values as-is and stamps machine fields last', () => {
  const machine = reviewMachine();
  const session = { sessionId: 's1', status: 'in_progress' };
  // A patch that names status or updatedAt must not win over the machine.
  const successor = machine.apply('buildAcceptance', session, { status: 'finalized', updatedAt: 'forged' }, { timestamp: '2026-09-27T00:00:00.000Z' });
  assert.equal(successor.status, 'acceptance_pending');
  assert.equal(successor.updatedAt, '2026-09-27T00:00:00.000Z');
});

test('isTerminal and the frozen machine surface', () => {
  const machine = reviewMachine();
  assert.equal(machine.isTerminal('finalized'), true);
  assert.equal(machine.isTerminal('in_progress'), false);
  assert.equal(machine.initial, 'in_progress');
  assert.equal(machine.terminal, 'finalized');
  assert.deepEqual(Object.keys(machine.transitions), ['recordExecution', 'buildAcceptance', 'rollBack', 'finalize']);
  assert.throws(() => { machine.terminal = 'other'; }, TypeError);
});
