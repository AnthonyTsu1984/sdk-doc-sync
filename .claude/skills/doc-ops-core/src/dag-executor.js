'use strict';

const { assertApproval } = require('./approval-guard');
const { digestSemantic } = require('./digest');

class DagError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = 'DagError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function stableTopologicalSort(actions = []) {
  const byId = new Map();
  for (const action of actions) {
    if (!action?.actionId || byId.has(action.actionId)) throw new DagError('ACTION_ID_INVALID', 'action IDs must be unique and non-empty');
    byId.set(action.actionId, action);
  }
  for (const action of actions) {
    for (const dependency of action.dependsOn || []) {
      if (!byId.has(dependency)) throw new DagError('MISSING_DEPENDENCY', `${action.actionId} depends on missing ${dependency}`);
    }
  }
  const remaining = new Map([...byId].map(([id, action]) => [id, new Set(action.dependsOn || [])]));
  const ordered = [];
  while (remaining.size > 0) {
    const ready = [...remaining.entries()].filter(([, dependencies]) => dependencies.size === 0).map(([id]) => id).sort();
    if (ready.length === 0) throw new DagError('DAG_CYCLE', 'action dependency graph contains a cycle');
    for (const id of ready) {
      ordered.push(byId.get(id));
      remaining.delete(id);
      for (const dependencies of remaining.values()) dependencies.delete(id);
    }
  }
  return ordered;
}

async function checkpoint(injector, point, actionId = null) {
  if (injector?.checkpoint) await injector.checkpoint(point, actionId);
}

async function executeDag({
  skill,
  operation,
  actions,
  batchDigest,
  approval,
  journal,
  precondition,
  mutate,
  refetch,
  verify,
  faultInjector = null,
}) {
  const ordered = stableTopologicalSort(actions);
  const targets = ordered.map(action => action.target).filter(Boolean);
  const sideEffects = ordered.flatMap(action => action.sideEffects || []);
  assertApproval(approval, { skill, operation, batchDigest, actionCount: ordered.length, targets, sideEffects });
  const results = [];
  for (const action of ordered) {
    await checkpoint(faultInjector, 'before_mutation', action.actionId);
    const livePrecondition = await precondition(action);
    journal.prepared({
      actionId: action.actionId,
      dependsOn: [...(action.dependsOn || [])].sort(),
      preconditionDigest: livePrecondition?.digest || digestSemantic(livePrecondition || {}),
      mutation: action.mutation || { sideEffects: action.sideEffects || [] },
    });
    const mutationResult = await mutate(action, livePrecondition);
    await checkpoint(faultInjector, 'after_mutation', action.actionId);
    await checkpoint(faultInjector, 'during_refetch', action.actionId);
    const observed = await refetch(action, mutationResult);
    const verification = await verify(action, { mutationResult, observed });
    journal.observed({
      actionId: action.actionId,
      status: verification?.ok === true ? 'success' : 'failure',
      verified: verification?.ok === true,
      observedDigest: digestSemantic(observed || {}),
      diagnostics: verification?.diagnostics || [],
    });
    results.push({ actionId: action.actionId, mutationResult, observed, verification });
    if (verification?.ok !== true) return { status: 'PARTIAL', results };
  }
  await checkpoint(faultInjector, 'before_completion');
  journal.complete();
  return { status: 'EXECUTED', results };
}

module.exports = { DagError, stableTopologicalSort, executeDag };
