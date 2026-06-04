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

When a live endpoint is only reachable inside a Manta workspace or Kubernetes namespace, use the optional Manta runtime workflow below instead of treating local DNS or network failures as documentation failures.

For Java, provide the SDK classpath explicitly or derive it from a local `milvus-sdk-java` checkout:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --doc <doc-url-or-token> --scenario --languages java --java-sdk-repo repos/milvus-sdk-java
```

For C++, provide the local SDK checkout so SDK includes can be syntax-checked:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --doc <doc-url-or-token> --languages cpp --cpp-sdk-repo repos/milvus-sdk-cpp
```

Run the full SDK-assisted workflow when local SDK checkouts are available:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js \
  --doc <doc-url-or-token> \
  --scenario \
  --languages python,go,java,node,bash,cpp \
  --go-module-dir repos/milvus-sdk-go \
  --node-sdk-repo repos/milvus-sdk-node \
  --java-sdk-repo repos/milvus-sdk-java \
  --cpp-sdk-repo repos/milvus-sdk-cpp
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
- Do not create, delete, or mutate Manta-managed Milvus resources unless the user explicitly asks for it. Prefer reusing a user-provided ready resource for runtime verification.
- Do not use `kubectl` directly for routine verification when `manta-client resource` and `manta-client job` can provide the needed resource status and execution context.

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

Java, Go, and C++ docs often use fragments that rely on setup from previous sections. The verifier uses lightweight harnesses by default:

- Go fragments are wrapped in `package main` and `func main()` and checked with `gofmt`. This validates syntax but not SDK types.
- Java fragments are wrapped in `public class DocsSnippet` with common `java.util.*` imports. If `javac` only reports missing SDK classes or setup variables, the result is `manual` with a classpath/setup hint.
- C++ fragments are wrapped in `int main()`, common standard headers are added, and snippets that reference `milvus::` get `#include <milvus/MilvusClientV2.h>`. Use `DOC_VERIFY_CPP_SDK_REPO` or `--cpp-sdk-repo` for SDK-aware checks.

Disable this with `--no-harness`. See [references/harnesses.md](references/harnesses.md).

## Scenario Mode

Use `--scenario` for step-by-step docs where snippets depend on earlier snippets. The verifier groups snippets by source and language, combines them in document order, and writes generated scenarios under `/tmp/feishu-code-scenarios/<language>/...`.

- Python generates `docs_scenario.py`, injects common env variables, converts simple doctest prompts to code, and checks with `py_compile`.
- Go generates `DocsScenario.go`, merges imports, injects common env variables, and checks syntax with `gofmt`. Set `DOC_VERIFY_GO_MODULE_DIR` or `--go-module-dir` to generate a temporary module with a local `replace` and attempt `go test`.
- Java generates `DocsScenario.java`, combines imports and snippet bodies, injects common env variables, and compiles with `javac`.
- Node/JavaScript generates `docs_scenario.js` or `docs_scenario.mjs`, hoists static imports, scopes duplicate local declarations, injects common env variables on `globalThis`, and checks with `node --check`.
- Bash generates `docs_scenario.sh`, injects common env variables, and checks with `bash -n`.

For Java, provide SDK dependencies through `DOC_VERIFY_JAVA_CLASSPATH` or `--java-classpath`.

When a local Java SDK checkout is available, use `--java-sdk-repo` or `DOC_VERIFY_JAVA_SDK_REPO`. The verifier builds `sdk-core`, writes Maven dependencies to `sdk-core/target/doc-verify-full-classpath.txt`, and uses the SDK jar/classes plus Maven dependencies as the Java classpath. `DOC_VERIFY_JAVA_CLASSPATH` and `--java-classpath` still take precedence.

Scenario mode does not rewrite individual snippet results. A fragment can remain `manual` because it is not self-contained while also receiving `scenarioCoverage.status=passed` when the chained scenario compiles. Use `summary.manualUncovered` to find manual blocks that were not covered by a passing scenario.

To execute generated scenarios, use `--run-scenarios --live --allow-run`. This runs Python with `python3` or `DOC_VERIFY_PYTHON`, Go with `go run .` after module-aware `go mod tidy` and `go test`, Java with `java -cp ... DocsScenario`, Node with `node docs_scenario.js|mjs`, and Bash with `bash docs_scenario.sh`. Runtime scenarios rewrite common collection/database literals to source-scoped isolated names; override the generated suffix with `DOC_VERIFY_RESOURCE_SUFFIX` or `--resource-suffix`. Java and Go runtime scenarios insert a small three-row fixture before search so the query path checks real data; Python and Bash can also prepare StructArray fixtures when docs start from StructArray index/search snippets. Use `DOC_VERIFY_PYTHONPATH` or `--python-path` when Python docs need a local SDK checkout such as `repos/pymilvus`. Use `DOC_VERIFY_NODE_SDK_REPO` or `--node-sdk-repo` for Node runtime imports; if `dist/` is missing, the verifier attempts a local SDK build and reports that result separately. The report includes `scenarioRuntimePassed`, `scenarioRuntimeFailed`, and `scenarioRuntimeManual`.

Runtime SDK rules:

- Python Milvus docs should be verified through `MilvusClient` unless the document explicitly documents the ORM API. Do not add ORM validation just to create fixtures or probes; it increases false failures when `MilvusClient` is the documented surface.
- Java examples should use the Milvus Java SDK v2 surface when generating harnesses or runtime probes.
- Go examples should use the Milvus Go client v2 module/import path when generating harnesses or runtime probes.
- Node examples should use the Milvus Node SDK v2 package/runtime surface when generating harnesses or runtime probes.
- If `--node-sdk-repo` or `DOC_VERIFY_NODE_SDK_REPO` points to a local Node SDK checkout and its `dist/` output is missing, attempt a local build before classifying Node runtime as `manual`. For `repos/milvus-sdk-node`, use `yarn build` when dependencies are installed; if not, install dependencies with the repository's lockfile first, then run `yarn build`. If `yarn` is unavailable, use `npm run build` only after confirming dependencies are present or installing them. Report build failures separately from documentation-code failures.

For an end-to-end runbook and report interpretation guidance, see [references/scenario-workflow.md](references/scenario-workflow.md).

## Live Verification

Live runtime checks require all of:

- in-block annotation such as `doc-verify: run` or `doc-verify: live`;
- `--allow-run`;
- `--live`;
- required env vars for the selected profile.

Generated scenario runtime uses `--run-scenarios --live --allow-run` instead of per-block annotations because the scenario is an explicit whole-document runtime target.

Use `--request-live` to print and report the missing env vars. See [references/live-env.md](references/live-env.md).

## Manta Runtime Verification

Use `manta-client` as an optional live runtime harness when the target Milvus endpoint is internal to a Manta workspace or namespace, for example `*.manta-user-...:19530`, and cannot be reached from the local machine. This is useful for validating docs against temporary Milvus builds or Manta-managed instances, while keeping the default verifier read-only and local.

If the user explicitly asks to verify with a Milvus instance, or asks to use a specific Milvus version/build and no ready endpoint is provided, create the instance with `manta-client` and run the Manta verification flow. Do not fall back to a local Milvus Lite/localhost fixture for that request, because the purpose is to verify against the requested server build.

Verifier flags for the integrated Manta flow:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js \
  --doc <doc-url-or-token> \
  --scenario \
  --run-scenarios \
  --live \
  --allow-run \
  --manta \
  --manta-workspace <workspace> \
  --manta-resource <resource-id-or-name> \
  --report /tmp/feishu-code-verify-manta.json
```

Use `--manta-endpoint <internal-milvus-uri>` when the endpoint is already known. Use `--manta-create-milvus <version-or-image>` only when the user explicitly requested creating a Milvus instance or version-specific verification and did not provide a ready resource. Without `--run-scenarios --live --allow-run`, explicit `--manta` is reported as `mantaRuntimeManual` and no Manta runtime job should be created.

Recommended sequence:

1. Run a local static/scenario baseline first with the repository's current verifier and SDK checkouts:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js \
  --doc <doc-url-or-token> \
  --scenario \
  --languages python,node,bash \
  --python-command repos/pymilvus/.venv/bin/python \
  --python-path repos/pymilvus \
  --report /tmp/feishu-code-verify-static.json
```

2. Confirm the Manta resource is ready and capture its endpoint:

```bash
manta-client resource list --json
manta-client resource info <resource-id> --json
```

3. If the user requested a new Milvus instance and no ready resource exists, create it through a Manta job using the deployment skill, then wait for readiness before verification:

```bash
manta-client job create \
  -w <workspace> \
  -s milvus-deploy \
  -p "Create a temporary Milvus <version-or-build> instance for doc verification. Return resource id/name, namespace, endpoint, image tag, and server readiness. Verify the endpoint is reachable before finishing." \
  -f -T 1800 -j
```

After the job completes, use `manta-client resource list/info` to confirm `ready: true` and copy the internal endpoint into the runtime verification job.

4. If the endpoint is internal-only, create a Manta job in the same workspace/namespace to execute the runtime scenario or an equivalent minimized smoke test:

```bash
manta-client job create \
  -w <workspace> \
  -s milvus-test \
  -p "Run the generated feishu-code-verify runtime scenario against <endpoint>. Create isolated resources, print server version, record pass/fail per documented step, and return artifacts." \
  -f -T 1800 -j
```

5. Track and collect evidence:

```bash
manta-client job info <job-id> --json
manta-client job logs <job-id> -f -T 300
manta-client job artifacts <job-id>
manta-client job download <job-id> output.md -o /tmp/feishu-code-verify-manta-output.md
manta-client job download <job-id> output.json -o /tmp/feishu-code-verify-manta-output.json
```

Allowed `manta-client` usage for this skill:

- `manta-client resource list/info`: check resource readiness, endpoint, namespace, and lease metadata.
- `manta-client job create/info/logs/wait/artifacts/download`: run and collect runtime verification inside the target namespace.
- `manta-client workspace list`: identify the workspace/namespace for internal endpoint access.
- `manta-client cluster list/download-kubeconfig`: only when needed for read-only diagnosis and when `manta-client resource/job` is insufficient.

Avoid these by default:

- creating or deleting Milvus instances unless the user explicitly requests instance lifecycle work or explicitly asks to verify against a Milvus instance/version without providing a ready endpoint;
- running broad or destructive cluster commands;
- patching Feishu docs from a verification pass;
- claiming a doc failed because local DNS cannot resolve a Manta-internal endpoint. Classify that as a local reachability limitation and run a Manta job if live validation is still required.

When reporting Manta runtime results, keep local and Manta evidence separate:

- `staticPassed` / `scenarioPassed`: local extraction and compile/syntax scenario status.
- `localRuntimePassed` / `localRuntimeFailed`: runtime status from the local machine, if attempted.
- `mantaRuntimePassed` / `mantaRuntimeFailed` / `mantaRuntimeManual`: runtime status from the Manta job.

Include these details in the final review:

- Manta job id, resource id/name, namespace, endpoint, and Milvus server version/build.
- SDK/runtime versions used inside the Manta job.
- Exact collection/database names created by the runtime fixture and whether they were cleaned up.
- Per-step pass/fail, especially when service support differs from SDK support.
- Compatibility findings, such as an internal Milvus 3.0 build supporting server-side syntax while the installed SDK lacks a documented helper class.

## Verification Matrix

When choosing what to run for a language, follow [references/verification-matrix.md](references/verification-matrix.md). Prefer weaker but reliable checks over brittle runtime execution.

## Reporting Results

After each verification run, provide a doc-review summary, not just a report path. Explain what passed as raw snippets, what passed only through scenario coverage, what remains manual or failed, and what the source doc should change or clarify. See [references/doc-review-output.md](references/doc-review-output.md).

## Existing SDK Doc Sync Integration

This skill complements `.claude/skills/sdk-doc-sync`:

- Reuse `sdk-doc-sync/src/markdown-to-feishu.js` for authenticated Feishu doc block fetching when needed.
- Reuse `sdk-doc-sync/src/sdk-doc-sync/bitable-writer.js` for bitable reads.
- Keep write-back separate from verification. If remediation is requested, use `sdk-doc-sync` conventions: dry-run/report first, then `patch_document` or bitable update with approval.
