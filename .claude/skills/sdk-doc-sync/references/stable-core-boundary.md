# SDK Doc Sync Stable-Core Boundary

Classify every changed file before committing an SDK documentation run. A successful live write does not make its migration code or reviewed release content reusable.

## Ownership classes

| Class | Contents | Location and action |
|---|---|---|
| Stable core | Release-independent schemas, adapters, renderers, validators, converters, and operational safety logic | Commit under `.claude/skills/sdk-doc-sync/src/` or `bin/` with focused tests |
| Stable guidance and fixtures | Durable authoring rules, smoke procedures, and minimal synthetic regression cases | Commit under the skill references, SDK guides, and tests |
| Tracked operational state | The successfully synchronized baseline and date | Commit `scan-state.json` separately from stable-core changes |
| Run content | Exact reviewed prose, platform classifications, signatures, examples, placement evidence, previews, manifests, and receipts | Keep under ignored `tmp/sdk-doc-sync-runs/<language>-<track>/<run-id>/` |
| One-off tooling | Migration, repair, execution, verification, and cleanup scripts that name this batch, release, method, record, document, or folder | Keep in the run directory's `migrations/` folder; never promote unchanged into the skill's `scripts/` directory |

## Promotion rule

A run-local behavior may enter the stable core only when all of these conditions hold:

1. The rule can be stated without a release number, method name, record ID, document token, folder token, or exact batch wording.
2. It represents a reusable schema contract, rendering behavior, validation invariant, conversion rule, or operational safety check.
3. A minimal synthetic regression test fails without the change and passes with it.
4. Stable code does not read, import, or require any file below `tmp/`.

Platform endpoint vocabulary may be stable policy when it applies across releases. Exact examples and per-parameter classifications remain run content.

## One-off script test

Treat a script as one-off when any of these statements is true:

- it contains fixed Feishu tokens, Bitable record IDs, release action IDs, or one document's block IDs;
- it rewrites only the current reviewed-context artifact;
- it builds or executes one approval batch;
- it verifies or repairs one named interface or one live document;
- deleting the completed run would eliminate the script's only use case.

If the underlying operation is reusable, extract the generic operation into stable code with tests and leave only the run-specific inputs and orchestration in the ignored script.

## Pre-commit boundary check

Before committing:

1. Produce a run-local classification report listing stable core, stable guidance/tests, tracked operational state, retained run content, and temporary one-off tooling.
2. Confirm `git ls-files tmp/sdk-doc-sync-runs/` returns no files.
3. Confirm stable runtime code contains no imports or reads from `tmp/sdk-doc-sync-runs/` or `tmp/sdk-release-scout/`.
4. Confirm the stable test suite passes with no dependency on the run directory.
5. Review stable runtime additions for method names, release numbers, Feishu tokens, or per-run lookup tables.
6. Commit stable core and its tests together.
7. Commit `scan-state.json` separately after post-write verification succeeds.

Do not delete retained run evidence as part of the core commit. Retention or cleanup is a separate recoverability decision.
