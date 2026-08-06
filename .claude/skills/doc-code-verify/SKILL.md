---
name: doc-code-verify
description: Use when existing code examples in Feishu/Lark docs, wiki/doc tokens, local Markdown, or bitable-backed SDK docs need syntax checks, linting, compilation, scenario validation, smoke tests, or carefully gated runtime verification. Do not use to draft the surrounding document or patch missing language examples unless remediation is separately requested.
---

# Doc Code Verify

Run deterministic, read-only verification over documentation code examples and keep remediation separate.

## Trigger Boundary

Use for parse, lint, compile, scenario, smoke, or explicitly approved runtime verification of existing snippets from Markdown, Docx/wiki, or Bitable-backed documents.

Do not use to draft surrounding prose or to add missing language variants.

## Permission Boundary

- Verification is read-only by default. Do not patch documents or Bitable fields during the verification pass.
- Do not execute snippets unless they are annotated and `--allow-run` is present.
- Do not make service or network calls unless `--live` is present. Scenario execution requires `--run-scenarios --live --allow-run`.
- For a live manifest containing create, update, or delete effects, `--live --allow-run` is necessary but insufficient. The verifier must first write the exact runtime manifest, then receive `--approve-runtime-digest sha256:<digest>` for that manifest before executing.
- Treat credentials, destructive calls, and SDK clients as parse/compile-only unless runtime scope and cleanup are explicitly approved.
- Mutating live runs require an isolated resource suffix, a write-ahead runtime journal, verified cleanup observations, and either zero residual resources or a `BLOCKED` result with exact recovery commands.
- Remediation requires a separate request, exact preview, explicit approval, write, and refetch verification.

## Shared Contract

- Capability baseline: [capabilities.json](capabilities.json).
- Shared result schema: `../doc-ops-core/contracts/run-artifact.schema.json`; status, exit code, diagnostics, artifact paths, and semantic digest follow `../doc-ops-core/src/result-contract.js`.
- The JSON report retains detailed per-block evidence and adds a top-level `contract` envelope. Runtime timestamps and temporary paths do not affect the semantic digest.
- A typed remediation handoff may name exact block IDs, diagnostics, source evidence, and the recommended owning skill. It always sets `writeAuthorized: false`; `procedure-code-sync` or `verified-doc-authoring` must build a new action batch.

Quick start:

```bash
node .claude/skills/doc-code-verify/scripts/verify-feishu-doc-code.js --markdown exported.md
node .claude/skills/doc-code-verify/scripts/verify-feishu-doc-code.js --doc <doc-url-or-token>
node .claude/skills/doc-code-verify/scripts/verify-feishu-doc-code.js --bitable <base-token> --table <table-id> --max-docs 20
```

## Domain Workflow

1. Resolve the source and extract every code block with document, section, language, and block identity.
2. Classify each block as `parse`, `compile`, `run`, `manual`, or `skip`.
3. Run the strongest safe reliable check. Use scenario construction when ordered snippets form one program, but retain raw-block results separately.
4. Before live execution, materialize the exact runtime manifest: snippets/scenarios, env groups, network targets, isolated resources, expected mutations, cleanup actions, timeouts, and side-effect classes. Require its digest approval when mutating.
5. Journal prepared mutation/cleanup actions and observed outcomes. Do not report a clean completion while residual resources remain.
6. Normalize diagnostics by stable code and target identity; redact likely secrets from commands and output.
7. Write the machine-readable report and a concise human review. The default report is `/tmp/feishu-code-verify-report.json`.
8. If fixes are requested, emit a read-only remediation handoff and use the appropriate write skill only after a separate action batch and approval.

Default checks include JSON parse, Python syntax/`py_compile`, `bash -n`, `node --check`, `tsc --noEmit` when available, and complete-source Go/Java/C++ compilation when feasible.

## Required References

- Scenarios and interpretation: [references/scenario-workflow.md](references/scenario-workflow.md).
- Language/check matrix and wrappers: [references/verification-matrix.md](references/verification-matrix.md), [references/annotation-schema.md](references/annotation-schema.md), and [references/harnesses.md](references/harnesses.md).
- Runtime safety: [references/live-env.md](references/live-env.md), [references/safety-policy.md](references/safety-policy.md), and [references/manta-runtime.md](references/manta-runtime.md).
- Final review format: [references/doc-review-output.md](references/doc-review-output.md).

## Output

Report normalized status and exit code, semantic digest, artifact path, block/scenario counts, deterministic diagnostics, skipped checks and reasons, runtime-manifest digest, live actions performed, runtime-journal digest, cleanup/residual evidence and recovery commands, and the read-only remediation-handoff digest when requested.
