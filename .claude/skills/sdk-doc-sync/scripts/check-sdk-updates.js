#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Config ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
const SCAN_STATE_PATH = path.join(__dirname, '..', 'scan-state.json');
const FEISHU_USER_ID = 'ou_da1b3f9cc2a392ece79c4dd967f0ec47';

const SDKS = [
  { key: 'python', repo: 'repos/pymilvus',        tagFilter: /^v\d+\.\d+\.\d+$/ },
  { key: 'java',   repo: 'repos/milvus-sdk-java', tagFilter: /^v\d+\.\d+\.\d+$/ },
  { key: 'node',   repo: 'repos/milvus-sdk-node',  tagFilter: /^v\d+\.\d+\.\d+$/ },
  { key: 'cpp',    repo: 'repos/milvus-sdk-cpp',   tagFilter: /^v\d+\.\d+\.\d+$/ },
  { key: 'go',     repo: 'repos/milvus-sdk-go',    tagFilter: /^client\/v\d+\.\d+\.\d+$/ },
  { key: 'rest',   repo: 'repos/milvus',            tagFilter: /^v\d+\.\d+\.\d+$/ },
];

const DRY_RUN = process.argv.includes('--dry-run');

// ── Helpers ─────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` }, stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
  } catch (e) {
    return null;
  }
}

function getLatestTag(repoPath, tagFilter) {
  const tags = run(`git -C "${repoPath}" tag --sort=-v:refname`);
  if (!tags) return null;
  for (const tag of tags.split('\n')) {
    if (tagFilter.test(tag.trim())) return tag.trim();
  }
  return null;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const scanState = JSON.parse(fs.readFileSync(SCAN_STATE_PATH, 'utf-8'));
  const updates = [];

  for (const sdk of SDKS) {
    const repoPath = path.join(PROJECT_ROOT, sdk.repo);

    // Verify repo exists
    if (!fs.existsSync(repoPath)) {
      console.log(`[WARN] ${sdk.key}: repo not found at ${sdk.repo}`);
      continue;
    }

    // Fetch latest tags
    if (!DRY_RUN) {
      run(`git -C "${repoPath}" fetch --tags --quiet`);
    }

    const latestTag = getLatestTag(repoPath, sdk.tagFilter);
    const lastScanned = scanState[sdk.key]?.lastScannedTag;

    if (!latestTag) {
      console.log(`[WARN] ${sdk.key}: no matching tags found`);
      continue;
    }

    if (!lastScanned) {
      console.log(`[INFO] ${sdk.key}: no previous scan — latest is ${latestTag}`);
      updates.push({ key: sdk.key, from: '(none)', to: latestTag });
      continue;
    }

    if (latestTag !== lastScanned) {
      console.log(`[NEW]  ${sdk.key}: ${lastScanned} → ${latestTag}`);
      updates.push({ key: sdk.key, from: lastScanned, to: latestTag });
    } else {
      console.log(`[OK]   ${sdk.key}: ${lastScanned} (up to date)`);
    }
  }

  // Summary
  console.log('');
  if (updates.length === 0) {
    console.log('All SDKs up to date. No notification sent.');
    process.exit(0);
  }

  console.log(`${updates.length} SDK update(s) detected:`);
  for (const u of updates) {
    console.log(`  - ${u.key}: ${u.from} → ${u.to}`);
  }

  // Build Feishu message
  const today = new Date().toISOString().slice(0, 10);
  const lines = updates.map(u => `- **${u.key}**: ${u.from} → **${u.to}**`).join('\n');
  const markdown = `**SDK Version Update${updates.length > 1 ? 's' : ''}** (${today})\n\n${lines}\n\nRun \`/scan\` in Claude to sync docs.`;

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would send Feishu message:');
    console.log(markdown);
    process.exit(0);
  }

  // Send Feishu notification
  const result = run(
    `lark-cli im +messages-send --user-id "${FEISHU_USER_ID}" --as bot --markdown ${JSON.stringify(markdown)}`
  );

  if (result !== null) {
    console.log('\nFeishu notification sent.');
  } else {
    console.log('\n[ERROR] Failed to send Feishu notification.');
    process.exit(2);
  }

  process.exit(1); // exit 1 = updates found
}

main();
