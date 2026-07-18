# Draft Verified Docs Workflow Reference

Load this file when using `draft-verified-docs`. It records the source map, reusable commands, and evidence format for drafting source-verified Milvus/Zilliz docs. Verification must cover both public API shape and implementation/service logic when the references make behavioral claims.

## Source Map

Use these as starting points, then broaden with `rg` if the mapped path does not contain the relevant public API.

| Surface | Source of truth |
| --- | --- |
| PyMilvus | `repos/pymilvus/pymilvus` |
| Milvus Java SDK | `repos/milvus-sdk-java/sdk-core/src/main/java/io/milvus`; also check `repos/milvus-sdk-java/sdk-bulkwriter` for bulk import/cloud helper APIs |
| Milvus Go SDK | `repos/milvus-sdk-go/client/milvusclient` |
| Milvus Node.js SDK | `repos/milvus-sdk-node` |
| Milvus C++ SDK | `repos/milvus-sdk-cpp/src/include/milvus` and examples/tests under `repos/milvus-sdk-cpp` |
| Milvus REST API | `repos/milvus/internal/distributed/proxy/httpserver` plus `.claude/skills/sdk-doc-sync/specs/openapi-milvus.json` |
| Milvus service logic | Start from `repos/milvus/internal/distributed/proxy/httpserver`; trace calls into Milvus implementation files. If sparse checkout hides the needed path, expand the checkout before marking behavior unresolved. |
| Zilliz Cloud REST API | `repos/zilliz-cloud/vdc/global/cloud-control-api/src/main/java/com/zilliz/cloud/control/api/controller` plus `.claude/skills/sdk-doc-sync/specs/openapi-cloud.json` |
| Zilliz Cloud service logic | `repos/zilliz-cloud/vdc/global/cloud-control-api/src/main/java/com/zilliz/cloud/control/api/services`, `repository`, `commons/validators`, `commons/utils`, `config`, `kafka`, and any controller-injected service dependencies. If a referenced service dependency lives outside the sparse checkout, expand the checkout before marking behavior unresolved. |
| Zilliz CLI | `repos/zilliz-cloud/vdc/zilliz-tui`, `repos/zilliz-cloud/vdc/zilliz-cli`, and public release repo `repos/zilliz-cli` |

Related sdk-doc-sync reference files:

- Python: `.claude/skills/sdk-doc-sync/sdk-python.md`
- Java: `.claude/skills/sdk-doc-sync/sdk-java.md`
- Go: `.claude/skills/sdk-doc-sync/sdk-go.md`
- Node.js: `.claude/skills/sdk-doc-sync/sdk-node.md`
- C++: `.claude/skills/sdk-doc-sync/sdk-cpp.md`
- REST/OpenAPI: `.claude/skills/sdk-doc-sync/sdk-rest.md`
- Zilliz CLI: `.claude/skills/sdk-doc-sync/sdk-zilliz-cli.md`
- SDK alignment: `.claude/skills/sdk-doc-sync/sdk-alignment.md`

## Reference Extraction

Create scratch files under `tmp/draft-verified-docs/`.

Export a Feishu doc:

```bash
node .claude/skills/sdk-doc-sync/bin/export-doc.js <doc-token-or-url> tmp/draft-verified-docs/reference.md
```

Fetch Feishu blocks when precise patch anchors or language labels matter:

```bash
node .claude/skills/sdk-doc-sync/scripts/feishu-doc.js get-blocks <doc-token>
```

Fetch external URLs with available web/Tavily tooling. For each external source, record:

- URL
- title
- retrieval date
- sections used
- claims extracted

If an external URL cannot be fetched because network access is blocked or the page requires auth, list it in "Needs further verification" instead of guessing.

## Claim Inventory

Build a table in notes before drafting:

| Claim | Reference source | API-shape evidence | Service-logic evidence | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Endpoint path, SDK method, parameter, default, status, error, or behavior | Feishu/external/local ref | route/spec/DTO/SDK method/test/example | handler/service/validator/converter/repository/remote-client call | verified / contradicted / needs-verification | concise evidence |

Use `contradicted` when code and references disagree. In the final draft, follow code and mention the discrepancy in the final report.

Use `needs-verification` for:

- live service behavior not visible from checked-out code;
- Milvus downstream behavior that cannot be traced beyond the sparse HTTP handler checkout;
- feature gating, account-plan constraints, or rollout state;
- ambiguous docs or source comments;
- behavior hidden behind generated code that is not checked out;
- examples that need real credentials, object storage, or running clusters;
- anything only supported by an internal implementation but not public API.

## Search Tactics

Use `rg` first.

```bash
rg -n "<method-or-field>" repos/pymilvus/pymilvus
rg -n "<RequestClass|Builder|fieldName>" repos/milvus-sdk-java
rg -n "<method-or-option>" repos/milvus-sdk-go/client/milvusclient repos/milvus-sdk-go/examples repos/milvus-sdk-go/tests
rg -n "<method-or-field>" repos/milvus-sdk-node
rg -n "<method|param|enum>" repos/milvus-sdk-cpp/src/include/milvus repos/milvus-sdk-cpp/examples repos/milvus-sdk-cpp/test
rg -n "<route|request-field|handler>" repos/milvus/internal/distributed/proxy/httpserver
rg -n "<service-method|state|default|validation|error>" repos/milvus
rg -n "<endpoint|DTO|field|enum>" repos/zilliz-cloud/vdc/global/cloud-control-api/src/main/java/com/zilliz/cloud/control/api/controller
rg -n "<service-method|state|default|validation|error>" repos/zilliz-cloud/vdc/global/cloud-control-api/src/main/java/com/zilliz/cloud/control/api/services repos/zilliz-cloud/vdc/global/cloud-control-api/src/main/java/com/zilliz/cloud/control/api/commons repos/zilliz-cloud/vdc/global/cloud-control-api/src/main/java/com/zilliz/cloud/control/api/repository
rg -n "<command|flag|resource>" repos/zilliz-cloud/vdc/zilliz-tui repos/zilliz-cloud/vdc/zilliz-cli repos/zilliz-cli
```

For REST docs:

- Milvus server routes and Go structs win over old docs for API shape, but behavioral claims must be traced into handler/wrapper/proxy/service logic where available.
- Zilliz Cloud Java DTOs/controllers and `openapi-cloud.json` verify API shape. Behavioral claims must also be checked against service methods, validators, converters, repositories/DAOs, remote-client calls, and tests where available.
- Do not mix Milvus server OpenAPI paths into Cloud docs or Cloud paths into Milvus server docs.

## Repository Completeness

Before proving service behavior, check whether the needed source is present. Both `repos/milvus` and `repos/zilliz-cloud` may be sparse and partial clones.

Check sparse status:

```bash
git -C repos/milvus config --get core.sparseCheckout
git -C repos/milvus sparse-checkout list
git -C repos/zilliz-cloud config --get core.sparseCheckout
git -C repos/zilliz-cloud sparse-checkout list
```

Rule:

- If a behavioral claim requires source outside the current sparse checkout, expand the checkout before concluding the claim cannot be verified.
- Prefer adding the smallest relevant directories first. Use full checkout only when the call chain crosses many missing directories or the feature area is unclear.
- If expansion fails because network access or permissions are unavailable, report that explicitly in "Needs further verification".
- Do not silently downgrade service-logic verification to route/DTO verification because the local checkout is incomplete.

Milvus expansion starting point:

```bash
git -C repos/milvus sparse-checkout add \
  internal/proxy \
  internal/types \
  internal/util \
  internal/rootcoord \
  internal/querycoord \
  internal/datacoord \
  internal/indexcoord \
  internal/streaming \
  pkg
```

If a Milvus behavior still cannot be traced and broad source is required:

```bash
git -C repos/milvus sparse-checkout disable
```

Zilliz Cloud expansion starting point:

```bash
git -C repos/zilliz-cloud sparse-checkout add \
  vdc/global/cloud-control-api \
  vdc/zilliz-cli \
  vdc/zilliz-tui
```

If controller-injected services, shared modules, remote clients, generated models, or infrastructure code live outside the current sparse paths, add the specific missing `vdc/...` directories. If the behavior spans unknown cross-service dependencies, use:

```bash
git -C repos/zilliz-cloud sparse-checkout disable
```

## Service-Logic Verification

Do not treat a matching route, method signature, DTO field, or OpenAPI schema as enough evidence for behavior. For every behavioral claim in the reference docs, find implementation evidence or list it as unresolved.

Behavioral claims include:

- lifecycle/state transitions, such as creating, pausing, resuming, importing, restoring, refreshing, or deleting;
- automatic or background behavior, such as async job creation, polling, scheduled cleanup, retries, or synchronization;
- default values and server-side defaulting;
- validation side effects, normalization, coercion, or field interactions;
- permission, project, organization, region, plan, quota, billing, or feature-gate checks;
- resource effects, such as creating dependent resources, calling remote services, writing records, publishing messages, or updating status;
- error conditions and response status/message mapping.

For Zilliz Cloud, trace this chain when possible:

1. `Open*Controller.java` route and request/response DTO.
2. Injected service method called by the controller.
3. Service implementation and converters under `services/`.
4. Validators under `commons/validators` and constants/enums under `commons/`.
5. Repository/DAO writes or reads under `repository/`.
6. Remote service/client calls, Kafka/event publishing, job-center calls, or config-gated branches.
7. Tests that assert the behavior, if present.

For Milvus server REST, trace this chain when possible:

1. `handler_v2.go` or `handler_v1.go` route registration.
2. Request struct and wrapper/conversion logic in `request*.go`, `wrap_request.go`, `wrapper.go`, `utils.go`, or resource-specific handlers.
3. Proxy/client call and request fields passed to the downstream Milvus service.
4. Available tests for request validation, wrapping, response rendering, or resource behavior.
5. If the sparse checkout does not contain downstream service implementation, expand it as described in "Repository Completeness". Only mark deeper behavior as `needs-verification` after expansion is impossible or still does not expose the needed implementation.

Evidence is strong when it points to a concrete branch, method call, validator, enum, assignment, repository update, remote call, or test assertion. Evidence is weak when it is only a comment, schema, generated docs, or naming similarity.

For SDK examples:

- Prefer official examples/tests and public request builders.
- If a language lacks a real public equivalent, report the gap. Do not add a normal example that silently omits the feature.
- For cross-SDK docs, use `patch-feishu-code` conventions for language labels and ordering when code-tab groups are involved.

## Draft Structure

Choose the structure that fits the target page, but most docs should include:

1. A concise overview of what the operation or feature does.
2. Prerequisites and constraints.
3. Request/API/SDK syntax with verified parameters or options.
4. Examples using placeholders for credentials and endpoints.
5. Response/output interpretation when source supports it.
6. Error handling or caveats when verified.
7. "Needs further verification" when unresolved items remain.

Match the page's role in the doc set:

- Overview/concept pages should explain what the feature is and carry durable constraints or limits. Do not insert long operational workflows there when a manage/how-to/use-case page exists.
- Manage/how-to pages are the right place for ordered workflows, prerequisites, request syntax, and full SDK/API examples.
- Use-case pages should describe why and when to use the feature, then link into or summarize the manage/how-to workflow. Keep scenario examples focused.
- Do not add placeholder headings such as "Create X", "Restore X", or "Drop X" unless the heading has verified body content or an existing publishing system fills it.
- For repeated facts across related pages, use a short restriction/caveat on secondary pages and keep the full explanation in one primary workflow page.

Keep Feishu Markdown converter constraints in mind:

- Avoid deeply nested bullets for parameter docs.
- Use tight lists when writing parameter lists.
- Use fenced code blocks with correct language labels.
- Keep each logical paragraph or list item as its own Markdown line/block.
- Preserve existing code-tab conventions. When a page has examples for Python, Java, Go, Node.js, and cURL, keep that language order and include explicit placeholder blocks only if the page already uses placeholders for unsupported languages.
- Use real code fence language labels (`python`, `java`, `go`, `javascript`, `bash`) rather than generic `plaintext` for SDK/API snippets.

## Learning From User Edits

When the user edits a page after publication and asks for the rules:

1. Export the current page and diff it against the draft or final export saved under `tmp/draft-verified-docs/`.
2. Classify removed content as placement, style, factual, example, or tooling/rendering feedback.
3. Treat repeated edits across pages as candidate reusable rules. Report them and update the skill only when the user explicitly asks.
4. Do not re-add removed content unless the user explicitly asks; the edited page is the newest source of editorial intent.
5. Keep a short note in the final report naming the inferred rules and, when an update was requested, the skill files changed.

## Feishu Write-Back

Patch an existing target page:

```bash
node .claude/skills/sdk-doc-sync/scripts/feishu-doc.js patch <target-doc-id> tmp/draft-verified-docs/draft.md --strategy smart --dry-run
node .claude/skills/sdk-doc-sync/scripts/feishu-doc.js patch <target-doc-id> tmp/draft-verified-docs/draft.md --strategy smart
```

Use `replace` only when the user wants the page rewritten. Use `append` only when the target page should keep existing content and receive a new section at the end.

Push a new doc only if the user asks for creation and supplies a folder or wiki space:

```bash
node .claude/skills/sdk-doc-sync/scripts/feishu-doc.js push tmp/draft-verified-docs/draft.md --folder <folder-token> --title "<title>" --dry-run
node .claude/skills/sdk-doc-sync/scripts/feishu-doc.js push tmp/draft-verified-docs/draft.md --folder <folder-token> --title "<title>"
```

After any live write, export or fetch the target again:

```bash
node .claude/skills/sdk-doc-sync/bin/export-doc.js <target-doc-id> tmp/draft-verified-docs/after.md
```

Inspect the result for lost headings, malformed lists, incorrect code block languages, broken links, and missing "Needs further verification" items.

Do not use whole-page overwrite as a repair shortcut for existing docs with synced blocks, code-tab groups, includes, reference blocks, tables, or hand-maintained anchors unless the user explicitly requests a rebuild. Whole-page overwrite can flatten code tabs, change language metadata, delete synced/reference structures, and replace anchorable block IDs. If a smart patch creates duplicated leading blocks, malformed code fences, or block-order issues, stop and switch to precise `lark-cli` block operations after refetching current block IDs.

## Feishu/Lark CLI Patching

Use this path when a page is not editable through the Node helper, when the user explicitly asks for `lark-cli`, or when a precise block-level patch is safer than a whole-page smart patch.

Fetch with user identity and v2 API:

```bash
lark-cli docs +fetch --api-version v2 --as user --doc "<wiki-or-doc-url>" --doc-format markdown
lark-cli docs +fetch --api-version v2 --as user --doc "<wiki-or-doc-url>" --scope keyword --keyword "term1|term2" --detail full
```

Patch rules:

- Prefer `block_replace` for small edits to existing Feishu docs that contain synced blocks, includes, tables, or code tabs. Avoid overwriting the whole page unless the user explicitly wants a rebuild.
- Use `--dry-run` before live `docs +update` calls. Refetch after every live write that changes block structure, because replacement creates new block IDs.
- Run dependent block updates sequentially. Parallel writes can return revisions out of order; always refetch before continuing if multiple updates touch the same section.
- If Markdown `str_replace` dry-runs but live matching fails, switch to `block_replace` with XML and current block IDs.
- Keep raw conditional publishing tags such as `&lt;include target="milvus"&gt;...&lt;/include&gt;` escaped in XML content. In fetched Markdown they may appear as literal `<include ...>` tags.
- When updating a table of contents, preserve or refresh real Feishu block links rather than replacing them with `null` links or plain text.
- When using XML `block_replace` on list items, do not put paragraphs after a nested `<ul>` in the same `<li>`; Feishu may drop or move them. Put required prose before the nested list, or include it as list items.
- For label-style bullets, use `<b>Label</b><br/>Text` and do not insert leading spaces after `<br/>`. Leading spaces render as visible indentation in Feishu.
- For formatting verification, refetch as Markdown and grep for run-together or indented patterns, for example `\*\*Label\*\*Text`, `field\.The`, `below:Keep`, or lines beginning with two unintended spaces.
- If `lark-cli` reports an update notice, mention it in the final report after completing the user task.

## Optional Code Verification

Run the Feishu code verifier when the draft contains non-trivial examples and the relevant checks are feasible:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --markdown tmp/draft-verified-docs/draft.md
```

For SDK-aware checks:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js \
  --markdown tmp/draft-verified-docs/draft.md \
  --scenario \
  --languages python,go,java,node,bash,cpp \
  --go-module-dir repos/milvus-sdk-go \
  --java-sdk-repo repos/milvus-sdk-java \
  --cpp-sdk-repo repos/milvus-sdk-cpp
```

Do not run live snippets unless the user explicitly approves live execution and provides required credentials/environment.

## Final Report Template

Use this shape:

```text
Patched: <target doc URL/token or "draft only">
Strategy: smart | replace | append | draft-only

References used:
- <source>

Source verified:
- <repo/spec path>: <symbols/routes/DTOs checked>
- <service implementation path>: <service methods/validators/state transitions checked>

Corrected from references:
- <reference claim> -> <source-verified draft behavior>

Needs further verification:
- <item or "None">

Verification:
- <commands run and results>
- <commands skipped and why>
```
