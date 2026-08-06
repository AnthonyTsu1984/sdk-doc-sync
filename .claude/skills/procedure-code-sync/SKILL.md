---
name: procedure-code-sync
description: Use when an existing Feishu/Lark SDK procedure document already has Python workflow examples and needs missing Java, Go, Node.js, RESTful API, Zilliz CLI, or C++ equivalents verified from local source repositories and inserted in canonical language order. Do not use for release-wide API inventory or for verification-only checks that should not modify the document.
---

# Procedure Code Sync

Add source-verified language variants to an existing Python-led procedure without rewriting unrelated content.

## Trigger Boundary

Use when one procedure page has Python examples and needs missing or demonstrably incorrect Java, Go, JavaScript, REST/Bash, Zilliz CLI/Shell, or C++ blocks.

Do not use for release-wide API inventory, narrative drafting, localization, or verification-only work.

## Permission Boundary

- Reading the document, inspecting source repositories, and preparing a dry-run are allowed by default.
- Patch only the exact reviewed code blocks. Do not rewrite unrelated prose, duplicate existing languages, or invent unsupported SDK equivalents.
- Live mutation requires explicit approval of the immutable action batch. Refetch the document after every patch.
- A batch being described as reviewed, ready, correct, or smaller is not write approval. Unless the prompt contains the exact approval bound to the current `batchDigest`, `writesAllowed` remains false and no write tool may be called.
- Treat “reviewed batch” and “approved batch” as different states. A description of exact block operations, prior review, or urgency never substitutes for the current exact digest approval command.

## Shared Contract

- Capability baseline: [capabilities.json](capabilities.json).
- Use `node .claude/skills/procedure-code-sync/bin/procedure-code-sync.js plan --snapshot <blocks.json> --operations <operations.json> --output <plan.json> --session <session.json> --session-id <id>` to build the immutable whole-document review unit and action batch.
- The canonical planner owns the shared action-batch construction contract represented by `doc-ops-core/bin/build-action-batch.js`; do not invoke the shared builder as a substitute for the procedure snapshot and review-unit checks.
- Execute only through the same CLI with `execute --plan <plan.json> --approval <approval.json> --adapter-module <adapter.js> --verifier-module <verifier.js> --journal <execution.jsonl> --output <result.json> --session <session.json>`.
- Approval must match the exact `batchDigest`, targets, action count, and side effects. Verify the live precondition for document revision, parent, and target block identities immediately before mutation.
- After mutation, refetch blocks and run the shared round-trip guard from `../doc-ops-core/`; protected-block loss or unrelated changes block completion.
- `document_blocks` evidence is mandatory before deciding an exact insert/replace operation and again after mutation. A document record, execution journal, or successful API response does not substitute for block IDs, child indexes, and protected-block readback.
- Document acceptance is a separate `accept` command bound to both the execution-journal digest and typed verifier digest. Before acceptance, `rollback-plan` may restore snapshotted replacement blocks and delete only insert-generated block identities that still match live state.

## Domain Workflow

1. Fetch the Feishu document with block IDs and read headings, prose, setup, Python snippets, outputs, and cleanup as one workflow.
2. Group adjacent code blocks by procedure step and inventory existing languages.
3. Verify each requested port against public examples, tests, client APIs, request builders, routes, or CLI definitions in the local SDK repositories. Broaden to the full repository before declaring a gap.
4. Preserve procedure semantics, values, filters, data shapes, and output intent while using idiomatic language APIs.
5. Produce a dry-run with exact insert/replace operations, positions, languages, and evidence; obtain explicit approval for its batch digest.
6. Re-check the current document blocks and patch only digest-approved blocks, inserting from highest child index to lowest when positions could shift.
7. Refetch after every structural patch, then verify canonical order, language labels, source fidelity, no duplicates, and protected surrounding content. Do not report completion from mutation success alone. Bind the typed `doc-code-verify` semantic digest before requesting document acceptance.

Canonical order is: Python, Java, Go, JavaScript, Bash, Shell, C++.

## Required References

- Known feature-specific repository locations: [references/feature-cases.md](references/feature-cases.md).
- Feishu block operations: use `lark-doc`, `lark-cli`, or `../api-reference-sync/scripts/feishu-doc.js`; retain block IDs and child indexes for precise patching.
- Verification entry point: `../doc-code-verify/scripts/verify-feishu-doc-code.js`.

## Output

Report the target document, existing and added languages per group, source evidence, batch digest, exact block operations, write/refetch results, verification findings, and unsupported gaps.
