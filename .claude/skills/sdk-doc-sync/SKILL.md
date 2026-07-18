---
name: sdk-doc-sync
description: Use when a Milvus or Zilliz SDK, CLI, REST API, or OpenAPI release must be scanned and diffed against existing Feishu or zdoc documentation to create, update, deprecate, backfill, or reparent API reference records. Do not use for drafting a standalone narrative page, localization, or filling language tabs in one procedure document.
---

# SDK Doc Sync

Synchronize versioned SDK and API reference documentation incrementally. Scripts handle scanning, diffing, and Feishu CRUD; use source inspection and judgment to decide what changed, where documentation belongs, and how to preserve version history.

## Load The Relevant References

Read only what the task requires:

- Python: [sdk-python.md](sdk-python.md)
- Java: [sdk-java.md](sdk-java.md)
- Node.js: [sdk-node.md](sdk-node.md)
- C++: [sdk-cpp.md](sdk-cpp.md)
- Go: [sdk-go.md](sdk-go.md)
- Zilliz CLI: [sdk-zilliz-cli.md](sdk-zilliz-cli.md)
- REST/OpenAPI: [sdk-rest.md](sdk-rest.md)
- Cross-SDK alignment: [sdk-alignment.md](sdk-alignment.md)
- Same-version, cross-version, and backfill behavior: [references/versioning.md](references/versioning.md)
- Schema-first production workflow: [references/schema-first-generation.md](references/schema-first-generation.md)
- Manual release smoke procedure: [references/release-smoke-test.md](references/release-smoke-test.md)
- Formatting and post-write checks: [references/post-write-verification.md](references/post-write-verification.md)
- Supported CLI entry points: [references/cli.md](references/cli.md)
- Known failure patterns: [references/troubleshooting.md](references/troubleshooting.md)

## Non-Negotiable Invariants

- Read `scan-state.json` before scanning. Update it only after a successful synchronization.
- Diff the last scanned tag against the target tag; do not treat a full repository scan as the release delta.
- Treat Git diff/log as authoritative for release scope, changed files, and first appearance. Treat the scanner as structured extraction for symbols, signatures, parameters, and existing-doc comparison.
- Filter scanner output to release-changed public files or symbols before classifying actions. A full scanner dry-run is a health check or backlog signal, not an approval-grade release plan.
- Normalize scanner symbols to canonical documentation identities before comparing with Feishu records. Raw scanner slugs often differ from bitable or folder slugs.
- Separate release changes from older undocumented backlog before assigning `Added Since`.
- Never write the auto-populated `Slug` field.
- Resolve destination folders from the canonical version root in the per-SDK reference, not from possibly stale Module or VirtualNode links.
- Never patch an older-version source document in place for a newer release.
- Keep the older-version doc as a historical snapshot whenever it is the source for a newer version. Deletion requires a separate cleanup request and explicit approval.
- Treat each SDK version folder as sparse: it contains only documents created or updated for that version. Treat each version bitable as complete: it must retain records for all classes, methods, functions, commands, and related entries in that version.
- For unchanged entries in a new version bitable, keep their existing document links unless a version-local document was created or updated, but repoint `父记录` to the matching category or parent record in the current version when that parent exists.
- When repointing a `Docs` field, pass both `title` and `link` to `updateRecord()`.
- For every record whose document content, document link, parent, or editable metadata is changed in a run, leave the `Targets` field blank and set `Progress` to `WIP`. Verified Python version bitables use exact field names `Targets` and `Progress`, with progress option `WIP`.
- Do not add visible version-changelog sections to API reference pages unless the user explicitly requests release notes.
- Do not write until the user has reviewed the exact dry-run action list and given explicit approval.

## Workflow

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

### 3. Scan Only Relevant Symbols

Run the scanner and filter it to the changed files or symbols. Example:

```bash
node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js \
  --language python \
  --sdk-dir repos/pymilvus/pymilvus \
  --sdk-name pymilvus \
  --sdk-version v2.6.x \
  --dry-run
```

If a full dry-run reports broad false `CREATE` or `ORPHAN` noise, report it as non-approval-grade and continue with the release-scoped Git diff plus targeted scanner extraction. Do not ask for approval on an unfiltered dry-run action list.

Read the public implementation, examples, and tests for each action. Do not publish raw scanner scaffolds or source docstrings as finished documentation.

### 4. Index And Compare Feishu State

Fetch only the relevant records where feasible. For every proposed action, record:

- symbol and source location;
- action type and reason;
- parameter-level differences for updates;
- target version, category, folder, and parent record;
- current document token and whether older versions share it;
- whether the target-version bitable row should link a new/current-version doc or retain an unchanged older doc link while updating `父记录`;
- exact `Targets` and `Progress` post-write values for every edited record;
- planned metadata and post-write checks.

### 5. Preview And Approve

Show the exact action list and dry-run result, including unresolved placement or version-sharing risks. Obtain explicit approval before any live create, patch, move, copy, bitable update, or OpenAPI edit.

### 6. Execute Approved Actions

For schema-first production generation, follow [references/schema-first-generation.md](references/schema-first-generation.md): scan, normalize, validate, render, plan, approve, execute, and verify. The immutable plan and reviewed artifact are the approval boundary for live writes.

For creates:

1. Write source-backed documentation in the per-SDK format.
2. Resolve or create the correct category folder under the canonical version root.
3. Create the document.
4. Create its bitable record without setting `Slug`.

For updates and backfills, choose the version-safe flow in [references/versioning.md](references/versioning.md). Apply only approved actions.

### 7. Refetch And Verify

After every live write:

1. Refetch the document and bitable record.
2. Verify document content, folder ancestry, `Docs.link`, `父记录`, version metadata, and language/formatting details.
3. Run the scoped checks in [references/post-write-verification.md](references/post-write-verification.md).
4. Confirm older-version documents remain unchanged.
5. Report successful, failed, skipped, and unresolved actions separately.

### 8. Update Scan State

Update `scan-state.json` only when all approved actions for the scan are complete or explicitly recorded as deferred. Do not advance the tag after a partially failed run without explaining the recovery state.

## Documentation Quality

- Explain when and why to use a method, not only what its name says.
- Describe valid parameter values, constraints, defaults, and interactions.
- Use public SDK APIs and runnable examples.
- List exceptions and response details verified from source.
- Keep builder methods, typed return fields, and exception descriptions in separate rendered blocks.
- Preserve the established page structure and integrate changes into their normal sections.

## Completion Report

Report:

- baseline and target tags;
- scanned repositories and symbols;
- approved actions executed;
- created or updated document and record links;
- version-placement and shared-token decisions;
- post-write verification results;
- deferred backlog, unsupported surfaces, and failures;
- whether `scan-state.json` was updated.
