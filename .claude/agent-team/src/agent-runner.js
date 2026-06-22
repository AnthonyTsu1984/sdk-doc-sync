const { spawnSync } = require('child_process');

function runAgentIfEnabled(config, prompt) {
  const runtime = config.agentRuntime || {};
  if (!runtime.enabled) {
    return { skipped: true, reason: 'agent runtime disabled', prompt };
  }
  const command = runtime.command || 'codex';
  const args = [...(runtime.args || []), prompt];
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Agent runtime failed: ${result.stderr || result.status}`);
  }
  return {
    skipped: false,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

module.exports = {
  runAgentIfEnabled,
};
