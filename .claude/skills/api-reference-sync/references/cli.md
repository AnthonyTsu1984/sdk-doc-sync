# SDK Doc Sync CLI Reference

Run commands from the repository root. Prefer each command's `--help` output over copied flag lists.

## Core Sync

```bash
node .claude/skills/api-reference-sync/bin/sdk-doc-sync.js --help
```

Required dry-run inputs include `--sdk-dir`, `--sdk-name`, and `--sdk-version`. Use space-separated option values.

`--dry-run` is read-only, but it is not necessarily offline: release comparison against existing Feishu records needs a base token. For SDK release work, resolve `BASE_TOKEN` from the target version's Bitable Token in the per-SDK reference table, and resolve `ROOT_TOKEN` from the same row's Drive Folder token when folder placement is part of the plan. Provide `BASE_TOKEN` or `--previous-base-token`; provide `ROOT_TOKEN` when folder placement is part of the plan.

## Release Scout

Run release scout before approval-grade SDK release scans:

```bash
node .claude/skills/api-reference-sync/bin/sdk-release-scout.js \
  --language python \
  --sdk-name pymilvus \
  --track v2.6.x \
  --json \
  --output tmp/sdk-release-scout/python-v26.json
```

Then run the scoped sync dry-run:

```bash
BASE_TOKEN=<base-token> ROOT_TOKEN=<folder-token> \
node .claude/skills/api-reference-sync/bin/sdk-doc-sync.js \
  --language python \
  --sdk-dir repos/pymilvus/pymilvus \
  --sdk-name pymilvus \
  --sdk-version v2.6.x \
  --release-scope tmp/sdk-release-scout/python-v26.json \
  --changed-only \
  --summary-json tmp/sdk-release-scout/python-v26-dryrun-summary.json \
  --dry-run \
  --json
```

Use the same artifact naming pattern for all SDKs:

- release scope: `tmp/sdk-release-scout/<language>-<track>.json`
- bounded dry-run summary: `tmp/sdk-release-scout/<language>-<track>-dryrun-summary.json`

Use compact track names such as `v26`, `v30`, or `v14`.

Compare two scan artifacts when repeated sessions disagree:

```bash
node .claude/skills/api-reference-sync/bin/compare-scan-artifacts.js \
  tmp/sdk-release-scout/python-v26.json \
  tmp/sdk-release-scout/python-v26-dryrun-summary.json
```

Generate the semantic digest used by an interactive grouping or other JSON review gate:

```bash
node .claude/skills/api-reference-sync/scripts/review-artifact-digest.js \
  tmp/sdk-release-scout/<language>-<track>-grouping-proposal.json
```

The prompt must show the returned full digest in one copy-ready reply, for example `APPROVE_GROUPING sha256:<proposal-digest>`. Recompute it whenever the artifact changes.

If a dry-run summary has `planCount: 0` or nonzero `planningErrorCount`, report it as blocked generation and do not request Feishu write approval.

When a release contains one or more documents, create a persistent review session from the complete initial dry-run. The session is the only source of accepted-unit state across processes or chat sessions:

```bash
SESSION=tmp/sdk-doc-sync-runs/<language>-<track>/review-session.json
BASE_TOKEN=<base-token> ROOT_TOKEN=<folder-token> \
node .claude/skills/api-reference-sync/bin/sdk-doc-sync.js \
  <same-reviewed-inputs> \
  --session-state "$SESSION" \
  --dry-run \
  --json
```

`--session-state` refuses live runs, blocked or incomplete planning, and an existing file. Use `--resume-session` for every later invocation. Do not copy accepted review-unit IDs into command lines or prompts.

The first dry-run emits a `reviewUnitManifest` and does not emit an approvable multi-document batch. Select exactly one unit and rerun against current live state:

```bash
BASE_TOKEN=<base-token> ROOT_TOKEN=<folder-token> \
node .claude/skills/api-reference-sync/bin/sdk-doc-sync.js \
  <same-reviewed-inputs> \
  --resume-session "$SESSION" \
  --review-unit-id review:<document-stable-id> \
  --dry-run \
  --json
```

The selected unit's batch includes the document and all required resource operations. Approve and execute only its `proposedExecutionBatch.batchDigest`, again with `--resume-session "$SESSION"`. After execution, stop for document review; if comments change any artifact or plan, rerun the same unit and obtain a new digest.

After the exact `APPROVE_DOCUMENT` reply, write the verified touched-record inventory as JSON. Every entry must bind a live record to a successful action in the execution journal:

```json
[
  {
    "actionId": "<document-or-resource-stable-id>",
    "recordId": "<bitable-record-id>",
    "documentToken": "<docx-token-or-null>"
  }
]
```

Then persist the receipt:

```bash
node .claude/skills/api-reference-sync/bin/sdk-review-session.js accept-document \
  --session "$SESSION" \
  --review-unit-id review:<document-stable-id> \
  --execution-journal <execution-journal.jsonl> \
  --execution-journal-digest sha256:<execution-journal-digest> \
  --touched-records <touched-records.json> \
  --document-link <docx-url> \
  --record-link <bitable-record-url> \
  --comments-resolved
```

This command rereads the journal, verifies its digest, completion sentinel, action results, and document identity, then derives the accepted unit from the receipt. A new process can inspect progress with `sdk-review-session.js status --session "$SESSION"` and continue with `--resume-session "$SESSION"`. Resume reruns the baseline scan and blocks on manifest drift, missing or changed journals, non-`WIP` records, nonblank `Targets`, or changed document tokens. `scan-state.json` remains unchanged.

After every unit has a receipt, build the final acceptance artifact:

```bash
node .claude/skills/api-reference-sync/bin/sdk-review-session.js build-acceptance \
  --session "$SESSION"
```

Use the emitted `APPROVE_ACCEPTANCE sha256:<acceptance-manifest-digest>` gate. Pass that same digest to `AcceptanceFinalizer`. After finalization writes its successful JSON journal, bind it back to the session:

```bash
node .claude/skills/api-reference-sync/scripts/review-artifact-digest.js <acceptance-journal.json>
node .claude/skills/api-reference-sync/bin/sdk-review-session.js record-finalization \
  --session "$SESSION" \
  --acceptance-journal <acceptance-journal.json> \
  --acceptance-journal-digest sha256:<acceptance-journal-digest>
```

Only the last command can mark the persistent session `finalized` and `scanStateUpdated: true`, and only when the journal proves successful digest-bound finalization.

## Zilliz CLI Release Impact

Before scanning a new public `zilliz-cli` release, extract release-note command impacts:

```bash
node .claude/skills/api-reference-sync/bin/zilliz-cli-release-impact.js \
  --baseline-tag zilliz-v1.4.4 \
  --target-tag zilliz-v1.4.5 \
  --json \
  --output tmp/sdk-release-scout/zilliz-cli-v14-impact.json
```

Pass the artifact to release scout:

```bash
node .claude/skills/api-reference-sync/bin/sdk-release-scout.js \
  --language zilliz-cli \
  --sdk-name zilliz-cli \
  --track v1.4.x \
  --release-impact tmp/sdk-release-scout/zilliz-cli-v14-impact.json \
  --json \
  --output tmp/sdk-release-scout/zilliz-cli-v14.json
```

Audit Rust hand-written command metadata after source changes:

```bash
node .claude/skills/api-reference-sync/bin/zilliz-cli-handwritten-audit.js \
  --sdk-dir repos/zilliz-cloud/vdc/zilliz-tui \
  --json \
  --output tmp/sdk-release-scout/zilliz-cli-v14-handwritten-audit.json
```

Treat `SOURCE_VALIDATION_REQUIRED`, `HANDWRITTEN_FLAG_MISSING`, and `HANDWRITTEN_METADATA_MISSING` as blockers for approval-ready sync plans.

## Feishu Documents And Bitables

```bash
node .claude/skills/api-reference-sync/scripts/feishu-doc.js --help
```

The helper supports document push/patch/fetch, Drive folder list/move/copy/create/delete operations, and bitable list/show/create/update/delete operations. Use `--dry-run` for supported writes and avoid `--yes` until the exact action has been approved.

Common read-only checks:

```bash
node .claude/skills/api-reference-sync/scripts/feishu-doc.js get-blocks <doc-id>
node .claude/skills/api-reference-sync/scripts/feishu-doc.js list-folder <folder-token> --type all
node .claude/skills/api-reference-sync/scripts/feishu-doc.js bitable-show <base-token> <record-id>
```

## OpenAPI Editing

```bash
node .claude/skills/api-reference-sync/scripts/edit-openapi.js --help
```

Edit `openapi-milvus.json` for Milvus server changes and `openapi-cloud.json` for Zilliz Cloud changes. `openapi.json` is generated by the merge workflow and must not be edited directly. Run editor operations with `--dry-run` first and verify the regenerated combined spec.

## Localization Translator

```bash
node .claude/skills/api-reference-sync/bin/feishu-doc-translator.js --help
```

Multi-table bases require both `--source-table` and `--target-table`.
