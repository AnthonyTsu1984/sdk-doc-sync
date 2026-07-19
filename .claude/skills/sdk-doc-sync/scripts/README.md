# SDK Doc Sync Scripts

This directory contains both supported workflow helpers and retained historical/one-off migration scripts. Presence here does not make every script a current workflow entry point.

## Supported Workflow Helpers

- `build-current-placement-audit.js` builds the current document-placement audit used during planning.
- `build-reviewed-release-context.js` assembles reviewed release context for downstream generation.
- `render-grouping-inheritance-table.js` renders reviewed grouping and inheritance decisions.
- `feishu-doc.js` provides the maintained Feishu document, Drive, and Bitable operations described in the CLI reference.

These helpers support current workflows, but mutating commands still require the documented dry-run, review, and approval controls.

## Legacy Scaffold Infrastructure

`src/sdk-doc-sync/doc-generator.js` and its `DocGenerator` class are legacy scaffold infrastructure. TODO-generating scaffold output is not approval-grade and is not publishable input. `SyncExecutor` actively rejects legacy TODO scaffold artifacts before execution. Scaffold content must be replaced with reviewed, source-backed content that passes production validation before any sync or publication step.

## Historical/One-Off Migration Scripts

Most SDK-, release-, or dataset-specific scripts are retained as implementation history. Representative patterns include language and version prefixes such as `node-v30-*`, `java-v2614-*`, `go-v262-*`, `cpp-v263-*`, `cli-v01-*`, and the `zilliz-cli-v13x/` or `zilliz-cli-v14x/` directories. Historical version/create/update/fix scripts require source review before reuse because they may embed obsolete document IDs, release assumptions, content snapshots, or mutation behavior.

Preserve these scripts for auditability. Do not treat them as supported entry points or run them against current data solely because their names resemble a new task.
