'use strict';

async function reconcileActions({ actions = [], journalEntries = [], observe = async () => ({ state: 'unknown' }) }) {
  const entriesByAction = new Map();
  for (const entry of journalEntries) {
    if (!entry?.actionId) continue;
    if (!entriesByAction.has(entry.actionId)) entriesByAction.set(entry.actionId, []);
    entriesByAction.get(entry.actionId).push(entry);
  }
  const reconciled = [];
  for (const action of [...actions].sort((a, b) => a.actionId.localeCompare(b.actionId))) {
    const entries = entriesByAction.get(action.actionId) || [];
    const observedResult = entries.find(entry => entry.type === 'observed');
    let classification;
    if (observedResult?.status === 'success' && observedResult.verified === true) {
      classification = 'verified';
    } else if (!entries.some(entry => entry.type === 'prepared')) {
      classification = 'not_started';
    } else {
      const live = await observe(action, entries);
      classification = ['applied', 'divergent', 'unknown', 'not_started'].includes(live?.state)
        ? live.state
        : 'unknown';
    }
    reconciled.push({ actionId: action.actionId, classification });
  }
  const resumableActionIds = reconciled.filter(item => item.classification === 'not_started').map(item => item.actionId);
  const blocked = reconciled.some(item => ['divergent', 'unknown'].includes(item.classification));
  return { actions: reconciled, resumableActionIds, blocked };
}

module.exports = { reconcileActions };
