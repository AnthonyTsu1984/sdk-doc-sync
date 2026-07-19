# SDK Doc Sync Placement Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent approval-ready SDK sync plans from being produced when UPDATE candidates lack verified current document placement.

**Architecture:** Add a deterministic current-placement artifact between grouping review and reviewed planning. The reviewed-context builder must consume that artifact and refuse to emit approval-ready scope when any UPDATE lacks verified current version, folder ancestry, and shared-token classification.

**Tech Stack:** Node.js CommonJS, `node:test`, existing Feishu API helpers, existing sdk-doc-sync release-scope and planning modules.

---

## File Structure

- Modify: `.claude/skills/sdk-doc-sync/scripts/build-reviewed-release-context.js`
  - Enforce verified UPDATE placement evidence.
  - Consume placement audit entries keyed by record ID or document token.
  - Populate `planningContext.current` and `tokenReferencedByOlderVersions` only from verified placement evidence.
- Create: `.claude/skills/sdk-doc-sync/scripts/build-current-placement-audit.js`
  - Read a grouping proposal or candidate spec plus Bitable records.
  - Fetch Drive folder listings under the target version root.
  - Classify every existing document token as `current_version_local`, `inherited_from_previous_version`, or `unverified`.
  - Write `tmp/sdk-release-scout/<language>-<track>-placement-audit.json`.
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js`
  - Reject UPDATE planning when current placement is unverified, instead of silently selecting `COPY_PATCH_AND_REPOINT`.
- Modify: `.claude/skills/sdk-doc-sync/tests/release-scope.test.js`
  - Add tests for placement-audit enforcement in `buildReviewedReleaseContext`.
- Modify: `.claude/skills/sdk-doc-sync/tests/sync-planner.test.js`
  - Add tests that UPDATE with unknown current version/folder is a planning error.
- Modify: `.claude/skills/sdk-doc-sync/SKILL.md`
  - Add Phase 3 rule: do not produce approval TSV until the placement audit is complete and all UPDATE candidates are classified.

## Task 1: Mark Current Artifacts As Not Approval-Ready

**Files:**
- Modify: `tmp/sdk-release-scout/python-v26-user-facing-dryrun-summary.json`
- Modify: `tmp/sdk-release-scout/python-v26-user-facing-dryrun-full.json`
- Modify: `tmp/sdk-release-scout/python-v26-approval-actions.tsv`

- [ ] **Step 1: Move stale approval TSV aside**

Run:

```bash
mv tmp/sdk-release-scout/python-v26-approval-actions.tsv tmp/sdk-release-scout/python-v26-approval-actions.stale.tsv
```

Expected: `tmp/sdk-release-scout/python-v26-approval-actions.tsv` no longer exists.

- [ ] **Step 2: Write a stale marker file**

Create `tmp/sdk-release-scout/python-v26-planning-blocked.json`:

```json
{
  "status": "planning_blocked",
  "reason": "Current document placement was not verified for every UPDATE candidate.",
  "invalidatedArtifacts": [
    "tmp/sdk-release-scout/python-v26-user-facing-dryrun-summary.json",
    "tmp/sdk-release-scout/python-v26-user-facing-dryrun-full.json",
    "tmp/sdk-release-scout/python-v26-approval-actions.stale.tsv"
  ],
  "requiredRecovery": "Run current placement audit, rebuild reviewed context, rerun scoped dry-run, and create a new approval TSV only when every UPDATE has verified source.version and source.folderToken."
}
```

- [ ] **Step 3: Verify stale approval table is not present**

Run:

```bash
test ! -f tmp/sdk-release-scout/python-v26-approval-actions.tsv
```

Expected: command exits `0`.

## Task 2: Add Planner Guard For Unknown UPDATE Placement

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/sync-planner.test.js`

- [ ] **Step 1: Write failing planner test**

Add this test after `SyncPlanner rejects UPDATE without existing release record and document token evidence`:

```js
test('SyncPlanner rejects UPDATE with unknown current document placement', () => {
  const planner = new SyncPlanner();
  const base = planningContext();

  assert.throws(
    () => planner.planAction(updateAction(), planningContext({
      current: {
        ...base.current,
        version: null,
        folderToken: null,
        placementVerified: false,
      },
    })),
    (error) => error.code === 'UPDATE_PLACEMENT_REQUIRED'
      && /requires verified current document placement/.test(error.message),
  );
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
node .claude/skills/sdk-doc-sync/tests/sync-planner.test.js
```

Expected: FAIL because `UPDATE_PLACEMENT_REQUIRED` is not implemented.

- [ ] **Step 3: Implement the planner guard**

In `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js`, after the existing `UPDATE_SOURCE_REQUIRED` block, add:

```js
    if (diffAction === 'UPDATE' && (
      !nonEmptyString(source.version)
      || !nonEmptyString(source.folderToken)
      || currentProof.placementVerified !== true
    )) {
      throw new SyncPlanningError(
        'UPDATE_PLACEMENT_REQUIRED',
        `UPDATE ${stableId} requires verified current document placement before planning`,
        {
          version: source.version || null,
          folderToken: source.folderToken || null,
          placementVerified: currentProof.placementVerified === true,
        },
      );
    }
```

- [ ] **Step 4: Preserve existing safe UPDATE behavior**

In the same file, update the `safeInPlace` predicate from:

```js
          && currentProof.ancestryVerified === true
```

to:

```js
          && currentProof.ancestryVerified === true
          && currentProof.placementVerified === true
```

- [ ] **Step 5: Update planner fixture helper**

In `.claude/skills/sdk-doc-sync/tests/sync-planner.test.js`, find the `planningContext` helper and ensure its default `current` includes:

```js
placementVerified: true,
```

- [ ] **Step 6: Run planner tests**

Run:

```bash
node .claude/skills/sdk-doc-sync/tests/sync-planner.test.js
```

Expected: PASS.

## Task 3: Require Placement Evidence In Reviewed Context

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/scripts/build-reviewed-release-context.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/release-scope.test.js`

- [ ] **Step 1: Write failing context-builder test**

Add this test near the other `buildReviewedReleaseContext` tests:

```js
test('reviewed release context builder rejects UPDATE without verified current placement', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/bulk_writer/bulk_import.py'],
    actions: [{
      type: 'UPDATE',
      stableId: 'python:BulkImport:list_import_jobs',
      canonicalSlug: 'list_import_jobs',
      symbol: 'list_import_jobs',
      source: { file: 'pymilvus/bulk_writer/bulk_import.py', line: 314 },
      reason: 'signature changed',
    }],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { BulkImport: 'bulk-folder-v26' },
    },
    candidates: {
      list_import_jobs: {
        actionIntent: 'UPDATE',
        category: 'BulkImport',
        docIdentity: {
          stableId: 'python:BulkImport:list_import_jobs',
          canonicalSlug: 'BulkImport-list_import_jobs',
          title: 'list_import_jobs',
        },
        existingRecord: {
          recordId: 'rec-list',
          documentToken: 'doc-list',
          parentRecordId: 'rec-bulk-folder',
        },
        copySource: {
          documentToken: 'doc-list',
          link: 'https://zilliverse.feishu.cn/docx/doc-list',
          title: 'list_import_jobs()',
        },
        summary: 'Lists import jobs with project database filters.',
        example: { code: 'from pymilvus.bulk_writer import list_import_jobs' },
      },
    },
  };

  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference: '' }),
    /verified current placement is required for UPDATE python:BulkImport:list_import_jobs/,
  );
});
```

- [ ] **Step 2: Run failing release-scope test**

Run:

```bash
node .claude/skills/sdk-doc-sync/tests/release-scope.test.js
```

Expected: FAIL because missing placement is currently accepted.

- [ ] **Step 3: Implement strict UPDATE placement validation**

In `assertExistingRecordEvidence()` in `.claude/skills/sdk-doc-sync/scripts/build-reviewed-release-context.js`, replace the returned object with:

```js
  if (!existing.placement
    || existing.placement.verified !== true
    || !existing.placement.version
    || !existing.placement.folderToken
    || typeof existing.placement.referencedByOlderVersions !== 'boolean') {
    throw new Error(`verified current placement is required for UPDATE ${identity.stableId}`);
  }
  return {
    recordId: existing.recordId,
    documentToken: existing.documentToken,
    parentRecordId: existing.parentRecordId,
    version: existing.placement.version,
    folderToken: existing.placement.folderToken,
    ancestryVerified: true,
    placementVerified: true,
    referencedByOlderVersions: existing.placement.referencedByOlderVersions,
  };
```

- [ ] **Step 4: Wire shared-token status from placement**

In `buildReviewedReleaseContext()`, replace:

```js
        tokenReferencedByOlderVersions: spec.tokenReferencedByOlderVersions ?? planningAction.type === 'UPDATE',
```

with:

```js
        tokenReferencedByOlderVersions: existingRecord?.referencedByOlderVersions ?? false,
```

- [ ] **Step 5: Update existing passing tests**

For every UPDATE candidate fixture in `release-scope.test.js`, change `existingRecord` from:

```js
existingRecord: {
  recordId: 'rec-bulk',
  documentToken: 'doc-bulk',
  parentRecordId: 'rec-folder',
}
```

to:

```js
existingRecord: {
  recordId: 'rec-bulk',
  documentToken: 'doc-bulk',
  parentRecordId: 'rec-folder',
  placement: {
    verified: true,
    version: 'v2.6.x',
    folderToken: 'bulk-folder-v26',
    referencedByOlderVersions: false,
  },
}
```

Use each test’s actual folder token instead of `bulk-folder-v26`.

- [ ] **Step 6: Run release-scope tests**

Run:

```bash
node .claude/skills/sdk-doc-sync/tests/release-scope.test.js
```

Expected: PASS.

## Task 4: Add Current Placement Audit Script

**Files:**
- Create: `.claude/skills/sdk-doc-sync/scripts/build-current-placement-audit.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/script-paths.test.js`

- [ ] **Step 1: Add script path test**

In `.claude/skills/sdk-doc-sync/tests/script-paths.test.js`, add the script name to the required scripts list:

```js
'build-current-placement-audit.js',
```

- [ ] **Step 2: Create CLI skeleton**

Create `.claude/skills/sdk-doc-sync/scripts/build-current-placement-audit.js`:

```js
#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';

function parseArgs(argv = process.argv) {
  const args = {};
  const options = new Set(['--proposal', '--candidate-spec', '--version', '--version-root', '--output']);
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!options.has(key)) throw new Error(`Unknown argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    args[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  for (const key of ['proposal', 'version', 'versionRoot', 'output']) {
    if (!args[key]) throw new Error(`Missing --${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  return args;
}

function tokenFromLink(link) {
  return String(link || '').match(/\/docx\/([^/?#]+)/)?.[1] || '';
}

function proposalEntries(proposal) {
  return (proposal.proposals || [])
    .filter((item) => item.existingBitable?.status === 'matched')
    .map((item) => ({
      proposalId: item.id,
      stableId: item.docIdentity.stableId,
      canonicalSlug: item.docIdentity.canonicalSlug,
      title: item.docIdentity.title,
      recordId: item.existingBitable.recordId,
      documentToken: item.existingBitable.currentDocumentToken || tokenFromLink(item.existingBitable.currentDocsLink),
      targetFolderToken: item.docIdentity.targetFolderToken,
      parentRecordId: item.existingBitable.parentRecordIds?.[0] || null,
    }));
}

async function feishuGet(tokenFetcher, route) {
  const token = await tokenFetcher.token();
  const res = await fetch(`${FEISHU_HOST}${route}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`${route}: ${data.msg}`);
  return data.data;
}

async function listFolder(tokenFetcher, folderToken) {
  const items = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ folder_token: folderToken, page_size: '200' });
    if (pageToken) query.set('page_token', pageToken);
    const data = await feishuGet(tokenFetcher, `/open-apis/drive/v1/files?${query}`);
    items.push(...(data.files || data.items || []));
    pageToken = data.has_more ? (data.next_page_token || data.page_token || '') : '';
  } while (pageToken);
  return items;
}

async function indexVersionRoot(tokenFetcher, rootToken) {
  const byToken = new Map();
  const queue = [{ token: rootToken, ancestors: [rootToken] }];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const item of await listFolder(tokenFetcher, current.token)) {
      const token = item.token || item.file_token;
      const type = item.type || item.file_type;
      if (!token) continue;
      byToken.set(token, {
        token,
        type,
        parentFolderToken: current.token,
        ancestors: current.ancestors,
        name: item.name || item.title || '',
      });
      if (type === 'folder') queue.push({ token, ancestors: [...current.ancestors, token] });
    }
  }
  return byToken;
}

async function main() {
  const args = parseArgs();
  const proposal = JSON.parse(fs.readFileSync(args.proposal, 'utf8'));
  const tokenFetcher = new larkTokenFetcher();
  const index = await indexVersionRoot(tokenFetcher, args.versionRoot);
  const entries = proposalEntries(proposal).map((entry) => {
    const placement = index.get(entry.documentToken);
    const verified = Boolean(placement);
    return {
      ...entry,
      placement: {
        verified,
        status: verified ? 'current_version_local' : 'unverified',
        version: verified ? args.version : null,
        folderToken: placement?.parentFolderToken || null,
        versionRootToken: args.versionRoot,
        referencedByOlderVersions: verified ? false : null,
        ancestry: placement?.ancestors || [],
      },
    };
  });
  const artifact = {
    schemaVersion: 1,
    status: entries.every((entry) => entry.placement.verified) ? 'placement_audit_ready' : 'placement_audit_blocked',
    generatedAt: new Date().toISOString(),
    sourceProposal: args.proposal,
    version: args.version,
    versionRootToken: args.versionRoot,
    entries,
    blocked: entries.filter((entry) => !entry.placement.verified),
    writesPerformed: false,
  };
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({ output: args.output, status: artifact.status, entries: entries.length, blocked: artifact.blocked.length }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
```

- [ ] **Step 3: Run script syntax check**

Run:

```bash
node --check .claude/skills/sdk-doc-sync/scripts/build-current-placement-audit.js
```

Expected: PASS.

## Task 5: Merge Placement Audit Into Candidate Spec

**Files:**
- Modify: `tmp/sdk-release-scout/build-python-v26-reviewed-candidates.js`

- [ ] **Step 1: Add placement audit input**

At the top of `tmp/sdk-release-scout/build-python-v26-reviewed-candidates.js`, add:

```js
const placementAuditPath = 'tmp/sdk-release-scout/python-v26-placement-audit.json';
const placementAudit = fs.existsSync(placementAuditPath)
  ? JSON.parse(fs.readFileSync(placementAuditPath, 'utf8'))
  : null;
const placementByRecordId = new Map((placementAudit?.entries || []).map((entry) => [entry.recordId, entry]));
```

- [ ] **Step 2: Remove manual override list**

Delete:

```js
const currentVersionLocalDocs = {
  'proposal:python:BulkImport:bulk_import': true,
  'proposal:python:BulkImport:get_import_progress': true,
};
```

- [ ] **Step 3: Populate placement from audit**

Replace the current manual `if (currentVersionLocalDocs[item.id])` block with:

```js
    const auditedPlacement = placementByRecordId.get(existing.recordId);
    if (!auditedPlacement || auditedPlacement.placement.verified !== true) {
      throw new Error(`Missing verified placement audit for ${item.id} (${existing.recordId})`);
    }
    spec.existingRecord.placement = {
      verified: true,
      version: auditedPlacement.placement.version,
      folderToken: auditedPlacement.placement.folderToken,
      referencedByOlderVersions: auditedPlacement.placement.referencedByOlderVersions,
    };
```

- [ ] **Step 4: Verify candidate generation blocks without audit**

Run:

```bash
mv tmp/sdk-release-scout/python-v26-placement-audit.json tmp/sdk-release-scout/python-v26-placement-audit.json.bak 2>/dev/null || true
node tmp/sdk-release-scout/build-python-v26-reviewed-candidates.js
```

Expected: FAIL with `Missing verified placement audit`.

## Task 6: Regenerate Python v2.6 Planning Correctly

**Files:**
- Regenerate: `tmp/sdk-release-scout/python-v26-placement-audit.json`
- Regenerate: `tmp/sdk-release-scout/python-v26-candidates.json`
- Regenerate: `tmp/sdk-release-scout/python-v26-user-facing.json`
- Regenerate: `tmp/sdk-release-scout/python-v26-reviewed-context.json`
- Regenerate: `tmp/sdk-release-scout/python-v26-user-facing-dryrun-summary.json`
- Regenerate: `tmp/sdk-release-scout/python-v26-user-facing-dryrun-full.json`
- Regenerate only after validation: `tmp/sdk-release-scout/python-v26-approval-actions.tsv`

- [ ] **Step 1: Run placement audit**

Run:

```bash
node .claude/skills/sdk-doc-sync/scripts/build-current-placement-audit.js \
  --proposal tmp/sdk-release-scout/python-v26-grouping-proposal.json \
  --version v2.6.x \
  --version-root IaWgf4osAlpdwqdVIclct97wnCg \
  --output tmp/sdk-release-scout/python-v26-placement-audit.json
```

Expected: JSON output with `status`. If `blocked > 0`, stop and report `planning_blocked`.

- [ ] **Step 2: Regenerate candidate spec**

Run:

```bash
node tmp/sdk-release-scout/build-python-v26-reviewed-candidates.js
```

Expected: `candidateCount: 25`.

- [ ] **Step 3: Rebuild reviewed context**

Run:

```bash
node .claude/skills/sdk-doc-sync/scripts/build-reviewed-release-context.js \
  --release-scope tmp/sdk-release-scout/python-v26.json \
  --candidate-spec tmp/sdk-release-scout/python-v26-candidates.json \
  --output-scope tmp/sdk-release-scout/python-v26-user-facing.json \
  --output-context tmp/sdk-release-scout/python-v26-reviewed-context.json
```

Expected: `selectedCount: 25`.

- [ ] **Step 4: Rerun scoped dry-run**

Run:

```bash
BASE_TOKEN=J3Qzbv7AWazzivsv7vqcqlGCnFc ROOT_TOKEN=IaWgf4osAlpdwqdVIclct97wnCg \
node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js \
  --language python \
  --sdk-dir repos/pymilvus/pymilvus \
  --sdk-name pymilvus \
  --sdk-version v2.6.x \
  --release-scope tmp/sdk-release-scout/python-v26-user-facing.json \
  --reference-context tmp/sdk-release-scout/python-v26-reviewed-context.json \
  --changed-only \
  --dry-run \
  --summary-json tmp/sdk-release-scout/python-v26-user-facing-dryrun-summary.json \
  --json > tmp/sdk-release-scout/python-v26-user-facing-dryrun-full.json
```

Expected: command exits `0`.

- [ ] **Step 5: Verify no UPDATE has unknown placement**

Run:

```bash
jq -e '[.plans[] | select(.metadata.diffAction=="UPDATE") | select((.source.version == null) or (.source.folderToken == null))] | length == 0' \
  tmp/sdk-release-scout/python-v26-user-facing-dryrun-full.json
```

Expected: `true`.

- [ ] **Step 6: Verify planner counts**

Run:

```bash
jq '{diffCount:(.diff|length), planCount:(.plans|length), planningErrorCount:(.planningErrors|length), counts:(.plans|group_by(.action)|map({action:.[0].action,count:length}))}' \
  tmp/sdk-release-scout/python-v26-user-facing-dryrun-full.json
```

Expected: `diffCount == 25`, `planCount == 25`, `planningErrorCount == 0`. Do not require a specific COPY/UPDATE count; it must come from placement audit evidence.

- [ ] **Step 7: Generate approval TSV only after placement verification**

Run:

```bash
jq -r '.plans[] | [.action,.stableId,.target.folderToken,.source.recordId,.source.documentToken,.metadata.diffAction,.artifactDigest] | @tsv' \
  tmp/sdk-release-scout/python-v26-user-facing-dryrun-full.json \
  > tmp/sdk-release-scout/python-v26-approval-actions.tsv
```

Expected: `wc -l tmp/sdk-release-scout/python-v26-approval-actions.tsv` prints `25`.

## Task 7: Update Skill Instructions

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/SKILL.md`

- [ ] **Step 1: Add placement-audit invariant**

Add this bullet under Non-Negotiable Invariants:

```markdown
- Before Phase 3 approval-ready planning, verify current placement for every UPDATE candidate by resolving the current Docs token's actual Drive ancestry. Do not infer current placement from target folder, Bitable parent, record title, or slug. If any UPDATE has unknown current version, current folder, or shared-token status, report `planning_blocked` and do not generate an approval TSV.
```

- [ ] **Step 2: Add Phase 3 command**

In Phase 3 workflow before `build-reviewed-release-context.js`, add:

```bash
node .claude/skills/sdk-doc-sync/scripts/build-current-placement-audit.js \
  --proposal tmp/sdk-release-scout/python-v26-grouping-proposal.json \
  --version v2.6.x \
  --version-root IaWgf4osAlpdwqdVIclct97wnCg \
  --output tmp/sdk-release-scout/python-v26-placement-audit.json
```

- [ ] **Step 3: Add approval-ready condition**

Append to the approval-ready paragraph:

```markdown
Also verify every UPDATE plan has non-null `source.version`, non-null `source.folderToken`, and placement-derived `SHARED_TOKEN`; any null value is a blocker, not a reason to default to `COPY_PATCH_AND_REPOINT`.
```

## Task 8: Full Verification

**Files:**
- All modified files above.

- [ ] **Step 1: Run targeted unit tests**

Run:

```bash
node .claude/skills/sdk-doc-sync/tests/sync-planner.test.js
node .claude/skills/sdk-doc-sync/tests/release-scope.test.js
node .claude/skills/sdk-doc-sync/tests/script-paths.test.js
```

Expected: all PASS.

- [ ] **Step 2: Run CLI tests if fast enough**

Run:

```bash
node .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js
```

Expected: PASS.

- [ ] **Step 3: Verify no approval TSV is generated from blocked placement**

Run:

```bash
jq -e '.status == "placement_audit_ready"' tmp/sdk-release-scout/python-v26-placement-audit.json
jq -e '[.plans[] | select(.metadata.diffAction=="UPDATE") | select((.source.version == null) or (.source.folderToken == null))] | length == 0' tmp/sdk-release-scout/python-v26-user-facing-dryrun-full.json
```

Expected: both commands print `true`.

- [ ] **Step 4: Report Phase 3 status**

If all checks pass, report `approval_ready` with the regenerated TSV. If any placement audit entry is blocked, report `planning_blocked` with the blocked rows and do not ask for write approval.

## Self-Review

Spec coverage:
- Rejects current unacceptable process: Task 1.
- Adds deterministic placement audit: Task 4.
- Makes missing placement evidence a blocker: Tasks 2 and 3.
- Removes manual row overrides: Task 5.
- Regenerates Python v2.6 plan from evidence: Task 6.
- Updates skill instructions to prevent recurrence: Task 7.
- Verifies the fix: Task 8.

Placeholder scan:
- No `TBD`, `TODO`, `implement later`, or vague test instructions remain.

Type consistency:
- `placement.verified`, `placement.version`, `placement.folderToken`, and `placement.referencedByOlderVersions` are consistently used in audit, candidate spec, reviewed context, and planner context.
