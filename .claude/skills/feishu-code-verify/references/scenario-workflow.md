# Scenario Verification Workflow

Use this workflow for ordered SDK docs where standalone snippets are intentionally incomplete but the document should work as a chained example.

## What Changed

Scenario verification now has two levels:

1. Compile-oriented scenario checks: `--scenario` builds one generated program per source/language and verifies that the ordered snippets fit together.
2. Runtime scenario checks: `--run-scenarios --live --allow-run` executes the generated program against live services with isolated resource names and small generated fixtures.

This lets a standalone block remain `manual` while the containing workflow is verified. Use `summary.manualCoveredByScenario` to count blocks covered by passing scenarios, and inspect `summary.manualUncovered` first.

## Standard Flow

1. Run a static scenario pass first:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js \
  --doc <doc-url-or-token> \
  --scenario \
  --languages python,go,java,node,bash \
  --report /tmp/feishu-code-verify-scenario.json
```

2. Read the report summary:

- `scenarioPassed`: generated scenarios that compile or pass their static checks.
- `scenarioFailed`: real scenario construction or compile failures.
- `scenarioManual`: scenarios that need SDK dependencies, setup, or live env.
- `manualCoveredByScenario`: standalone manual blocks covered by a passing scenario.
- `manualUncovered`: manual blocks not covered by scenario verification.

3. Prepare local SDK dependencies for stronger checks:

- Java: pass `--java-sdk-repo repos/milvus-sdk-java` or set `DOC_VERIFY_JAVA_SDK_REPO`.
- Go: pass `--go-module-dir repos/milvus-sdk-go` or set `DOC_VERIFY_GO_MODULE_DIR`.
- Python: pass `--python-command repos/pymilvus/.venv/bin/python` and `--python-path repos/pymilvus`, or set `DOC_VERIFY_PYTHON` and `DOC_VERIFY_PYTHONPATH`.
- Node and Bash: no SDK dependency flags are required for generic syntax/runtime checks; live service commands still need the same env gate.

4. Prepare and inspect the generated program before live runtime:

- Locate the generated scenario under `/tmp/feishu-code-scenarios/<language>/<source-id>/`.
- Check that snippets are chained in document order and imports/setup appear before dependent calls.
- Confirm placeholder endpoint, token, database, collection, object URL, and credential assignments are rewritten to env-driven values.
- Confirm runtime fixtures are present when the workflow needs data: generated Parquet for Python bulk import, inserted rows for Java and Go search paths.
- Confirm destructive operations are either absent, isolated to generated resource names, or intentionally part of cleanup.
- If the generated program needs manual edits to run, treat that as a verifier gap and improve scenario generation instead of relying on hand-edited runtime artifacts.

5. Ask for live env requirements before running:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js \
  --doc <doc-url-or-token> \
  --request-live
```

6. Run each runtime scenario with a unique resource suffix:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js \
  --doc <doc-url-or-token> \
  --run-scenarios --live --allow-run \
  --languages <language> \
  --resource-suffix <unique-suffix> \
  --timeout 900000 \
  --report /tmp/feishu-code-verify-<language>-runtime.json
```

7. Read runtime counters:

- `scenarioRuntimePassed`: generated scenarios that ran successfully.
- `scenarioRuntimeFailed`: generated scenarios that ran and failed.
- `scenarioRuntimeManual`: generated scenarios skipped at runtime because deps or env were incomplete.

## Program Preparation Checklist

The verifier is responsible for preparing runnable programs from documentation snippets. Do not make live validation depend on manual edits to files in `/tmp/feishu-code-scenarios`; those edits are not reproducible.

Before a scenario can be considered runtime-ready, the generated program should satisfy these checks:

- It is self-contained for the selected language, apart from declared SDK dependencies and live env.
- It preserves document order while deduplicating imports and avoiding duplicate variable declarations.
- It maps doc placeholders to env vars without embedding secret values.
- It creates isolated resource names using `DOC_VERIFY_RESOURCE_SUFFIX` or `--resource-suffix`.
- It prepares minimal test data required by later snippets.
- It keeps fixture schemas aligned with the document's collection schema.
- It fails as `manual`, not `passed`, when required deps, credentials, storage, or service assumptions are missing.

Language-specific preparation:

- Python: normalize doctest prompts, preserve SDK imports, add `PYTHONPATH` when requested, map bulk-import placeholders, and generate/upload Parquet when S3 env is available.
- Go: merge imports, generate `package main` and `func main`, create a temporary module when `DOC_VERIFY_GO_MODULE_DIR` is set, run `go mod tidy`, and add fixture inserts before search.
- Java: merge imports, generate `DocsScenario.main`, infer missing SDK imports when possible, derive or use classpath, and add fixture inserts before search.
- Node/JavaScript: generate `docs_scenario.js` or `docs_scenario.mjs`, strip shebangs, hoist static imports, scope duplicate local declarations, expose common env values through `globalThis`, map common resource literals, and check with `node --check`.
- Bash: generate `docs_scenario.sh`, strip shebangs from snippets, export common env values, map common resource literals, and check with `bash -n`.

## Language Setup

### Python

Use a local PyMilvus checkout when the docs rely on unreleased SDK behavior:

```bash
uv sync --extra bulk_writer
```

Run from the repository root with:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js \
  --doc <doc-url-or-token> \
  --run-scenarios --live --allow-run \
  --languages python \
  --python-command repos/pymilvus/.venv/bin/python \
  --python-path repos/pymilvus \
  --resource-suffix <unique-suffix> \
  --timeout 900000 \
  --report /tmp/feishu-code-verify-python-runtime.json
```

For bulk-import docs, provide S3 env so the verifier can generate a schema-matching Parquet fixture:

- `AWS_ACCESS_KEY` or `DOC_VERIFY_AWS_ACCESS_KEY`
- `AWS_ACCESS_SECRET_KEY`, `AWS_SECRET_ACCESS_KEY`, or `DOC_VERIFY_AWS_SECRET_KEY`
- `AWS_S3_BUCKET` or `DOC_VERIFY_AWS_S3_BUCKET`

By default `DOC_VERIFY_GENERATE_PARQUET=1`, so the runtime path writes a generated Parquet object and rewrites placeholder object URLs to that fixture.

### Go

Use a local Milvus Go SDK checkout for module-aware checks:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js \
  --doc <doc-url-or-token> \
  --run-scenarios --live --allow-run \
  --languages go \
  --go-module-dir repos/milvus-sdk-go \
  --resource-suffix <unique-suffix> \
  --timeout 900000 \
  --report /tmp/feishu-code-verify-go-runtime.json
```

The verifier writes a temporary `go.mod`, adds a local `replace`, runs `go mod tidy`, runs `go test .`, then runs `go run .`. The first run can be slow if Go downloads a newer toolchain or modules.

Runtime scenarios insert a small three-row fixture before search so the search path verifies real data rather than only compiling.

### Node/JavaScript

Use scenario mode when JavaScript snippets form an ordered workflow:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js \
  --doc <doc-url-or-token> \
  --scenario \
  --languages node \
  --report /tmp/feishu-code-verify-node-scenario.json
```

The verifier generates `docs_scenario.js` by default and `docs_scenario.mjs` when snippets use ESM import/export syntax or top-level `await`. Static checks run `node --check`.

Runtime mode uses the same explicit scenario gate:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js \
  --doc <doc-url-or-token> \
  --run-scenarios --live --allow-run \
  --languages node \
  --resource-suffix <unique-suffix> \
  --timeout 900000 \
  --report /tmp/feishu-code-verify-node-runtime.json
```

### Bash

Use scenario mode when shell snippets form an ordered workflow:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js \
  --doc <doc-url-or-token> \
  --scenario \
  --languages bash \
  --report /tmp/feishu-code-verify-bash-scenario.json
```

The verifier generates `docs_scenario.sh`, injects common env variables, and checks with `bash -n`. Runtime mode runs `bash docs_scenario.sh` behind `--run-scenarios --live --allow-run`.

### Java

Prefer deriving the classpath from a local Milvus Java SDK checkout:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js \
  --doc <doc-url-or-token> \
  --run-scenarios --live --allow-run \
  --languages java \
  --java-sdk-repo repos/milvus-sdk-java \
  --resource-suffix <unique-suffix> \
  --timeout 180000 \
  --report /tmp/feishu-code-verify-java-runtime.json
```

The verifier builds `sdk-core`, writes the full Maven dependency classpath to `sdk-core/target/doc-verify-full-classpath.txt`, and uses that plus SDK classes for `javac` and `java`. Set `DOC_VERIFY_JAVA_CLASSPATH` or `--java-classpath` only when you need to override this derived classpath.

Runtime scenarios insert a small three-row fixture before search so the search path verifies real data rather than only compiling.

## Live Env

Set a Zilliz endpoint and token before runtime:

- one of `SERVING_CLUSTER_ENDPOINT`, `ZILLIZ_CLUSTER_ENDPOINT`, `DOC_VERIFY_SERVING_CLUSTER_ENDPOINT`
- one of `TOKEN`, `ZILLIZ_CLUSTER_CREDENTIAL`, `ZILLIZ_API_KEY`, `DOC_VERIFY_TOKEN`, `DOC_VERIFY_ZILLIZ_API_KEY`

Use `.env` for local runs, but never print secret values in reports or chat. Load it in the shell before invoking the verifier:

```bash
set -a
source .env
set +a
```

## Fixture Strategy

Runtime verification should create its own minimal data instead of depending on external sample files or pre-existing collections.

- Use `--resource-suffix` or `DOC_VERIFY_RESOURCE_SUFFIX` to isolate database and collection names.
- Let Python bulk-import scenarios generate a schema-matching Parquet file in S3.
- Let Java and Go scenarios insert a small row fixture before search.
- Keep fixture dimensions aligned with the docs under test. For the tested Zilliz import/search doc, query and inserted vectors use 768 dimensions.

## Interpreting Manual Results

`manual` is not always a problem.

A block should stay `manual` when it is a valid documentation fragment but cannot be verified alone because it depends on setup from previous snippets, SDK classpaths, live credentials, external storage, or service state. It becomes effectively verified when `scenarioCoverage.status=passed` appears for that block or when it is counted in `manualCoveredByScenario`.

Investigate these first:

- `scenarioFailed`
- `scenarioRuntimeFailed`
- `manualUncovered`

## Lessons From the Feishu Fixture

The fixture `https://zilliverse.feishu.cn/wiki/B1XTwQgNRizAMTkZQvrclGSonyc` exposed these reusable patterns:

- Python bulk-import examples need a generated Parquet object that matches the collection schema; placeholder objects are not enough for runnability.
- Java runtime needs a full SDK and Maven dependency classpath, not only local SDK classes.
- Go runtime needs module-aware setup and should run `go mod tidy` before `go test` and `go run`.
- Java and Go search examples need inserted fixture rows before search; compiling the search snippet does not prove the workflow returns valid results.
- Scenario coverage should be reported separately from standalone snippet status so partial docs remain honest while chained workflows can still pass.
