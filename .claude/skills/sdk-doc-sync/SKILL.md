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
- Formatting and post-write checks: [references/post-write-verification.md](references/post-write-verification.md)
- Supported CLI entry points: [references/cli.md](references/cli.md)
- Known failure patterns: [references/troubleshooting.md](references/troubleshooting.md)

## Non-Negotiable Invariants

- Read `scan-state.json` before scanning. Update it only after a successful synchronization.
- Diff the last scanned tag against the target tag; do not treat a full repository scan as the release delta.
- Separate release changes from older undocumented backlog before assigning `Added Since`.
- Never write the auto-populated `Slug` field.
- Resolve destination folders from the canonical version root in the per-SDK reference, not from possibly stale Module or VirtualNode links.
- Never patch an older-version source document in place for a newer release.
- Keep the older-version doc as a historical snapshot whenever it is the source for a newer version. Deletion requires a separate cleanup request and explicit approval.
- When repointing a `Docs` field, pass both `title` and `link` to `updateRecord()`.
- Do not add visible version-changelog sections to API reference pages unless the user explicitly requests release notes.
- Do not write until the user has reviewed the exact dry-run action list and given explicit approval.

## Workflow

### 1. Check Scan State

1. Read `scan-state.json` for the SDK's last scanned tag.
2. Fetch tags in the SDK repository.
3. Resolve the requested or latest target tag.
4. Stop with a no-change report when the target is already scanned.

### 2. Diff The Release

Use `git diff <baseline>..<target>` to identify changed public source files and symbols. Classify:

- `CREATE`: newly public symbol or command.
- `UPDATE`: signature, parameter, response, behavior, or example changed.
- `DEPRECATE`: removed, renamed, or explicitly deprecated surface.
- `BACKFILL`: symbol predates the release but lacks correct documentation.

Verify first appearance before assigning version metadata.

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

Read the public implementation, examples, and tests for each action. Do not publish raw scanner scaffolds or source docstrings as finished documentation.

### 4. Index And Compare Feishu State

Fetch only the relevant records where feasible. For every proposed action, record:

- symbol and source location;
- action type and reason;
- parameter-level differences for updates;
- target version, category, folder, and parent record;
- current document token and whether older versions share it;
- planned metadata and post-write checks.

### 5. Preview And Approve

Show the exact action list and dry-run result, including unresolved placement or version-sharing risks. Obtain explicit approval before any live create, patch, move, copy, bitable update, or OpenAPI edit.

### 6. Execute Approved Actions

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
