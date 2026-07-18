# Schema-First SDK/API Generation

Use this workflow for production SDK, CLI, and REST API reference changes. It separates pure reads and deterministic artifact generation from approval-gated Feishu mutations.

## Production Workflow

### 1. Scan

Read `scan-state.json`, fetch SDK tags, and diff the last scanned tag against the target release. Scan only the changed public files or symbols identified by the diff.

Do not advance `scan-state.json` during scanning. The state file changes only after approved work is complete or explicitly deferred.

### 2. Normalize

Convert scanner output into SDK Reference IR through the language adapter:

- `src/sdk-reference-ir/adapters/python.js`
- `src/sdk-reference-ir/adapters/java.js`
- `src/sdk-reference-ir/adapters/node.js`
- `src/sdk-reference-ir/adapters/go.js`
- `src/sdk-reference-ir/adapters/cpp.js`
- `src/sdk-reference-ir/adapters/zilliz-cli.js`
- `src/sdk-reference-ir/adapters/openapi.js`

The reference context must supply reviewed evidence, category placement, related links, type URLs, and REST OpenAPI input when those cannot be inferred safely from the scanner result.

### 3. Validate

Run production validation on the SDK Reference IR before rendering. Production validation rejects placeholder summaries, unresolved internal references, invalid defaults, malformed evidence, missing required fields, and other publish-blocking defects.

Warnings such as external type references or shallow examples must be reviewed before approval. They are not automatic publish blockers, but the approval summary must call them out.

If validation fails because generated drafts are missing reviewed evidence, source repository/revision, summaries, examples, or typed parameter details, classify the run as release triage only. Preserve the scanner output as evidence for changed symbols, but do not call the result an approval-ready dry-run and do not request Feishu write approval. The next step is to author reviewed Reference IR/context for the public symbols that matter and rerun validation.

Blocked-generation reports must name the blocker counts and the recovery path: build a reviewed `--reference-context` with source evidence, examples, category placement, related links, and type details for the public symbols; rerun validation; then plan only after validation passes.

### 4. Render

Render the validated SDK Reference IR into Document IR with the language renderer, then validate the Document IR with lossless policy. Render Markdown from Document IR only after both validations pass.

The rendered artifact must be deterministic. Re-rendering the same Reference IR with the same context should produce the same Document IR and Markdown.

### 5. Plan

Build immutable plans with `src/sdk-doc-sync/sync-planner.js`. Planning is read-only and must resolve canonical target folders before any mutation is requested.

Each plan artifact has these fields:

- `schemaVersion`: currently `1`.
- `action`: one of `CREATE`, `UPDATE_IN_PLACE`, `CREATE_AND_REPOINT`, `DEPRECATE`, `ORPHAN`, or `NOOP`.
- `stableId`: stable symbol identity used for review, execution, and recovery.
- `artifactDigest`: digest of the reviewed content or Document IR for write actions.
- `source`: current version, record ID, document token, and folder token.
- `target`: target version, parent record ID, folder token, and version root token.
- `preconditions`: artifact digest, current record state, current document token, target ancestry proof, and shared-token status.
- `postconditions`: expected target document location, bitable link, parent, version metadata, deprecation metadata, no-mutation state, or older-source preservation.
- `metadata`: diff action, reason, artifact kind, and non-destructive flags for orphan/no-op handling.

Plan action selection:

- `CREATE` creates a new document and record.
- `UPDATE_IN_PLACE` patches only when the current document is already in the target version folder, ancestry is verified, and no older-version bitable shares the token.
- `CREATE_AND_REPOINT` creates a target-version document and repoints the target record when the source is cross-version, shared, or not safely patchable in place.
- `DEPRECATE` updates metadata only.
- `ORPHAN` and `NOOP` perform no mutation.

### 6. Approve

Present the exact action list, rendered artifact summary, target folders, parent records, preconditions, postconditions, warnings, and recovery implications. Mutating execution requires explicit user approval.

Do not use `--auto-approve` for production Feishu writes unless the user has explicitly approved that exact run and its full action list.

Never request approval from a dry-run with `planCount: 0`, nonzero `planningErrorCount`, or validation errors. Report the blockers and the manually reviewed documentation work needed instead.

The approval boundary is the immutable plan plus reviewed rendered artifact. A release-scout artifact or blocked dry-run summary is evidence for triage, not approval to mutate Feishu.

### 7. Execute

Execute only approved immutable plans with `src/sdk-doc-sync/sync-executor.js`.

Execution behavior:

- Create: push the reviewed Markdown to the target folder, then create the bitable record without writing `Slug`; leave `Targets` blank and set `Progress` to `WIP`.
- Update in place: patch the existing target-version document, then update metadata; leave `Targets` blank and set `Progress` to `WIP`.
- Create and repoint: push the reviewed Markdown to the target folder, then update the existing record with both `title` and `link`; leave `Targets` blank and set `Progress` to `WIP`.
- Deprecate: set deprecation metadata and progress only.
- Orphan/no-op: leave Feishu untouched.

If a step fails, stop the current plan and report `failedStep`, completed steps, and suggested recovery. Do not continue with dependent actions until the recovery is understood.

### 8. Verify

Refetch the document and record after every mutation. Verify:

- document token and folder ancestry;
- artifact digest when available;
- `Docs.link` and document title;
- `父记录` / parent record;
- `Targets` is blank and `Progress` is `WIP` for edited create/update/repoint records;
- target version metadata;
- deprecation state when applicable;
- older-version source token still exists and remains unchanged for cross-version updates.

Run the scoped post-write checks from [post-write-verification.md](post-write-verification.md) for formatting-sensitive pages.

## Recovery Behavior

Recovery depends on the last completed mutation:

- Failure before document creation: no Feishu document exists; fix the artifact or plan context and rerun from planning.
- Failure after document creation but before record creation or repoint: leave the new document in the disposable or target folder, record its token, and either create/repoint the record manually after approval or delete the document after explicit cleanup approval.
- Failure after record creation or repoint but before verification: refetch the record and document, compare against postconditions, and either rerun verification or apply a narrowly scoped corrective update after approval.
- Verification failure for target folder or parent: do not patch content again until folder ancestry and bitable parent are corrected.
- Verification failure for artifact digest or formatting: preserve the failed document token for audit, prepare a corrected reviewed artifact, and execute a new approved plan.
- Cross-version failure: never repair by patching the older-version source document in place. Keep the historical source token unchanged.

Always include unrecovered resources and tokens in the completion report.

## Offline Commands

```bash
npm run validate:skills
npm test
node .claude/skills/sdk-doc-sync/tests/run-all.js --list
node --test .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js
```

Use CLI dry-runs for release review:

```bash
node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js \
  --language <python|java|node|go|cpp|zilliz-cli|rest> \
  --sdk-dir <path> \
  --sdk-name <name> \
  --sdk-version <version> \
  --reference-context <file> \
  --summary-json tmp/sdk-release-scout/<language>-<track>-dryrun-summary.json \
  --dry-run
```
