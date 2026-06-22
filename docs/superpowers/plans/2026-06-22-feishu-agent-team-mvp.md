# Feishu Agent Team MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MVP Feishu-controlled documentation agent loop: daily localization scan, Feishu policy card, approval gateway callback, dry-run task generation, reviewed live Feishu write, and final verification.

**Architecture:** GitHub Actions runs deterministic Node.js scripts for state, Feishu metadata, cards, artifacts, and live writes. A Cloudflare Worker receives Feishu interactive card callbacks and triggers GitHub `repository_dispatch`. Agent work is represented by owner/reviewer prompt artifacts in MVP, with Codex CLI execution added behind one script boundary so it can be enabled without changing workflow contracts.

**Tech Stack:** Node.js CommonJS, existing Feishu SDK sync utilities, GitHub Actions, Cloudflare Worker, Feishu/Lark bot APIs, `node --test`.

---

## Scope Boundary

Implement only the finalized MVP:

- One Feishu source/target localization table pair.
- One daily scan report card.
- One dry-run path after policy selection.
- One live-write approval card after dry-run review passes.
- Approved live Feishu writes for `NEW`, `UPDATE`, and `META_ONLY`.
- `ORPHAN` remains report-only.
- No SDK owner automation, guide live patching, PR creation, automatic writes, multi-chat routing, or source repo checkout.

## File Structure

Create:

- `.claude/agent-team/config.example.json` — documented non-secret configuration template.
- `.claude/agent-team/src/config.js` — environment/config loader and validator.
- `.claude/agent-team/src/contracts.js` — task/action/status constants and validation helpers.
- `.claude/agent-team/src/localization-diff.js` — MVP source/target bitable diff wrapper.
- `.claude/agent-team/src/state-store.js` — JSON state read/write and baseline handling.
- `.claude/agent-team/src/report-renderer.js` — human-readable summaries for Feishu cards and artifacts.
- `.claude/agent-team/src/feishu-im.js` — Feishu bot message/card sender.
- `.claude/agent-team/src/cards.js` — interactive card JSON builders.
- `.claude/agent-team/src/task-store.js` — task JSON creation, lookup, and artifact persistence.
- `.claude/agent-team/src/github-dispatch.js` — repository dispatch helper used by gateway tests and local tooling.
- `.claude/agent-team/src/agent-runner.js` — Codex CLI invocation boundary, disabled by default for MVP tests.
- `.claude/agent-team/bin/doc-agent-scan.js` — scheduled/manual scan entrypoint.
- `.claude/agent-team/bin/doc-agent-dry-run.js` — policy-to-task dry-run entrypoint.
- `.claude/agent-team/bin/doc-agent-live-write.js` — approved Feishu write entrypoint.
- `.claude/agent-team/bin/doc-agent-verify.js` — post-write verification entrypoint.
- `.claude/agent-team/approval-gateway/worker.js` — Cloudflare Worker callback receiver.
- `.claude/agent-team/approval-gateway/wrangler.toml.example` — deployment template.
- `.claude/agent-team/tests/config.test.js` — config validation tests.
- `.claude/agent-team/tests/localization-diff.test.js` — diff classification tests.
- `.claude/agent-team/tests/cards.test.js` — card payload tests.
- `.claude/agent-team/tests/state-store.test.js` — baseline/state tests.
- `.claude/agent-team/tests/gateway.test.js` — callback verification/dispatch tests.
- `.github/workflows/doc-agent-scan.yml` — daily scan workflow.
- `.github/workflows/doc-agent-dry-run.yml` — repository-dispatch dry-run workflow.
- `.github/workflows/doc-agent-live-write.yml` — repository-dispatch live-write workflow.
- `docs/superpowers/runbooks/feishu-agent-team-mvp.md` — setup, secrets, and operating runbook.

Modify:

- `package.json` — add `test:agent-team` and focused CLI scripts.
- `.gitignore` — ignore generated local agent-team state and artifacts if not already covered.

Reuse:

- `.claude/skills/sdk-doc-sync/src/feishu-doc-translator/bitable-reader.js`
- `.claude/skills/sdk-doc-sync/src/feishu-doc-translator/translation-diff.js`
- `.claude/skills/sdk-doc-sync/src/feishu-doc-translator/index.js`
- `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/bitable-writer.js`
- `.claude/skills/sdk-doc-sync/src/feishu-to-markdown.js`
- `.claude/skills/sdk-doc-sync/src/markdown-to-feishu.js`

Critical implementation notes:

- Cross-workflow task artifacts must be downloaded by `sourceRunId`. The scan card and gateway payload must include `sourceRunId`, and dry-run/live-write workflows must download the prior run artifact before reading task files.
- The existing `FeishuDocTranslator` must be patched to pass source and target table ids into `BitableReader`, `BitableWriter`, `FeishuToMarkdown`, and `MarkdownToFeishu` where those constructors support or need table-aware behavior.
- `META_ONLY` actions are not document translation actions. The live-write command must apply them through `BitableWriter.updateRecord()` instead of passing them to `FeishuDocTranslator`.

---

### Task 1: Config, Contracts, And Test Harness

**Files:**
- Create: `.claude/agent-team/config.example.json`
- Create: `.claude/agent-team/src/contracts.js`
- Create: `.claude/agent-team/src/config.js`
- Create: `.claude/agent-team/tests/config.test.js`
- Modify: `package.json`

- [ ] **Step 1: Create the config template**

Create `.claude/agent-team/config.example.json`:

```json
{
  "mvp": {
    "enabled": true,
    "timezone": "Asia/Shanghai",
    "artifactRetentionDays": 14
  },
  "feishu": {
    "host": "https://open.feishu.cn",
    "chatId": "oc_REPLACE_WITH_DOC_AGENT_TEAM_CHAT_ID",
    "approverIds": ["ou_REPLACE_WITH_APPROVER_OPEN_ID"],
    "appIdEnv": "APP_ID",
    "appSecretEnv": "APP_SECRET"
  },
  "github": {
    "owner": "REPLACE_WITH_GITHUB_OWNER",
    "repo": "feishu-markdown-bridge",
    "ref": "master",
    "dispatchEventPrefix": "doc-agent"
  },
  "approvalGateway": {
    "url": "https://REPLACE_WITH_WORKER_DOMAIN/feishu/card-callback",
    "taskTtlMinutes": 1440
  },
  "localization": {
    "sourceBaseToken": "REPLACE_WITH_SOURCE_BASE_TOKEN",
    "sourceTableId": "REPLACE_WITH_SOURCE_TABLE_ID",
    "sourceRootToken": "REPLACE_WITH_SOURCE_WIKI_ROOT_TOKEN",
    "targetBaseToken": "REPLACE_WITH_TARGET_BASE_TOKEN",
    "targetTableId": "REPLACE_WITH_TARGET_TABLE_ID",
    "targetRootToken": "REPLACE_WITH_TARGET_WIKI_ROOT_TOKEN",
    "sourceLang": "en",
    "targetLang": "zh",
    "driveType": "wiki",
    "translator": "claude",
    "allowedLiveActions": ["NEW", "UPDATE", "META_ONLY"]
  },
  "agentRuntime": {
    "enabled": false,
    "command": "codex",
    "args": ["exec", "--json"]
  }
}
```

- [ ] **Step 2: Define contracts**

Create `.claude/agent-team/src/contracts.js`:

```js
const ACTION_TYPES = Object.freeze({
  NEW: 'NEW',
  UPDATE: 'UPDATE',
  META_ONLY: 'META_ONLY',
  SKIP: 'SKIP',
  ORPHAN: 'ORPHAN',
});

const TASK_STATUS = Object.freeze({
  DETECTED: 'detected',
  DRY_RUN_STARTED: 'dry_run_started',
  DRY_RUN_READY: 'dry_run_ready',
  REVIEW_PASSED: 'review_passed',
  REVIEW_FAILED: 'review_failed',
  APPROVAL_REQUESTED: 'approval_requested',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CHANGES_REQUESTED: 'changes_requested',
  EXPIRED: 'expired',
  LIVE_WRITE_STARTED: 'live_write_started',
  VERIFICATION_STARTED: 'verification_started',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

const POLICY_ACTIONS = Object.freeze({
  IGNORE: 'ignore',
  DRY_RUN_ONLY: 'dry_run_only',
  PATCH_AFTER_APPROVAL: 'patch_after_approval',
  CUSTOM: 'custom',
});

function assertKnownActionType(type) {
  if (!Object.prototype.hasOwnProperty.call(ACTION_TYPES, type)) {
    throw new Error(`Unknown action type: ${type}`);
  }
}

function isLiveActionAllowed(type, allowed = []) {
  assertKnownActionType(type);
  return allowed.includes(type);
}

module.exports = {
  ACTION_TYPES,
  TASK_STATUS,
  POLICY_ACTIONS,
  assertKnownActionType,
  isLiveActionAllowed,
};
```

- [ ] **Step 3: Implement config loading**

Create `.claude/agent-team/src/config.js`:

```js
const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required config string: ${name}`);
  }
}

function requireArray(value, name) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Missing required config array: ${name}`);
  }
}

function validateConfig(config) {
  requireString(config.feishu?.chatId, 'feishu.chatId');
  requireArray(config.feishu?.approverIds, 'feishu.approverIds');
  requireString(config.github?.owner, 'github.owner');
  requireString(config.github?.repo, 'github.repo');
  requireString(config.github?.ref, 'github.ref');
  requireString(config.approvalGateway?.url, 'approvalGateway.url');
  requireString(config.localization?.sourceBaseToken, 'localization.sourceBaseToken');
  requireString(config.localization?.sourceTableId, 'localization.sourceTableId');
  requireString(config.localization?.sourceRootToken, 'localization.sourceRootToken');
  requireString(config.localization?.targetBaseToken, 'localization.targetBaseToken');
  requireString(config.localization?.targetTableId, 'localization.targetTableId');
  requireString(config.localization?.targetRootToken, 'localization.targetRootToken');
  requireArray(config.localization?.allowedLiveActions, 'localization.allowedLiveActions');
  return config;
}

function loadConfig(explicitPath = process.env.DOC_AGENT_CONFIG) {
  const configPath = explicitPath || path.resolve('.claude/agent-team/config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}. Copy .claude/agent-team/config.example.json and fill real values.`);
  }
  return validateConfig(readJson(configPath));
}

module.exports = {
  loadConfig,
  validateConfig,
};
```

- [ ] **Step 4: Add config tests**

Create `.claude/agent-team/tests/config.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig } = require('../src/config');

function validConfig() {
  return {
    feishu: { chatId: 'oc_chat', approverIds: ['ou_user'] },
    github: { owner: 'zilliztech', repo: 'feishu-markdown-bridge', ref: 'master' },
    approvalGateway: { url: 'https://worker.example.com/feishu/card-callback' },
    localization: {
      sourceBaseToken: 'src_base',
      sourceTableId: 'src_table',
      sourceRootToken: 'src_root',
      targetBaseToken: 'tgt_base',
      targetTableId: 'tgt_table',
      targetRootToken: 'tgt_root',
      allowedLiveActions: ['NEW', 'UPDATE', 'META_ONLY'],
    },
  };
}

test('validateConfig accepts complete MVP config', () => {
  assert.equal(validateConfig(validConfig()).github.repo, 'feishu-markdown-bridge');
});

test('validateConfig rejects missing approver allowlist', () => {
  const config = validConfig();
  config.feishu.approverIds = [];
  assert.throws(() => validateConfig(config), /feishu\.approverIds/);
});
```

- [ ] **Step 5: Add package scripts**

Modify `package.json` scripts:

```json
{
  "scripts": {
    "test": "node .claude/skills/sdk-doc-sync/tests/run-all.js",
    "test:unit": "node .claude/skills/sdk-doc-sync/tests/run-all.js --unit",
    "test:offline": "node .claude/skills/sdk-doc-sync/tests/run-all.js --offline",
    "test:integration": "node .claude/skills/sdk-doc-sync/tests/run-all.js --integration",
    "test:all": "node .claude/skills/sdk-doc-sync/tests/run-all.js --all",
    "test:list": "node .claude/skills/sdk-doc-sync/tests/run-all.js --list",
    "test:agent-team": "node --test .claude/agent-team/tests/*.test.js",
    "doc-agent:scan": "node .claude/agent-team/bin/doc-agent-scan.js",
    "doc-agent:dry-run": "node .claude/agent-team/bin/doc-agent-dry-run.js",
    "doc-agent:live-write": "node .claude/agent-team/bin/doc-agent-live-write.js",
    "doc-agent:verify": "node .claude/agent-team/bin/doc-agent-verify.js",
    "sdk-doc-sync": "node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js",
    "translate": "node .claude/skills/sdk-doc-sync/bin/feishu-doc-translator.js"
  }
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm run test:agent-team
```

Expected: PASS for `config.test.js`.

- [ ] **Step 7: Commit**

```bash
git add package.json .claude/agent-team/config.example.json .claude/agent-team/src/contracts.js .claude/agent-team/src/config.js .claude/agent-team/tests/config.test.js
git commit -m "feat: add doc agent config contracts"
```

---

### Task 2: State Store And Task Artifacts

**Files:**
- Create: `.claude/agent-team/src/state-store.js`
- Create: `.claude/agent-team/src/task-store.js`
- Create: `.claude/agent-team/tests/state-store.test.js`
- Modify: `.gitignore`

- [ ] **Step 1: Implement state store**

Create `.claude/agent-team/src/state-store.js`:

```js
const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function defaultState() {
  return {
    version: 1,
    localization: {
      lastHandled: null,
      carryover: [],
    },
    tasks: {},
  };
}

class StateStore {
  constructor(filePath = process.env.DOC_AGENT_STATE || '.claude/agent-team/state/local-state.json') {
    this.filePath = filePath;
  }

  read() {
    if (!fs.existsSync(this.filePath)) return defaultState();
    return Object.assign(defaultState(), JSON.parse(fs.readFileSync(this.filePath, 'utf8')));
  }

  write(state) {
    ensureDir(path.dirname(this.filePath));
    fs.writeFileSync(this.filePath, `${JSON.stringify(state, null, 2)}\n`);
    return state;
  }

  merge(patch) {
    const state = this.read();
    const merged = {
      ...state,
      ...patch,
      localization: {
        ...state.localization,
        ...(patch.localization || {}),
      },
      tasks: {
        ...state.tasks,
        ...(patch.tasks || {}),
      },
    };
    return this.write(merged);
  }
}

module.exports = {
  StateStore,
  defaultState,
};
```

- [ ] **Step 2: Implement task store**

Create `.claude/agent-team/src/task-store.js`:

```js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function createTaskId(prefix = 'doc-agent') {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${prefix}-${stamp}-${suffix}`;
}

class TaskStore {
  constructor(root = process.env.DOC_AGENT_ARTIFACT_DIR || 'tmp/doc-agent') {
    this.root = root;
  }

  taskDir(taskId) {
    return path.join(this.root, taskId);
  }

  writeTask(task) {
    ensureDir(this.taskDir(task.id));
    const filePath = path.join(this.taskDir(task.id), 'task.json');
    fs.writeFileSync(filePath, `${JSON.stringify(task, null, 2)}\n`);
    return filePath;
  }

  readTask(taskId) {
    return JSON.parse(fs.readFileSync(path.join(this.taskDir(taskId), 'task.json'), 'utf8'));
  }

  writeArtifact(taskId, name, data) {
    ensureDir(this.taskDir(taskId));
    const filePath = path.join(this.taskDir(taskId), name);
    const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, body.endsWith('\n') ? body : `${body}\n`);
    return filePath;
  }
}

module.exports = {
  TaskStore,
  createTaskId,
};
```

- [ ] **Step 3: Add state tests**

Create `.claude/agent-team/tests/state-store.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { StateStore } = require('../src/state-store');
const { TaskStore, createTaskId } = require('../src/task-store');

test('StateStore returns default state when file is absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-agent-state-'));
  const store = new StateStore(path.join(dir, 'state.json'));
  assert.equal(store.read().version, 1);
  assert.deepEqual(store.read().localization.carryover, []);
});

test('StateStore persists merged localization state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-agent-state-'));
  const store = new StateStore(path.join(dir, 'state.json'));
  store.merge({ localization: { lastHandled: '2026-06-22T00:00:00Z' } });
  assert.equal(store.read().localization.lastHandled, '2026-06-22T00:00:00Z');
});

test('TaskStore writes task and artifact files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-agent-task-'));
  const taskId = createTaskId('test');
  const store = new TaskStore(dir);
  store.writeTask({ id: taskId, status: 'detected' });
  store.writeArtifact(taskId, 'summary.md', '# Summary\n');
  assert.equal(store.readTask(taskId).status, 'detected');
  assert.equal(fs.existsSync(path.join(dir, taskId, 'summary.md')), true);
});
```

- [ ] **Step 4: Ignore generated local state**

Modify `.gitignore` to include:

```gitignore
.claude/agent-team/config.json
.claude/agent-team/state/*.json
tmp/doc-agent/
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test:agent-team
```

Expected: PASS for config and state tests.

- [ ] **Step 6: Commit**

```bash
git add .gitignore .claude/agent-team/src/state-store.js .claude/agent-team/src/task-store.js .claude/agent-team/tests/state-store.test.js
git commit -m "feat: add doc agent state store"
```

---

### Task 3: Localization Diff And Report Rendering

**Files:**
- Create: `.claude/agent-team/src/localization-diff.js`
- Create: `.claude/agent-team/src/report-renderer.js`
- Create: `.claude/agent-team/tests/localization-diff.test.js`

- [ ] **Step 1: Implement localization diff wrapper**

Create `.claude/agent-team/src/localization-diff.js`:

```js
const TranslationDiff = require('../../skills/sdk-doc-sync/src/feishu-doc-translator/translation-diff');
const BitableReader = require('../../skills/sdk-doc-sync/src/feishu-doc-translator/bitable-reader');

function normalizeSummary(actions) {
  return actions.reduce((summary, action) => {
    summary.total += 1;
    summary[action.type] = (summary[action.type] || 0) + 1;
    return summary;
  }, { total: 0, NEW: 0, UPDATE: 0, META_ONLY: 0, SKIP: 0, ORPHAN: 0 });
}

function classifyMetaOnly(actions) {
  return actions.map((action) => {
    if (action.type !== 'UPDATE') return action;
    const reason = action.reason || '';
    if (/deprecated since|source deprecated/i.test(reason)) {
      return { ...action, type: 'META_ONLY', reason };
    }
    return action;
  });
}

async function readLocalizationRecords(config) {
  const sourceReader = new BitableReader({
    baseToken: config.localization.sourceBaseToken,
    tableId: config.localization.sourceTableId,
  });
  const targetReader = new BitableReader({
    baseToken: config.localization.targetBaseToken,
    tableId: config.localization.targetTableId,
  });
  const [sourceRecords, targetRecords] = await Promise.all([
    sourceReader.listRecords(),
    targetReader.listRecords(),
  ]);
  return { sourceRecords, targetRecords };
}

function diffLocalizationRecords(sourceRecords, targetRecords) {
  const diff = new TranslationDiff({ strict: true });
  const actions = classifyMetaOnly(diff.diff(sourceRecords, targetRecords));
  return {
    actions,
    summary: normalizeSummary(actions),
  };
}

module.exports = {
  readLocalizationRecords,
  diffLocalizationRecords,
  normalizeSummary,
};
```

- [ ] **Step 2: Implement report renderer**

Create `.claude/agent-team/src/report-renderer.js`:

```js
function actionTitle(action) {
  return action.source?.metadata?.title || action.target?.metadata?.title || action.slug || '(untitled)';
}

function renderMarkdownReport({ task, summary, actions }) {
  const lines = [];
  lines.push(`# Doc Agent Daily Localization Report`);
  lines.push('');
  lines.push(`Task: \`${task.id}\``);
  lines.push(`Generated: ${task.createdAt}`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`- Total: ${summary.total}`);
  lines.push(`- NEW: ${summary.NEW}`);
  lines.push(`- UPDATE: ${summary.UPDATE}`);
  lines.push(`- META_ONLY: ${summary.META_ONLY}`);
  lines.push(`- SKIP: ${summary.SKIP}`);
  lines.push(`- ORPHAN: ${summary.ORPHAN}`);
  lines.push('');
  lines.push(`## Actionable Items`);
  lines.push('');

  for (const action of actions.filter(a => ['NEW', 'UPDATE', 'META_ONLY', 'ORPHAN'].includes(a.type))) {
    lines.push(`- **${action.type}** \`${action.slug || '(no-slug)'}\` — ${actionTitle(action)}`);
    lines.push(`  Reason: ${action.reason || 'No reason recorded'}`);
  }

  if (!actions.some(a => ['NEW', 'UPDATE', 'META_ONLY', 'ORPHAN'].includes(a.type))) {
    lines.push('- No actionable items.');
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderFeishuSummary({ summary }) {
  return [
    `Total: ${summary.total}`,
    `NEW: ${summary.NEW}`,
    `UPDATE: ${summary.UPDATE}`,
    `META_ONLY: ${summary.META_ONLY}`,
    `ORPHAN: ${summary.ORPHAN}`,
  ].join(' · ');
}

module.exports = {
  renderMarkdownReport,
  renderFeishuSummary,
};
```

- [ ] **Step 3: Add diff tests**

Create `.claude/agent-team/tests/localization-diff.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { diffLocalizationRecords } = require('../src/localization-diff');
const { renderMarkdownReport } = require('../src/report-renderer');

function record(slug, title, modified, extra = {}) {
  return {
    id: `${slug}-id`,
    metadata: {
      slug,
      title,
      link: `https://example.com/${slug}`,
      type: 'Doc',
      last_modified: modified,
      deprecate_since: extra.deprecate_since || '',
    },
  };
}

test('diffLocalizationRecords classifies NEW UPDATE SKIP ORPHAN', () => {
  const source = [
    record('new-doc', 'New Doc', '2026-06-22'),
    record('changed-doc', 'Changed Doc', '2026-06-22'),
    record('same-doc', 'Same Doc', '2026-06-01'),
  ];
  const target = [
    record('changed-doc', 'Changed Doc', '2026-06-01'),
    record('same-doc', 'Same Doc', '2026-06-01'),
    record('old-doc', 'Old Doc', '2026-05-01'),
  ];
  const result = diffLocalizationRecords(source, target);
  assert.equal(result.summary.NEW, 1);
  assert.equal(result.summary.UPDATE, 1);
  assert.equal(result.summary.SKIP, 1);
  assert.equal(result.summary.ORPHAN, 1);
});

test('renderMarkdownReport includes actionable items', () => {
  const source = [record('new-doc', 'New Doc', '2026-06-22')];
  const result = diffLocalizationRecords(source, []);
  const report = renderMarkdownReport({
    task: { id: 'task-1', createdAt: '2026-06-22T00:00:00Z' },
    ...result,
  });
  assert.match(report, /NEW/);
  assert.match(report, /new-doc/);
});
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm run test:agent-team
```

Expected: PASS for localization diff and renderer tests.

- [ ] **Step 5: Commit**

```bash
git add .claude/agent-team/src/localization-diff.js .claude/agent-team/src/report-renderer.js .claude/agent-team/tests/localization-diff.test.js
git commit -m "feat: add localization diff reporting"
```

---

### Task 4: Feishu Cards And Message Sender

**Files:**
- Create: `.claude/agent-team/src/cards.js`
- Create: `.claude/agent-team/src/feishu-im.js`
- Create: `.claude/agent-team/tests/cards.test.js`

- [ ] **Step 1: Implement card builders**

Create `.claude/agent-team/src/cards.js`:

```js
const { POLICY_ACTIONS } = require('./contracts');

function button(text, value, type = 'default') {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: text },
    type,
    value,
  };
}

function buildDailyReportCard({ task, summaryText, gatewayUrl }) {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: 'Doc Agent Daily Localization Report' },
      template: 'blue',
    },
    elements: [
      { tag: 'markdown', content: `**Task**: ${task.id}\n\n${summaryText}` },
      {
        tag: 'input',
        name: 'customInstruction',
        placeholder: { tag: 'plain_text', content: 'Optional custom instruction for the agent team' },
      },
      {
        tag: 'action',
        actions: [
          button('Ignore for now', { taskId: task.id, sourceRunId: task.sourceRunId, action: POLICY_ACTIONS.IGNORE }, 'default'),
          button('Create dry-run plans only', { taskId: task.id, sourceRunId: task.sourceRunId, action: POLICY_ACTIONS.DRY_RUN_ONLY }, 'default'),
          button('Create/update after approval', { taskId: task.id, sourceRunId: task.sourceRunId, action: POLICY_ACTIONS.PATCH_AFTER_APPROVAL }, 'primary'),
          button('Custom instruction', { taskId: task.id, sourceRunId: task.sourceRunId, action: POLICY_ACTIONS.CUSTOM, gatewayUrl }, 'default'),
        ],
      },
    ],
  };
}

function buildLiveWriteApprovalCard({ task, summaryText }) {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: 'Doc Agent Live Write Approval' },
      template: 'orange',
    },
    elements: [
      { tag: 'markdown', content: `**Task**: ${task.id}\n\n${summaryText}` },
      {
        tag: 'action',
        actions: [
          button('Approve', { taskId: task.id, sourceRunId: task.sourceRunId, action: 'approve_live_write' }, 'primary'),
          button('Reject', { taskId: task.id, sourceRunId: task.sourceRunId, action: 'reject' }, 'danger'),
          button('Request changes', { taskId: task.id, sourceRunId: task.sourceRunId, action: 'changes_requested' }, 'default'),
        ],
      },
    ],
  };
}

module.exports = {
  buildDailyReportCard,
  buildLiveWriteApprovalCard,
};
```

- [ ] **Step 2: Implement Feishu sender**

Create `.claude/agent-team/src/feishu-im.js`:

```js
const fetch = require('node-fetch');
const larkTokenFetcher = require('../../skills/sdk-doc-sync/lib/lark-docs/larkTokenFetcher');

class FeishuImClient {
  constructor({ host = process.env.FEISHU_HOST || 'https://open.feishu.cn' } = {}) {
    this.host = host;
    this.tokenFetcher = new larkTokenFetcher();
  }

  async sendCard({ chatId, card }) {
    const token = await this.tokenFetcher.token();
    const response = await fetch(`${this.host}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      }),
    });
    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(`Failed to send Feishu card: ${data.msg || JSON.stringify(data)}`);
    }
    return data.data;
  }
}

module.exports = {
  FeishuImClient,
};
```

- [ ] **Step 3: Add card tests**

Create `.claude/agent-team/tests/cards.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDailyReportCard, buildLiveWriteApprovalCard } = require('../src/cards');

test('daily report card contains MVP policy actions', () => {
  const card = buildDailyReportCard({
    task: { id: 'task-1' },
    summaryText: 'Total: 1 · NEW: 1',
    gatewayUrl: 'https://worker.example.com/feishu/card-callback',
  });
  const actionElement = card.elements.find(element => element.tag === 'action');
  const actions = actionElement.actions.map(action => action.value.action);
  assert.deepEqual(actions, ['ignore', 'dry_run_only', 'patch_after_approval', 'custom']);
});

test('live write card has approve reject and changes buttons', () => {
  const card = buildLiveWriteApprovalCard({
    task: { id: 'task-1' },
    summaryText: 'NEW: one doc',
  });
  const actionElement = card.elements.find(element => element.tag === 'action');
  const actions = actionElement.actions.map(action => action.value.action);
  assert.deepEqual(actions, ['approve_live_write', 'reject', 'changes_requested']);
});
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm run test:agent-team
```

Expected: PASS for card tests.

- [ ] **Step 5: Commit**

```bash
git add .claude/agent-team/src/cards.js .claude/agent-team/src/feishu-im.js .claude/agent-team/tests/cards.test.js
git commit -m "feat: add feishu approval cards"
```

---

### Task 5: Scan CLI And Daily Report Artifact

**Files:**
- Create: `.claude/agent-team/bin/doc-agent-scan.js`
- Modify: `.claude/agent-team/src/state-store.js`

- [ ] **Step 1: Implement scan CLI**

Create `.claude/agent-team/bin/doc-agent-scan.js`:

```js
#!/usr/bin/env node

const { loadConfig } = require('../src/config');
const { createTaskId, TaskStore } = require('../src/task-store');
const { StateStore } = require('../src/state-store');
const { readLocalizationRecords, diffLocalizationRecords } = require('../src/localization-diff');
const { renderMarkdownReport, renderFeishuSummary } = require('../src/report-renderer');
const { buildDailyReportCard } = require('../src/cards');
const { FeishuImClient } = require('../src/feishu-im');
const { TASK_STATUS } = require('../src/contracts');

async function main() {
  const args = new Set(process.argv.slice(2));
  const sendCard = args.has('--send-card');
  const config = loadConfig();
  const stateStore = new StateStore();
  const taskStore = new TaskStore();
  const state = stateStore.read();
  const task = {
    id: createTaskId('loc-scan'),
    type: 'localization_scan',
    status: TASK_STATUS.DETECTED,
    createdAt: new Date().toISOString(),
    sourceRunId: process.env.GITHUB_RUN_ID || null,
    baseline: state.localization.lastHandled,
  };

  const records = await readLocalizationRecords(config);
  const diff = diffLocalizationRecords(records.sourceRecords, records.targetRecords);
  const report = renderMarkdownReport({ task, ...diff });

  taskStore.writeTask({ ...task, summary: diff.summary });
  taskStore.writeArtifact(task.id, 'actions.json', diff.actions);
  taskStore.writeArtifact(task.id, 'summary.md', report);

  if (sendCard) {
    const card = buildDailyReportCard({
      task,
      summaryText: renderFeishuSummary(diff),
      gatewayUrl: config.approvalGateway.url,
    });
    const im = new FeishuImClient({ host: config.feishu.host });
    const message = await im.sendCard({ chatId: config.feishu.chatId, card });
    taskStore.writeArtifact(task.id, 'feishu-message.json', message);
  }

  console.log(JSON.stringify({ task, summary: diff.summary }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
```

- [ ] **Step 2: Make CLI executable**

Run:

```bash
chmod +x .claude/agent-team/bin/doc-agent-scan.js
```

- [ ] **Step 3: Run offline tests**

Run:

```bash
npm run test:agent-team
```

Expected: PASS. Do not run `doc-agent-scan.js --send-card` until real Feishu config exists.

- [ ] **Step 4: Commit**

```bash
git add .claude/agent-team/bin/doc-agent-scan.js
git commit -m "feat: add localization scan command"
```

---

### Task 6: Approval Gateway Worker

**Files:**
- Create: `.claude/agent-team/approval-gateway/worker.js`
- Create: `.claude/agent-team/approval-gateway/wrangler.toml.example`
- Create: `.claude/agent-team/tests/gateway.test.js`

- [ ] **Step 1: Implement worker**

Create `.claude/agent-team/approval-gateway/worker.js`:

```js
async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function verifyFeishuToken(payload, env) {
  const configured = env.FEISHU_VERIFICATION_TOKEN;
  if (!configured) return false;
  const token = payload.token || payload.header?.token || payload.event?.token || '';
  return token === configured;
}

async function dispatchGithub(env, payload) {
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'User-Agent': 'feishu-doc-agent-approval-gateway',
    },
    body: JSON.stringify({
      event_type: `${env.DISPATCH_PREFIX || 'doc-agent'}-${payload.action}`,
      client_payload: payload,
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub dispatch failed: ${response.status} ${await response.text()}`);
  }
}

async function handleCallback(request, env) {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const payload = await request.json();
  if (!verifyFeishuToken(payload, env)) return new Response('forbidden', { status: 403 });
  if (payload.challenge) {
    return Response.json({ challenge: payload.challenge });
  }

  const actionValue = payload.action?.value || payload.event?.action?.value || payload;
  const taskId = actionValue.taskId;
  const action = actionValue.action;
  const sourceRunId = actionValue.sourceRunId || null;
  const customInstruction = payload.form_value?.customInstruction || payload.event?.form_value?.customInstruction || '';
  const userId = payload.operator?.open_id || payload.event?.operator?.open_id || payload.open_id || 'unknown';

  if (!taskId || !action) {
    return Response.json({ ok: false, error: 'missing taskId or action' }, { status: 400 });
  }

  const allowed = (env.APPROVER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length > 0 && !allowed.includes(userId)) {
    return Response.json({ ok: false, error: 'approver not allowed' }, { status: 403 });
  }

  const decisionId = await sha256Hex(`${taskId}:${action}:${userId}`);
  const decision = {
    decisionId,
    taskId,
    action,
    sourceRunId,
    customInstruction,
    userId,
    decidedAt: new Date().toISOString(),
  };

  if (env.DECISIONS) {
    const existing = await env.DECISIONS.get(decisionId);
    if (existing) return Response.json({ ok: true, duplicate: true, decision });
    await env.DECISIONS.put(decisionId, JSON.stringify(decision), { expirationTtl: 60 * 60 * 24 * 14 });
  }

  await dispatchGithub(env, decision);
  return Response.json({ ok: true, decision });
}

export default {
  fetch: handleCallback,
};

export { handleCallback, sha256Hex };
```

This MVP verifies Feishu callbacks with `FEISHU_VERIFICATION_TOKEN` from the callback payload. During implementation, capture one real Feishu card callback payload in a non-live environment and adjust `verifyFeishuToken()` only if Feishu uses a different token/header shape for interactive cards.

- [ ] **Step 2: Add Wrangler template**

Create `.claude/agent-team/approval-gateway/wrangler.toml.example`:

```toml
name = "feishu-doc-agent-approval"
main = "worker.js"
compatibility_date = "2026-06-22"

[[kv_namespaces]]
binding = "DECISIONS"
id = "REPLACE_WITH_CLOUDFLARE_KV_NAMESPACE_ID"

[vars]
GITHUB_OWNER = "REPLACE_WITH_GITHUB_OWNER"
GITHUB_REPO = "feishu-markdown-bridge"
DISPATCH_PREFIX = "doc-agent"
APPROVER_IDS = "ou_REPLACE_WITH_APPROVER_OPEN_ID"
```

Secrets set with `wrangler secret put`:

```bash
wrangler secret put GITHUB_TOKEN
wrangler secret put FEISHU_VERIFICATION_TOKEN
```

- [ ] **Step 3: Add gateway tests**

Create `.claude/agent-team/tests/gateway.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

test('gateway worker source contains required exports and dispatch guard', async () => {
  const fs = require('fs');
  const source = fs.readFileSync('.claude/agent-team/approval-gateway/worker.js', 'utf8');
  assert.match(source, /export default/);
  assert.match(source, /FEISHU_VERIFICATION_TOKEN/);
  assert.match(source, /dispatchGithub/);
  assert.match(source, /APPROVER_IDS/);
});
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm run test:agent-team
```

Expected: PASS. Worker runtime integration is verified later with Cloudflare preview or deployed endpoint.

- [ ] **Step 5: Commit**

```bash
git add .claude/agent-team/approval-gateway/worker.js .claude/agent-team/approval-gateway/wrangler.toml.example .claude/agent-team/tests/gateway.test.js
git commit -m "feat: add approval gateway worker"
```

---

### Task 7: Dry-Run And Live-Write Commands

**Prerequisite:** Complete Task 7A before implementing the live-write command.

---

### Task 7A: Make Localization Translator Table-Aware

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/src/feishu-doc-translator/index.js`
- Modify: `.claude/skills/sdk-doc-sync/bin/feishu-doc-translator.js`

- [ ] **Step 1: Add constructor options**

Modify `.claude/skills/sdk-doc-sync/src/feishu-doc-translator/index.js` constructor so it stores table ids:

```js
this.sourceTableId = options.sourceTableId || null;
this.targetTableId = options.targetTableId || null;
```

Then initialize readers/writers with table ids:

```js
this.sourceReader = new BitableReader({
  baseToken: this.sourceBitable,
  tableId: this.sourceTableId,
});
this.targetReader = new BitableReader({
  baseToken: this.targetBitable,
  tableId: this.targetTableId,
});
this.targetWriter = new BitableWriter({
  baseToken: this.targetBitable,
  tableId: this.targetTableId,
});
```

- [ ] **Step 2: Parse table-id CLI flags**

Modify `.claude/skills/sdk-doc-sync/bin/feishu-doc-translator.js` `parseArgs()`:

```js
} else if (arg === '--source-table' && argv[i + 1]) {
    args.sourceTableId = argv[++i];
} else if (arg === '--target-table' && argv[i + 1]) {
    args.targetTableId = argv[++i];
```

Pass them to `FeishuDocTranslator`:

```js
sourceTableId: args.sourceTableId,
targetTableId: args.targetTableId,
```

Update usage text:

```text
  --source-table <table_id>     Source bitable table ID
  --target-table <table_id>     Target bitable table ID
```

- [ ] **Step 3: Run focused smoke command**

Run:

```bash
node .claude/skills/sdk-doc-sync/bin/feishu-doc-translator.js --help
```

Expected: help includes `--source-table` and `--target-table`.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/sdk-doc-sync/src/feishu-doc-translator/index.js .claude/skills/sdk-doc-sync/bin/feishu-doc-translator.js
git commit -m "feat: support table-specific localization translation"
```

---

### Task 7B: Dry-Run And Live-Write Commands

**Files:**
- Create: `.claude/agent-team/src/agent-runner.js`
- Create: `.claude/agent-team/bin/doc-agent-dry-run.js`
- Create: `.claude/agent-team/bin/doc-agent-live-write.js`
- Create: `.claude/agent-team/bin/doc-agent-verify.js`

- [ ] **Step 1: Implement agent runner boundary**

Create `.claude/agent-team/src/agent-runner.js`:

```js
const { spawnSync } = require('child_process');

function runAgentIfEnabled(config, prompt) {
  const runtime = config.agentRuntime || {};
  if (!runtime.enabled) {
    return {
      skipped: true,
      reason: 'agent runtime disabled',
      prompt,
    };
  }
  const command = runtime.command || 'codex';
  const args = [...(runtime.args || []), prompt];
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return {
    skipped: false,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

module.exports = {
  runAgentIfEnabled,
};
```

- [ ] **Step 2: Implement dry-run command**

Create `.claude/agent-team/bin/doc-agent-dry-run.js`:

```js
#!/usr/bin/env node

const { loadConfig } = require('../src/config');
const fs = require('fs');
const path = require('path');
const { TaskStore } = require('../src/task-store');
const { TASK_STATUS } = require('../src/contracts');
const { buildLiveWriteApprovalCard } = require('../src/cards');
const { renderFeishuSummary } = require('../src/report-renderer');
const { FeishuImClient } = require('../src/feishu-im');
const { runAgentIfEnabled } = require('../src/agent-runner');

async function main() {
  const taskId = process.env.DOC_AGENT_TASK_ID || process.argv[2];
  if (!taskId) throw new Error('Usage: doc-agent-dry-run <task-id>');
  const config = loadConfig();
  const store = new TaskStore();
  const task = store.readTask(taskId);
  const actions = JSON.parse(fs.readFileSync(path.join(store.taskDir(taskId), 'actions.json'), 'utf8'));
  const actionable = actions.filter(action => ['NEW', 'UPDATE', 'META_ONLY'].includes(action.type));
  const agentResult = runAgentIfEnabled(config, [
    'You are localization-owner.',
    `Task ${taskId}: review the localization dry-run actions and produce a concise risk summary.`,
    JSON.stringify(actionable.slice(0, 20), null, 2),
  ].join('\n\n'));

  const nextTask = {
    ...task,
    status: actionable.length > 0 ? TASK_STATUS.REVIEW_PASSED : TASK_STATUS.COMPLETED,
    dryRunCompletedAt: new Date().toISOString(),
    sourceRunId: process.env.GITHUB_RUN_ID || task.sourceRunId,
    actionableCount: actionable.length,
  };
  store.writeTask(nextTask);
  store.writeArtifact(taskId, 'owner-agent-result.json', agentResult);
  store.writeArtifact(taskId, 'live-actions.json', actionable);

  if (actionable.length > 0 && process.argv.includes('--send-card')) {
    const card = buildLiveWriteApprovalCard({
      task: nextTask,
      summaryText: renderFeishuSummary({ summary: task.summary }),
    });
    const im = new FeishuImClient({ host: config.feishu.host });
    await im.sendCard({ chatId: config.feishu.chatId, card });
  }

  console.log(JSON.stringify({ task: nextTask, actionableCount: actionable.length }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
```

- [ ] **Step 3: Implement live-write command**

Create `.claude/agent-team/bin/doc-agent-live-write.js`:

```js
#!/usr/bin/env node

const FeishuDocTranslator = require('../../skills/sdk-doc-sync/src/feishu-doc-translator');
const BitableWriter = require('../../skills/sdk-doc-sync/src/sdk-doc-sync/bitable-writer');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../src/config');
const { TaskStore } = require('../src/task-store');
const { TASK_STATUS, isLiveActionAllowed } = require('../src/contracts');

async function applyMetaOnlyActions(config, actions) {
  const writer = new BitableWriter({
    baseToken: config.localization.targetBaseToken,
    tableId: config.localization.targetTableId,
  });
  const results = [];
  for (const action of actions) {
    if (!action.target?.id) {
      results.push({ action, status: 'skipped', reason: 'target record missing' });
      continue;
    }
    const fields = {
      deprecateSince: action.source?.metadata?.deprecate_since || undefined,
      lastModified: action.source?.metadata?.last_modified || undefined,
    };
    await writer.updateRecord(action.target.id, fields);
    results.push({ action, status: 'success' });
  }
  return results;
}

async function main() {
  const taskId = process.env.DOC_AGENT_TASK_ID || process.argv[2];
  if (!taskId) throw new Error('Usage: doc-agent-live-write <task-id>');
  const config = loadConfig();
  const store = new TaskStore();
  const task = store.readTask(taskId);
  const approved = JSON.parse(fs.readFileSync(path.join(store.taskDir(taskId), 'live-actions.json'), 'utf8'));
  const allowed = config.localization.allowedLiveActions;
  const unsafe = approved.filter(action => !isLiveActionAllowed(action.type, allowed));
  if (unsafe.length) {
    throw new Error(`Refusing live write for disallowed action types: ${unsafe.map(a => a.type).join(', ')}`);
  }

  store.writeTask({ ...task, status: TASK_STATUS.LIVE_WRITE_STARTED, liveWriteStartedAt: new Date().toISOString() });

  const translator = new FeishuDocTranslator({
    sourceBitable: config.localization.sourceBaseToken,
    targetBitable: config.localization.targetBaseToken,
    sourceTableId: config.localization.sourceTableId,
    targetTableId: config.localization.targetTableId,
    sourceRoot: config.localization.sourceRootToken,
    targetRoot: config.localization.targetRootToken,
    sourceLang: config.localization.sourceLang,
    targetLang: config.localization.targetLang,
    driveType: config.localization.driveType,
    translatorType: config.localization.translator,
    dryRun: false,
    approvalCallback: async (actions) => {
      const approvedSlugs = new Set(approved.map(action => `${action.type}:${action.slug}`));
      return actions.filter(action => approvedSlugs.has(`${action.type}:${action.slug}`));
    },
  });

  const translationActions = approved.filter(action => ['NEW', 'UPDATE'].includes(action.type));
  const metaOnlyActions = approved.filter(action => action.type === 'META_ONLY');
  const result = translationActions.length > 0
    ? await translator.run()
    : { actions: [], summary: { total: 0 }, results: [] };
  const metaOnlyResults = await applyMetaOnlyActions(config, metaOnlyActions);
  store.writeArtifact(taskId, 'meta-only-result.json', metaOnlyResults);
  store.writeArtifact(taskId, 'live-write-result.json', result);
  store.writeTask({ ...task, status: TASK_STATUS.VERIFICATION_STARTED, liveWriteCompletedAt: new Date().toISOString() });
  console.log(JSON.stringify({ taskId, resultSummary: result.summary }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
```

- [ ] **Step 4: Implement verification command**

Create `.claude/agent-team/bin/doc-agent-verify.js`:

```js
#!/usr/bin/env node

const { loadConfig } = require('../src/config');
const { TaskStore } = require('../src/task-store');
const { TASK_STATUS } = require('../src/contracts');
const { readLocalizationRecords, diffLocalizationRecords } = require('../src/localization-diff');

async function main() {
  const taskId = process.env.DOC_AGENT_TASK_ID || process.argv[2];
  if (!taskId) throw new Error('Usage: doc-agent-verify <task-id>');
  const config = loadConfig();
  const store = new TaskStore();
  const task = store.readTask(taskId);
  const records = await readLocalizationRecords(config);
  const diff = diffLocalizationRecords(records.sourceRecords, records.targetRecords);
  const failed = diff.actions.filter(action => ['NEW', 'UPDATE', 'META_ONLY'].includes(action.type));
  const status = failed.length === 0 ? TASK_STATUS.COMPLETED : TASK_STATUS.FAILED;
  store.writeArtifact(taskId, 'verification.json', { summary: diff.summary, remaining: failed });
  store.writeTask({ ...task, status, verifiedAt: new Date().toISOString() });
  console.log(JSON.stringify({ taskId, status, remaining: failed.length }, null, 2));
  if (failed.length > 0) process.exit(2);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
```

- [ ] **Step 5: Make CLIs executable**

Run:

```bash
chmod +x .claude/agent-team/bin/doc-agent-dry-run.js .claude/agent-team/bin/doc-agent-live-write.js .claude/agent-team/bin/doc-agent-verify.js
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm run test:agent-team
```

Expected: PASS. Live write is not run without real Feishu config and approval.

- [ ] **Step 7: Commit**

```bash
git add .claude/agent-team/src/agent-runner.js .claude/agent-team/bin/doc-agent-dry-run.js .claude/agent-team/bin/doc-agent-live-write.js .claude/agent-team/bin/doc-agent-verify.js
git commit -m "feat: add doc agent execution commands"
```

---

### Task 8: GitHub Actions Workflows

**Files:**
- Create: `.github/workflows/doc-agent-scan.yml`
- Create: `.github/workflows/doc-agent-dry-run.yml`
- Create: `.github/workflows/doc-agent-live-write.yml`

- [ ] **Step 1: Add scan workflow**

Create `.github/workflows/doc-agent-scan.yml`:

```yaml
name: Doc Agent Scan

on:
  schedule:
    - cron: "0 1 * * *"
  workflow_dispatch: {}

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
      - run: npm ci
      - run: npm run test:agent-team
      - name: Write config
        run: |
          mkdir -p .claude/agent-team
          printf '%s' "$DOC_AGENT_CONFIG_JSON" > .claude/agent-team/config.json
        env:
          DOC_AGENT_CONFIG_JSON: ${{ secrets.DOC_AGENT_CONFIG_JSON }}
      - name: Run scan
        run: npm run doc-agent:scan -- --send-card
        env:
          APP_ID: ${{ secrets.FEISHU_APP_ID }}
          APP_SECRET: ${{ secrets.FEISHU_APP_SECRET }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: doc-agent-scan-artifacts
          path: tmp/doc-agent/**
```

- [ ] **Step 2: Add dry-run workflow**

Create `.github/workflows/doc-agent-dry-run.yml`:

```yaml
name: Doc Agent Dry Run

on:
  repository_dispatch:
    types:
      - doc-agent-dry_run_only
      - doc-agent-patch_after_approval
      - doc-agent-custom

jobs:
  dry-run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
      - run: npm ci
      - run: npm run test:agent-team
      - name: Write config
        run: |
          mkdir -p .claude/agent-team
          printf '%s' "$DOC_AGENT_CONFIG_JSON" > .claude/agent-team/config.json
        env:
          DOC_AGENT_CONFIG_JSON: ${{ secrets.DOC_AGENT_CONFIG_JSON }}
      - name: Download scan artifacts
        uses: actions/download-artifact@v4
        with:
          name: doc-agent-scan-artifacts
          path: tmp/doc-agent
          run-id: ${{ github.event.client_payload.sourceRunId }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
      - name: Run dry-run
        run: npm run doc-agent:dry-run -- "${{ github.event.client_payload.taskId }}" --send-card
        env:
          APP_ID: ${{ secrets.FEISHU_APP_ID }}
          APP_SECRET: ${{ secrets.FEISHU_APP_SECRET }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: doc-agent-dry-run-artifacts
          path: tmp/doc-agent/**
```

- [ ] **Step 3: Add live-write workflow**

Create `.github/workflows/doc-agent-live-write.yml`:

```yaml
name: Doc Agent Live Write

on:
  repository_dispatch:
    types:
      - doc-agent-approve_live_write

jobs:
  live-write:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
      - run: npm ci
      - run: npm run test:agent-team
      - name: Write config
        run: |
          mkdir -p .claude/agent-team
          printf '%s' "$DOC_AGENT_CONFIG_JSON" > .claude/agent-team/config.json
        env:
          DOC_AGENT_CONFIG_JSON: ${{ secrets.DOC_AGENT_CONFIG_JSON }}
      - name: Download dry-run artifacts
        uses: actions/download-artifact@v4
        with:
          name: doc-agent-dry-run-artifacts
          path: tmp/doc-agent
          run-id: ${{ github.event.client_payload.sourceRunId }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
      - name: Run live write
        run: npm run doc-agent:live-write -- "${{ github.event.client_payload.taskId }}"
        env:
          APP_ID: ${{ secrets.FEISHU_APP_ID }}
          APP_SECRET: ${{ secrets.FEISHU_APP_SECRET }}
          WIKI_SPACE_ID: ${{ secrets.FEISHU_WIKI_SPACE_ID }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      - name: Verify
        run: npm run doc-agent:verify -- "${{ github.event.client_payload.taskId }}"
        env:
          APP_ID: ${{ secrets.FEISHU_APP_ID }}
          APP_SECRET: ${{ secrets.FEISHU_APP_SECRET }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: doc-agent-live-write-artifacts
          path: tmp/doc-agent/**
```

- [ ] **Step 4: Validate YAML and run tests**

Run:

```bash
npm run test:agent-team
```

Expected: PASS. If `ruby` is available, also run:

```bash
ruby -e 'require "yaml"; ARGV.each { |f| YAML.load_file(f) }; puts "yaml ok"' .github/workflows/doc-agent-scan.yml .github/workflows/doc-agent-dry-run.yml .github/workflows/doc-agent-live-write.yml
```

Expected: `yaml ok`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/doc-agent-scan.yml .github/workflows/doc-agent-dry-run.yml .github/workflows/doc-agent-live-write.yml
git commit -m "ci: add doc agent workflows"
```

---

### Task 9: Runbook And Final Verification

**Files:**
- Create: `docs/superpowers/runbooks/feishu-agent-team-mvp.md`

- [ ] **Step 1: Add runbook**

Create `docs/superpowers/runbooks/feishu-agent-team-mvp.md`:

```md
# Feishu Agent Team MVP Runbook

## Required Secrets

GitHub Actions secrets:

- `DOC_AGENT_CONFIG_JSON`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_WIKI_SPACE_ID`
- `ANTHROPIC_API_KEY` when translator is `claude`

Cloudflare Worker secrets:

- `GITHUB_TOKEN`
- `APPROVAL_GATEWAY_SHARED_SECRET`

## Setup

1. Copy `.claude/agent-team/config.example.json`.
2. Fill real Feishu chat, approver, source table, target table, root, GitHub, and approval gateway values.
3. Store the filled JSON as GitHub secret `DOC_AGENT_CONFIG_JSON`.
4. Deploy `.claude/agent-team/approval-gateway/worker.js` with the Cloudflare config from `wrangler.toml.example`.
5. Configure Feishu card callback URL to the Cloudflare Worker endpoint.
6. Run `Doc Agent Scan` manually from GitHub Actions.

## Expected MVP Flow

1. `Doc Agent Scan` posts a Feishu daily report card.
2. Approver chooses `Create dry-run plans only` or `Create/update after approval`.
3. Worker receives the card callback and dispatches the dry-run workflow.
4. Dry-run workflow uploads artifacts and sends a concrete live-write approval card when there are actionable records.
5. Approver clicks `Approve`.
6. Worker dispatches live-write workflow.
7. Live-write workflow updates approved Feishu docs/records and verifies the result.

## Safety Rules

- Do not use live-write workflow without a reviewed dry-run artifact.
- Do not approve `ORPHAN` deletion; MVP never deletes or archives target docs.
- Duplicate card clicks must not cause duplicate writes.
- If verification fails, preserve artifacts and do not advance the handled baseline.
```

- [ ] **Step 2: Run final verification**

Run:

```bash
npm run test:agent-team
git status --short
```

Expected:

- `npm run test:agent-team` passes.
- `git status --short` shows only intentional files before commit.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/runbooks/feishu-agent-team-mvp.md
git commit -m "docs: add doc agent mvp runbook"
```

---

## Plan Self-Review

Spec coverage:

- Feishu cards as interaction media: Task 4, Task 5, Task 7, Task 8.
- Always-on approval gateway: Task 6.
- GitHub Actions scheduler/executor: Task 8.
- Domain-owner model: Task 7 adds the owner-agent boundary without implementing all owners.
- Metadata-first localization MVP: Task 3 and Task 5.
- Live writes only after review and approval: Task 7 and Task 8.
- Guide-doc scan: deferred because the finalized spec marks it Phase 2 report-only after MVP.

Residual verification notes:

- Feishu interactive card callback payload shape must be verified against one real non-live callback before enabling live writes. The Worker is structured to isolate that parsing change.
- The current root `npm test` points at a missing SDK sync test directory. Use `npm run test:agent-team` for this MVP until the broader test script is repaired.
