# API Reference Sync REST Track Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `api-reference-sync` with deterministic Milvus REST minor-track scanning, lifecycle analysis, and one review unit per `(versionTrack, endpoint, method)`.

**Architecture:** Add a REST-specific read-only analysis pipeline beside the generic SDK/Feishu planner. It inventories operations and request/response contract elements, compares track snapshots, assigns shared-component changes to affected operations, and emits a canonical grouping manifest and digest. It does not mutate zdoc specs or reuse the Feishu document execution state machine.

**Tech Stack:** Node.js CommonJS, `node:test`, existing OpenAPI scanner, and `doc-ops-core` canonical JSON/digest utilities.

**Approved design:** `/Users/anthony/Documents/projects/zdoc/.claude/superpowers/specs/2026-08-14-milvus-rest-track-publication-design.md`

---

## Task 1: Add strict minor-track primitives

**Files:**
- Create: `.claude/skills/api-reference-sync/src/rest-track/release-track.js`
- Test: `.claude/skills/api-reference-sync/tests/rest-release-track.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const {compareReleaseTracks, normalizeReleaseTrack, parseReleaseTrack} =
  require('../src/rest-track/release-track');

test('normalizes tracks and compares major/minor numerically', () => {
  assert.deepEqual(parseReleaseTrack('v2.6.x'), {major: 2, minor: 6});
  assert.equal(normalizeReleaseTrack('v2.6.x'), '2.6.x');
  assert.equal(compareReleaseTracks('2.10.x', '2.6.x'), 1);
  assert.equal(compareReleaseTracks('3.0.x', '3.0.x'), 0);
});

test('rejects patch and non-track values', () => {
  for (const value of ['2.6.22', '2.6', 'v2.x', 'latest', '']) {
    assert.throws(() => parseReleaseTrack(value), /REST_RELEASE_TRACK_INVALID/);
  }
});
```

- [ ] **Step 2: Verify the test fails**

Run:

```bash
node --test .claude/skills/api-reference-sync/tests/rest-release-track.test.js
```

Expected: FAIL because `release-track.js` does not exist.

- [ ] **Step 3: Implement the public API**

```javascript
'use strict';

const TRACK_PATTERN = /^v?(\d+)\.(\d+)\.x$/u;

function parseReleaseTrack(value) {
  const match = TRACK_PATTERN.exec(String(value || ''));
  if (!match) throw new Error(`REST_RELEASE_TRACK_INVALID: ${JSON.stringify(value)}`);
  return {major: Number(match[1]), minor: Number(match[2])};
}

function normalizeReleaseTrack(value) {
  const {major, minor} = parseReleaseTrack(value);
  return `${major}.${minor}.x`;
}

function compareReleaseTracks(left, right) {
  const a = parseReleaseTrack(left);
  const b = parseReleaseTrack(right);
  return Math.sign(a.major - b.major || a.minor - b.minor);
}

module.exports = {compareReleaseTracks, normalizeReleaseTrack, parseReleaseTrack};
```

- [ ] **Step 4: Run the focused test**

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/api-reference-sync/src/rest-track/release-track.js \
  .claude/skills/api-reference-sync/tests/rest-release-track.test.js
git commit -m "feat(api-reference-sync): parse REST minor tracks"
```

## Task 2: Inventory operations and contract elements

**Files:**
- Create: `.claude/skills/api-reference-sync/src/rest-track/openapi-inventory.js`
- Create: `.claude/skills/api-reference-sync/tests/fixtures/rest-track/2.6.x.json`
- Create: `.claude/skills/api-reference-sync/tests/fixtures/rest-track/3.0.x.json`
- Test: `.claude/skills/api-reference-sync/tests/rest-openapi-inventory.test.js`
- Modify: `.claude/skills/api-reference-sync/src/sdk-doc-sync/scanners/openapi-scanner.js`
- Modify: `.claude/skills/api-reference-sync/tests/scanner-adapters.test.js`

- [ ] **Step 1: Add compact track fixtures**

The `2.6.x` fixture must contain `POST /v2/vectordb/entities/search`, a reusable authorization parameter, `SearchRequest`, `SearchResult`, and a reusable response. Every operation, parameter, reusable schema/response, and schema property carries:

```json
{"x-added-at":"2.6.x","x-last-modified":"2.6.x","x-deprecated-since":null}
```

The `3.0.x` fixture must:

- add `SearchRequest.functionChains` with `x-added-at: 3.0.x`;
- change `SearchResult.id` from integer to string and set its `x-last-modified` to `3.0.x`;
- set the search operation `x-last-modified` to `3.0.x`;
- add `POST /v2/vectordb/file_resources/list` as a new operation.

- [ ] **Step 2: Write failing inventory assertions**

```javascript
const inventory = inventoryOpenApi(readFixture('2.6.x.json'), {
  track: '2.6.x', sourceFile: '2.6.x.json',
});
const unitId = '2.6.x|/v2/vectordb/entities/search|post';
assert.deepEqual([...inventory.operations.keys()], [unitId]);
assert.equal(
  inventory.operations.get(unitId).pointer,
  '#/paths/~1v2~1vectordb~1entities~1search/post',
);
assert.ok(inventory.operations.get(unitId).elements.some(element =>
  element.pointer === '#/components/schemas/SearchRequest/properties/collectionName'));
assert.ok(inventory.operations.get(unitId).componentRefs.includes(
  '#/components/responses/SearchResponse'));
```

Also assert that structural objects such as `content`, `application/json`, and `properties` are not emitted as lifecycle elements.

- [ ] **Step 3: Verify failure**

```bash
node --test .claude/skills/api-reference-sync/tests/rest-openapi-inventory.test.js
```

Expected: FAIL because `inventoryOpenApi` is missing.

- [ ] **Step 4: Implement `inventoryOpenApi(spec, options)`**

Return this interface:

```javascript
{
  track,
  sourceFile,
  operations: Map<unitId, {
    endpoint, method, operationId, pointer, lifecycle,
    elements: Array<{identity, pointer, kind, lifecycle, semantic}>,
    componentRefs: string[]
  }>,
  components: Map<pointer, {semantic, referencedBy: string[]}>
}
```

Requirements:

- escape JSON Pointer segments correctly;
- follow local `$ref` transitively and detect cycles;
- throw `REST_OPENAPI_REF_MISSING` for missing local refs;
- inventory path/query/header/cookie parameters, request fields, response fields, reusable parameters/headers/requestBodies/responses/schemas, and version-sensitive object branches;
- do not inventory scalar enum members or structural containers;
- build `semantic` values without `x-i18n`, examples, or formatting-only authoring metadata.

- [ ] **Step 5: Enrich the existing scanner result**

Add without removing current fields:

```javascript
operationPointer: `#/paths/${escapePointer(operationPath)}/${normalizedMethod}`,
operationId: operation.operationId || `${normalizedMethod}:${operationPath}`,
sourceFile: path.relative(this.rootDir, filePath) || path.basename(filePath),
```

- [ ] **Step 6: Run regressions**

```bash
node --test \
  .claude/skills/api-reference-sync/tests/rest-openapi-inventory.test.js \
  .claude/skills/api-reference-sync/tests/scanner-adapters.test.js
```

Expected: all pass, including existing REST adapter cases.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/api-reference-sync/src/rest-track/openapi-inventory.js \
  .claude/skills/api-reference-sync/src/sdk-doc-sync/scanners/openapi-scanner.js \
  .claude/skills/api-reference-sync/tests/rest-openapi-inventory.test.js \
  .claude/skills/api-reference-sync/tests/scanner-adapters.test.js \
  .claude/skills/api-reference-sync/tests/fixtures/rest-track
git commit -m "feat(api-reference-sync): inventory REST contract elements"
```

## Task 3: Build the per-operation review manifest

**Files:**
- Create: `.claude/skills/api-reference-sync/src/rest-track/review-manifest.js`
- Test: `.claude/skills/api-reference-sync/tests/rest-review-manifest.test.js`

- [ ] **Step 1: Write failing classification tests**

```javascript
const manifest = buildRestReviewManifest({
  tracks: [inventory26, inventory30],
  managedFloor: '2.6.x',
  sourceEvidence: {
    '2.6.x': {repository: 'milvus-io/milvus', revision: 'v2.6.22'},
    '3.0.x': {repository: 'milvus-io/milvus', revision: 'v3.0.0'},
  },
});

assert.deepEqual(manifest.units.map(unit => unit.reviewUnitId), [
  'rest:2.6.x:post:%2Fv2%2Fvectordb%2Fentities%2Fsearch',
  'rest:3.0.x:post:%2Fv2%2Fvectordb%2Fentities%2Fsearch',
  'rest:3.0.x:post:%2Fv2%2Fvectordb%2Ffile_resources%2Flist',
]);
assert.equal(manifest.units[0].action, 'BACKFILL_LIFECYCLE');
assert.equal(manifest.units[1].action, 'UPDATE');
assert.equal(manifest.units[2].action, 'ADD');
```

Assert the 3.0 search unit owns the added request field and modified response field. Assert every shared component appears once in `sharedComponents` and lists every affected operation.

- [ ] **Step 2: Add failing validation cases**

Cover:

- invalid lifecycle format → `REST_LIFECYCLE_INVALID`;
- `x-added-at > x-last-modified` → `REST_LIFECYCLE_ORDER_INVALID`;
- `deprecated: true` with null `x-deprecated-since` → `REST_DEPRECATION_METADATA_MISSING`;
- unowned changed component → `REST_COMPONENT_OWNER_UNKNOWN`;
- duplicate `(track, endpoint, method)` → `REST_REVIEW_UNIT_DUPLICATE`.

- [ ] **Step 3: Implement deterministic construction**

Export:

```javascript
function buildRestReviewManifest({tracks, managedFloor, sourceEvidence})
```

Use this stable top-level shape:

```javascript
{
  schemaVersion: 1,
  managedFloor: '2.6.x',
  tracks: [],
  units: [],
  sharedComponents: [],
  summary: {unitCount: 0, actionCounts: {}},
  manifestDigest: digestSemantic(theManifestWithoutThisField)
}
```

Each unit contains `versionTrack`, `endpoint`, lowercase `method`, action, source evidence, proposed operation lifecycle, sorted contract changes, shared component refs, blockers, and warnings. Sort by numeric track, endpoint, and method. Calculate the digest with `digestSemantic()` before adding `manifestDigest`.

- [ ] **Step 4: Verify deterministic output**

```bash
node --test .claude/skills/api-reference-sync/tests/rest-review-manifest.test.js
```

Expected: all tests pass and two builds are deeply equal with the same digest.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/api-reference-sync/src/rest-track/review-manifest.js \
  .claude/skills/api-reference-sync/tests/rest-review-manifest.test.js
git commit -m "feat(api-reference-sync): build REST review manifests"
```

## Task 4: Add a read-only REST track CLI

**Files:**
- Create: `.claude/skills/api-reference-sync/bin/rest-track-review.js`
- Test: `.claude/skills/api-reference-sync/tests/rest-track-review-cli.test.js`
- Modify: `.claude/skills/api-reference-sync/tests/run-all.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing CLI tests**

Exercise:

```bash
node .claude/skills/api-reference-sync/bin/rest-track-review.js \
  --track-spec 2.6.x=.claude/skills/api-reference-sync/tests/fixtures/rest-track/2.6.x.json \
  --track-spec 3.0.x=.claude/skills/api-reference-sync/tests/fixtures/rest-track/3.0.x.json \
  --source-revision 2.6.x=milvus-io/milvus@v2.6.22 \
  --source-revision 3.0.x=milvus-io/milvus@v3.0.0 \
  --managed-floor 2.6.x \
  --output /tmp/rest-review.json \
  --json
```

Assert exit 0, output-file/stdout equality, unchanged inputs, and a full digest. Assert duplicate tracks, missing source revisions, patch-form tracks, and missing output exit 64.

- [ ] **Step 2: Implement strict parsing and atomic write**

The CLI must accept repeated `--track-spec` and `--source-revision`, require a one-to-one mapping, write `${output}.tmp` then rename after validation, and perform no zdoc or Feishu writes.

- [ ] **Step 3: Register command and test tier**

Add:

```json
"api-reference-sync:rest-review": "node .claude/skills/api-reference-sync/bin/rest-track-review.js"
```

Classify `rest-track-review-cli.test.js` as integration in `tests/run-all.js`.

- [ ] **Step 4: Run tests**

```bash
node --test .claude/skills/api-reference-sync/tests/rest-track-review-cli.test.js
node .claude/skills/api-reference-sync/tests/run-all.js --unit
```

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/api-reference-sync/bin/rest-track-review.js \
  .claude/skills/api-reference-sync/tests/rest-track-review-cli.test.js \
  .claude/skills/api-reference-sync/tests/run-all.js package.json
git commit -m "feat(api-reference-sync): add REST track review CLI"
```

## Task 5: Refresh the skill and REST contract

**Files:**
- Modify: `.claude/skills/api-reference-sync/SKILL.md`
- Modify: `.claude/skills/api-reference-sync/sdk-rest.md`
- Modify: `.claude/skills/api-reference-sync/capabilities.json`
- Create: `.claude/skills/api-reference-sync/tests/rest-skill-contract.test.js`

- [ ] **Step 1: Write a failing contract test**

Assert:

```javascript
assert.match(skill, /\(versionTrack, endpoint, method\)/);
assert.match(rest, /packages\/docs-tooling\/src\/reference\/rest\/meta\/openapi/);
assert.match(rest, /x-added-at/);
assert.match(rest, /x-last-modified/);
assert.match(rest, /x-deprecated-since/);
assert.match(rest, /2\.6\.x/);
assert.match(rest, /3\.0\.x/);
assert.doesNotMatch(rest, /plugins\/apifox-docs\/meta\/openapi/);
```

Parse `capabilities.json` and require `rest.track-scan`, `rest.lifecycle`, and `rest.review-unit`.

- [ ] **Step 2: Add the concise SKILL.md exception**

Add under `Shared Contract`:

```markdown
- REST/OpenAPI review uses one unit per `(versionTrack, endpoint, method)`, not one unit per rendered document. Read `sdk-rest.md` and use the REST track manifest CLI; the generic Feishu document execution state machine does not apply to zdoc spec-file writes.
```

- [ ] **Step 3: Refresh sdk-rest.md**

Document the current zdoc path, Milvus data-plane ownership, separate 2.6/3.0 scans, operation and contract-element lifecycle scope, the managed 2.6 floor, one latest snapshot per minor, retained deprecation, and the exact grouping gate. Remove stale `plugins/apifox-docs` paths.

- [ ] **Step 4: Update capabilities**

Add capability records with fixture IDs matching the new tests:

```json
{"id":"rest.track-scan","description":"Scan Milvus REST minor tracks independently.","fixtureIds":["rest-track-26","rest-track-30"]},
{"id":"rest.lifecycle","description":"Track operation and contract-element lifecycle metadata at minor granularity.","fixtureIds":["rest-lifecycle-fields"]},
{"id":"rest.review-unit","description":"Emit one review unit per version track, endpoint, and method.","fixtureIds":["rest-review-manifest"]}
```

- [ ] **Step 5: Validate**

```bash
node --test .claude/skills/api-reference-sync/tests/rest-skill-contract.test.js
npm run validate:skills
```

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/api-reference-sync/SKILL.md \
  .claude/skills/api-reference-sync/sdk-rest.md \
  .claude/skills/api-reference-sync/capabilities.json \
  .claude/skills/api-reference-sync/tests/rest-skill-contract.test.js
git commit -m "docs(api-reference-sync): define REST track workflow"
```

## Task 6: Produce deterministic fixture evidence

**Files:**
- Generate only: `tmp/rest-track-review/manifest-a.json`
- Generate only: `tmp/rest-track-review/manifest-b.json`

- [ ] **Step 1: Generate the same fixture manifest twice**

Run the Task 4 CLI twice with identical arguments and distinct output names.

- [ ] **Step 2: Prove byte and semantic stability**

```bash
cmp tmp/rest-track-review/manifest-a.json tmp/rest-track-review/manifest-b.json
node .claude/skills/api-reference-sync/scripts/review-artifact-digest.js \
  tmp/rest-track-review/manifest-a.json
```

Expected: `cmp` exits 0 and the script prints a full `sha256:` digest.

- [ ] **Step 3: Run proportional verification**

```bash
node --test \
  .claude/skills/api-reference-sync/tests/rest-release-track.test.js \
  .claude/skills/api-reference-sync/tests/rest-openapi-inventory.test.js \
  .claude/skills/api-reference-sync/tests/rest-review-manifest.test.js \
  .claude/skills/api-reference-sync/tests/rest-track-review-cli.test.js \
  .claude/skills/api-reference-sync/tests/rest-skill-contract.test.js
npm run test:unit
npm run validate:skills
git diff --check
```

- [ ] **Step 4: Handoff without applying production data changes**

Report the worktree, commits, tests, fixture digest, and confirmation that no zdoc fragment, Feishu record, or `scan-state.json` changed. The real-source manifest is produced during the separate bootstrap migration plan.
