#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

// --- Config ---
const WIKI_ROOTS = [
  { token: 'OUWXw5c4gia34ZkQUcEcMFbWn6s', label: 'Global Docs' },
  { token: 'XyeFwdx6kiK9A6kq3yIcLNdEnDd', label: 'Chinese Docs' },
  { token: 'R8ZwwvHrJivIAyk8JkQchM0Anng', label: 'Agent Docs' },
  { token: 'Tg6mwbRGDitPQ3kLUQzc44I7nth', label: 'Lakebase Docs' },
];

const DRIVE_ROOTS = [
  { token: 'ACKGfinsNlQCovdK2v1cPxiqnle', label: 'Python SDK' },
  { token: 'O4sRfb29olHnoid8hJMcxfhHnud', label: 'Java SDK' },
  { token: 'WXiqfeczjlpK0RdlN87c8hVWnag', label: 'Node.js SDK' },
  { token: 'PImWfhhIaleQUZd3qrWcsIgOncb', label: 'C++ SDK' },
  { token: 'Pzejf3x4WlXq1HdtTndcfMjVnxh', label: 'Go SDK' },
  { token: 'PPuBfnEIWltim9dw8hxcC3EDnwb', label: 'Zilliz CLI' },
];

const USER_OPEN_ID = 'ou_da1b3f9cc2a392ece79c4dd967f0ec47';
const LARK_CLI = 'lark-cli';
const DELAY_MS = 200;

// --- CLI args ---
const args = process.argv.slice(2);
let dryRun = false;
let targetDate = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') dryRun = true;
  if (args[i] === '--date' && args[i + 1]) targetDate = args[++i];
}

// --- Helpers ---
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function extractError(msg) {
  // Try to parse the lark-cli JSON error from stderr
  try {
    const json = JSON.parse(msg);
    return json?.error?.message || json?.msg || msg.slice(0, 120);
  } catch {
    // execFileSync puts stderr after the command line
    const idx = msg.indexOf('{');
    if (idx >= 0) {
      try {
        const json = JSON.parse(msg.slice(idx));
        return json?.error?.message || msg.slice(0, 120);
      } catch {}
    }
    return msg.slice(0, 120);
  }
}

function execLark(cmdArgs) {
  const out = execFileSync(LARK_CLI, cmdArgs, { encoding: 'utf8', timeout: 30000 });
  return JSON.parse(out);
}

function getDateRange(dateStr) {
  let d;
  if (dateStr === 'yesterday' || !dateStr) {
    d = new Date();
    d.setDate(d.getDate() - 1);
  } else {
    d = new Date(dateStr);
    if (isNaN(d.getTime())) {
      console.error(`Invalid date: ${dateStr}`);
      process.exit(1);
    }
  }
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  const start = Math.floor(new Date(y, m, day, 0, 0, 0).getTime() / 1000);
  const end = Math.floor(new Date(y, m, day, 23, 59, 59).getTime() / 1000);
  const label = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { start, end, label };
}

function formatTime(unixTs) {
  const d = new Date(Number(unixTs) * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// --- Wiki Scanner ---
async function scanWikiNode(spaceId, parentNodeToken, range, results, depth = 0) {
  if (depth > 10) return; // safety limit
  try {
    const params = JSON.stringify({ space_id: spaceId, parent_node_token: parentNodeToken, page_size: 50 });
    const res = execLark(['wiki', 'nodes', 'list', '--params', params, '--page-all', '--page-limit', '0', '--format', 'json']);
    const items = res?.data?.items || [];

    for (const item of items) {
      const editTime = Number(item.obj_edit_time || 0);
      if (editTime >= range.start && editTime <= range.end) {
        results.push({
          title: item.title,
          editTime,
          type: item.obj_type,
          token: item.node_token,
          spaceId: item.space_id,
        });
      }
      if (item.has_child) {
        await sleep(DELAY_MS);
        await scanWikiNode(spaceId, item.node_token, range, results, depth + 1);
      }
    }
  } catch (err) {
    console.error(`  [wiki] Error scanning ${parentNodeToken}: ${err.message}`);
  }
}

async function scanWikiRoots(range) {
  const allResults = {};
  for (const root of WIKI_ROOTS) {
    console.log(`Scanning wiki: ${root.label}...`);
    const results = [];
    try {
      // Resolve space_id from node token
      const nodeInfo = execLark(['wiki', 'spaces', 'get_node', '--params', JSON.stringify({ token: root.token }), '--format', 'json']);
      const spaceId = nodeInfo?.data?.node?.space_id;
      if (!spaceId) {
        console.error(`  Could not resolve space_id for ${root.label}`);
        allResults[root.label] = { results: [], error: 'Could not resolve space_id' };
        continue;
      }
      await sleep(DELAY_MS);
      await scanWikiNode(spaceId, root.token, range, results);
      allResults[root.label] = { results };
      console.log(`  Found ${results.length} changed items`);
    } catch (err) {
      const short = extractError(err.stderr || err.message);
      console.error(`  Error: ${short}`);
      allResults[root.label] = { results: [], error: short };
    }
  }
  return allResults;
}

// --- Drive Scanner ---
async function scanDriveFolder(folderToken, range, results, depth = 0) {
  if (depth > 10) return;
  try {
    const params = JSON.stringify({ folder_token: folderToken, page_size: 50 });
    const res = execLark(['drive', 'files', 'list', '--params', params, '--page-all', '--page-limit', '0', '--format', 'json']);
    const files = res?.data?.files || [];

    for (const file of files) {
      const modTime = Number(file.modified_time || 0);
      if (modTime >= range.start && modTime <= range.end) {
        results.push({
          name: file.name,
          editTime: modTime,
          type: file.type,
          token: file.token,
        });
      }
      if (file.type === 'folder') {
        await sleep(DELAY_MS);
        await scanDriveFolder(file.token, range, results, depth + 1);
      }
    }
  } catch (err) {
    const msg = err.stderr || err.message || String(err);
    const short = extractError(msg);
    if (short.includes('permission') || short.includes('scope')) {
      throw new Error(short);
    }
    console.error(`  [drive] Error scanning ${folderToken}: ${short}`);
  }
}

async function scanDriveRoots(range) {
  const allResults = {};
  for (const root of DRIVE_ROOTS) {
    console.log(`Scanning drive: ${root.label}...`);
    const results = [];
    try {
      await scanDriveFolder(root.token, range, results);
      allResults[root.label] = { results };
      console.log(`  Found ${results.length} changed items`);
    } catch (err) {
      const short = extractError(err.stderr || err.message);
      console.error(`  Error: ${short}`);
      allResults[root.label] = { results: [], error: short };
    }
  }
  return allResults;
}

// --- Reporter ---
function buildReport(wikiResults, driveResults, dateLabel) {
  const lines = [];
  lines.push(`Daily Doc Changes — ${dateLabel}`);
  lines.push('');

  const sections = [];

  // Wiki sections
  for (const [label, data] of Object.entries(wikiResults)) {
    if (data.error) {
      sections.push({ label, error: data.error, count: 0 });
    } else if (data.results.length > 0) {
      sections.push({
        label,
        items: data.results.map(r => `  - ${r.title} — edited ${formatTime(r.editTime)}`),
        count: data.results.length,
      });
    } else {
      sections.push({ label, count: 0 });
    }
  }

  // Drive sections
  for (const [label, data] of Object.entries(driveResults)) {
    if (data.error) {
      sections.push({ label, error: data.error, count: 0 });
    } else if (data.results.length > 0) {
      sections.push({
        label,
        items: data.results.map(r => `  - ${r.name} — edited ${formatTime(r.editTime)}`),
        count: data.results.length,
      });
    } else {
      sections.push({ label, count: 0 });
    }
  }

  // Changed sections first
  const changed = sections.filter(s => s.count > 0);
  const unchanged = sections.filter(s => s.count === 0 && !s.error);
  const errored = sections.filter(s => s.error);

  for (const s of changed) {
    lines.push(`[${s.label}] ${s.count} changed`);
    lines.push(...s.items);
    lines.push('');
  }

  if (errored.length > 0) {
    lines.push('Errors:');
    for (const s of errored) {
      lines.push(`  - ${s.label}: ${s.error}`);
    }
    lines.push('');
  }

  if (unchanged.length > 0) {
    lines.push(`No changes: ${unchanged.map(s => s.label).join(', ')}`);
  }

  if (changed.length === 0 && errored.length === 0) {
    lines.push('No changes found across all sources.');
  }

  return lines.join('\n');
}

async function sendReport(markdown) {
  const out = execFileSync(LARK_CLI, [
    'im', '+messages-send',
    '--user-id', USER_OPEN_ID,
    '--markdown', markdown,
    '--as', 'bot',
  ], { encoding: 'utf8', timeout: 30000 });
  return JSON.parse(out);
}

// --- Main ---
async function main() {
  const range = getDateRange(targetDate);
  console.log(`Scanning for changes on ${range.label} (unix ${range.start} - ${range.end})`);
  console.log(dryRun ? '[DRY RUN - will not send IM]\n' : '');

  const [wikiResults, driveResults] = await Promise.all([
    scanWikiRoots(range),
    scanDriveRoots(range),
  ]);

  const report = buildReport(wikiResults, driveResults, range.label);

  console.log('\n--- Report ---');
  console.log(report);
  console.log('--- End ---\n');

  if (dryRun) {
    console.log('Dry run — not sending IM.');
  } else {
    console.log('Sending report via Feishu IM...');
    try {
      await sendReport(report);
      console.log('Report sent.');
    } catch (err) {
      console.error(`Failed to send IM: ${err.message}`);
      process.exit(1);
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
