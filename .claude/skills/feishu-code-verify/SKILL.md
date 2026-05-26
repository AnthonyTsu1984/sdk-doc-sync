---
name: feishu-code-verify
description: Verify code examples in Feishu/Lark docs, docx URLs, wiki/doc tokens, local Markdown exports, or bitable-backed SDK docs. Use when the user asks to test, lint, compile, smoke-test, audit, or validate documentation code snippets before or after syncing Feishu docs.
---

# Feishu Code Verify

Use this skill to run a read-only verification pass over code examples in Feishu documentation. The default workflow never patches Feishu; it exports/extracts, classifies snippets, runs conservative checks, and writes a report.

## Quick Start

From the repository root:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --markdown exported.md
```

Verify a single Feishu docx URL or token:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --doc <doc-url-or-token>
```

Verify docs listed in a bitable:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --bitable <base-token> --table <table-id> --max-docs 20
```

Ask for the env vars needed to attempt live runtime verification:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --doc <doc-url-or-token> --request-live
```

Build chained scenarios from ordered snippets:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --doc <doc-url-or-token> --scenario --languages python,go,java,node,bash
```

For the full compile-to-runtime workflow, including local SDK checkouts and live fixtures, read [references/scenario-workflow.md](references/scenario-workflow.md).

For Java, provide the SDK classpath explicitly or derive it from a local `milvus-sdk-java` checkout:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --doc <doc-url-or-token> --scenario --languages java --java-sdk-repo repos/milvus-sdk-java
```

The default report path is `/tmp/feishu-code-verify-report.json`.

## Workflow

1. Resolve input: local Markdown, direct Feishu doc, or bitable records.
2. Extract fenced code blocks or Feishu code blocks with section context.
3. Classify every block as `parse`, `compile`, `run`, `manual`, or `skip`.
4. Execute only safe checks by default:
   - JSON parse.
   - Python syntax/py_compile or doctest syntax when applicable.
   - Bash `bash -n`.
   - JavaScript `node --check`.
   - TypeScript `tsc --noEmit` only when `tsc` is available.
   - Go/Java/C++ complete source checks when possible.
   - Go/Java partial snippet harness checks when docs intentionally omit boilerplate.
   - Python/Go/Java/Node/Bash scenario checks when snippets form ordered workflows.
5. Write a JSON report and print a short summary.
6. Summarize the verification results and suggest documentation improvements, covering script correctness, structure, procedure, prerequisites, fixtures, and missing information. Use [references/doc-review-output.md](references/doc-review-output.md).
7. Only patch Feishu or bitable fields if the user explicitly asks after reviewing the report.

## Safety Defaults

- Do not run snippets unless they are explicitly annotated and `--allow-run` is passed.
- Do not make network/service calls unless `--live` is passed.
- Examples containing credentials, API keys, cluster endpoints, delete/drop/remove operations, or SDK clients may still receive non-executing parse/compile checks. Runtime execution remains `manual` unless explicitly allowed.
- Use temp directories for generated harness files.
- Redact likely secrets from command output.

Read [references/safety-policy.md](references/safety-policy.md) before enabling `--allow-run` or `--live`.

## Annotations

Authors can guide verification with comments inside code blocks:

```python
# doc-verify: compile
```

```bash
# doc-verify: run
# doc-verify-timeout: 10000
```

```python
# doc-verify: skip reason="requires a running Milvus cluster"
```

See [references/annotation-schema.md](references/annotation-schema.md) for supported annotations.

## Harnesses

Java and Go docs often use fragments that rely on setup from previous sections. The verifier uses lightweight harnesses by default:

- Go fragments are wrapped in `package main` and `func main()` and checked with `gofmt`. This validates syntax but not SDK types.
- Java fragments are wrapped in `public class DocsSnippet` with common `java.util.*` imports. If `javac` only reports missing SDK classes or setup variables, the result is `manual` with a classpath/setup hint.

Disable this with `--no-harness`. See [references/harnesses.md](references/harnesses.md).

## Scenario Mode

Use `--scenario` for step-by-step docs where snippets depend on earlier snippets. The verifier groups snippets by source and language, combines them in document order, and writes generated scenarios under `/tmp/feishu-code-scenarios/<language>/...`.

- Python generates `docs_scenario.py`, injects common env variables, converts simple doctest prompts to code, and checks with `py_compile`.
- Go generates `DocsScenario.go`, merges imports, injects common env variables, and checks syntax with `gofmt`. Set `DOC_VERIFY_GO_MODULE_DIR` or `--go-module-dir` to generate a temporary module with a local `replace` and attempt `go test`.
- Java generates `DocsScenario.java`, combines imports and snippet bodies, injects common env variables, and compiles with `javac`.
- Node/JavaScript generates `docs_scenario.js` or `docs_scenario.mjs`, injects common env variables on `globalThis`, and checks with `node --check`.
- Bash generates `docs_scenario.sh`, injects common env variables, and checks with `bash -n`.

For Java, provide SDK dependencies through `DOC_VERIFY_JAVA_CLASSPATH` or `--java-classpath`.

When a local Java SDK checkout is available, use `--java-sdk-repo` or `DOC_VERIFY_JAVA_SDK_REPO`. The verifier builds `sdk-core`, writes Maven dependencies to `sdk-core/target/doc-verify-full-classpath.txt`, and uses the SDK jar/classes plus Maven dependencies as the Java classpath. `DOC_VERIFY_JAVA_CLASSPATH` and `--java-classpath` still take precedence.

Scenario mode does not rewrite individual snippet results. A fragment can remain `manual` because it is not self-contained while also receiving `scenarioCoverage.status=passed` when the chained scenario compiles. Use `summary.manualUncovered` to find manual blocks that were not covered by a passing scenario.

To execute generated scenarios, use `--run-scenarios --live --allow-run`. This runs Python with `python3` or `DOC_VERIFY_PYTHON`, Go with `go run .` after module-aware `go mod tidy` and `go test`, Java with `java -cp ... DocsScenario`, Node with `node docs_scenario.js|mjs`, and Bash with `bash docs_scenario.sh`. Runtime scenarios rewrite common `my_database` and `prod_collection` literals to isolated names; override the generated suffix with `DOC_VERIFY_RESOURCE_SUFFIX` or `--resource-suffix`. Java and Go runtime scenarios insert a small three-row fixture before search so the query path checks real data. Use `DOC_VERIFY_PYTHONPATH` or `--python-path` when Python docs need a local SDK checkout such as `repos/pymilvus`. The report includes `scenarioRuntimePassed`, `scenarioRuntimeFailed`, and `scenarioRuntimeManual`.

For an end-to-end runbook and report interpretation guidance, see [references/scenario-workflow.md](references/scenario-workflow.md).

## Live Verification

Live runtime checks require all of:

- in-block annotation such as `doc-verify: run` or `doc-verify: live`;
- `--allow-run`;
- `--live`;
- required env vars for the selected profile.

Generated scenario runtime uses `--run-scenarios --live --allow-run` instead of per-block annotations because the scenario is an explicit whole-document runtime target.

Use `--request-live` to print and report the missing env vars. See [references/live-env.md](references/live-env.md).

## Verification Matrix

When choosing what to run for a language, follow [references/verification-matrix.md](references/verification-matrix.md). Prefer weaker but reliable checks over brittle runtime execution.

## Reporting Results

After each verification run, provide a doc-review summary, not just a report path. Explain what passed as raw snippets, what passed only through scenario coverage, what remains manual or failed, and what the source doc should change or clarify. See [references/doc-review-output.md](references/doc-review-output.md).

## Existing SDK Doc Sync Integration

This skill complements `.claude/skills/sdk-doc-sync`:

- Reuse `sdk-doc-sync/src/markdown-to-feishu.js` for authenticated Feishu doc block fetching when needed.
- Reuse `sdk-doc-sync/src/sdk-doc-sync/bitable-writer.js` for bitable reads.
- Keep write-back separate from verification. If remediation is requested, use `sdk-doc-sync` conventions: dry-run/report first, then `patch_document` or bitable update with approval.
