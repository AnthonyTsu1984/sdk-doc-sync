---
name: draft-verified-docs
description: Draft technical documentation from supplied references and publish or patch it on a specified Feishu/Lark doc page. Use when the user provides Feishu docs, wiki/doc tokens, external URLs, local Markdown, product notes, issue links, or mixed references and wants a Milvus or Zilliz technical doc drafted after verifying claims against the actual Milvus, SDK, Zilliz Cloud, or Zilliz CLI source repos, including service/business logic in Milvus or Zilliz Cloud implementations. Also use when asked to list unresolved verification items before or while drafting docs.
---

# Draft Verified Docs

Use this skill to turn reference material into source-verified Milvus/Zilliz documentation. Treat supplied references as leads, not ground truth. The source repos and generated specs are the authority for API shape, service behavior, supported languages, request fields, response fields, examples, and version constraints.

For concrete repo paths, reusable commands, and report format, read [references/workflow.md](references/workflow.md).

## Core Workflow

1. Collect inputs.
   - Identify every reference: Feishu doc URL/token, wiki URL/token, external URL, local file, issue, PR, release note, or pasted text.
   - Identify the target Feishu doc page to patch. If no target page is specified, draft Markdown locally and ask for the target before writing to Feishu.
   - Identify the product surface: Milvus server REST API, Zilliz Cloud REST API, PyMilvus, Java SDK, Go SDK, Node SDK, C++ SDK, Zilliz CLI, or cross-SDK procedure.
2. Extract reference content.
   - For Feishu docs, use `.claude/skills/sdk-doc-sync/bin/export-doc.js <doc-token-or-url> <tmp-file.md>` or `scripts/feishu-doc.js get-blocks <doc-id>` when block IDs matter.
   - For external URLs, fetch the page content with the available web or Tavily tooling. Record URL, title, and retrieval date in the working notes.
   - Put temporary exports and drafts under `tmp/draft-verified-docs/`.
3. Build a claim inventory.
   - Convert the references into a checklist of concrete claims: endpoint paths, method names, parameters, defaults, enum values, lifecycle states, constraints, examples, errors, and prerequisites.
   - Mark each claim as `reference-only` until verified against code or an accepted canonical spec.
4. Verify against source.
   - Search the relevant local repo paths with `rg`; broaden from mapped directories to the full repo before declaring a feature unsupported.
   - Check whether `repos/milvus` or `repos/zilliz-cloud` is sparse before verifying service logic. If the needed implementation path is missing because of sparse checkout, expand the checkout first when feasible.
   - For REST APIs, compare source handlers/DTOs with `.claude/skills/sdk-doc-sync/specs/openapi-milvus.json` or `openapi-cloud.json` as appropriate.
   - For service-behavior claims, trace beyond route/DTO/API shape into Milvus or Zilliz Cloud implementation logic: handlers, validators, service methods, converters, remote-client calls, repositories/DAOs, state transitions, defaults, permission checks, and error handling.
   - Require at least one implementation-level evidence point for behavioral claims such as lifecycle semantics, automatic actions, async jobs, validation side effects, limits, state changes, defaulting, cleanup, billing/resource effects, or cross-service calls.
   - Prefer public SDK APIs, examples, tests, request builders, route handlers, and DTOs over internal helper code.
   - If code and reference docs disagree, trust code and list the discrepancy.
5. List unresolved verification.
   - Before writing the final draft, produce a concise "Needs further verification" list for claims that cannot be proven from local source, require product confirmation, depend on live service behavior, or have conflicting evidence.
   - Do not hide uncertain claims inside polished prose.
6. Draft the document.
   - Write from verified behavior. Use reference docs for structure and context only after checking factual claims.
   - Keep examples realistic and consistent with verified SDK/API usage. Do not invent SDK methods, endpoint fields, flags, statuses, or outputs.
   - Include a short "Needs further verification" section in the draft when unresolved items remain, unless the user explicitly wants that list outside the doc.
7. Patch the target Feishu page.
   - Prepare a Markdown draft first.
   - Use `.claude/skills/sdk-doc-sync/scripts/feishu-doc.js patch <target-doc-id> <draft.md> --strategy smart|replace|append`.
   - If the target page cannot be patched by the Node helper or the user asks for `lark-cli`, use the Feishu/Lark CLI workflow in [references/workflow.md](references/workflow.md#feishulark-cli-patching).
   - Use `--dry-run` before the first live patch when the target already contains content or when the requested edit scope is ambiguous.
   - After patching, refetch/export the target page and verify that headings, code blocks, tables/lists, and the unresolved-verification section rendered as intended.

## Dependency Reuse

Reuse the existing `.claude/skills/sdk-doc-sync` dependencies and scripts. Do not add a new package.json, install a second converter stack, or duplicate Feishu auth logic for this skill.

Use these existing assets when needed:

- Feishu export: `.claude/skills/sdk-doc-sync/bin/export-doc.js`
- Feishu push/patch/blocks/folder/bitable CLI: `.claude/skills/sdk-doc-sync/scripts/feishu-doc.js`
- Markdown to Feishu converter: `.claude/skills/sdk-doc-sync/src/markdown-to-feishu.js`
- Feishu to Markdown converter: `.claude/skills/sdk-doc-sync/src/feishu-to-markdown.js`
- Bitable writer/reader support: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/bitable-writer.js`
- Milvus and Zilliz OpenAPI specs: `.claude/skills/sdk-doc-sync/specs/openapi-milvus.json` and `openapi-cloud.json`
- Code example verification: `.claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js`

## Draft Quality Rules

- Cite internal working evidence in notes: reference source, API-shape evidence, service-logic evidence, source-code file path, relevant symbol/route/DTO/service method, and verification status.
- Use precise product names: Milvus, Zilliz Cloud, Zilliz CLI, PyMilvus, Milvus Java SDK, Milvus Go SDK, Milvus Node.js SDK, Milvus C++ SDK.
- Keep credentials, endpoints, project IDs, cluster IDs, collection names, and object storage paths as placeholders unless the source reference provides safe sample values.
- Avoid unsupported absolutes such as "always", "all", or "automatically" unless code confirms them.
- Do not mark a behavior unresolved solely because the local sparse checkout lacks the relevant Milvus or Zilliz Cloud path; first try to expand the checkout or explicitly report why expansion could not be done.
- If a generated example cannot be syntax-checked or compile-checked, say why in the final report.

## Final Report

After drafting or patching, summarize:

- Target Feishu page and patch strategy used.
- Reference inputs consumed.
- Source repos/specs checked.
- Main discrepancies corrected from the references.
- Items needing further verification.
- Verification performed on the final page or draft, including any command that could not run.
