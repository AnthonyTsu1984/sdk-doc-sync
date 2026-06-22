# Feishu Agent Team MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MVP Feishu-controlled documentation agent control plane with multi-domain owner contracts, localization as the first enabled live owner, Feishu policy cards, local Feishu event approvals, dry-run task generation, reviewed live Feishu write, and final verification.

**Architecture:** GitHub Actions runs deterministic Node.js scripts for state, Feishu metadata, cards, artifacts, owner routing, and approved live writes. The control-plane schema models localization, SDK reference, REST reference, CLI reference, guide-doc, and verified-doc owners, while only the localization surface is enabled for MVP live execution. A local long-lived Node.js consumer wraps `lark-cli event consume im.message.receive_v1`, parses approval replies in the configured Feishu chat, and triggers GitHub `repository_dispatch`.

**Tech Stack:** Node.js CommonJS, existing Feishu SDK sync utilities, GitHub Actions, local `lark-cli event consume`, Feishu/Lark bot APIs, `node --test`.

---

## Scope Boundary

Implement the finalized MVP control plane, with localization as the only enabled live work type:

- One Feishu source/target localization base pair with one or more mapped source/target table id pairs.
- Disabled-but-validated configuration surfaces for SDK reference docs, REST API reference docs, CLI docs, guide docs, and verified long-form docs.
- Shared task/owner contracts for all documented domains.
- One daily scan report card.
- One dry-run path after policy selection.
- One live-write approval card after dry-run review passes.
- Approved live Feishu writes for `NEW`, `UPDATE`, and `META_ONLY`.
- `ORPHAN` remains report-only.
- No enabled SDK/REST/CLI owner automation, guide live patching, PR creation, automatic writes, multi-chat routing, or source repo checkout.

## File Structure

Create:

- `.claude/agent-team/config.example.json` — documented non-secret configuration template.
- `.claude/agent-team/src/config.js` — environment/config loader and validator.
- `.claude/agent-team/src/contracts.js` — task/action/status constants and validation helpers.
- `.claude/agent-team/src/owner-registry.js` — enabled/disabled owner surface registry and routing helpers.
- `.claude/agent-team/src/localization-diff.js` — MVP source/target bitable diff wrapper.
- `.claude/agent-team/src/state-store.js` — JSON state read/write and baseline handling.
- `.claude/agent-team/src/report-renderer.js` — human-readable summaries for Feishu cards and artifacts.
- `.claude/agent-team/src/feishu-im.js` — Feishu bot message/card sender.
- `.claude/agent-team/src/cards.js` — Feishu report/approval card JSON builders.
- `.claude/agent-team/src/task-store.js` — task JSON creation, lookup, and artifact persistence.
- `.claude/agent-team/src/github-dispatch.js` — repository dispatch helper used by the local event consumer.
- `.claude/agent-team/src/approval-commands.js` — approval reply parser and validator.
- `.claude/agent-team/src/event-consumer.js` — `lark-cli event consume` wrapper and dispatcher.
- `.claude/agent-team/src/agent-runner.js` — Codex CLI invocation boundary, disabled by default for MVP tests.
- `.claude/agent-team/bin/doc-agent-scan.js` — scheduled/manual scan entrypoint.
- `.claude/agent-team/bin/doc-agent-dry-run.js` — policy-to-task dry-run entrypoint.
- `.claude/agent-team/bin/doc-agent-live-write.js` — approved Feishu write entrypoint.
- `.claude/agent-team/bin/doc-agent-verify.js` — post-write verification entrypoint.
- `.claude/agent-team/bin/doc-agent-approval-consumer.js` — local long-lived approval listener entrypoint.
- `.claude/agent-team/supervisor/launchd.plist.example` — macOS launchd template.
- `.claude/agent-team/supervisor/systemd.service.example` — Linux systemd template.
- `.claude/agent-team/tests/config.test.js` — config validation tests.
- `.claude/agent-team/tests/owner-registry.test.js` — owner routing and disabled-surface tests.
- `.claude/agent-team/tests/localization-diff.test.js` — diff classification tests.
- `.claude/agent-team/tests/cards.test.js` — card payload tests.
- `.claude/agent-team/tests/state-store.test.js` — baseline/state tests.
- `.claude/agent-team/tests/approval-commands.test.js` — approval parser tests.
- `.claude/agent-team/tests/event-consumer.test.js` — event consumer tests.
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

- Cross-workflow task artifacts must be downloaded by `sourceRunId`. The scan card and normalized approval payload must include `sourceRunId`, and dry-run/live-write workflows must download the prior run artifact before reading task files.
- Every task artifact must include `workType` and `owner`. The MVP only enables `workType: "localization"`, but disabled SDK/REST/CLI/guide/verified surfaces must still be represented in contracts and owner routing tests.
- The existing `FeishuDocTranslator` must be patched to accept one source/target table id pair per invocation and pass those ids into `BitableReader`, `BitableWriter`, `FeishuToMarkdown`, and `MarkdownToFeishu` where those constructors support or need table-aware behavior.
- `META_ONLY` actions are not document translation actions. The live-write command must apply them through `BitableWriter.updateRecord()` instead of passing them to `FeishuDocTranslator`.

---

### Task 1: Config, Contracts, And Test Harness

**Files:**
- Create: `.claude/agent-team/config.example.json`
- Create: `.claude/agent-team/src/contracts.js`
- Create: `.claude/agent-team/src/config.js`
- Create: `.claude/agent-team/src/owner-registry.js`
- Create: `.claude/agent-team/tests/config.test.js`
- Create: `.claude/agent-team/tests/owner-registry.test.js`
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
  "approvalConsumer": {
    "enabled": true,
    "decisionLogPath": ".claude/agent-team/state/decisions.jsonl",
    "taskTtlMinutes": 1440,
    "larkCliCommand": "lark-cli",
    "eventKey": "im.message.receive_v1"
  },
  "surfaces": {
    "localization": {
      "enabled": true,
      "owner": "localization-owner",
      "sourceBaseToken": "REPLACE_WITH_SOURCE_BASE_TOKEN",
      "sourceTableIds": ["REPLACE_WITH_SOURCE_TABLE_ID"],
      "sourceRootToken": "REPLACE_WITH_SOURCE_WIKI_ROOT_TOKEN",
      "targetBaseToken": "REPLACE_WITH_TARGET_BASE_TOKEN",
      "targetTableIds": ["REPLACE_WITH_TARGET_TABLE_ID"],
      "targetRootToken": "REPLACE_WITH_TARGET_WIKI_ROOT_TOKEN",
      "sourceLang": "en",
      "targetLang": "zh",
      "driveType": "wiki",
      "translator": "claude",
      "allowedLiveActions": ["NEW", "UPDATE", "META_ONLY"]
    },
    "sdkReference": {
      "enabled": false,
      "owners": [
        {
          "id": "java-sdk-doc-owner",
          "language": "java",
          "repo": "milvus-io/milvus-sdk-java",
          "defaultBranch": "master",
          "sourcePathHints": ["src/main/java"],
          "feishuBaseToken": "OPTIONAL_TARGET_BASE_TOKEN",
          "feishuTableId": "OPTIONAL_TARGET_TABLE_ID",
          "feishuRootToken": "OPTIONAL_TARGET_WIKI_ROOT_TOKEN"
        },
        {
          "id": "python-sdk-doc-owner",
          "language": "python",
          "repo": "milvus-io/pymilvus",
          "defaultBranch": "master",
          "sourcePathHints": ["pymilvus"],
          "feishuBaseToken": "OPTIONAL_TARGET_BASE_TOKEN",
          "feishuTableId": "OPTIONAL_TARGET_TABLE_ID",
          "feishuRootToken": "OPTIONAL_TARGET_WIKI_ROOT_TOKEN"
        }
      ]
    },
    "restReference": {
      "enabled": false,
      "owners": [
        {
          "id": "rest-api-doc-owner",
          "repo": "zilliztech/cloud-v2",
          "defaultBranch": "master",
          "openApiSpecPath": "OPTIONAL_OPENAPI_SPEC_PATH",
          "sourcePathHints": ["api", "internal"],
          "feishuBaseToken": "OPTIONAL_TARGET_BASE_TOKEN",
          "feishuTableId": "OPTIONAL_TARGET_TABLE_ID",
          "feishuRootToken": "OPTIONAL_TARGET_WIKI_ROOT_TOKEN"
        }
      ]
    },
    "cliReference": {
      "enabled": false,
      "owners": [
        {
          "id": "cli-doc-owner",
          "repo": "zilliztech/zilliz-cli",
          "defaultBranch": "main",
          "sourcePathHints": ["cmd", "internal"],
          "feishuBaseToken": "OPTIONAL_TARGET_BASE_TOKEN",
          "feishuTableId": "OPTIONAL_TARGET_TABLE_ID",
          "feishuRootToken": "OPTIONAL_TARGET_WIKI_ROOT_TOKEN"
        }
      ]
    },
    "guideDocs": {
      "enabled": false,
      "owner": "guide-doc-owner",
      "docs": [
        {
          "id": "example-guide",
          "url": "https://REPLACE_WITH_FEISHU_DOC_URL",
          "expectedLanguages": ["python", "java", "go", "javascript", "bash", "shell", "cpp"]
        }
      ]
    },
    "verifiedDocs": {
      "enabled": false,
      "owner": "verified-doc-owner",
      "docs": []
    }
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
  REFERENCE_CREATE: 'REFERENCE_CREATE',
  REFERENCE_UPDATE: 'REFERENCE_UPDATE',
  GUIDE_CODE_GAP: 'GUIDE_CODE_GAP',
  VERIFIED_DRAFT: 'VERIFIED_DRAFT',
});

const WORK_TYPES = Object.freeze({
  LOCALIZATION: 'localization',
  SDK_REFERENCE: 'sdkReference',
  REST_REFERENCE: 'restReference',
  CLI_REFERENCE: 'cliReference',
  GUIDE_DOCS: 'guideDocs',
  VERIFIED_DOCS: 'verifiedDocs',
});

const OWNER_TYPES = Object.freeze({
  DOC_COORDINATOR: 'doc-coordinator',
  LOCALIZATION_OWNER: 'localization-owner',
  JAVA_SDK_DOC_OWNER: 'java-sdk-doc-owner',
  PYTHON_SDK_DOC_OWNER: 'python-sdk-doc-owner',
  GO_SDK_DOC_OWNER: 'go-sdk-doc-owner',
  NODE_SDK_DOC_OWNER: 'node-sdk-doc-owner',
  CPP_SDK_DOC_OWNER: 'cpp-sdk-doc-owner',
  REST_API_DOC_OWNER: 'rest-api-doc-owner',
  CLI_DOC_OWNER: 'cli-doc-owner',
  GUIDE_DOC_OWNER: 'guide-doc-owner',
  VERIFIED_DOC_OWNER: 'verified-doc-owner',
  REVIEW_AGENT: 'review-agent',
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
  WORK_TYPES,
  OWNER_TYPES,
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

function requireEqualLength(left, right, leftName, rightName) {
  requireArray(left, leftName);
  requireArray(right, rightName);
  if (left.length !== right.length) {
    throw new Error(`Config arrays must have equal length: ${leftName} and ${rightName}`);
  }
}

function requireBoolean(value, name) {
  if (typeof value !== 'boolean') {
    throw new Error(`Missing required config boolean: ${name}`);
  }
}

function validateOwnerList(surface, name) {
  requireBoolean(surface?.enabled, `surfaces.${name}.enabled`);
  requireArray(surface?.owners, `surfaces.${name}.owners`);
  for (const [index, owner] of surface.owners.entries()) {
    requireString(owner.id, `surfaces.${name}.owners.${index}.id`);
    requireString(owner.repo, `surfaces.${name}.owners.${index}.repo`);
    requireString(owner.defaultBranch, `surfaces.${name}.owners.${index}.defaultBranch`);
  }
}

function validateConfig(config) {
  requireString(config.feishu?.chatId, 'feishu.chatId');
  requireArray(config.feishu?.approverIds, 'feishu.approverIds');
  requireString(config.github?.owner, 'github.owner');
  requireString(config.github?.repo, 'github.repo');
  requireString(config.github?.ref, 'github.ref');
  requireString(config.approvalConsumer?.decisionLogPath, 'approvalConsumer.decisionLogPath');
  requireString(config.approvalConsumer?.larkCliCommand, 'approvalConsumer.larkCliCommand');
  requireString(config.approvalConsumer?.eventKey, 'approvalConsumer.eventKey');
  const surfaces = config.surfaces || {};
  requireBoolean(surfaces.localization?.enabled, 'surfaces.localization.enabled');
  requireString(surfaces.localization?.owner, 'surfaces.localization.owner');
  requireString(surfaces.localization?.sourceBaseToken, 'surfaces.localization.sourceBaseToken');
  requireEqualLength(
    surfaces.localization?.sourceTableIds,
    surfaces.localization?.targetTableIds,
    'surfaces.localization.sourceTableIds',
    'surfaces.localization.targetTableIds'
  );
  requireString(surfaces.localization?.sourceRootToken, 'surfaces.localization.sourceRootToken');
  requireString(surfaces.localization?.targetBaseToken, 'surfaces.localization.targetBaseToken');
  requireString(surfaces.localization?.targetRootToken, 'surfaces.localization.targetRootToken');
  requireArray(surfaces.localization?.allowedLiveActions, 'surfaces.localization.allowedLiveActions');
  validateOwnerList(surfaces.sdkReference, 'sdkReference');
  validateOwnerList(surfaces.restReference, 'restReference');
  validateOwnerList(surfaces.cliReference, 'cliReference');
  requireBoolean(surfaces.guideDocs?.enabled, 'surfaces.guideDocs.enabled');
  requireString(surfaces.guideDocs?.owner, 'surfaces.guideDocs.owner');
  requireArray(surfaces.guideDocs?.docs, 'surfaces.guideDocs.docs');
  requireBoolean(surfaces.verifiedDocs?.enabled, 'surfaces.verifiedDocs.enabled');
  requireString(surfaces.verifiedDocs?.owner, 'surfaces.verifiedDocs.owner');
  requireArray(surfaces.verifiedDocs?.docs, 'surfaces.verifiedDocs.docs');
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

- [ ] **Step 4: Implement owner registry**

Create `.claude/agent-team/src/owner-registry.js`:

```js
const { WORK_TYPES } = require('./contracts');

function localizationSurface(config) {
  return {
    workType: WORK_TYPES.LOCALIZATION,
    enabled: config.surfaces.localization.enabled,
    owner: config.surfaces.localization.owner,
    liveWriteEnabled: config.surfaces.localization.enabled,
  };
}

function ownerListSurface(config, workType) {
  const surface = config.surfaces[workType];
  return surface.owners.map(owner => ({
    workType,
    enabled: surface.enabled,
    owner: owner.id,
    repo: owner.repo,
    liveWriteEnabled: false,
  }));
}

function singletonSurface(config, workType) {
  const surface = config.surfaces[workType];
  return [{
    workType,
    enabled: surface.enabled,
    owner: surface.owner,
    liveWriteEnabled: false,
  }];
}

function listOwnerRoutes(config) {
  return [
    localizationSurface(config),
    ...ownerListSurface(config, WORK_TYPES.SDK_REFERENCE),
    ...ownerListSurface(config, WORK_TYPES.REST_REFERENCE),
    ...ownerListSurface(config, WORK_TYPES.CLI_REFERENCE),
    ...singletonSurface(config, WORK_TYPES.GUIDE_DOCS),
    ...singletonSurface(config, WORK_TYPES.VERIFIED_DOCS),
  ];
}

function enabledOwnerRoutes(config) {
  return listOwnerRoutes(config).filter(route => route.enabled);
}

function routeTask(config, task) {
  const route = listOwnerRoutes(config).find(candidate => {
    if (candidate.workType !== task.workType) return false;
    if (task.owner && candidate.owner !== task.owner) return false;
    return true;
  });
  if (!route) throw new Error(`No owner route for workType=${task.workType} owner=${task.owner || ''}`);
  if (!route.enabled) throw new Error(`Owner route is disabled: ${route.owner}`);
  return route;
}

module.exports = {
  listOwnerRoutes,
  enabledOwnerRoutes,
  routeTask,
};
```

- [ ] **Step 5: Add config tests**

Create `.claude/agent-team/tests/config.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig } = require('../src/config');

function validConfig() {
  return {
    feishu: { chatId: 'oc_chat', approverIds: ['ou_user'] },
    github: { owner: 'zilliztech', repo: 'feishu-markdown-bridge', ref: 'master' },
    approvalConsumer: {
      decisionLogPath: '.claude/agent-team/state/decisions.jsonl',
      larkCliCommand: 'lark-cli',
      eventKey: 'im.message.receive_v1',
    },
    surfaces: {
      localization: {
        enabled: true,
        owner: 'localization-owner',
        sourceBaseToken: 'src_base',
        sourceTableIds: ['src_table_a', 'src_table_b'],
        sourceRootToken: 'src_root',
        targetBaseToken: 'tgt_base',
        targetTableIds: ['tgt_table_a', 'tgt_table_b'],
        targetRootToken: 'tgt_root',
        allowedLiveActions: ['NEW', 'UPDATE', 'META_ONLY'],
      },
      sdkReference: {
        enabled: false,
        owners: [{ id: 'java-sdk-doc-owner', repo: 'milvus-io/milvus-sdk-java', defaultBranch: 'master' }],
      },
      restReference: {
        enabled: false,
        owners: [{ id: 'rest-api-doc-owner', repo: 'zilliztech/cloud-v2', defaultBranch: 'master' }],
      },
      cliReference: {
        enabled: false,
        owners: [{ id: 'cli-doc-owner', repo: 'zilliztech/zilliz-cli', defaultBranch: 'main' }],
      },
      guideDocs: { enabled: false, owner: 'guide-doc-owner', docs: [] },
      verifiedDocs: { enabled: false, owner: 'verified-doc-owner', docs: [] },
    },
  };
}

test('validateConfig accepts complete MVP config', () => {
  assert.equal(validateConfig(validConfig()).github.repo, 'feishu-markdown-bridge');
});

test('validateConfig requires disabled SDK and REST surfaces to be explicit', () => {
  const config = validConfig();
  delete config.surfaces.restReference;
  assert.throws(() => validateConfig(config), /surfaces\.restReference\.enabled/);
});

test('validateConfig rejects mismatched localization table mappings', () => {
  const config = validConfig();
  config.surfaces.localization.targetTableIds = ['tgt_table_a'];
  assert.throws(() => validateConfig(config), /sourceTableIds and surfaces\.localization\.targetTableIds/);
});

test('validateConfig rejects missing approver allowlist', () => {
  const config = validConfig();
  config.feishu.approverIds = [];
  assert.throws(() => validateConfig(config), /feishu\.approverIds/);
});
```

- [ ] **Step 6: Add owner registry tests**

Create `.claude/agent-team/tests/owner-registry.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { enabledOwnerRoutes, listOwnerRoutes, routeTask } = require('../src/owner-registry');

function config() {
  return {
    surfaces: {
      localization: { enabled: true, owner: 'localization-owner' },
      sdkReference: {
        enabled: false,
        owners: [{ id: 'java-sdk-doc-owner', repo: 'milvus-io/milvus-sdk-java' }],
      },
      restReference: {
        enabled: false,
        owners: [{ id: 'rest-api-doc-owner', repo: 'zilliztech/cloud-v2' }],
      },
      cliReference: {
        enabled: false,
        owners: [{ id: 'cli-doc-owner', repo: 'zilliztech/zilliz-cli' }],
      },
      guideDocs: { enabled: false, owner: 'guide-doc-owner' },
      verifiedDocs: { enabled: false, owner: 'verified-doc-owner' },
    },
  };
}

test('listOwnerRoutes includes localization, SDK, REST, CLI, guide, and verified domains', () => {
  const routes = listOwnerRoutes(config());
  assert.deepEqual(routes.map(route => route.owner), [
    'localization-owner',
    'java-sdk-doc-owner',
    'rest-api-doc-owner',
    'cli-doc-owner',
    'guide-doc-owner',
    'verified-doc-owner',
  ]);
});

test('enabledOwnerRoutes only enables localization in MVP config', () => {
  assert.deepEqual(enabledOwnerRoutes(config()).map(route => route.owner), ['localization-owner']);
});

test('routeTask rejects disabled SDK reference owner during MVP', () => {
  assert.throws(
    () => routeTask(config(), { workType: 'sdkReference', owner: 'java-sdk-doc-owner' }),
    /disabled/
  );
});
```

- [ ] **Step 7: Add package scripts**

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

- [ ] **Step 8: Run tests**

Run:

```bash
npm run test:agent-team
```

Expected: PASS for `config.test.js` and `owner-registry.test.js`.

- [ ] **Step 9: Commit**

```bash
git add package.json .claude/agent-team/config.example.json .claude/agent-team/src/contracts.js .claude/agent-team/src/config.js .claude/agent-team/src/owner-registry.js .claude/agent-team/tests/config.test.js .claude/agent-team/tests/owner-registry.test.js
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
    const tableScopedAction = {
      ...action,
      sourceTableId: action.sourceTableId || action.source?.sourceTableId || action.target?.sourceTableId,
      targetTableId: action.targetTableId || action.source?.targetTableId || action.target?.targetTableId,
    };
    if (tableScopedAction.type !== 'UPDATE') return tableScopedAction;
    const reason = tableScopedAction.reason || '';
    if (/deprecated since|source deprecated/i.test(reason)) {
      return { ...tableScopedAction, type: 'META_ONLY', reason };
    }
    return tableScopedAction;
  });
}

async function readLocalizationRecords(config) {
  const localization = config.surfaces.localization;
  const pairs = localization.sourceTableIds.map((sourceTableId, index) => ({
    sourceTableId,
    targetTableId: localization.targetTableIds[index],
  }));
  const tableResults = await Promise.all(pairs.map(async pair => {
    const sourceReader = new BitableReader({
      baseToken: localization.sourceBaseToken,
      tableId: pair.sourceTableId,
    });
    const targetReader = new BitableReader({
      baseToken: localization.targetBaseToken,
      tableId: pair.targetTableId,
    });
    const [sourceRecords, targetRecords] = await Promise.all([
      sourceReader.listRecords(),
      targetReader.listRecords(),
    ]);
    return {
      ...pair,
      sourceRecords: sourceRecords.map(record => ({ ...record, sourceTableId: pair.sourceTableId, targetTableId: pair.targetTableId })),
      targetRecords: targetRecords.map(record => ({ ...record, sourceTableId: pair.sourceTableId, targetTableId: pair.targetTableId })),
    };
  }));
  return {
    tableResults,
    sourceRecords: tableResults.flatMap(result => result.sourceRecords),
    targetRecords: tableResults.flatMap(result => result.targetRecords),
  };
}

function diffOneTablePair(sourceRecords, targetRecords) {
  const diff = new TranslationDiff({ strict: true });
  return classifyMetaOnly(diff.diff(sourceRecords, targetRecords));
}

function diffLocalizationRecords(sourceRecordsOrReadResult, targetRecords = null) {
  const actions = sourceRecordsOrReadResult.tableResults
    ? sourceRecordsOrReadResult.tableResults.flatMap(result => diffOneTablePair(result.sourceRecords, result.targetRecords))
    : diffOneTablePair(sourceRecordsOrReadResult, targetRecords);
  return {
    actions,
    summary: normalizeSummary(actions),
  };
}

module.exports = {
  readLocalizationRecords,
  diffLocalizationRecords,
  diffOneTablePair,
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
function commandBlock(task, commands) {
  const sourceRun = task.sourceRunId ? `\nsource run: \`${task.sourceRunId}\`` : '';
  return [
    `task: \`${task.id}\`${sourceRun}`,
    '',
    ...commands.map(command => `- \`${command}\``),
  ].join('\n');
}

function buildDailyReportCard({ task, summaryText }) {
  const commands = [
    `ignore ${task.id}`,
    `dry-run ${task.id}`,
    `patch ${task.id}`,
    `custom ${task.id}: <your instruction>`,
  ];
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: 'Doc Agent Daily Localization Report' },
      template: 'blue',
    },
    elements: [
      { tag: 'markdown', content: `**Summary**\n${summaryText}` },
      { tag: 'markdown', content: `**Reply with one command**\n${commandBlock(task, commands)}` },
    ],
  };
}

function buildLiveWriteApprovalCard({ task, summaryText }) {
  const commands = [
    `approve ${task.id}`,
    `reject ${task.id}`,
    `changes ${task.id}: <what to change>`,
  ];
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: 'Doc Agent Live Write Approval' },
      template: 'orange',
    },
    elements: [
      { tag: 'markdown', content: `**Summary**\n${summaryText}` },
      { tag: 'markdown', content: `**Reply with one command**\n${commandBlock(task, commands)}` },
    ],
  };
}

module.exports = {
  buildDailyReportCard,
  buildLiveWriteApprovalCard,
  commandBlock,
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

test('daily report card contains MVP reply commands', () => {
  const card = buildDailyReportCard({
    task: { id: 'task-1', sourceRunId: '123' },
    summaryText: 'Total: 1 · NEW: 1'
  });
  const content = JSON.stringify(card);
  assert.match(content, /dry-run task-1/);
  assert.match(content, /patch task-1/);
  assert.match(content, /custom task-1/);
});

test('live write card has approve reject and changes commands', () => {
  const card = buildLiveWriteApprovalCard({
    task: { id: 'task-1', sourceRunId: '456' },
    summaryText: 'NEW: one doc',
  });
  const content = JSON.stringify(card);
  assert.match(content, /approve task-1/);
  assert.match(content, /reject task-1/);
  assert.match(content, /changes task-1/);
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
const { TASK_STATUS, WORK_TYPES } = require('../src/contracts');
const { routeTask } = require('../src/owner-registry');

async function main() {
  const args = new Set(process.argv.slice(2));
  const sendCard = args.has('--send-card');
  const config = loadConfig();
  const stateStore = new StateStore();
  const taskStore = new TaskStore();
  const state = stateStore.read();
  const task = {
    id: createTaskId('loc-scan'),
    workType: WORK_TYPES.LOCALIZATION,
    owner: config.surfaces.localization.owner,
    type: 'localization_scan',
    status: TASK_STATUS.DETECTED,
    createdAt: new Date().toISOString(),
    sourceRunId: process.env.GITHUB_RUN_ID || null,
    baseline: state.localization.lastHandled,
  };
  routeTask(config, task);

  const records = await readLocalizationRecords(config);
  const diff = diffLocalizationRecords(records);
  const report = renderMarkdownReport({ task, ...diff });

  taskStore.writeTask({ ...task, summary: diff.summary });
  taskStore.writeArtifact(task.id, 'actions.json', diff.actions);
  taskStore.writeArtifact(task.id, 'summary.md', report);

  if (sendCard) {
    const card = buildDailyReportCard({
      task,
      summaryText: renderFeishuSummary(diff),
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

### Task 6: Local Approval Event Consumer

**Files:**
- Create: `.claude/agent-team/src/approval-commands.js`
- Create: `.claude/agent-team/src/github-dispatch.js`
- Create: `.claude/agent-team/src/event-consumer.js`
- Create: `.claude/agent-team/bin/doc-agent-approval-consumer.js`
- Create: `.claude/agent-team/supervisor/launchd.plist.example`
- Create: `.claude/agent-team/supervisor/systemd.service.example`
- Create: `.claude/agent-team/tests/approval-commands.test.js`
- Create: `.claude/agent-team/tests/event-consumer.test.js`

- [ ] **Step 1: Implement approval command parser**

Create `.claude/agent-team/src/approval-commands.js`:

```js
const ACTION_ALIASES = Object.freeze({
  ignore: 'ignore',
  'dry-run': 'dry_run_only',
  dryrun: 'dry_run_only',
  patch: 'patch_after_approval',
  custom: 'custom',
  approve: 'approve_live_write',
  reject: 'reject',
  changes: 'changes_requested',
});

function parseApprovalCommand(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/^([a-zA-Z-]+)\s+([a-zA-Z0-9_.:-]+)(?::\s*([\s\S]+))?$/);
  if (!match) return null;
  const command = match[1].toLowerCase();
  const action = ACTION_ALIASES[command];
  if (!action) return null;
  return {
    action,
    taskId: match[2],
    customInstruction: match[3] ? match[3].trim() : '',
    raw,
  };
}

function normalizeFeishuMessageEvent(event) {
  const root = event.event || event;
  return {
    chatId: root.chat_id || root.message?.chat_id || '',
    senderId: root.sender_id || root.sender?.sender_id?.open_id || root.sender?.id || '',
    messageId: root.message_id || root.message?.message_id || '',
    text: root.text || root.content || root.message?.content || '',
  };
}

module.exports = {
  parseApprovalCommand,
  normalizeFeishuMessageEvent,
};
```

- [ ] **Step 2: Implement GitHub dispatch helper**

Create `.claude/agent-team/src/github-dispatch.js`:

```js
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
```

- [ ] **Step 3: Implement event consumer wrapper**

Create `.claude/agent-team/src/event-consumer.js`:

```js
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parseApprovalCommand, normalizeFeishuMessageEvent } = require('./approval-commands');
const { dispatchGithub } = require('./github-dispatch');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function appendDecision(filePath, decision) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(decision)}\n`);
}

function hasDecision(filePath, decisionId) {
  if (!fs.existsSync(filePath)) return false;
  return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).some(line => {
    try {
      return JSON.parse(line).decisionId === decisionId;
    } catch {
      return false;
    }
  });
}

function createDecision({ parsed, event, sourceRunId = null }) {
  const decisionId = `${parsed.taskId}:${parsed.action}:${event.senderId}`;
  return {
    decisionId,
    taskId: parsed.taskId,
    action: parsed.action,
    sourceRunId,
    customInstruction: parsed.customInstruction,
    userId: event.senderId,
    messageId: event.messageId,
    decidedAt: new Date().toISOString(),
  };
}

async function handleEvent({ config, event, githubToken, sourceRunIdResolver = () => null }) {
  const normalized = normalizeFeishuMessageEvent(event);
  if (normalized.chatId !== config.feishu.chatId) return { ignored: true, reason: 'chat mismatch' };
  if (!config.feishu.approverIds.includes(normalized.senderId)) return { ignored: true, reason: 'sender not allowed' };
  const parsed = parseApprovalCommand(normalized.text);
  if (!parsed) return { ignored: true, reason: 'not an approval command' };
  const decision = createDecision({
    parsed,
    event: normalized,
    sourceRunId: sourceRunIdResolver(parsed.taskId),
  });
  const logPath = config.approvalConsumer.decisionLogPath;
  if (hasDecision(logPath, decision.decisionId)) return { duplicate: true, decision };
  appendDecision(logPath, decision);
  await dispatchGithub({ config, token: githubToken, decision });
  return { ok: true, decision };
}

function waitForReady(child, eventKey) {
  return new Promise((resolve, reject) => {
    const readyLine = `[event] ready event_key=${eventKey}`;
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${readyLine}`)), 30000);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderr += chunk;
      process.stderr.write(chunk);
      if (stderr.includes(readyLine)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`lark-cli event consumer exited before ready, code=${code}`));
    });
  });
}

async function runEventConsumer({ config, githubToken }) {
  const command = config.approvalConsumer.larkCliCommand || 'lark-cli';
  const eventKey = config.approvalConsumer.eventKey || 'im.message.receive_v1';
  const child = spawn(command, ['event', 'consume', eventKey, '--as', 'bot'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  await waitForReady(child, eventKey);
  child.stdout.setEncoding('utf8');
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      Promise.resolve()
        .then(() => handleEvent({ config, event: JSON.parse(line), githubToken }))
        .catch(error => console.error(error.stack || error.message));
    }
  });
  return child;
}

module.exports = {
  appendDecision,
  createDecision,
  handleEvent,
  waitForReady,
  runEventConsumer,
};
```

- [ ] **Step 4: Implement local consumer CLI**

Create `.claude/agent-team/bin/doc-agent-approval-consumer.js`:

```js
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
```

- [ ] **Step 5: Add supervisor templates**

Create `.claude/agent-team/supervisor/launchd.plist.example`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.zilliz.doc-agent-approval-consumer</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/ABSOLUTE/PATH/feishu-markdown-bridge/.claude/agent-team/bin/doc-agent-approval-consumer.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/ABSOLUTE/PATH/feishu-markdown-bridge</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>GITHUB_TOKEN</key>
    <string>REPLACE_WITH_TOKEN_OR_USE_LAUNCHD_ENV</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
```

Create `.claude/agent-team/supervisor/systemd.service.example`:

```ini
[Unit]
Description=Feishu Doc Agent Approval Consumer
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/ABSOLUTE/PATH/feishu-markdown-bridge
ExecStart=/usr/bin/node .claude/agent-team/bin/doc-agent-approval-consumer.js
Environment=GITHUB_TOKEN=REPLACE_WITH_TOKEN_OR_USE_ENV_FILE
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 6: Add approval parser tests**

Create `.claude/agent-team/tests/approval-commands.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseApprovalCommand, normalizeFeishuMessageEvent } = require('../src/approval-commands');

test('parseApprovalCommand parses MVP policy commands', () => {
  assert.deepEqual(parseApprovalCommand('dry-run loc-scan-1'), {
    action: 'dry_run_only',
    taskId: 'loc-scan-1',
    customInstruction: '',
    raw: 'dry-run loc-scan-1',
  });
  assert.equal(parseApprovalCommand('patch loc-scan-1').action, 'patch_after_approval');
  assert.equal(parseApprovalCommand('approve loc-scan-1').action, 'approve_live_write');
});

test('parseApprovalCommand captures custom instruction', () => {
  const parsed = parseApprovalCommand('custom loc-scan-1: only update metadata');
  assert.equal(parsed.action, 'custom');
  assert.equal(parsed.customInstruction, 'only update metadata');
});

test('normalizeFeishuMessageEvent handles flat event shape', () => {
  const event = normalizeFeishuMessageEvent({
    chat_id: 'oc_chat',
    sender_id: 'ou_user',
    message_id: 'om_msg',
    content: 'approve loc-scan-1',
  });
  assert.equal(event.chatId, 'oc_chat');
  assert.equal(event.senderId, 'ou_user');
  assert.equal(event.text, 'approve loc-scan-1');
});
```

- [ ] **Step 7: Add event consumer tests**

Create `.claude/agent-team/tests/event-consumer.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { handleEvent } = require('../src/event-consumer');

function config(logPath) {
  return {
    feishu: { chatId: 'oc_chat', approverIds: ['ou_allowed'] },
    github: { owner: 'zilliztech', repo: 'feishu-markdown-bridge', dispatchEventPrefix: 'doc-agent' },
    approvalConsumer: { decisionLogPath: logPath },
  };
}

test('handleEvent ignores unauthorized sender before dispatch', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-agent-consumer-'));
  const result = await handleEvent({
    config: config(path.join(dir, 'decisions.jsonl')),
    githubToken: 'unused',
    event: { chat_id: 'oc_chat', sender_id: 'ou_other', message_id: 'om_1', content: 'approve loc-scan-1' },
  });
  assert.equal(result.ignored, true);
  assert.equal(result.reason, 'sender not allowed');
});
```

- [ ] **Step 8: Make CLI executable**

Run:

```bash
chmod +x .claude/agent-team/bin/doc-agent-approval-consumer.js
```

- [ ] **Step 9: Run tests**

Run:

```bash
npm run test:agent-team
```

Expected: PASS. Do not run the unbounded consumer until `lark-cli` auth and `GITHUB_TOKEN` are configured.

- [ ] **Step 10: Commit**

```bash
git add .claude/agent-team/src/approval-commands.js .claude/agent-team/src/github-dispatch.js .claude/agent-team/src/event-consumer.js .claude/agent-team/bin/doc-agent-approval-consumer.js .claude/agent-team/supervisor/launchd.plist.example .claude/agent-team/supervisor/systemd.service.example .claude/agent-team/tests/approval-commands.test.js .claude/agent-team/tests/event-consumer.test.js
git commit -m "feat: add local feishu approval consumer"
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

function groupByTablePair(actions) {
  return actions.reduce((groups, action) => {
    const key = `${action.sourceTableId}:${action.targetTableId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        sourceTableId: action.sourceTableId,
        targetTableId: action.targetTableId,
        actions: [],
      });
    }
    groups.get(key).actions.push(action);
    return groups;
  }, new Map());
}

async function applyMetaOnlyActions(config, actions) {
  const localization = config.surfaces.localization;
  const results = [];
  for (const group of groupByTablePair(actions).values()) {
    const writer = new BitableWriter({
      baseToken: localization.targetBaseToken,
      tableId: group.targetTableId,
    });
    for (const action of group.actions) {
      if (!action.target?.id) {
        results.push({ action, status: 'skipped', reason: 'target record missing' });
        continue;
      }
      const fields = {
        deprecateSince: action.source?.metadata?.deprecate_since || undefined,
        lastModified: action.source?.metadata?.last_modified || undefined,
      };
      await writer.updateRecord(action.target.id, fields);
      results.push({ action, status: 'success', targetTableId: group.targetTableId });
    }
  }
  return results;
}

async function runTranslationActions(config, approved) {
  const localization = config.surfaces.localization;
  const results = [];
  for (const group of groupByTablePair(approved).values()) {
    const translator = new FeishuDocTranslator({
      sourceBitable: localization.sourceBaseToken,
      targetBitable: localization.targetBaseToken,
      sourceTableId: group.sourceTableId,
      targetTableId: group.targetTableId,
      sourceRoot: localization.sourceRootToken,
      targetRoot: localization.targetRootToken,
      sourceLang: localization.sourceLang,
      targetLang: localization.targetLang,
      driveType: localization.driveType,
      translatorType: localization.translator,
      dryRun: false,
      approvalCallback: async (actions) => {
        const approvedSlugs = new Set(group.actions.map(action => `${action.type}:${action.slug}`));
        return actions.filter(action => approvedSlugs.has(`${action.type}:${action.slug}`));
      },
    });
    results.push({
      sourceTableId: group.sourceTableId,
      targetTableId: group.targetTableId,
      result: await translator.run(),
    });
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
  const localization = config.surfaces.localization;
  const allowed = localization.allowedLiveActions;
  const unsafe = approved.filter(action => !isLiveActionAllowed(action.type, allowed));
  if (unsafe.length) {
    throw new Error(`Refusing live write for disallowed action types: ${unsafe.map(a => a.type).join(', ')}`);
  }

  store.writeTask({ ...task, status: TASK_STATUS.LIVE_WRITE_STARTED, liveWriteStartedAt: new Date().toISOString() });

  const translationActions = approved.filter(action => ['NEW', 'UPDATE'].includes(action.type));
  const metaOnlyActions = approved.filter(action => action.type === 'META_ONLY');
  const result = translationActions.length > 0 ? await runTranslationActions(config, translationActions) : [];
  const metaOnlyResults = await applyMetaOnlyActions(config, metaOnlyActions);
  store.writeArtifact(taskId, 'meta-only-result.json', metaOnlyResults);
  store.writeArtifact(taskId, 'live-write-result.json', result);
  store.writeTask({ ...task, status: TASK_STATUS.VERIFICATION_STARTED, liveWriteCompletedAt: new Date().toISOString() });
  console.log(JSON.stringify({ taskId, translationTableCount: result.length, metaOnlyCount: metaOnlyResults.length }, null, 2));
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
  const diff = diffLocalizationRecords(records);
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

Local approval consumer environment:

- `GITHUB_TOKEN`

## Setup

1. Copy `.claude/agent-team/config.example.json`.
2. Fill real Feishu chat, approver, source/target base tokens, `sourceTableIds`, `targetTableIds`, root tokens, GitHub, and approval consumer values.
3. Keep SDK reference, REST reference, CLI reference, guide-doc, and verified-doc surfaces present but disabled until their owners are implemented.
4. Store the filled JSON as GitHub secret `DOC_AGENT_CONFIG_JSON`.
5. Put the same config file at `.claude/agent-team/config.json` on the machine that runs the local consumer.
6. Run `lark-cli auth login` if needed and verify `lark-cli event consume im.message.receive_v1 --as bot --max-events 1 --timeout 30s` can receive events.
7. Start `.claude/agent-team/bin/doc-agent-approval-consumer.js` under `launchd`, `systemd`, or another supervisor with `GITHUB_TOKEN` in its environment.
8. Run `Doc Agent Scan` manually from GitHub Actions.

## Expected MVP Flow

1. `Doc Agent Scan` posts a Feishu daily report card.
2. Approver replies in the configured Feishu chat with `dry-run <task-id>` or `patch <task-id>`.
3. Local approval consumer receives the Feishu event and dispatches the dry-run workflow.
4. Dry-run workflow uploads artifacts and sends a concrete live-write approval card when there are actionable records.
5. Approver replies `approve <task-id>`.
6. Local approval consumer dispatches live-write workflow.
7. Live-write workflow updates approved Feishu docs/records and verifies the result.

## Safety Rules

- Do not use live-write workflow without a reviewed dry-run artifact.
- Do not approve `ORPHAN` deletion; MVP never deletes or archives target docs.
- Duplicate approval replies must not cause duplicate writes.
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
- Always-on local Feishu approval consumer: Task 6.
- GitHub Actions scheduler/executor: Task 8.
- Domain-owner model: Task 1 defines multi-domain owner routes and disabled SDK/REST/CLI/guide/verified surfaces; Task 7 uses the localization owner route for MVP execution.
- Metadata-first localization MVP: Task 3 and Task 5.
- Live writes only after review and approval: Task 7 and Task 8.
- Guide-doc scan: config and owner route exist in Task 1, but scanning remains deferred because the finalized spec marks it Phase 2 report-only after MVP.

Residual verification notes:

- Feishu event payload shape must be verified against one real non-live approval message before enabling live writes. `normalizeFeishuMessageEvent()` is structured to isolate that parsing change.
- The current root `npm test` points at a missing SDK sync test directory. Use `npm run test:agent-team` for this MVP until the broader test script is repaired.
