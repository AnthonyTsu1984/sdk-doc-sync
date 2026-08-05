---
name: verified-doc-authoring
description: Use when drafting or substantially revising Milvus or Zilliz technical documentation from Feishu pages, external URLs, local Markdown, product notes, issues, or mixed references, with claims verified against source repositories and implementation logic before publishing or patching a target Feishu/Lark page. Do not use for a verification-only pass over existing code snippets or for release-wide SDK symbol synchronization.
---

# Verified Doc Authoring

Turn mixed references into source-grounded documentation while keeping unresolved claims visible.

## Trigger Boundary

Use for a new technical guide or substantial revision that requires claim verification against Milvus/Zilliz source, public SDK APIs, tests, generated specs, routes, DTOs, or service logic.

Do not use for verification-only snippet checks, release-wide API-reference synchronization, localization, or filling language tabs in one procedure.

## Permission Boundary

- Research, claim inventory, source verification, and a local Markdown draft are allowed by default.
- If no target page is specified, stop with the local draft and request the target before any Feishu write.
- Live patching requires a dry-run, exact target and strategy, explicit approval, write, and refetch verification.
- Never invent methods, fields, defaults, statuses, outputs, or behavioral guarantees. Keep unresolved claims visible.

## Shared Contract

- Capability baseline: [capabilities.json](capabilities.json).
- Shared evidence/result artifacts use `../doc-ops-core/contracts/run-artifact.schema.json` and `../doc-ops-core/src/result-contract.js`.
- Claim interpretation, implementation evidence, and unresolved-status decisions remain domain-local; shared core controls identity, lineage, status, approval, and deterministic output.

## Domain Workflow

1. Collect all references and identify the target, audience, product surface, and requested document role.
2. Extract concrete claims: APIs, endpoints, fields, defaults, enums, lifecycle states, constraints, examples, errors, prerequisites, and side effects.
3. Mark claims `reference-only` until verified against implementation or an accepted canonical spec.
4. Verify API shape with public clients, examples, tests, handlers, DTOs, and specs. For behavioral claims, trace into validators, services, converters, repositories, state transitions, permissions, defaults, and cleanup. A user's statement that the implementation does or does not prove a claim is not repository evidence: inspect the relevant source or accepted canonical spec before assigning `verified`, `contradicted`, or `needs-verification`.
5. Record discrepancies and a visible “Needs further verification” list. Sparse checkout is not evidence of absence; expand it or report why that could not be done.
6. Draft only verified behavior. Keep examples realistic, omit empty placeholder sections, and preserve the target documentation set's navigation and code conventions.
7. Prepare an exact dry-run, obtain explicit approval, patch the target, then refetch and verify headings, prose, code, tables/lists, media, and unresolved-claim visibility.

Use `tmp/verified-doc-authoring/` for run-local exports and drafts. Reuse `api-reference-sync` Feishu converters/specs and `doc-code-verify` for examples; do not create a duplicate converter or authentication stack.

## Required References

- Repository paths, reusable commands, Feishu patching, evidence notes, and report format: [references/workflow.md](references/workflow.md).
- Feishu export/patch tools: `../api-reference-sync/bin/export-doc.js` and `../api-reference-sync/scripts/feishu-doc.js`.
- Code verification: `../doc-code-verify/scripts/verify-feishu-doc-code.js`.

## Output

Report target and patch strategy, references consumed, source/spec evidence, claim statuses, discrepancies corrected, unresolved items, dry-run/approval/write/refetch evidence, and checks that could not run.

Update this skill or its workflow notes only when the user explicitly asks.
