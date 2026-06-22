async function dispatchGithub({ config, token, decision }) {
  if (!token) throw new Error('GITHUB_TOKEN is required for repository_dispatch');
  const prefix = config.github.dispatchEventPrefix || 'doc-agent';
  const response = await fetch(`https://api.github.com/repos/${config.github.owner}/${config.github.repo}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'feishu-doc-agent-approval-consumer',
    },
    body: JSON.stringify({
      event_type: `${prefix}-${decision.action}`,
      client_payload: decision,
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub dispatch failed: ${response.status} ${await response.text()}`);
  }
}

module.exports = {
  dispatchGithub,
};
