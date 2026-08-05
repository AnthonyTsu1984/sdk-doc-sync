'use strict';

const STATES = Object.freeze([
  'DISCOVER',
  'PLAN',
  'BLOCKED',
  'READY',
  'APPROVED',
  'EXECUTING',
  'EXECUTED',
  'PARTIAL',
  'REFETCHED',
  'VERIFIED',
  'ACCEPTANCE_REQUIRED',
  'COMPLETE',
]);

const TRANSITIONS = Object.freeze({
  DISCOVER: ['PLAN'],
  PLAN: ['BLOCKED', 'READY'],
  BLOCKED: ['PLAN'],
  READY: ['APPROVED', 'EXECUTING', 'VERIFIED'],
  APPROVED: ['EXECUTING'],
  EXECUTING: ['BLOCKED', 'EXECUTED', 'PARTIAL'],
  EXECUTED: ['REFETCHED'],
  PARTIAL: ['BLOCKED'],
  REFETCHED: ['BLOCKED', 'VERIFIED'],
  VERIFIED: ['ACCEPTANCE_REQUIRED', 'COMPLETE'],
  ACCEPTANCE_REQUIRED: ['BLOCKED', 'COMPLETE'],
  COMPLETE: [],
});

class StateTransitionError extends Error {
  constructor(from, to) {
    super(`INVALID_STATE_TRANSITION: ${from} -> ${to}`);
    this.name = 'StateTransitionError';
    this.code = 'INVALID_STATE_TRANSITION';
    this.from = from;
    this.to = to;
  }
}

function nextStates(state) {
  if (!STATES.includes(state)) throw new StateTransitionError(state, '(unknown)');
  return [...TRANSITIONS[state]];
}

function assertTransition(from, to) {
  if (!nextStates(from).includes(to)) throw new StateTransitionError(from, to);
  return true;
}

module.exports = { STATES, TRANSITIONS, StateTransitionError, nextStates, assertTransition };
