const test = require('node:test');
const assert = require('node:assert/strict');
const { runAgentIfEnabled } = require('../src/agent-runner');

test('runAgentIfEnabled returns skipped result when runtime is disabled', () => {
  const result = runAgentIfEnabled({ agentRuntime: { enabled: false } }, 'review this');
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'agent runtime disabled');
});
