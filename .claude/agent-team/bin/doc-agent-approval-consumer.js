#!/usr/bin/env node

require('dotenv').config();

const { loadConfig } = require('../src/config');
const { runSdkEventConsumer } = require('../src/event-consumer');

const config = loadConfig();
const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) {
  console.error('GITHUB_TOKEN is required');
  process.exit(1);
}

runSdkEventConsumer({ config, githubToken }).then(() => {
  console.error('[doc-agent] approval consumer started with Feishu official SDK long connection');
}).catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
