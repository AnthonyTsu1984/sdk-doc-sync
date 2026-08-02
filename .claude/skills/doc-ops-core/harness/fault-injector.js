'use strict';

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
  return {
    async checkpoint(point, actionId = null) {
      if (point === failAt && remaining > 0) {
        remaining -= 1;
        throw new InjectedFailure(point, actionId);
      }
    },
  };
}

module.exports = { InjectedFailure, createFaultInjector };
