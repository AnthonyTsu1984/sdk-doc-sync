# SDK Doc Sync Validation And Smoke Testing

This guide lists the validation commands that exist in this repository and the live release smoke procedure used before approving a schema-first SDK/API documentation release.

## Offline Validation

Run offline checks from the repository root. These commands do not call Feishu and are the default verification path for development changes.

```bash
npm run validate:skills
npm test
```

Useful scoped checks:

```bash
node .claude/skills/sdk-doc-sync/tests/run-all.js --list
node --test .claude/skills/sdk-doc-sync/tests/script-paths.test.js
node --test .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js
node --test .claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js .claude/skills/sdk-doc-sync/tests/cli-rest-renderers.test.js
node --test .claude/skills/sdk-doc-sync/tests/lark-doc-writer.test.js .claude/skills/sdk-doc-sync/tests/markdown-to-feishu-lists.test.js
```

Release-scope harness checks:

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scope.test.js
node --test .claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js
node --test .claude/skills/sdk-doc-sync/tests/agent-harness.test.js
```

These tests verify deterministic release-scout artifacts, scoped scanner use, canonical identity mapping, and rejection of raw full-scan dumps as final approval artifacts.

The offline suites cover scanner adapters, SDK Reference IR validation, Document IR validation, deterministic renderers, sync planning, approved execution behavior, CLI dry-runs, legacy writer preservation, and path/link wiring.

## Offline Schema-First Dry Runs

Use dry-runs to exercise scan, schema-first rendering, and planning without Feishu writes. Provide `--reference-context` when production validation requires reviewed evidence, related links, type URLs, or REST OpenAPI context.

```bash
node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js \
  --language node \
  --sdk-dir /path/to/node-sdk \
  --sdk-name milvus-sdk-node \
  --sdk-version vX.Y.x \
  --reference-context /path/to/reference-context.json \
  --dry-run
```

```bash
node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js \
  --language rest \
  --sdk-dir /path/to/openapi-fixture \
  --sdk-name zilliz-rest \
  --sdk-version vX.Y.x \
  --reference-context /path/to/reference-context.json \
  --dry-run \
  --json
```

Dry-run output is the review artifact. Inspect the scanned symbols, diff actions, immutable plans, target folders, artifact validation, and any planning errors before asking for approval.

## Live Release Smoke Test

The release smoke test is manual, mutating, disposable, and approval-required. It creates temporary Feishu resources and must not run in CI.

Before running it:

- Confirm the operator has Feishu read/write access for a disposable Drive folder and disposable Bitable.
- Confirm `.env` has `APP_ID`, `APP_SECRET`, `FEISHU_HOST`, `ROOT_TOKEN`, and `BASE_TOKEN` for disposable resources only.
- Ask for explicit approval to create the disposable folder, document, and record.
- Record every created folder token, document token, document URL, base token, table ID, and record ID in the smoke log.

Use the full procedure in [../../references/release-smoke-test.md](../../references/release-smoke-test.md). That procedure verifies C++ code block preservation, nested-list rendering, include handling, citations, patch/refetch behavior, and cleanup approval.

## Cleanup Policy

Cleanup is a separate approval gate. After the smoke checks pass or fail, report the exact disposable resources that would be deleted or archived and ask for explicit cleanup approval. Do not delete smoke resources automatically, even after a successful run.

If cleanup approval is denied or unavailable, leave the resources in the recorded disposable location and report the remaining tokens as unresolved cleanup work.
