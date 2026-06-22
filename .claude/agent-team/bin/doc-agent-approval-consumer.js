#!/usr/bin/env node

const { loadConfig } = require('../src/config');
const { runEventConsumer } = require('../src/event-consumer');

const config = loadConfig();
const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) {
  console.error('GITHUB_TOKEN is required');
  process.exit(1);
}

runEventConsumer({ config, githubToken }).then(child => {
  console.error(`[doc-agent] approval consumer started pid=${child.pid}`);
}).catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
