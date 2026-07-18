---
name: feishu-code-verify
description: Use when existing code examples in Feishu/Lark docs, wiki/doc tokens, local Markdown, or bitable-backed SDK docs need syntax checks, linting, compilation, scenario validation, smoke tests, or carefully gated runtime verification. Do not use to draft the surrounding document or patch missing language examples unless remediation is separately requested.
---

# Feishu Code Verify

Run a read-only verification pass over documentation code examples. Export or extract snippets, classify them, run conservative checks, and write a report. Keep remediation and Feishu write-back separate unless the user explicitly requests them after reviewing the findings.

## Quick Start

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --markdown exported.md
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --doc <doc-url-or-token>
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --bitable <base-token> --table <table-id> --max-docs 20
```

For ordered snippets that form one program:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js \
  --doc <doc-url-or-token> \
  --scenario \
  --languages python,go,java,node,bash,cpp
```

The default report is `/tmp/feishu-code-verify-report.json`.

## Load References As Needed

- Scenario preparation and runtime interpretation: [references/scenario-workflow.md](references/scenario-workflow.md)
- Language and check selection: [references/verification-matrix.md](references/verification-matrix.md)
- Annotations: [references/annotation-schema.md](references/annotation-schema.md)
- Partial-snippet wrappers: [references/harnesses.md](references/harnesses.md)
- Live environment variables: [references/live-env.md](references/live-env.md)
- Runtime safety rules: [references/safety-policy.md](references/safety-policy.md)
- Manta/internal-endpoint execution: [references/manta-runtime.md](references/manta-runtime.md)
- Final review format: [references/doc-review-output.md](references/doc-review-output.md)

## Workflow

1. Resolve local Markdown, direct Feishu documents, or bitable records.
2. Extract every fenced or Feishu code block with its section context.
3. Classify blocks as `parse`, `compile`, `run`, `manual`, or `skip`.
4. Run only the strongest safe and reliable check available.
5. Build language scenarios when snippets depend on earlier setup.
6. Write the JSON report and a human-readable documentation review.
7. Patch Feishu or bitable fields only after the user separately requests remediation, reviews the exact proposed changes, and gives explicit approval.

## Safety Defaults

- Do not execute snippets unless they are annotated for execution and `--allow-run` is present.
- Do not make service or network calls unless `--live` is present.
- Scenario execution requires `--run-scenarios --live --allow-run`.
- Treat credentials, endpoints, destructive calls, and SDK clients as compile/parse-only unless runtime is explicitly approved.
- Use temporary directories and isolated resource suffixes.
- Redact likely secrets from commands, output, reports, and chat.
- Prefer weaker reliable checks over brittle runtime execution.
- Do not patch documentation during a verification-only pass.
- Read [references/safety-policy.md](references/safety-policy.md) before enabling live execution.

## Default Checks

- JSON: parse.
- Python: syntax, `py_compile`, or doctest syntax.
- Bash: `bash -n`.
- JavaScript: `node --check`.
- TypeScript: `tsc --noEmit` when available.
- Go, Java, and C++: complete-source compilation where possible; otherwise use documented harness behavior.
- Ordered Python, Go, Java, Node, Bash, and C++ snippets: scenario construction and compile checks.

## Annotations

Authors can guide the verifier inside code blocks:

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

See [references/annotation-schema.md](references/annotation-schema.md) for the complete schema.

## Harness And Scenario Rules

- Use lightweight harnesses for intentionally incomplete Go, Java, and C++ fragments.
- Use `--no-harness` only when wrappers would misrepresent the documented surface.
- Use `--scenario` for step-by-step documents whose snippets depend on earlier imports, variables, schemas, or fixtures.
- Do not hand-edit generated scenario files to make a run pass. Improve reproducible generation or classify the result as manual.
- Report standalone block status separately from scenario coverage.

For SDK-aware checks, provide the relevant local checkout:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js \
  --doc <doc-url-or-token> \
  --scenario \
  --languages python,go,java,node,bash,cpp \
  --python-path repos/pymilvus \
  --go-module-dir repos/milvus-sdk-go \
  --java-sdk-repo repos/milvus-sdk-java \
  --node-sdk-repo repos/milvus-sdk-node \
  --cpp-sdk-repo repos/milvus-sdk-cpp
```

## Live Verification Routing

Before live execution:

1. Run a static/scenario baseline.
2. Use `--request-live` to report missing environment variables.
3. Confirm the exact endpoint, SDK versions, operations, fixtures, cleanup, and resource suffix.
4. Obtain explicit approval for live execution.

If the endpoint is internal to a Manta workspace or Kubernetes namespace, do not classify local DNS failure as a documentation failure. Follow [references/manta-runtime.md](references/manta-runtime.md).

## Runtime SDK Rules

- Python: use `MilvusClient` unless the page explicitly documents ORM APIs.
- Java: use the Java SDK v2 surface.
- Go: use the Go client v2 surface.
- Node.js: use the Node SDK v2 surface.
- Report SDK build failures separately from documentation-code failures.

## Reporting Results

Provide a documentation review, not only a report path. Separate:

- raw snippets that passed;
- snippets covered only by a passing scenario;
- static, local-runtime, and Manta-runtime evidence;
- genuine failures;
- manual or skipped checks and why;
- prerequisites, fixture, structure, and clarity improvements for the source document.

Use [references/doc-review-output.md](references/doc-review-output.md) for the final shape.
