'use strict';

// Deterministic fault-injection harness for crash/retry evidence (6.7).
// Tests arm a fault at one of the five canonical seams and wrap the
// adapter/writer boundary; production code never calls checkpoint() — the
// injected adapters call it so the thrown point names the seam that crashed.
//
// Seams (per checklist 6.7):
//   before_mutation   — the adapter is called but has not mutated yet.
//   after_mutation    — the mutation landed but its observed evidence did not.
//   during_refetch    — the post-mutation verification read fails.
//   before_completion — every action observed; the sentinel is not written.
//   after_completion  — durable evidence complete; the session save did not
//                       happen (recovery must converge with zero re-mutation).

class InjectedFailure extends Error {
  constructor(point, actionId) {
    super(`INJECTED_FAILURE: ${point}${actionId ? `:${actionId}` : ''}`);
    this.name = 'InjectedFailure';
    this.code = 'INJECTED_FAILURE';
    this.point = point;
    this.actionId = actionId;
  }
}

function createFaultInjector({ failAt, times = 1 } = {}) {
  let remaining = times;
  const hits = [];
  return {
    async checkpoint(point, actionId = null) {
      hits.push({ point, actionId });
      if (point === failAt && remaining > 0) {
        remaining -= 1;
        throw new InjectedFailure(point, actionId);
      }
    },
    hits,
  };
}

module.exports = { InjectedFailure, createFaultInjector, FAULT_POINTS: [
  'before_mutation',
  'after_mutation',
  'during_refetch',
  'before_completion',
  'after_completion',
] };
