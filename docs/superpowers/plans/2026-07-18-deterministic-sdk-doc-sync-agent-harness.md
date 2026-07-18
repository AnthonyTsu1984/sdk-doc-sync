# Deterministic SDK Doc Sync Agent Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, schema-validated release-scout and agent harness for `sdk-doc-sync` so fresh agents produce the same approval-grade SDK/API release action list every time.

**Architecture:** Add a release-scope layer before the existing scanner-to-IR pipeline. The release-scope layer resolves baseline/target tags, extracts changed public symbols, normalizes them to canonical documentation identities, and emits a bounded JSON artifact that the main sync CLI can consume. Agent-facing skill instructions must require this artifact before approval, and tests must cover release fixtures, tool contracts, zero-write dry-runs, and replayable agent cases.

**Tech Stack:** Node.js CommonJS, `node:test`, existing SDK scanner modules, Git CLI through `child_process.spawnSync`, JSON fixtures/goldens, existing schema-first SDK Reference IR and SyncPlanner modules.

---

## File Structure

- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/schema.js` — validators and constructors for release-scout artifacts.
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/git-range.js` — deterministic Git tag/range/file helpers.
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/symbol-inventory.js` — baseline/target scanner inventory and symbol delta classification.
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/identity-normalizer.js` — canonical stable ID and slug normalization from JSON maps.
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/release-scout.js` — orchestration library used by CLI and tests.
- Create: `.claude/skills/sdk-doc-sync/bin/sdk-release-scout.js` — executable command agents run first.
- Create: `.claude/skills/sdk-doc-sync/references/identity/python-v26.json` — Python v2.6.x canonical identity map.
- Create: `.claude/skills/sdk-doc-sync/references/identity/common-categories.json` — shared category names used by tests and future maps.
- Create: `.claude/skills/sdk-doc-sync/tests/release-scope.test.js` — unit tests for schema, Git helpers, symbol diffing, and identity normalization.
- Create: `.claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js` — CLI tests with injected Git/scanner fixtures.
- Create: `.claude/skills/sdk-doc-sync/tests/agent-harness.test.js` — replay tests that assert bounded agent-facing artifacts.
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/release-scope/python-v26-scanned-baseline.json` — baseline scanner fixture.
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/release-scope/python-v26-scanned-target.json` — target scanner fixture.
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/release-scope/python-v26-expected.json` — golden release-scout artifact.
- Modify: `.claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js` — accept `--release-scope`, `--changed-only`, and bounded summary output.
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/index.js` — filter scanned symbols and annotate plans from release scope.
- Modify: `.claude/skills/sdk-doc-sync/SKILL.md` — require release-scout before approval-grade SDK release scans.
- Modify: `.claude/skills/sdk-doc-sync/references/cli.md` — document release-scout and scoped dry-run commands.
- Modify: `.claude/skills/sdk-doc-sync/docs/development/integration-testing.md` — add offline validation commands.
- Modify: `.claude/skills/sdk-doc-sync/tests/script-paths.test.js` — expect new test files and CLI path.
- Modify: `package.json` — add optional `sdk-doc-sync:release-scout` script.

### Task 1: Define The Release-Scope Artifact Contract

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/schema.js`
- Create: `.claude/skills/sdk-doc-sync/tests/release-scope.test.js`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/release-scope/python-v26-expected.json`

- [ ] **Step 1: Write the failing schema tests**

Add this block to `.claude/skills/sdk-doc-sync/tests/release-scope.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createReleaseScope,
  validateReleaseScope,
  stableReleaseScopeJson,
} = require('../src/sdk-doc-sync/release-scope/schema');

const fixtureDir = path.join(__dirname, 'fixtures', 'release-scope');

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
}

test('release-scope schema accepts the Python v2.6 golden artifact', () => {
  const scope = readFixture('python-v26-expected.json');
  const validation = validateReleaseScope(scope);
  assert.deepEqual(validation, { valid: true, errors: [] });
});

test('release-scope schema rejects missing approval and mutation flags', () => {
  const scope = readFixture('python-v26-expected.json');
  delete scope.approvalGrade;
  delete scope.writesPerformed;
  const validation = validateReleaseScope(scope);
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.errors.map((error) => error.path), [
    '$.approvalGrade',
    '$.writesPerformed',
  ]);
});

test('createReleaseScope sorts files, actions, and diagnostics deterministically', () => {
  const scope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/client/field_ops.py', 'pymilvus/milvus_client/milvus_client.py'],
    actions: [
      { type: 'UPDATE', stableId: 'python:Management:compact', symbol: 'MilvusClient.compact', source: { file: 'pymilvus/milvus_client/milvus_client.py', line: 1835 }, reason: 'signature changed' },
      { type: 'CREATE', stableId: 'python:Vector:FieldOp', symbol: 'FieldOp', source: { file: 'pymilvus/client/field_ops.py', line: 45 }, reason: 'new public class' },
    ],
    scannerDiagnostics: [
      { level: 'warn', code: 'FULL_SCAN_DIAGNOSTIC_ONLY', message: 'Full scanner output is not approval-grade for python v2.6.x.' },
    ],
  });

  assert.deepEqual(scope.changedFiles, [
    'pymilvus/client/field_ops.py',
    'pymilvus/milvus_client/milvus_client.py',
  ]);
  assert.deepEqual(scope.actions.map((action) => action.stableId), [
    'python:Management:compact',
    'python:Vector:FieldOp',
  ]);
  assert.equal(stableReleaseScopeJson(scope), `${stableReleaseScopeJson(scope)}`);
  assert.deepEqual(validateReleaseScope(scope), { valid: true, errors: [] });
});
```

Create `.claude/skills/sdk-doc-sync/tests/fixtures/release-scope/python-v26-expected.json`:

```json
{
  "schemaVersion": 1,
  "language": "python",
  "sdkName": "pymilvus",
  "track": "v2.6.x",
  "baselineTag": "v2.6.12",
  "targetTag": "v2.6.17",
  "targetCommit": "05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4",
  "targetDate": "2026-07-15T08:32:32.000Z",
  "releaseRange": "v2.6.12..v2.6.17",
  "approvalGrade": true,
  "changedFiles": [
    "pymilvus/client/field_ops.py",
    "pymilvus/milvus_client/milvus_client.py"
  ],
  "actions": [
    {
      "type": "UPDATE",
      "stableId": "python:Management:compact",
      "canonicalSlug": "Management-compact",
      "symbol": "MilvusClient.compact",
      "source": {
        "file": "pymilvus/milvus_client/milvus_client.py",
        "line": 1835
      },
      "reason": "signature changed"
    },
    {
      "type": "CREATE",
      "stableId": "python:Vector:FieldOp",
      "canonicalSlug": "FieldOp",
      "symbol": "FieldOp",
      "source": {
        "file": "pymilvus/client/field_ops.py",
        "line": 45
      },
      "reason": "new public class"
    }
  ],
  "scannerDiagnostics": [
    {
      "level": "warn",
      "code": "FULL_SCAN_DIAGNOSTIC_ONLY",
      "message": "Full scanner output is not approval-grade for python v2.6.x."
    }
  ],
  "writesPerformed": false,
  "scanStateUpdated": false
}
```

- [ ] **Step 2: Run the schema tests and verify failure**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scope.test.js
```

Expected:

```text
not ok 1 - release-scope schema accepts the Python v2.6 golden artifact
```

The failure must mention that `../src/sdk-doc-sync/release-scope/schema` cannot be found.

- [ ] **Step 3: Implement the schema module**

Create `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/schema.js`:

```js
'use strict';

const ACTION_TYPES = new Set(['CREATE', 'UPDATE', 'DEPRECATE', 'BACKFILL']);
const DIAGNOSTIC_LEVELS = new Set(['info', 'warn', 'error']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableSortBy(items, keyFn) {
  return [...items].sort((a, b) => keyFn(a).localeCompare(keyFn(b)));
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, stableObject(value[key])]),
  );
}

function stableReleaseScopeJson(scope) {
  return `${JSON.stringify(stableObject(scope), null, 2)}\n`;
}

function createReleaseScope(input) {
  const actions = stableSortBy(input.actions || [], (action) => `${action.stableId}:${action.type}`);
  const diagnostics = stableSortBy(input.scannerDiagnostics || [], (item) => `${item.level}:${item.code}:${item.message}`);
  return {
    schemaVersion: 1,
    language: input.language,
    sdkName: input.sdkName,
    track: input.track,
    baselineTag: input.baselineTag,
    targetTag: input.targetTag,
    targetCommit: input.targetCommit,
    targetDate: input.targetDate,
    releaseRange: `${input.baselineTag}..${input.targetTag}`,
    approvalGrade: input.approvalGrade !== false,
    changedFiles: [...new Set(input.changedFiles || [])].sort(),
    actions,
    scannerDiagnostics: diagnostics,
    writesPerformed: false,
    scanStateUpdated: false,
  };
}

function validateReleaseScope(scope) {
  const errors = [];
  const requireString = (path, value) => {
    if (typeof value !== 'string' || value.length === 0) {
      errors.push({ path, message: 'must be a non-empty string' });
    }
  };
  const requireBoolean = (path, value) => {
    if (typeof value !== 'boolean') errors.push({ path, message: 'must be a boolean' });
  };
  if (!isObject(scope)) {
    return { valid: false, errors: [{ path: '$', message: 'must be an object' }] };
  }
  if (scope.schemaVersion !== 1) errors.push({ path: '$.schemaVersion', message: 'must be 1' });
  requireString('$.language', scope.language);
  requireString('$.sdkName', scope.sdkName);
  requireString('$.track', scope.track);
  requireString('$.baselineTag', scope.baselineTag);
  requireString('$.targetTag', scope.targetTag);
  requireString('$.targetCommit', scope.targetCommit);
  requireString('$.targetDate', scope.targetDate);
  requireString('$.releaseRange', scope.releaseRange);
  requireBoolean('$.approvalGrade', scope.approvalGrade);
  requireBoolean('$.writesPerformed', scope.writesPerformed);
  requireBoolean('$.scanStateUpdated', scope.scanStateUpdated);
  if (!Array.isArray(scope.changedFiles)) errors.push({ path: '$.changedFiles', message: 'must be an array' });
  if (!Array.isArray(scope.actions)) errors.push({ path: '$.actions', message: 'must be an array' });
  if (!Array.isArray(scope.scannerDiagnostics)) errors.push({ path: '$.scannerDiagnostics', message: 'must be an array' });

  for (const [index, action] of (scope.actions || []).entries()) {
    if (!isObject(action)) {
      errors.push({ path: `$.actions[${index}]`, message: 'must be an object' });
      continue;
    }
    if (!ACTION_TYPES.has(action.type)) errors.push({ path: `$.actions[${index}].type`, message: 'must be CREATE, UPDATE, DEPRECATE, or BACKFILL' });
    requireString(`$.actions[${index}].stableId`, action.stableId);
    requireString(`$.actions[${index}].canonicalSlug`, action.canonicalSlug);
    requireString(`$.actions[${index}].symbol`, action.symbol);
    requireString(`$.actions[${index}].reason`, action.reason);
    if (!isObject(action.source)) {
      errors.push({ path: `$.actions[${index}].source`, message: 'must be an object' });
    } else {
      requireString(`$.actions[${index}].source.file`, action.source.file);
      if (!Number.isInteger(action.source.line) || action.source.line < 1) {
        errors.push({ path: `$.actions[${index}].source.line`, message: 'must be a positive integer' });
      }
    }
  }

  for (const [index, diagnostic] of (scope.scannerDiagnostics || []).entries()) {
    if (!isObject(diagnostic)) {
      errors.push({ path: `$.scannerDiagnostics[${index}]`, message: 'must be an object' });
      continue;
    }
    if (!DIAGNOSTIC_LEVELS.has(diagnostic.level)) errors.push({ path: `$.scannerDiagnostics[${index}].level`, message: 'must be info, warn, or error' });
    requireString(`$.scannerDiagnostics[${index}].code`, diagnostic.code);
    requireString(`$.scannerDiagnostics[${index}].message`, diagnostic.message);
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  createReleaseScope,
  validateReleaseScope,
  stableReleaseScopeJson,
};
```

- [ ] **Step 4: Run the schema tests and verify pass**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scope.test.js
```

Expected:

```text
# pass 3
# fail 0
```

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/schema.js .claude/skills/sdk-doc-sync/tests/release-scope.test.js .claude/skills/sdk-doc-sync/tests/fixtures/release-scope/python-v26-expected.json
git commit -m "feat: define deterministic sdk release scope schema"
```

### Task 2: Add Deterministic Git Range Resolution

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/git-range.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/release-scope.test.js`

- [ ] **Step 1: Write failing Git helper tests**

Append to `.claude/skills/sdk-doc-sync/tests/release-scope.test.js`:

```js
const {
  latestTagInTrack,
  resolveReleaseRange,
  changedFilesInRange,
} = require('../src/sdk-doc-sync/release-scope/git-range');

function fakeGit(outputs) {
  return (args) => {
    const key = args.join(' ');
    if (!Object.prototype.hasOwnProperty.call(outputs, key)) {
      throw new Error(`Unexpected git call: ${key}`);
    }
    return outputs[key];
  };
}

test('latestTagInTrack resolves the highest semver tag in a track', () => {
  const tag = latestTagInTrack({
    track: 'v2.6.x',
    runGit: fakeGit({
      'tag --list v2.6.* --sort=v:refname': 'v2.6.15\nv2.6.16\nv2.6.17\n',
    }),
  });
  assert.equal(tag, 'v2.6.17');
});

test('resolveReleaseRange uses scan-state baseline and latest target', () => {
  const range = resolveReleaseRange({
    languageKey: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    scanState: { python: { lastScannedTag: 'v2.6.12' } },
    runGit: fakeGit({
      'tag --list v2.6.* --sort=v:refname': 'v2.6.13\nv2.6.17\n',
      'rev-list -n 1 v2.6.17': '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4\n',
      'show -s --format=%cI v2.6.17': '2026-07-15T16:32:32+08:00\n',
    }),
  });
  assert.deepEqual(range, {
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    releaseRange: 'v2.6.12..v2.6.17',
    noChanges: false,
  });
});

test('changedFilesInRange returns sorted public SDK paths only', () => {
  const files = changedFilesInRange({
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    publicRoots: ['pymilvus/', 'src/'],
    runGit: fakeGit({
      'diff --name-only v2.6.12..v2.6.17': [
        'tests/unit/test_milvus_client.py',
        'pymilvus/milvus_client/milvus_client.py',
        'pymilvus/client/field_ops.py',
        'README.md',
      ].join('\n'),
    }),
  });
  assert.deepEqual(files, [
    'pymilvus/client/field_ops.py',
    'pymilvus/milvus_client/milvus_client.py',
  ]);
});
```

- [ ] **Step 2: Run the Git helper tests and verify failure**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scope.test.js
```

Expected failure includes:

```text
Cannot find module '../src/sdk-doc-sync/release-scope/git-range'
```

- [ ] **Step 3: Implement Git range helpers**

Create `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/git-range.js`:

```js
'use strict';

const { spawnSync } = require('node:child_process');

function defaultRunGit(args, { cwd } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function tagPatternFromTrack(track) {
  const match = track.match(/^v(\d+)\.(\d+)\.x$/);
  if (!match) throw new Error(`Unsupported track format: ${track}`);
  return `v${match[1]}.${match[2]}.*`;
}

function latestTagInTrack({ track, runGit = defaultRunGit, cwd } = {}) {
  const pattern = tagPatternFromTrack(track);
  const output = runGit(['tag', '--list', pattern, '--sort=v:refname'], { cwd });
  const tags = output.split('\n').map((line) => line.trim()).filter(Boolean);
  if (tags.length === 0) throw new Error(`No tags found for track ${track}`);
  return tags[tags.length - 1];
}

function isoDateFromGit(value) {
  return new Date(value.trim()).toISOString();
}

function resolveReleaseRange({
  languageKey,
  sdkName,
  track,
  scanState,
  targetTag = null,
  runGit = defaultRunGit,
  cwd,
} = {}) {
  const baselineTag = scanState?.[languageKey]?.lastScannedTag;
  if (!baselineTag) throw new Error(`scan-state missing lastScannedTag for ${languageKey}`);
  const resolvedTarget = targetTag || latestTagInTrack({ track, runGit, cwd });
  const targetCommit = runGit(['rev-list', '-n', '1', resolvedTarget], { cwd }).trim();
  const targetDate = isoDateFromGit(runGit(['show', '-s', '--format=%cI', resolvedTarget], { cwd }));
  return {
    language: languageKey,
    sdkName,
    track,
    baselineTag,
    targetTag: resolvedTarget,
    targetCommit,
    targetDate,
    releaseRange: `${baselineTag}..${resolvedTarget}`,
    noChanges: baselineTag === resolvedTarget,
  };
}

function changedFilesInRange({
  baselineTag,
  targetTag,
  publicRoots,
  runGit = defaultRunGit,
  cwd,
} = {}) {
  const output = runGit(['diff', '--name-only', `${baselineTag}..${targetTag}`], { cwd });
  const roots = publicRoots || [];
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => roots.length === 0 || roots.some((root) => file.startsWith(root)))
    .sort();
}

module.exports = {
  defaultRunGit,
  latestTagInTrack,
  resolveReleaseRange,
  changedFilesInRange,
};
```

- [ ] **Step 4: Run the Git helper tests and verify pass**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scope.test.js
```

Expected:

```text
# pass 6
# fail 0
```

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/git-range.js .claude/skills/sdk-doc-sync/tests/release-scope.test.js
git commit -m "feat: resolve sdk release ranges deterministically"
```

### Task 3: Add Public Symbol Inventory And Delta Classification

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/symbol-inventory.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/release-scope.test.js`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/release-scope/python-v26-scanned-baseline.json`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/release-scope/python-v26-scanned-target.json`

- [ ] **Step 1: Add scanner inventory fixtures**

Create `.claude/skills/sdk-doc-sync/tests/fixtures/release-scope/python-v26-scanned-baseline.json`:

```json
[
  {
    "name": "compact",
    "kind": "method",
    "signature": "def compact(self, collection_name: str, is_clustering: Optional[bool] = False, is_l0: Optional[bool] = False, timeout: Optional[float] = None, **kwargs) -> int:",
    "params": [
      { "name": "collection_name", "kind": "positional", "type": "str", "default": null },
      { "name": "is_clustering", "kind": "keyword", "type": "Optional[bool]", "default": "False" },
      { "name": "is_l0", "kind": "keyword", "type": "Optional[bool]", "default": "False" },
      { "name": "timeout", "kind": "keyword", "type": "Optional[float]", "default": "None" },
      { "name": "kwargs", "kind": "kwargs", "type": null, "default": null }
    ],
    "filePath": "milvus_client/milvus_client.py",
    "lineNumber": 1798,
    "parentClass": "MilvusClient",
    "decorators": [],
    "returnType": "int"
  }
]
```

Create `.claude/skills/sdk-doc-sync/tests/fixtures/release-scope/python-v26-scanned-target.json`:

```json
[
  {
    "name": "compact",
    "kind": "method",
    "signature": "def compact(self, collection_name: str, is_clustering: Optional[bool] = False, is_l0: Optional[bool] = False, target_size: Optional[int] = None, target_size_unit: str = \"mb\", timeout: Optional[float] = None, **kwargs) -> int:",
    "params": [
      { "name": "collection_name", "kind": "positional", "type": "str", "default": null },
      { "name": "is_clustering", "kind": "keyword", "type": "Optional[bool]", "default": "False" },
      { "name": "is_l0", "kind": "keyword", "type": "Optional[bool]", "default": "False" },
      { "name": "target_size", "kind": "keyword", "type": "Optional[int]", "default": "None" },
      { "name": "target_size_unit", "kind": "keyword", "type": "str", "default": "\"mb\"" },
      { "name": "timeout", "kind": "keyword", "type": "Optional[float]", "default": "None" },
      { "name": "kwargs", "kind": "kwargs", "type": null, "default": null }
    ],
    "filePath": "milvus_client/milvus_client.py",
    "lineNumber": 1835,
    "parentClass": "MilvusClient",
    "decorators": [],
    "returnType": "int"
  },
  {
    "name": "FieldOp",
    "kind": "class",
    "signature": "class FieldOp:",
    "params": [],
    "filePath": "client/field_ops.py",
    "lineNumber": 45,
    "parentClass": null,
    "decorators": [],
    "returnType": null
  }
]
```

- [ ] **Step 2: Write failing symbol delta tests**

Append to `.claude/skills/sdk-doc-sync/tests/release-scope.test.js`:

```js
const {
  publicIdentity,
  classifySymbolDeltas,
  filterSymbolsByChangedFiles,
} = require('../src/sdk-doc-sync/release-scope/symbol-inventory');

test('publicIdentity is stable across line-number changes', () => {
  assert.equal(publicIdentity({
    parentClass: 'MilvusClient',
    name: 'compact',
  }), 'MilvusClient.compact');
  assert.equal(publicIdentity({
    parentClass: null,
    name: 'bulk_import',
  }), 'bulk_import');
});

test('classifySymbolDeltas detects creates and signature updates', () => {
  const baseline = readFixture('python-v26-scanned-baseline.json');
  const target = readFixture('python-v26-scanned-target.json');
  const deltas = classifySymbolDeltas({ baseline, target });
  assert.deepEqual(deltas.map((delta) => [delta.type, delta.symbolIdentity, delta.reason]), [
    ['UPDATE', 'MilvusClient.compact', 'signature changed'],
    ['CREATE', 'FieldOp', 'new public class'],
  ]);
});

test('filterSymbolsByChangedFiles accepts scanner paths relative to package root', () => {
  const target = readFixture('python-v26-scanned-target.json');
  const filtered = filterSymbolsByChangedFiles({
    symbols: target,
    changedFiles: [
      'pymilvus/client/field_ops.py',
      'pymilvus/milvus_client/milvus_client.py',
    ],
    sdkPackagePrefix: 'pymilvus/',
  });
  assert.deepEqual(filtered.map(publicIdentity), ['FieldOp', 'MilvusClient.compact']);
});
```

- [ ] **Step 3: Run symbol tests and verify failure**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scope.test.js
```

Expected failure includes:

```text
Cannot find module '../src/sdk-doc-sync/release-scope/symbol-inventory'
```

- [ ] **Step 4: Implement symbol inventory**

Create `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/symbol-inventory.js`:

```js
'use strict';

function publicIdentity(symbol) {
  return symbol.parentClass ? `${symbol.parentClass}.${symbol.name}` : symbol.name;
}

function comparableSignature(symbol) {
  return JSON.stringify({
    kind: symbol.kind || null,
    signature: symbol.signature || '',
    params: symbol.params || [],
    returnType: symbol.returnType || null,
    decorators: symbol.decorators || [],
  });
}

function sourceOf(symbol, sdkPackagePrefix = '') {
  const file = `${sdkPackagePrefix}${symbol.filePath}`.replace(/\\/g, '/');
  return { file, line: symbol.lineNumber || 1 };
}

function classifySymbolDeltas({ baseline, target } = {}) {
  const oldByIdentity = new Map((baseline || []).map((symbol) => [publicIdentity(symbol), symbol]));
  const deltas = [];
  for (const symbol of target || []) {
    const identity = publicIdentity(symbol);
    const previous = oldByIdentity.get(identity);
    if (!previous) {
      deltas.push({
        type: 'CREATE',
        symbolIdentity: identity,
        symbol,
        previous: null,
        reason: `new public ${symbol.kind || 'symbol'}`,
      });
      continue;
    }
    if (comparableSignature(previous) !== comparableSignature(symbol)) {
      deltas.push({
        type: 'UPDATE',
        symbolIdentity: identity,
        symbol,
        previous,
        reason: 'signature changed',
      });
    }
  }
  return deltas.sort((a, b) => a.symbolIdentity.localeCompare(b.symbolIdentity));
}

function filterSymbolsByChangedFiles({ symbols, changedFiles, sdkPackagePrefix = '' } = {}) {
  const changed = new Set(changedFiles || []);
  return (symbols || [])
    .filter((symbol) => changed.has(sourceOf(symbol, sdkPackagePrefix).file))
    .sort((a, b) => publicIdentity(a).localeCompare(publicIdentity(b)));
}

module.exports = {
  publicIdentity,
  sourceOf,
  classifySymbolDeltas,
  filterSymbolsByChangedFiles,
};
```

- [ ] **Step 5: Run symbol tests and verify pass**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scope.test.js
```

Expected:

```text
# fail 0
```

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/symbol-inventory.js .claude/skills/sdk-doc-sync/tests/release-scope.test.js .claude/skills/sdk-doc-sync/tests/fixtures/release-scope/python-v26-scanned-baseline.json .claude/skills/sdk-doc-sync/tests/fixtures/release-scope/python-v26-scanned-target.json
git commit -m "feat: classify sdk public symbol release deltas"
```

### Task 4: Add Canonical Identity Normalization

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/identity-normalizer.js`
- Create: `.claude/skills/sdk-doc-sync/references/identity/python-v26.json`
- Create: `.claude/skills/sdk-doc-sync/references/identity/common-categories.json`
- Modify: `.claude/skills/sdk-doc-sync/tests/release-scope.test.js`

- [ ] **Step 1: Create identity map fixtures**

Create `.claude/skills/sdk-doc-sync/references/identity/common-categories.json`:

```json
{
  "python": [
    "Authentication",
    "BulkImport",
    "Client",
    "Collections",
    "CollectionSchema",
    "Management",
    "Vector"
  ]
}
```

Create `.claude/skills/sdk-doc-sync/references/identity/python-v26.json`:

```json
{
  "schemaVersion": 1,
  "language": "python",
  "track": "v2.6.x",
  "defaultCategory": "Client",
  "packagePrefix": "pymilvus/",
  "symbols": {
    "MilvusClient.compact": {
      "stableId": "python:Management:compact",
      "canonicalSlug": "Management-compact",
      "category": "Management"
    },
    "bulk_import": {
      "stableId": "python:BulkImport:bulk_import",
      "canonicalSlug": "BulkImport-bulk_import",
      "category": "BulkImport"
    },
    "MilvusClient.alter_role": {
      "stableId": "python:Authentication:alter_role",
      "canonicalSlug": "Authentication-alter_role",
      "category": "Authentication"
    },
    "FieldOp": {
      "stableId": "python:Vector:FieldOp",
      "canonicalSlug": "FieldOp",
      "category": "Vector"
    }
  }
}
```

- [ ] **Step 2: Write failing normalizer tests**

Append to `.claude/skills/sdk-doc-sync/tests/release-scope.test.js`:

```js
const {
  loadIdentityMap,
  normalizeDelta,
} = require('../src/sdk-doc-sync/release-scope/identity-normalizer');

test('identity normalizer maps raw Python scanner symbols to canonical docs', () => {
  const map = loadIdentityMap(path.join(__dirname, '..', 'references', 'identity', 'python-v26.json'));
  const delta = classifySymbolDeltas({
    baseline: readFixture('python-v26-scanned-baseline.json'),
    target: readFixture('python-v26-scanned-target.json'),
  }).find((item) => item.symbolIdentity === 'MilvusClient.compact');

  assert.deepEqual(normalizeDelta(delta, map), {
    type: 'UPDATE',
    stableId: 'python:Management:compact',
    canonicalSlug: 'Management-compact',
    symbol: 'MilvusClient.compact',
    source: {
      file: 'pymilvus/milvus_client/milvus_client.py',
      line: 1835,
    },
    reason: 'signature changed',
  });
});

test('identity normalizer gives unmapped symbols explicit diagnostics', () => {
  const map = loadIdentityMap(path.join(__dirname, '..', 'references', 'identity', 'python-v26.json'));
  const normalized = normalizeDelta({
    type: 'CREATE',
    symbolIdentity: 'MilvusClient.unknown_method',
    symbol: {
      name: 'unknown_method',
      kind: 'method',
      parentClass: 'MilvusClient',
      filePath: 'milvus_client/milvus_client.py',
      lineNumber: 2000,
    },
    reason: 'new public method',
  }, map);
  assert.deepEqual(normalized.diagnostic, {
    level: 'warn',
    code: 'UNMAPPED_CANONICAL_IDENTITY',
    message: 'No canonical identity mapping for MilvusClient.unknown_method in python v2.6.x.',
  });
});
```

- [ ] **Step 3: Run normalizer tests and verify failure**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scope.test.js
```

Expected failure includes:

```text
Cannot find module '../src/sdk-doc-sync/release-scope/identity-normalizer'
```

- [ ] **Step 4: Implement identity normalizer**

Create `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/identity-normalizer.js`:

```js
'use strict';

const fs = require('node:fs');
const { sourceOf } = require('./symbol-inventory');

function loadIdentityMap(filePath) {
  const map = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (map.schemaVersion !== 1) throw new Error(`Unsupported identity map schema: ${filePath}`);
  if (!map.language || !map.track || !map.symbols) throw new Error(`Invalid identity map: ${filePath}`);
  return Object.freeze({
    ...map,
    symbols: Object.freeze({ ...map.symbols }),
  });
}

function fallbackIdentity(delta, map) {
  const suffix = delta.symbolIdentity.replace(/\./g, ':');
  return {
    stableId: `${map.language}:${map.defaultCategory}:${suffix}`,
    canonicalSlug: delta.symbolIdentity.replace(/\./g, '-'),
    category: map.defaultCategory,
  };
}

function normalizeDelta(delta, map) {
  const mapped = map.symbols[delta.symbolIdentity];
  const identity = mapped || fallbackIdentity(delta, map);
  const normalized = {
    type: delta.type,
    stableId: identity.stableId,
    canonicalSlug: identity.canonicalSlug,
    symbol: delta.symbolIdentity,
    source: sourceOf(delta.symbol, map.packagePrefix || ''),
    reason: delta.reason,
  };
  if (!mapped) {
    normalized.diagnostic = {
      level: 'warn',
      code: 'UNMAPPED_CANONICAL_IDENTITY',
      message: `No canonical identity mapping for ${delta.symbolIdentity} in ${map.language} ${map.track}.`,
    };
  }
  return normalized;
}

module.exports = {
  loadIdentityMap,
  normalizeDelta,
};
```

- [ ] **Step 5: Run normalizer tests and verify pass**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scope.test.js
```

Expected:

```text
# fail 0
```

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/identity-normalizer.js .claude/skills/sdk-doc-sync/references/identity .claude/skills/sdk-doc-sync/tests/release-scope.test.js
git commit -m "feat: normalize scanner symbols to canonical sdk doc identities"
```

### Task 5: Build The Release-Scout Orchestrator And CLI

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/release-scout.js`
- Create: `.claude/skills/sdk-doc-sync/bin/sdk-release-scout.js`
- Create: `.claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/script-paths.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing orchestrator and CLI tests**

Create `.claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runReleaseScout } = require('../src/sdk-doc-sync/release-scope/release-scout');
const { runCli } = require('../bin/sdk-release-scout');

const fixtureDir = path.join(__dirname, 'fixtures', 'release-scope');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
}

test('runReleaseScout emits the bounded Python v2.6 release artifact', async () => {
  const scope = await runReleaseScout({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    scanState: { python: { lastScannedTag: 'v2.6.12' } },
    targetTag: 'v2.6.17',
    publicRoots: ['pymilvus/'],
    identityMapPath: path.join(__dirname, '..', 'references', 'identity', 'python-v26.json'),
    baselineSymbols: fixture('python-v26-scanned-baseline.json'),
    targetSymbols: fixture('python-v26-scanned-target.json'),
    runGit(args) {
      const key = args.join(' ');
      return {
        'rev-list -n 1 v2.6.17': '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4\n',
        'show -s --format=%cI v2.6.17': '2026-07-15T16:32:32+08:00\n',
        'diff --name-only v2.6.12..v2.6.17': 'pymilvus/client/field_ops.py\npymilvus/milvus_client/milvus_client.py\n',
      }[key];
    },
  });

  assert.equal(scope.approvalGrade, true);
  assert.equal(scope.writesPerformed, false);
  assert.equal(scope.scanStateUpdated, false);
  assert.deepEqual(scope.actions.map((action) => [action.type, action.stableId]), [
    ['UPDATE', 'python:Management:compact'],
    ['CREATE', 'python:Vector:FieldOp'],
  ]);
});

test('sdk-release-scout CLI writes JSON and does not print raw scanner dumps', async () => {
  const stdout = [];
  const stderr = [];
  const writes = [];
  const result = await runCli({
    argv: [
      'node',
      'sdk-release-scout',
      '--language',
      'python',
      '--sdk-name',
      'pymilvus',
      '--track',
      'v2.6.x',
      '--target-tag',
      'v2.6.17',
      '--json',
      '--output',
      '/tmp/python-v26-release-scope.json',
    ],
    dependencies: {
      loadScanState() { return { python: { lastScannedTag: 'v2.6.12' } }; },
      runReleaseScout: async () => ({
        schemaVersion: 1,
        language: 'python',
        sdkName: 'pymilvus',
        track: 'v2.6.x',
        baselineTag: 'v2.6.12',
        targetTag: 'v2.6.17',
        targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
        targetDate: '2026-07-15T08:32:32.000Z',
        releaseRange: 'v2.6.12..v2.6.17',
        approvalGrade: true,
        changedFiles: [],
        actions: [],
        scannerDiagnostics: [],
        writesPerformed: false,
        scanStateUpdated: false,
      }),
      writeFile(file, content) { writes.push([file, JSON.parse(content)]); },
      onStdout(line) { stdout.push(line); },
      onStderr(line) { stderr.push(line); },
    },
  });

  assert.equal(result.targetTag, 'v2.6.17');
  assert.deepEqual(stderr, []);
  assert.equal(writes[0][0], '/tmp/python-v26-release-scope.json');
  assert.match(stdout.join('\n'), /"approvalGrade": true/);
  assert.doesNotMatch(stdout.join('\n'), /"scanned": \[/);
});
```

- [ ] **Step 2: Run CLI tests and verify failure**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js
```

Expected failure includes:

```text
Cannot find module '../src/sdk-doc-sync/release-scope/release-scout'
```

- [ ] **Step 3: Implement release-scout library**

Create `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/release-scout.js`:

```js
'use strict';

const path = require('node:path');

const PythonScanner = require('../scanners/python-scanner');
const { createReleaseScope, validateReleaseScope } = require('./schema');
const { resolveReleaseRange, changedFilesInRange } = require('./git-range');
const { classifySymbolDeltas, filterSymbolsByChangedFiles } = require('./symbol-inventory');
const { loadIdentityMap, normalizeDelta } = require('./identity-normalizer');

function scannerFor(language, sdkDir) {
  if (language === 'python') return new PythonScanner({ rootDir: sdkDir, publicOnly: true });
  throw new Error(`Release scout scanner is not configured for ${language}`);
}

async function scanSymbols({ scanner, sdkDir, language }) {
  const resolvedScanner = scanner || scannerFor(language, sdkDir);
  return await resolvedScanner.scan();
}

async function runReleaseScout({
  language,
  sdkName,
  track,
  scanState,
  targetTag = null,
  sdkDir = null,
  repoDir = null,
  publicRoots = [],
  identityMapPath,
  baselineSymbols = null,
  targetSymbols = null,
  baselineScanner = null,
  targetScanner = null,
  runGit,
} = {}) {
  const range = resolveReleaseRange({
    languageKey: language,
    sdkName,
    track,
    scanState,
    targetTag,
    runGit,
    cwd: repoDir,
  });
  if (range.noChanges) {
    return createReleaseScope({
      ...range,
      changedFiles: [],
      actions: [],
      scannerDiagnostics: [{ level: 'info', code: 'NO_RELEASE_CHANGES', message: `${language} is already scanned at ${range.targetTag}.` }],
    });
  }

  const changedFiles = changedFilesInRange({
    baselineTag: range.baselineTag,
    targetTag: range.targetTag,
    publicRoots,
    runGit,
    cwd: repoDir,
  });
  const map = loadIdentityMap(identityMapPath);
  const baseline = baselineSymbols || await scanSymbols({ scanner: baselineScanner, sdkDir, language });
  const target = targetSymbols || await scanSymbols({ scanner: targetScanner, sdkDir, language });
  const scopedTarget = filterSymbolsByChangedFiles({
    symbols: target,
    changedFiles,
    sdkPackagePrefix: map.packagePrefix || '',
  });
  const scopedIdentities = new Set(scopedTarget.map((symbol) => symbol.parentClass ? `${symbol.parentClass}.${symbol.name}` : symbol.name));
  const deltas = classifySymbolDeltas({ baseline, target })
    .filter((delta) => scopedIdentities.has(delta.symbolIdentity));

  const normalized = deltas.map((delta) => normalizeDelta(delta, map));
  const actions = normalized.map(({ diagnostic, ...action }) => action);
  const scannerDiagnostics = [
    { level: 'warn', code: 'FULL_SCAN_DIAGNOSTIC_ONLY', message: `Full scanner output is not approval-grade for ${language} ${track}.` },
    ...normalized.map((item) => item.diagnostic).filter(Boolean),
  ];
  const scope = createReleaseScope({
    ...range,
    changedFiles,
    actions,
    scannerDiagnostics,
  });
  const validation = validateReleaseScope(scope);
  if (!validation.valid) {
    throw new Error(`Invalid release scope: ${JSON.stringify(validation.errors)}`);
  }
  return scope;
}

function defaultIdentityMapPath({ skillRoot, language, track }) {
  if (language === 'python' && track === 'v2.6.x') {
    return path.join(skillRoot, 'references', 'identity', 'python-v26.json');
  }
  throw new Error(`No default identity map for ${language} ${track}`);
}

module.exports = {
  runReleaseScout,
  defaultIdentityMapPath,
};
```

- [ ] **Step 4: Implement release-scout CLI**

Create `.claude/skills/sdk-doc-sync/bin/sdk-release-scout.js`:

```js
#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { stableReleaseScopeJson } = require('../src/sdk-doc-sync/release-scope/schema');
const { runReleaseScout: defaultRunReleaseScout, defaultIdentityMapPath } = require('../src/sdk-doc-sync/release-scope/release-scout');

const SKILL_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--language') args.language = argv[++i];
    else if (arg === '--sdk-name') args.sdkName = argv[++i];
    else if (arg === '--track') args.track = argv[++i];
    else if (arg === '--sdk-dir') args.sdkDir = argv[++i];
    else if (arg === '--repo-dir') args.repoDir = argv[++i];
    else if (arg === '--target-tag') args.targetTag = argv[++i];
    else if (arg === '--identity-map') args.identityMapPath = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function printUsage(out = console.log) {
  out(`Usage: sdk-release-scout --language <lang> --sdk-name <name> --track <vX.Y.x> [--target-tag <tag>] [--output <file>] [--json]`);
}

function loadScanState() {
  return JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'scan-state.json'), 'utf8'));
}

function defaultsFor(args) {
  if (args.language === 'python') {
    return {
      sdkDir: args.sdkDir || path.join(PROJECT_ROOT, 'repos', 'pymilvus', 'pymilvus'),
      repoDir: args.repoDir || path.join(PROJECT_ROOT, 'repos', 'pymilvus'),
      publicRoots: ['pymilvus/'],
    };
  }
  return {
    sdkDir: args.sdkDir,
    repoDir: args.repoDir,
    publicRoots: [],
  };
}

async function runCli({ argv = process.argv, dependencies = {} } = {}) {
  const args = parseArgs(argv);
  const out = dependencies.onStdout || ((line) => console.log(line));
  const err = dependencies.onStderr || ((line) => console.error(line));
  const writeFile = dependencies.writeFile || ((file, content) => fs.writeFileSync(file, content));
  if (args.help) {
    printUsage(out);
    return null;
  }
  for (const key of ['language', 'sdkName', 'track']) {
    if (!args[key]) {
      err(`Error: --${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)} is required`);
      return null;
    }
  }
  const defaults = defaultsFor(args);
  const identityMapPath = args.identityMapPath || defaultIdentityMapPath({
    skillRoot: SKILL_ROOT,
    language: args.language,
    track: args.track,
  });
  const scope = await (dependencies.runReleaseScout || defaultRunReleaseScout)({
    language: args.language,
    sdkName: args.sdkName,
    track: args.track,
    scanState: dependencies.loadScanState ? dependencies.loadScanState() : loadScanState(),
    targetTag: args.targetTag || null,
    sdkDir: defaults.sdkDir,
    repoDir: defaults.repoDir,
    publicRoots: defaults.publicRoots,
    identityMapPath,
  });
  const json = stableReleaseScopeJson(scope);
  if (args.output) writeFile(args.output, json);
  if (args.json || !args.output) out(json.trimEnd());
  else out(`Release scope written to ${args.output}`);
  return scope;
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  runCli,
};
```

- [ ] **Step 5: Update script-path tests and package script**

In `.claude/skills/sdk-doc-sync/tests/script-paths.test.js`, add this test:

```js
test('sdk-release-scout CLI path exists', () => {
  const skillRoot = path.resolve(__dirname, '..');
  assert.equal(fs.existsSync(path.join(skillRoot, 'bin', 'sdk-release-scout.js')), true);
});
```

In `package.json`, add:

```json
"sdk-doc-sync:release-scout": "node .claude/skills/sdk-doc-sync/bin/sdk-release-scout.js"
```

Keep the JSON comma placement valid within the existing `"scripts"` object.

- [ ] **Step 6: Run release-scout tests and verify pass**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scope.test.js .claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js .claude/skills/sdk-doc-sync/tests/script-paths.test.js
```

Expected:

```text
# fail 0
```

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/release-scout.js .claude/skills/sdk-doc-sync/bin/sdk-release-scout.js .claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js .claude/skills/sdk-doc-sync/tests/script-paths.test.js package.json
git commit -m "feat: add deterministic sdk release scout command"
```

### Task 6: Make `sdk-doc-sync` Consume Release Scope

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js`
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/index.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js`

- [ ] **Step 1: Write failing scoped dry-run CLI tests**

Append to `.claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js`:

```js
test('schema-first CLI filters scanned symbols through release scope', async () => {
  const stdout = [];
  const scope = {
    schemaVersion: 1,
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    releaseRange: 'v2.6.12..v2.6.17',
    approvalGrade: true,
    changedFiles: ['pymilvus/milvus_client/milvus_client.py'],
    actions: [{
      type: 'UPDATE',
      stableId: 'python:Management:compact',
      canonicalSlug: 'Management-compact',
      symbol: 'MilvusClient.compact',
      source: { file: 'pymilvus/milvus_client/milvus_client.py', line: 1835 },
      reason: 'signature changed',
    }],
    scannerDiagnostics: [],
    writesPerformed: false,
    scanStateUpdated: false,
  };
  const result = await runCli({
    argv: [
      'node',
      'sdk-doc-sync',
      '--sdk-dir',
      '/fixtures/sdk',
      '--language',
      'python',
      '--sdk-name',
      'pymilvus',
      '--sdk-version',
      'v2.6.x',
      '--release-scope',
      '/tmp/release-scope.json',
      '--dry-run',
      '--json',
    ],
    env: { BASE_TOKEN: 'base-v26', ROOT_TOKEN: 'root-v26' },
    dependencies: {
      loadEnv: false,
      readFile(file) {
        assert.equal(file, path.resolve('/tmp/release-scope.json'));
        return JSON.stringify(scope);
      },
      scanner: {
        rootDir: '/fixtures/sdk',
        async scan() {
          return [
            fixture('python-search.json'),
            {
              name: 'compact',
              kind: 'method',
              parentClass: 'MilvusClient',
              filePath: 'milvus_client/milvus_client.py',
              lineNumber: 1835,
              signature: 'def compact(self, collection_name: str, target_size: Optional[int] = None) -> int:',
              params: [],
              returnType: 'int',
              decorators: [],
            },
          ];
        },
      },
      indexReader: async () => [{
        id: 'rec-compact',
        metadata: {
          slug: 'Management-compact',
          description: 'Old compact description.',
          token: 'doc-compact',
          version: 'v2.6.x',
          folderToken: 'folder-management',
        },
      }],
      referenceContextProvider: () => sdkContext('python'),
      onStdout: (line) => stdout.push(line),
    },
  });

  assert.equal(result.scanned.length, 1);
  assert.equal(result.scanned[0].name, 'compact');
  assert.equal(result.diff[0].slug, 'Management-compact');
  assert.match(stdout.join('\n'), /"releaseScope"/);
});
```

- [ ] **Step 2: Run the scoped dry-run test and verify failure**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js
```

Expected failure mentions that `--release-scope` is ignored or scanned length is `2`.

- [ ] **Step 3: Extend CLI argument parsing**

In `.claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js`, update `parseArgs()` with:

```js
        } else if (arg === '--release-scope' && argv[i + 1]) {
            args.releaseScope = argv[++i];
        } else if (arg === '--changed-only') {
            args.changedOnly = true;
        } else if (arg === '--summary-json' && argv[i + 1]) {
            args.summaryJson = argv[++i];
```

Update `printUsage()` options with:

```text
  --release-scope <file>           Release-scout JSON artifact for approval-grade scoped planning
  --changed-only                   Require release scope and scan only release-scoped symbols
  --summary-json <file>            Write bounded run summary JSON to a file
```

- [ ] **Step 4: Load and validate release scope in the CLI**

In `.claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js`, add imports:

```js
const { validateReleaseScope } = require('../src/sdk-doc-sync/release-scope/schema');
```

Inside `runCli()`, after `const args = parseArgs(argv);`, add:

```js
    const readFile = dependencies.readFile || ((file) => fs.readFileSync(file, 'utf8'));
    let releaseScope = null;
    if (args.releaseScope) {
        const releaseScopePath = path.resolve(args.releaseScope);
        releaseScope = JSON.parse(readFile(releaseScopePath));
        const validation = validateReleaseScope(releaseScope);
        if (!validation.valid) {
            err(`Error: invalid --release-scope: ${JSON.stringify(validation.errors)}`);
            exit(1);
            return null;
        }
        if (releaseScope.approvalGrade !== true) {
            err('Error: --release-scope must be approvalGrade=true');
            exit(1);
            return null;
        }
    }
    if (args.changedOnly && !releaseScope) {
        err('Error: --changed-only requires --release-scope');
        exit(1);
        return null;
    }
```

Pass `releaseScope` into `new SdkDocSync({ ... })`:

```js
        releaseScope,
```

- [ ] **Step 5: Filter scanned symbols inside `SdkDocSync`**

In `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/index.js`, add constructor field:

```js
        releaseScope = null,
```

and assign:

```js
        this.releaseScope = releaseScope;
```

Add helper methods to the class:

```js
    _symbolDisplayName(symbol) {
        return symbol.parentClass ? `${symbol.parentClass}.${symbol.name}` : symbol.name;
    }

    _filterByReleaseScope(symbols) {
        if (!this.releaseScope) return symbols;
        const allowed = new Set(this.releaseScope.actions.map((action) => action.symbol));
        return symbols.filter((symbol) => allowed.has(this._symbolDisplayName(symbol)));
    }
```

In `run()`, after scanner scan:

```js
        result.scanned = this._filterByReleaseScope(await this.scanner.scan());
        if (this.releaseScope) {
            result.releaseScope = {
                baselineTag: this.releaseScope.baselineTag,
                targetTag: this.releaseScope.targetTag,
                releaseRange: this.releaseScope.releaseRange,
                approvalGrade: this.releaseScope.approvalGrade,
                actionCount: this.releaseScope.actions.length,
            };
        }
```

Remove the older two-line version:

```js
        result.scanned = await this.scanner.scan();
```

- [ ] **Step 6: Apply canonical slugs from release scope before diffing**

In `SdkDocSync.run()`, before `result.diff = this.diffEngine.diff(...)`, add:

```js
        const scopedCategoryMap = this.releaseScope
            ? Object.fromEntries(this.releaseScope.actions.map((action) => [
                action.symbol.replace('.', '-'),
                action.canonicalSlug,
            ]))
            : null;
        if (scopedCategoryMap) {
            this.diffEngine.categoryMap = { ...this.diffEngine.categoryMap, ...scopedCategoryMap };
            this.diffEngine._categoryMapLower = Object.fromEntries(
                Object.entries(this.diffEngine.categoryMap).map(([key, value]) => [key.toLowerCase(), value]),
            );
        }
```

- [ ] **Step 7: Run scoped CLI tests and verify pass**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js
```

Expected:

```text
# fail 0
```

- [ ] **Step 8: Commit**

```bash
git add .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js .claude/skills/sdk-doc-sync/src/sdk-doc-sync/index.js .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js
git commit -m "feat: scope sdk doc sync dry-runs with release scout artifacts"
```

### Task 7: Add Replayable Agent Harness Tests

**Files:**
- Create: `.claude/skills/sdk-doc-sync/tests/agent-harness.test.js`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/release-scope/python-v26-agent-case.json`
- Modify: `.claude/skills/sdk-doc-sync/tests/script-paths.test.js`

- [ ] **Step 1: Create the agent case fixture**

Create `.claude/skills/sdk-doc-sync/tests/fixtures/release-scope/python-v26-agent-case.json`:

```json
{
  "schemaVersion": 1,
  "prompt": "Use $sdk-doc-sync to find the latest changes in python 2.6.x",
  "requiredCommands": [
    "sdk-release-scout",
    "sdk-doc-sync --release-scope"
  ],
  "expected": {
    "baselineTag": "v2.6.12",
    "targetTag": "v2.6.17",
    "approvalGrade": true,
    "writesPerformed": false,
    "scanStateUpdated": false,
    "stableIds": [
      "python:Management:compact",
      "python:Vector:FieldOp"
    ]
  }
}
```

- [ ] **Step 2: Write agent harness tests**

Create `.claude/skills/sdk-doc-sync/tests/agent-harness.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateReleaseScope } = require('../src/sdk-doc-sync/release-scope/schema');

const fixtureDir = path.join(__dirname, 'fixtures', 'release-scope');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
}

function validateAgentArtifact({ caseFixture, releaseScope, commandLog }) {
  const errors = [];
  const scopeValidation = validateReleaseScope(releaseScope);
  if (!scopeValidation.valid) errors.push(...scopeValidation.errors.map((error) => error.message));
  for (const required of caseFixture.requiredCommands) {
    if (!commandLog.some((command) => command.includes(required))) {
      errors.push(`missing command: ${required}`);
    }
  }
  if (releaseScope.baselineTag !== caseFixture.expected.baselineTag) errors.push('baselineTag mismatch');
  if (releaseScope.targetTag !== caseFixture.expected.targetTag) errors.push('targetTag mismatch');
  if (releaseScope.approvalGrade !== caseFixture.expected.approvalGrade) errors.push('approvalGrade mismatch');
  if (releaseScope.writesPerformed !== false) errors.push('writesPerformed must be false');
  if (releaseScope.scanStateUpdated !== false) errors.push('scanStateUpdated must be false');
  const stableIds = releaseScope.actions.map((action) => action.stableId);
  assert.deepEqual(stableIds, caseFixture.expected.stableIds);
  return { valid: errors.length === 0, errors };
}

test('agent harness accepts bounded release-scout artifact and command trace', () => {
  const caseFixture = readJson('python-v26-agent-case.json');
  const releaseScope = readJson('python-v26-expected.json');
  const validation = validateAgentArtifact({
    caseFixture,
    releaseScope,
    commandLog: [
      'node .claude/skills/sdk-doc-sync/bin/sdk-release-scout.js --language python --sdk-name pymilvus --track v2.6.x --json --output tmp/python-v26.json',
      'node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js --release-scope tmp/python-v26.json --dry-run --json',
    ],
  });
  assert.deepEqual(validation, { valid: true, errors: [] });
});

test('agent harness rejects full scanner dumps as final artifacts', () => {
  const caseFixture = readJson('python-v26-agent-case.json');
  const releaseScope = {
    scanned: [{ name: 'compact' }],
    diff: [],
    plans: [],
  };
  const validation = validateAgentArtifact({
    caseFixture,
    releaseScope,
    commandLog: ['node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js --dry-run --json'],
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes('missing command: sdk-release-scout')));
});
```

- [ ] **Step 3: Update script-path test list**

In `.claude/skills/sdk-doc-sync/tests/script-paths.test.js`, add this file to the `--list` expected output in sorted order:

```text
.claude/skills/sdk-doc-sync/tests/agent-harness.test.js
```

It should appear before `bitable-repository.test.js`.

- [ ] **Step 4: Run agent harness tests and verify pass**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/agent-harness.test.js .claude/skills/sdk-doc-sync/tests/script-paths.test.js
```

Expected:

```text
# fail 0
```

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/sdk-doc-sync/tests/agent-harness.test.js .claude/skills/sdk-doc-sync/tests/fixtures/release-scope/python-v26-agent-case.json .claude/skills/sdk-doc-sync/tests/script-paths.test.js
git commit -m "test: add replayable sdk doc sync agent harness"
```

### Task 8: Update Skill And Operational Documentation

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/SKILL.md`
- Modify: `.claude/skills/sdk-doc-sync/references/cli.md`
- Modify: `.claude/skills/sdk-doc-sync/docs/development/integration-testing.md`
- Modify: `.claude/skills/sdk-doc-sync/sdk-python.md`

- [ ] **Step 1: Update `SKILL.md` workflow**

In `.claude/skills/sdk-doc-sync/SKILL.md`, replace the current “Check Scan State” and “Diff The Release” steps with:

```markdown
### 1. Create The Release Scope

1. Read `scan-state.json`.
2. Run `sdk-release-scout` for SDK release requests before any full scanner dry-run.
3. Treat the release-scout JSON as the only approval-grade release discovery artifact.
4. Stop with a no-change report when `scannerDiagnostics` includes `NO_RELEASE_CHANGES`.

Example:

```bash
node .claude/skills/sdk-doc-sync/bin/sdk-release-scout.js \
  --language python \
  --sdk-name pymilvus \
  --track v2.6.x \
  --json \
  --output tmp/sdk-release-scout/python-v26.json
```

The artifact must validate with `schemaVersion: 1`, `approvalGrade: true`, `writesPerformed: false`, and `scanStateUpdated: false`. Do not ask for approval when this artifact is absent, invalid, or diagnostic-only.

### 2. Run A Scoped Dry-Run

Use the release-scout artifact to constrain the scanner and canonical slugs:

```bash
BASE_TOKEN=<base-token> ROOT_TOKEN=<folder-token> \
node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js \
  --language python \
  --sdk-dir repos/pymilvus/pymilvus \
  --sdk-name pymilvus \
  --sdk-version v2.6.x \
  --release-scope tmp/sdk-release-scout/python-v26.json \
  --dry-run \
  --json
```

Full-package dry-runs are diagnostic health checks only. They are not approval-grade release plans.
```

- [ ] **Step 2: Update CLI reference**

In `.claude/skills/sdk-doc-sync/references/cli.md`, add a “Release Scout” section:

```markdown
## Release Scout

Run release scout before approval-grade SDK release scans:

```bash
node .claude/skills/sdk-doc-sync/bin/sdk-release-scout.js \
  --language python \
  --sdk-name pymilvus \
  --track v2.6.x \
  --json \
  --output tmp/sdk-release-scout/python-v26.json
```

Then run the scoped sync dry-run:

```bash
BASE_TOKEN=<base-token> ROOT_TOKEN=<folder-token> \
node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js \
  --language python \
  --sdk-dir repos/pymilvus/pymilvus \
  --sdk-name pymilvus \
  --sdk-version v2.6.x \
  --release-scope tmp/sdk-release-scout/python-v26.json \
  --dry-run \
  --json
```
```

- [ ] **Step 3: Update validation guide**

In `.claude/skills/sdk-doc-sync/docs/development/integration-testing.md`, add the new focused checks:

```markdown
Release-scope harness checks:

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scope.test.js
node --test .claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js
node --test .claude/skills/sdk-doc-sync/tests/agent-harness.test.js
```

These tests verify deterministic release-scout artifacts, scoped scanner use, canonical identity mapping, and rejection of raw full-scan dumps as final approval artifacts.
```

- [ ] **Step 4: Update Python reference**

In `.claude/skills/sdk-doc-sync/sdk-python.md`, add under the v2.6.x scanner identity notes:

```markdown
- The executable canonical map is `references/identity/python-v26.json`. Update that file and its release-scope golden tests when adding or correcting category mappings. Do not rely on prose-only slug examples for deterministic release plans.
```

- [ ] **Step 5: Run documentation/path tests**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/script-paths.test.js
npm run validate:skills
```

Expected:

```text
# fail 0
```

and:

```text
Skill validation passed
```

If `validate:skills` prints a different success line, require exit code `0` and no diagnostics containing `sdk-doc-sync`.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/sdk-doc-sync/SKILL.md .claude/skills/sdk-doc-sync/references/cli.md .claude/skills/sdk-doc-sync/docs/development/integration-testing.md .claude/skills/sdk-doc-sync/sdk-python.md
git commit -m "docs: require release-scout artifacts for sdk doc sync"
```

### Task 9: Final Offline Verification Gate

**Files:**
- Modify only if a prior task exposes a broken test expectation.

- [ ] **Step 1: Run focused deterministic harness checks**

Run:

```bash
node --test \
  .claude/skills/sdk-doc-sync/tests/release-scope.test.js \
  .claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js \
  .claude/skills/sdk-doc-sync/tests/agent-harness.test.js \
  .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js
```

Expected:

```text
# fail 0
```

- [ ] **Step 2: Run SDK sync suite**

Run:

```bash
node .claude/skills/sdk-doc-sync/tests/run-all.js
```

Expected:

```text
# fail 0
```

- [ ] **Step 3: Run repository validation**

Run:

```bash
npm test
```

Expected:

```text
All test groups passed
```

If the aggregate runner uses native `node:test` output instead, require process exit code `0` and no failing test groups.

- [ ] **Step 4: Inspect mutation boundaries**

Run:

```bash
rg -n "writesPerformed|scanStateUpdated|approvalGrade|release-scope|sdk-release-scout" .claude/skills/sdk-doc-sync
```

Expected:

```text
.claude/skills/sdk-doc-sync/SKILL.md
.claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js
.claude/skills/sdk-doc-sync/bin/sdk-release-scout.js
.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/schema.js
.claude/skills/sdk-doc-sync/tests/agent-harness.test.js
.claude/skills/sdk-doc-sync/tests/release-scope.test.js
.claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js
```

Additional matches in fixture JSON and documentation are acceptable. No match should show live writes or `scan-state.json` mutation from release-scout code.

- [ ] **Step 5: Commit final fixes if any**

If Step 1, 2, 3, or 4 required fixes:

```bash
git add .claude/skills/sdk-doc-sync package.json docs/superpowers/plans/2026-07-18-deterministic-sdk-doc-sync-agent-harness.md
git commit -m "test: verify deterministic sdk doc sync harness"
```

If no fixes were needed, do not create an empty commit.

## Self-Review

Spec coverage:
- Deterministic release discovery is covered by Tasks 2 and 5.
- Structured, schema-validated output is covered by Task 1.
- Canonical identity normalization is covered by Task 4.
- Scoped dry-run behavior is covered by Task 6.
- Replayable agent behavior is covered by Task 7.
- Skill and operational guidance are covered by Task 8.
- CI/offline verification gates are covered by Task 9.

Placeholder scan:
- The plan contains no placeholder markers or unspecified implementation steps.
- Each code-changing step includes concrete code or exact replacement text.

Type consistency:
- `ReleaseScope` fields are consistent across schema, fixtures, CLI, and agent harness.
- `stableId`, `canonicalSlug`, `symbol`, and `source` names are consistent across release-scout and scoped sync.
