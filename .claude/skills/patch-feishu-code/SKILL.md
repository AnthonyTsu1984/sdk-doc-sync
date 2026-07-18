---
name: patch-feishu-code
description: Use when an existing Feishu/Lark SDK procedure document already has Python workflow examples and needs missing Java, Go, Node.js, RESTful API, Zilliz CLI, or C++ equivalents verified from local source repositories and inserted in canonical language order. Do not use for release-wide API inventory or for verification-only checks that should not modify the document.
---

# Patch Feishu Code

Use this skill when a Feishu doc already has Python procedure examples and needs the corresponding Java, Go, Node.js, RESTful API, Zilliz CLI, and C++ code blocks added.

## Canonical Order

For every code-tab group or consecutive multi-language example, use this exact order:

1. Python
2. Java
3. Go
4. JavaScript
5. Bash
6. Shell
7. C++

Do not duplicate an existing language block. Insert only missing blocks unless an existing block is clearly wrong or uses the wrong Feishu language.

## Language And Repo Map

| SDK language | Feishu code block language | Local source to inspect |
| --- | --- | --- |
| python | Python | `repos/pymilvus/pymilvus` |
| java | Java | `repos/milvus-sdk-java/sdk-core/src/main/java/io/milvus` |
| go | Go | `repos/milvus-sdk-go/client/milvusclient/` |
| nodejs | JavaScript | `repos/milvus-sdk-node` |
| restful | Bash | `repos/milvus/internal/distributed/proxy/httpserver/` |
| zilliz-cli | Shell | `repos/zilliz-cloud/vdc/zilliz-tui/` |
| c++ | C++ | `repos/milvus-sdk-cpp/src/include/milvus/` |

Use `zilliz-cli` for user requests that say "cli". Use `nodejs` for user requests that say "node".

The map is the starting point, not a hard search boundary. If the Python doc uses a feature that belongs to an SDK add-on module, examples folder, or generated helper outside the mapped folder, broaden the search to the whole SDK repo before declaring a language unsupported. Known example: Java Cloud bulk import APIs live under `repos/milvus-sdk-java/sdk-bulkwriter/`, not `sdk-core/src/main/java/io/milvus`.

## Workflow

1. Resolve and read the Feishu doc.
   - If a Feishu URL/token is supplied, use the `lark-doc` skill or `.claude/skills/sdk-doc-sync/scripts/feishu-doc.js get-blocks <doc-id>` to fetch blocks.
   - Convert to Markdown when useful, but keep block IDs and child indexes available for precise patching.
2. Learn the procedure from the doc before writing code.
   - Read headings, prose, parameter descriptions, expected outputs, and every Python block in order.
   - Identify setup variables, client initialization, collection/index/search/load steps, cleanup, and any dependencies between snippets.
   - Treat Python as the semantic source of the workflow, not as text to mechanically translate.
3. Inventory each code group.
   - Group adjacent code blocks that represent the same procedure step.
   - Record existing languages and missing languages according to the canonical order.
   - If a group has only Python, generate the six missing ports. If a group has some non-Python blocks, preserve them and fill only the gaps.
4. Verify each SDK's real user-facing API from local repos.
   - Use `rg` in the mapped repo path for method names, request/option types, examples, tests, and builders.
   - If the first path has no match, search the full repo for the feature name and route path before concluding no SDK support exists.
   - Prefer public examples/tests and public client APIs over internal implementation details.
   - For RESTful API, inspect routes and handlers under `httpserver`; cross-check any local OpenAPI spec if present, but let server routes win.
   - For Zilliz CLI, inspect command definitions, flags, and examples under `zilliz-tui`.
5. Port the code.
   - Preserve the same procedure, data shape, variable names, collection names, dimensions, filters, and output intent as the Python block.
   - Use idiomatic setup for each SDK, but avoid adding unrelated tutorial material.
   - Keep examples self-contained enough to understand the step; do not invent unavailable SDK APIs.
   - If a language has no real equivalent, do not add a fake block. Report the gap and why it cannot be patched.
6. Patch the Feishu doc.
   - Build code blocks with the exact Feishu language names from the table.
   - Insert missing blocks into each group so the resulting order is `Python`, `Java`, `Go`, `JavaScript`, `Bash`, `Shell`, `C++`.
   - When inserting multiple blocks into the same parent, insert from highest child index to lowest to avoid index shifting.
   - Prefer block-level insert/update with `lark-cli docs +update --api-version v2 --command block_insert_after` or `block_replace`, passing XML content via `--content @file`.
   - Do not pass unsupported flags such as `--format` to `docs +update`; `--format` is for fetch-style commands, not updates.
   - Use `.claude/skills/sdk-doc-sync/docs/converters/patch-document.md` only when a whole-document Markdown patch is safer.
7. Verify after patching.
   - Refetch the doc blocks and confirm every touched group has the canonical order and correct language labels.
   - Run `.claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js` when feasible, at least in parse/compile mode for changed languages.
   - Treat verifier scenario failures carefully: combined JavaScript scenarios can fail from independent snippets redeclaring names, and Java compile checks need a classpath. Inspect per-block status before calling a patch bad.
   - Summarize inserted blocks, skipped languages, and verification results.

## Feature-Specific Cases

When the procedure covers Cloud import jobs, on-demand routing, StructArray/EmbeddingList search, or block-level patch mechanics, read [references/feature-cases.md](references/feature-cases.md). Treat those notes as search guidance and re-verify current public APIs before generating code.

## Porting Rules

- Keep credentials as placeholders or environment variables; never introduce real endpoints, tokens, or secrets.
- Keep destructive operations only if the Python procedure already includes them, and preserve safety guards/comments.
- RESTful examples should be `curl`-style Bash using the documented HTTP endpoint and JSON payload.
- Zilliz CLI examples should be executable shell commands, not prose or pseudo-commands.
- Node.js examples must be labeled `JavaScript`, not `TypeScript`.
- C++ examples must be labeled `C++`, not `cpp` or PlainText.
- Prefer minimal imports/includes required for the shown snippet. Include setup only when the Python block includes comparable setup or the target SDK requires it to make the snippet intelligible.
- Match output handling style across languages: if Python prints a response, show the equivalent print/log statement in the target language.

## Patching Guardrails

- Make a dry-run or written insertion plan before the first write: doc token, target groups, insertion point, languages to add, and source files used for each port.
- Show that exact plan or dry-run and obtain explicit approval before the first live write.
- Put temporary generated XML, helper scripts, fetch outputs, and verification scratch files in `tmp/patch-feishu-code/`.
- Do not rewrite unrelated prose, headings, links, or existing correct code blocks.
- Do not use whole-document replacement for a small code-block insertion unless block-level patching cannot represent the change.
- If the doc is versioned or linked from a bitable, follow the version-aware update rules in `.claude/skills/sdk-doc-sync/SKILL.md` before writing.
- After writing, refetch from Feishu instead of trusting local generated Markdown.
