# SDK Reference Type Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared documentation-ownership harness and a complete C++ ownership graph so method-owned helper types are embedded in owning API pages and cannot become standalone sibling documents.

**Architecture:** Extend canonical identity normalization with explicit ownership metadata, preserve it through release scope, and enforce it in reviewed-context building and immutable planning. Add a focused C++ type-graph parser that attaches transitive request/response/helper surfaces and source headers to each owning method; existing Reference IR request and result structures render embedded content without changing the shared IR schema or the six unrelated Node.js/IR files already edited in the worktree.

**Tech Stack:** Node.js CommonJS, `node:test`, JSON identity maps, sdk-doc-sync release scope and planner modules, SDK Reference IR.

---

## File Structure

- Create `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/type-ownership.js`: validate ownership declarations, identify ambiguous helper-like symbols, and expand owners.
- Modify `identity-normalizer.js`, `schema.js`, and `release-scout.js`: preserve ownership, fan out helpers, retain changed helper-header evidence, and gate approval.
- Create `scanners/cpp-type-graph.js`; modify `cpp-scanner.js` and `symbol-inventory.js`: derive transitive C++ ownership and detect helper-only changes.
- Modify `adapters/cpp.js`: put nested response/result fields into the existing Reference IR.
- Modify `build-reviewed-release-context.js` and `sync-planner.js`: reject contradictory standalone helper identities.
- Create `scripts/audit-sdk-type-ownership.js`: produce a deterministic read-only cleanup audit.
- Modify C++ identity maps and stable skill references.
- Add focused fixtures and tests.

Do not stage, restore, rewrite, or commit the pre-existing edits to:

- `.claude/skills/sdk-doc-sync/src/renderers/languages/node.js`
- `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/adapters/node.js`
- `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/schema.js`
- `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/validate.js`
- `.claude/skills/sdk-doc-sync/tests/sdk-reference-ir.test.js`
- `.claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js`

### Task 1: Define the shared ownership contract

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/type-ownership.js`
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/identity-normalizer.js`
- Test: `.claude/skills/sdk-doc-sync/tests/release-scope.test.js`

- [ ] **Step 1: Write failing normalization tests**

Add tests for a method-owned helper with one owner and an unmapped helper-like symbol:

```js
test('identity normalizer marks target mappings as method-owned fan-out', () => {
  const map = {
    language: 'cpp', track: 'v3.0.x', defaultCategory: 'Client', packagePrefix: '',
    symbols: {
      OptimizeTask: {
        classification: 'method_owned',
        targets: [{
          stableId: 'cpp:Management:Optimize',
          canonicalSlug: 'Management-Optimize',
          category: 'Management',
        }],
      },
    },
  };
  const [action] = normalizeDeltas({
    type: 'UPDATE',
    symbolIdentity: 'OptimizeTask',
    symbol: {
      name: 'OptimizeTask', kind: 'class',
      filePath: 'src/include/milvus/types/OptimizeTask.h', lineNumber: 12,
    },
    reason: 'public member methods changed',
  }, map);
  assert.deepEqual(action.documentationOwnership, {
    classification: 'method_owned',
    sourceSymbol: 'OptimizeTask',
    owners: [{
      stableId: 'cpp:Management:Optimize',
      canonicalSlug: 'Management-Optimize',
      category: 'Management',
    }],
    selectedOwnerStableId: 'cpp:Management:Optimize',
  });
});

test('identity normalizer blocks unmapped helper-like symbols', () => {
  const map = {
    language: 'cpp', track: 'v3.0.x',
    defaultCategory: 'Client', packagePrefix: '', symbols: {},
  };
  const [action] = normalizeDeltas({
    type: 'CREATE',
    symbolIdentity: 'OptimizeResponse',
    symbol: {
      name: 'OptimizeResponse', kind: 'class',
      filePath: 'src/include/milvus/types/OptimizeResponse.h', lineNumber: 9,
    },
    reason: 'new public class',
  }, map);
  assert.equal(action.documentationOwnership.classification, 'ambiguous');
  assert.equal(action.diagnostic.code, 'AMBIGUOUS_DOCUMENTATION_OWNERSHIP');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scope.test.js
```

Expected: FAIL because ownership metadata and the ambiguity diagnostic do not exist.

- [ ] **Step 3: Implement the ownership module**

Create:

```js
'use strict';

const CLASSIFICATIONS = new Set(['standalone', 'method_owned', 'ambiguous']);
function normalizeOwner(owner) {
  if (!owner || typeof owner !== 'object') {
    throw new TypeError('documentation owner must be an object');
  }
  for (const key of ['stableId', 'canonicalSlug', 'category']) {
    if (typeof owner[key] !== 'string' || owner[key].length === 0) {
      throw new TypeError(`documentation owner ${key} must be a non-empty string`);
    }
  }
  return {
    stableId: owner.stableId,
    canonicalSlug: owner.canonicalSlug,
    category: owner.category,
  };
}

function ownershipFor({ symbolIdentity, symbolKind, mapped }) {
  if (Array.isArray(mapped?.targets)) {
    return {
      classification: mapped.classification || 'method_owned',
      sourceSymbol: symbolIdentity,
      owners: mapped.targets.map(normalizeOwner),
    };
  }
  if (mapped?.classification) {
    if (!CLASSIFICATIONS.has(mapped.classification)) {
      throw new TypeError(`invalid documentation ownership ${mapped.classification}`);
    }
    return {
      classification: mapped.classification,
      sourceSymbol: symbolIdentity,
      owners: (mapped.owners || []).map(normalizeOwner),
    };
  }
  if (!mapped && ['class', 'struct', 'interface'].includes(String(symbolKind).toLowerCase())) {
    return { classification: 'ambiguous', sourceSymbol: symbolIdentity, owners: [] };
  }
  return { classification: 'standalone', sourceSymbol: symbolIdentity, owners: [] };
}

module.exports = { CLASSIFICATIONS, ownershipFor };
```

Update `normalizeDeltas()` so it passes `delta.symbol.kind`, each target action receives the full owners list and its own `selectedOwnerStableId`, and every unmapped class/struct/interface is ambiguous. Methods, functions, commands, and enums may use the existing standalone fallback. Ambiguous types retain a diagnostic and do not become approval-grade fallback identities.

- [ ] **Step 4: Run the test and verify GREEN**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/type-ownership.js \
  .claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/identity-normalizer.js \
  .claude/skills/sdk-doc-sync/tests/release-scope.test.js
git commit -m "feat(sdk-doc-sync): classify documentation ownership"
```

### Task 2: Preserve ownership and helper evidence in release scope

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/schema.js`
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/release-scout.js`
- Test: `.claude/skills/sdk-doc-sync/tests/release-scope.test.js`
- Test: `.claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js`

- [ ] **Step 1: Write failing schema and scout tests**

Validate all three classifications and require complete owners for `method_owned`. Add a scout assertion:

```js
assert.equal(action.documentationOwnership.classification, 'method_owned');
assert.deepEqual(action.evidence.map((item) => item.locator), [
  'src/include/milvus/MilvusClientV2.h:120',
  'src/include/milvus/types/OptimizeTask.h:1',
]);
```

Add an ambiguity case:

```js
assert.equal(scope.approvalGrade, false);
assert.ok(scope.scannerDiagnostics.some(
  (item) => item.code === 'AMBIGUOUS_DOCUMENTATION_OWNERSHIP',
));
```

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scope.test.js \
  .claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js
```

Expected: FAIL because the schema ignores ownership, related helper evidence is absent, and ambiguity does not lower approval grade.

- [ ] **Step 3: Validate ownership in `schema.js`**

For each action, validate:

```js
const ownership = action.documentationOwnership;
if (ownership !== undefined) {
  if (!isObject(ownership)) {
    errors.push({ path: `${actionPath}.documentationOwnership`, message: 'must be an object' });
  } else {
    if (!['standalone', 'method_owned', 'ambiguous'].includes(ownership.classification)) {
      errors.push({
        path: `${actionPath}.documentationOwnership.classification`,
        message: 'must be standalone, method_owned, or ambiguous',
      });
    }
    requireString(
      `${actionPath}.documentationOwnership.sourceSymbol`,
      ownership.sourceSymbol,
    );
  }
}
```

For `method_owned`, require at least one owner, complete owner identity fields, and `selectedOwnerStableId` matching both the action stable ID and one declared owner.

- [ ] **Step 4: Add changed helper-header evidence and approval gating**

In `runReleaseScout()`:

```js
const changedSet = new Set(changedFiles);
const relatedEvidence = (delta.symbol.relatedFiles || [])
  .filter((file) => changedSet.has(file))
  .map((file) => ({
    kind: 'source',
    locator: `${file}:1`,
    revision: range.targetCommit,
    confidence: 'direct',
  }));
```

Deduplicate evidence by locator. Set `approvalGrade: false` if any normalized item has `classification: 'ambiguous'`.

- [ ] **Step 5: Run tests and verify GREEN**

Run the same two test files. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/schema.js \
  .claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/release-scout.js \
  .claude/skills/sdk-doc-sync/tests/release-scope.test.js \
  .claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js
git commit -m "feat(sdk-doc-sync): preserve type ownership evidence"
```

### Task 3: Enforce ownership at reviewed-context and plan boundaries

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/scripts/build-reviewed-release-context.js`
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js`
- Test: `.claude/skills/sdk-doc-sync/tests/release-scope.test.js`
- Test: `.claude/skills/sdk-doc-sync/tests/sync-planner.test.js`

- [ ] **Step 1: Write failing guard tests**

Use:

```js
const documentationOwnership = {
  classification: 'method_owned',
  sourceSymbol: 'OptimizeTask',
  owners: [{
    stableId: 'cpp:Management:Optimize',
    canonicalSlug: 'Management-Optimize',
    category: 'Management',
  }],
  selectedOwnerStableId: 'cpp:Management:OptimizeTask',
};

assert.throws(
  () => planner.planAction(
    { ...createAction, documentationOwnership },
    planningContext,
  ),
  (error) => error.code === 'METHOD_OWNED_STANDALONE_FORBIDDEN',
);
```

Add an allowed case with `selectedOwnerStableId: 'cpp:Management:Optimize'` and an ambiguous case producing `AMBIGUOUS_DOCUMENTATION_OWNERSHIP`.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scope.test.js \
  .claude/skills/sdk-doc-sync/tests/sync-planner.test.js
```

Expected: FAIL because neither boundary checks ownership.

- [ ] **Step 3: Implement the invariant**

Add this logic before artifact and target validation:

```js
function assertOwnershipMatchesIdentity(action, stableId) {
  const ownership = action.documentationOwnership;
  if (!ownership || ownership.classification === 'standalone') return;
  if (ownership.classification === 'ambiguous') {
    throw new SyncPlanningError(
      'AMBIGUOUS_DOCUMENTATION_OWNERSHIP',
      `${ownership.sourceSymbol} requires reviewed documentation ownership`,
    );
  }
  const ownerIds = new Set((ownership.owners || []).map((owner) => owner.stableId));
  if (!ownerIds.has(stableId) || ownership.selectedOwnerStableId !== stableId) {
    throw new SyncPlanningError(
      'METHOD_OWNED_STANDALONE_FORBIDDEN',
      `${ownership.sourceSymbol} must be embedded in an owning interface document`,
      { stableId, owners: [...ownerIds] },
    );
  }
}
```

The reviewed-context script uses the same condition and throws an `Error` whose message begins with the same code. Preserve `documentationOwnership` in filtered actions and planning context.

- [ ] **Step 4: Run tests and verify GREEN**

Run both focused files. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/sdk-doc-sync/scripts/build-reviewed-release-context.js \
  .claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js \
  .claude/skills/sdk-doc-sync/tests/release-scope.test.js \
  .claude/skills/sdk-doc-sync/tests/sync-planner.test.js
git commit -m "feat(sdk-doc-sync): forbid standalone method helpers"
```

### Task 4: Build the C++ transitive type graph

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/scanners/cpp-type-graph.js`
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/scanners/cpp-scanner.js`
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/symbol-inventory.js`
- Test: `.claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js`
- Create fixtures: `.claude/skills/sdk-doc-sync/tests/fixtures/cpp-type-ownership/`

- [ ] **Step 1: Create failing fixtures and scanner tests**

Build a minimal fixture repository containing `MilvusClientV2.h`, `OptimizeRequest.h`, `OptimizeResponse.h`, `OptimizeTask.h`, `DescribeReplicasResponse.h`, `ReplicaInfo.h`, and `ShardReplica.h`.

Assert:

```js
const optimize = symbols.find((symbol) => symbol.name === 'Optimize');
assert.deepEqual(optimize.embeddedTypes.map((type) => type.name), [
  'OptimizeRequest', 'OptimizeResponse', 'OptimizeTask',
]);
assert.ok(optimize.relatedFiles.includes(
  'src/include/milvus/types/OptimizeTask.h',
));

const replicas = symbols.find((symbol) => symbol.name === 'DescribeReplicas');
assert.deepEqual(replicas.embeddedTypes.map((type) => type.name), [
  'DescribeReplicasRequest',
  'DescribeReplicasResponse',
  'ReplicaInfo',
  'ShardReplica',
]);
```

Create baseline and target symbols differing only in `OptimizeTask` and assert the method delta reason is `embedded type surface changed`.

- [ ] **Step 2: Run C++ tests and verify RED**

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js
```

Expected: FAIL because the scanner indexes only request builders and symbol comparison ignores embedded types.

- [ ] **Step 3: Implement `cpp-type-graph.js`**

Export `buildCppTypeGraph({ rootDir, includeDir })`. Its public resolver is:

```js
return {
  resolve(typeName) {
    const canonical = resolveAlias(typeName);
    return types.get(canonical) || null;
  },
  reachable(typeNames) {
    const queue = typeNames.filter(Boolean);
    const seen = new Set();
    const result = [];
    while (queue.length > 0) {
      const name = resolveAlias(queue.shift());
      if (seen.has(name)) continue;
      seen.add(name);
      const type = types.get(name);
      if (!type) continue;
      result.push(type);
      for (const reference of type.references) queue.push(reference);
      for (const baseClass of type.baseClasses) queue.push(baseClass);
    }
    return result.sort((left, right) => left.name.localeCompare(right.name));
  },
};
```

Each parsed type contains:

```js
{
  name,
  kind,
  filePath,
  lineNumber,
  fields: [{ name, type, typeName, description, filePath, lineNumber }],
  methods: [{ name, signature, returnType, description, filePath, lineNumber }],
  references,
  baseClasses,
}
```

Strip namespaces, `const`, pointers, references, arrays, and standard-library containers before resolving Milvus types. Resolve `using` aliases and inheritance cycle-safely.

- [ ] **Step 4: Attach reachable types to C++ methods**

Construct the graph once in `CppScanner.scan()`. Seed traversal with `requestClass`, `responseClass`, and non-primitive public direct parameter types. Attach `embeddedTypes` and add every reachable header to `relatedFiles`.

Update `comparableSignature()`:

```js
embeddedTypes: symbol.embeddedTypes || [],
```

Update `updateReason()`:

```js
if (!sameValue(previous.embeddedTypes || [], symbol.embeddedTypes || [])) {
  return 'embedded type surface changed';
}
```

- [ ] **Step 5: Run tests and verify GREEN**

Run the release-scout test file. Expected: PASS, including alias, cycle, and shared-helper cases.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/scanners/cpp-type-graph.js \
  .claude/skills/sdk-doc-sync/src/sdk-doc-sync/scanners/cpp-scanner.js \
  .claude/skills/sdk-doc-sync/src/sdk-doc-sync/release-scope/symbol-inventory.js \
  .claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js \
  .claude/skills/sdk-doc-sync/tests/fixtures/cpp-type-ownership
git commit -m "feat(sdk-doc-sync): derive C++ type ownership graph"
```

### Task 5: Embed C++ result surfaces in owning method Reference IR

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/adapters/cpp.js`
- Test: `.claude/skills/sdk-doc-sync/tests/scanner-adapters.test.js`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/scanners/cpp-optimize-with-types.json`

- [ ] **Step 1: Write a failing adapter test**

Assert:

```js
assert.equal(doc.requestVariants[0].id, 'OptimizeRequest');
assert.equal(doc.result.type.display, 'Status');
assert.deepEqual(doc.result.fields.map((field) => field.name), ['response']);
assert.equal(doc.result.fields[0].type.display, 'OptimizeResponse');
assert.deepEqual(
  doc.result.fields[0].children.map((field) => field.name),
  ['tasks'],
);
assert.equal(
  doc.result.fields[0].children[0].children[0].type.display,
  'OptimizeTask',
);
assert.equal(validateReferenceDocument(doc, { production: true }).valid, true);
```

Assert that each nested field has direct or derived source evidence.

- [ ] **Step 2: Run test and verify RED**

```bash
node --test .claude/skills/sdk-doc-sync/tests/scanner-adapters.test.js
```

Expected: FAIL because the adapter names the response class but ignores `embeddedTypes`.

- [ ] **Step 3: Build nested fields using the existing schema**

Add:

```js
function fieldsForType(typeName, embeddedByName, seen = new Set()) {
  if (!typeName || seen.has(typeName)) return [];
  const type = embeddedByName.get(typeName);
  if (!type) return [];
  const nextSeen = new Set(seen).add(typeName);
  return (type.fields || []).map((field) => ({
    ...field,
    children: fieldsForType(field.typeName, embeddedByName, nextSeen),
  }));
}
```

When `symbol.responseClass` exists and `context.result` is absent, create a `Status` result with one `response` field. Its children come from the embedded response type. Preserve current request-builder behavior. Include only public result/iterator methods needed to consume the result; exclude constructors and internal mutators.

- [ ] **Step 4: Run adapter and CLI tests and verify GREEN**

```bash
node --test .claude/skills/sdk-doc-sync/tests/scanner-adapters.test.js \
  .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js
```

Expected: PASS. Do not edit or stage the dirty `sdk-renderers.test.js`.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-reference-ir/adapters/cpp.js \
  .claude/skills/sdk-doc-sync/tests/scanner-adapters.test.js \
  .claude/skills/sdk-doc-sync/tests/fixtures/scanners/cpp-optimize-with-types.json
git commit -m "feat(sdk-doc-sync): embed C++ result helper types"
```

### Task 6: Add reviewed C++ identity exceptions

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/references/identity/cpp-v26.json`
- Modify: `.claude/skills/sdk-doc-sync/references/identity/cpp-v30.json`
- Modify: `.claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js`

- [ ] **Step 1: Write failing identity-map assertions**

Cover non-obvious or shared families:

```js
assert.deepEqual(map.symbols.OptimizeTask, {
  classification: 'method_owned',
  targets: [{
    stableId: 'cpp:Management:Optimize',
    canonicalSlug: 'Management-Optimize',
    category: 'Management',
  }],
});
assert.equal(map.symbols.SearchResults.classification, 'method_owned');
assert.ok(map.symbols.SearchResults.targets.length >= 1);
```

Add assertions for batch describe, collection functions, database descriptors, refresh load, replica description, insert/upsert results, search/query results, analyzers, and iterators.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js
```

Expected: FAIL because C++ maps contain only standalone method identities.

- [ ] **Step 3: Add reviewed map entries**

Use:

```json
{
  "classification": "method_owned",
  "targets": [
    {
      "stableId": "cpp:Management:Optimize",
      "canonicalSlug": "Management-Optimize",
      "category": "Management"
    }
  ]
}
```

Do not duplicate graph-derived ownership unless the mapping is needed for helper-symbol input, aliases, shared ownership, or the audit. Keep standalone enums mapped to themselves.

- [ ] **Step 4: Run identity and scope tests and verify GREEN**

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js \
  .claude/skills/sdk-doc-sync/tests/release-scope.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/sdk-doc-sync/references/identity/cpp-v26.json \
  .claude/skills/sdk-doc-sync/references/identity/cpp-v30.json \
  .claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js
git commit -m "fix(sdk-doc-sync): map C++ helpers to method owners"
```

### Task 7: Add a read-only existing-record audit

**Files:**
- Create: `.claude/skills/sdk-doc-sync/scripts/audit-sdk-type-ownership.js`
- Create: `.claude/skills/sdk-doc-sync/tests/type-ownership-audit.test.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/script-paths.test.js`

- [ ] **Step 1: Write failing audit tests**

For records containing `Optimize()`, `OptimizeRequest`, `OptimizeResponse`, and `OptimizeTask`, plus an owner-content inventory that reports only `OptimizeRequest` and `OptimizeResponse` as embedded, assert:

```js
assert.equal(report.schemaVersion, 1);
assert.equal(report.writesPerformed, false);
assert.deepEqual(
  report.invalidSiblingRecords.map((item) => item.title),
  ['OptimizeRequest', 'OptimizeResponse', 'OptimizeTask'],
);
assert.deepEqual(
  report.invalidSiblingRecords[0].owners,
  ['cpp:Management:Optimize'],
);
assert.equal(
  report.invalidSiblingRecords[0].proposedDisposition,
  'REVIEW_CLEANUP_AFTER_EMBEDDING',
);
assert.equal(
  report.invalidSiblingRecords.find((item) => item.title === 'OptimizeTask').embeddedInAllOwners,
  false,
);
```

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test .claude/skills/sdk-doc-sync/tests/type-ownership-audit.test.js \
  .claude/skills/sdk-doc-sync/tests/script-paths.test.js
```

Expected: FAIL because the audit does not exist.

- [ ] **Step 3: Implement a pure audit and CLI**

Export:

```js
function buildTypeOwnershipAudit({
  language, track, records, ownershipEntries, ownerDocuments,
}) {
  const byTitle = new Map(records.map((record) => [record.title, record]));
  const embeddedByOwner = new Map(ownerDocuments.map((document) => [
    document.stableId,
    new Set(document.embeddedTypeNames || []),
  ]));
  const invalidSiblingRecords = ownershipEntries
    .filter((entry) =>
      entry.classification === 'method_owned'
      && byTitle.has(entry.sourceSymbol))
    .map((entry) => {
      const record = byTitle.get(entry.sourceSymbol);
      return {
        recordId: record.recordId,
        title: entry.sourceSymbol,
        documentToken: record.documentToken || null,
        owners: entry.owners.map((owner) => owner.stableId).sort(),
        embeddedInAllOwners: entry.owners.every((owner) =>
          embeddedByOwner.get(owner.stableId)?.has(entry.sourceSymbol) === true),
        proposedDisposition: 'REVIEW_CLEANUP_AFTER_EMBEDDING',
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));
  return {
    schemaVersion: 1,
    language,
    track,
    writesPerformed: false,
    invalidSiblingRecords,
  };
}
```

The CLI accepts `--records`, `--ownership`, `--owner-documents`, and `--output`, reads JSON, and writes deterministic formatted JSON. It must not import Feishu clients or expose a write option. A cleanup item is not ready for later removal review until `embeddedInAllOwners` is true.

- [ ] **Step 4: Run tests and verify GREEN**

Run both test files. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/sdk-doc-sync/scripts/audit-sdk-type-ownership.js \
  .claude/skills/sdk-doc-sync/tests/type-ownership-audit.test.js \
  .claude/skills/sdk-doc-sync/tests/script-paths.test.js
git commit -m "feat(sdk-doc-sync): audit standalone helper records"
```

### Task 8: Update stable guidance and verify the harness

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/SKILL.md`
- Modify: `.claude/skills/sdk-doc-sync/sdk-cpp.md`
- Modify: `.claude/skills/sdk-doc-sync/sdk-python.md`
- Modify: `.claude/skills/sdk-doc-sync/sdk-java.md`
- Modify: `.claude/skills/sdk-doc-sync/sdk-go.md`
- Modify: `.claude/skills/sdk-doc-sync/sdk-node.md`
- Test: focused stable tests listed below

- [ ] **Step 1: Add a failing guidance test**

In `release-scout-cli.test.js`:

```js
assert.match(mainSkill, /method-owned helper types.*owning interface/i);
assert.match(
  cppGuide,
  /request, response, result, task, info, iterator/i,
);
assert.doesNotMatch(
  cppGuide,
  /New support docs:.*Request.*Response/,
);
assert.doesNotMatch(
  cppGuide,
  /Type\/Class docs \(response objects, helper types\)/,
);
```

- [ ] **Step 2: Run the guidance test and verify RED**

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js
```

Expected: FAIL because the C++ guide still promotes response and helper pages.

- [ ] **Step 3: Update the skill files**

Add this invariant to `SKILL.md`:

> Classify every scanned type as standalone, method-owned, or ambiguous. Embed method-owned request, response, result, task, info, iterator, descriptor, transport, and wrapper types in every owning interface document. Never create or preserve a sibling helper page merely because a public class exists. Ambiguous ownership is a planning blocker; standalone exceptions require source evidence or explicit reviewed configuration.

Replace the C++ support-doc and type/class-page sections with embedded request/result guidance. In Python, Go, and Node.js guides, state that public visibility alone does not establish a standalone identity. In Java, reference the shared harness while retaining its existing identity-map fan-out rules.

- [ ] **Step 4: Run all focused tests**

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scope.test.js \
  .claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js \
  .claude/skills/sdk-doc-sync/tests/sync-planner.test.js \
  .claude/skills/sdk-doc-sync/tests/scanner-adapters.test.js \
  .claude/skills/sdk-doc-sync/tests/type-ownership-audit.test.js \
  .claude/skills/sdk-doc-sync/tests/script-paths.test.js
```

Expected: PASS.

- [ ] **Step 5: Run the full stable suite**

```bash
npm run test:unit
```

Expected: all unit tests PASS. If a failure is caused by the six pre-existing dirty files, preserve those edits, reconcile rather than overwrite, and rerun.

- [ ] **Step 6: Verify worktree ownership**

```bash
git diff --check
git status --short
git diff --name-only --cached
git diff --name-only
```

Expected: no whitespace errors. The six pre-existing files remain identifiable as user-owned changes and are absent from ownership-harness commits.

- [ ] **Step 7: Commit stable guidance**

```bash
git add .claude/skills/sdk-doc-sync/SKILL.md \
  .claude/skills/sdk-doc-sync/sdk-cpp.md \
  .claude/skills/sdk-doc-sync/sdk-python.md \
  .claude/skills/sdk-doc-sync/sdk-java.md \
  .claude/skills/sdk-doc-sync/sdk-go.md \
  .claude/skills/sdk-doc-sync/sdk-node.md \
  .claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js
git commit -m "docs(sdk-doc-sync): require embedded helper ownership"
```

## Completion Check

Run:

```bash
git log --oneline -8
git status --short
npm run test:unit
```

Confirm:

- method-owned helper symbols fan out only to declared owners;
- ambiguous helper-like symbols make release scope non-approval-grade;
- C++ helper-header-only changes update owning methods;
- nested C++ request and result structures render inside method documents;
- reviewed-context and planning reject contradictory standalone helper actions;
- the audit reports existing sibling helpers without writes;
- no live Feishu state or `scan-state.json` changed;
- none of the six pre-existing files entered ownership-harness commits.
