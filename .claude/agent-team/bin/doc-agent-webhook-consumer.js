#!/usr/bin/env node

require('dotenv').config();

const { loadConfig } = require('../src/config');
const { createFeishuWebhookServer } = require('../src/feishu-event-callback');

const config = loadConfig();
const githubToken = process.env.GITHUB_TOKEN || '';
const port = Number(process.env.DOC_AGENT_WEBHOOK_PORT || config.approvalConsumer.webhookPort || 8787);
const path = process.env.DOC_AGENT_WEBHOOK_PATH || config.approvalConsumer.webhookPath || '/feishu/events';

if (!githubToken) {
  console.error('[doc-agent] GITHUB_TOKEN is not set; local help replies will work, workflow dispatch will fail');
}

const server = createFeishuWebhookServer({ config, githubToken, path });

server.listen(port, () => {
  console.error(`[doc-agent] Feishu webhook consumer listening on http://0.0.0.0:${port}${path}`);
  console.error('[doc-agent] Configure the Feishu event subscription request URL to this public endpoint');
});
