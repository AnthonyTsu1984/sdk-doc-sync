# Python SDK Reference (pymilvus)

**Scanner:** `src/sdk-doc-sync/scanners/python-scanner.js`
**Root dir:** `repos/pymilvus/pymilvus` (package dir, not repo root)
**Latest release:** `v3.0.0` (as of 2026-05-09)

| Version | Bitable Token              | Drive Folder          |
|---------|----------------------------|-----------------------|
| v2.4.x  | D1VabelmAansLwsNTvLc2Wxxn1g | `ACKGfinsNlQCovdK2v1cPxiqnle` |
| v2.5.x  | B8X9bJjJta2q4NskclYcxT7lngG |                       |
| v2.6.x  | J3Qzbv7AWazzivsv7vqcqlGCnFc | `IaWgf4osAlpdwqdVIclct97wnCg` |
| v3.0.x  | Hk05b5eI6aXXSSsd6j9cqwwMn5a | `UxyTfjS3wl0TF8dn9tZcRT39nUe` |

For scoped dry-runs, set `BASE_TOKEN` to the row's Bitable Token and `ROOT_TOKEN` to the row's Drive Folder token. For Python v2.6.x, use `BASE_TOKEN=J3Qzbv7AWazzivsv7vqcqlGCnFc` and `ROOT_TOKEN=IaWgf4osAlpdwqdVIclct97wnCg`.

**Doc format:**

```
[Description — explain what this does and when to use it]

## Request Syntax{#request-syntax}

```python
method_name(
    param1: type = default,
    param2: type
) -> return_type
```

**PARAMETERS:**

- **param_name** (*type*) -
**[REQUIRED]**
Explain what this parameter does, valid values, constraints.

**RETURN TYPE:**

*ReturnType*

Description of return value.

**EXCEPTIONS:**

- **ExceptionName**
When this exception is raised.

## Examples

```python
[Realistic, runnable usage example]
```
```

## Platform-aware parameter prose

Treat sentence-start checks as lint signals, not as a writing template. A reviewed parameter description must be a complete, human-readable sentence that explains what the value represents, names the applicable platform when relevant, and includes important constraints or examples. Prefer an article-led sentence such as `The name of the target collection.` or a natural plural subject such as `Files containing the import data.` Never repair source text by mechanically prefixing `The`.

Classify every reviewed field explicitly as `shared`, `milvus`, or `zilliz`; do not infer ownership from a parameter name or a marker such as `(cloud)`. A shared field with the same meaning uses `description`. A shared field whose meaning differs by platform uses one `descriptions` object with `milvus` and `zilliz` entries so the field header, type, required state, and default render once. A platform-only field wraps the complete parameter entry for that audience.

Use precise endpoint vocabulary:

- The Milvus server endpoint, such as `http://localhost:19530`.
- The Zilliz Cloud API server endpoint, which is `https://api.cloud.zilliz.com`.

Audience wrappers and code variants have different representations. Parameter prose uses structural `<include target="milvus">` and `<include target="zilliz">` regions outside code blocks. Request syntax and examples use complete-line zdoc comment directives inside one physical Python block: `# include-start milvus`, `# include-start zilliz`, and `# include-end`. Never place HTML-like include or exclude tags inside code.

Reviewed request variants must list their canonical parameters explicitly. Validation rejects unknown parameters, cross-platform parameter leakage, missing request/example audience coverage, platform-inconsistent endpoints, malformed directives, and audience tags inside code blocks. A genuinely shared request or example remains directive-free.

Keep Python examples readable without horizontal scrolling. When a constructor or API call passes multiple arguments and uses keyword arguments, place the opening parenthesis, every top-level argument, and the closing parenthesis on separate lines. Nested values may span additional lines when needed. Production validation rejects compact multi-argument calls such as `Request(data=..., limit=...)`.

Keep the core release-independent. Do not add method names, record IDs, release lookup tables, or exact one-run wording to adapters, renderers, or validators. Store release classifications, reviewed prose, migrations, previews, approval manifests, and receipts under the ignored run root `tmp/sdk-doc-sync-runs/<language>-<track>/<run-id>/`. Stable code must run with that directory absent.

**v3.0.x specific notes:**

- **Tag + commit tracking:** v3.0.x now has tag `v3.0.0`. Track both `lastScannedTag` and `lastScannedCommit` in `scan-state.json` under `python-v3`.
- **Added Since correctness:** Determine `Added Since` by checking first appearance across older tags, not by the current publish target. Example: `get_replicate_configuration` exists in `v2.6.13`, so `Added Since` is `v2.6.x`.
- **ORM is deprecated:** Do not create ORM folder docs for v3.0.x. `Collection.truncate` and `Collection.alter_index` already have MilvusClient equivalents (`truncate_collection`, `alter_index_properties`) under their respective categories.
- **Folder structure:** MilvusClient docs live in category subfolders (e.g., `Client`, `Vector`, `Collections`, `Management`). Create missing folders via Feishu API before pushing docs. Never place docs in the MilvusClient root or in an ORM folder.
- **Async methods:** The scanner regex must match `async def` as well as `def`. If `AsyncMilvusClient` shows only a handful of methods, the regex is broken. Both the detection regex (`/^\s+(?:async\s+)?def\s+(\w+)\s*\(/`) and the signature parsing regex must include `(?:async\s+)?`.

**v2.6.x scanner identity notes:**

- Python v2.6.x bitable records use category-prefixed slugs, while the generic scanner may emit raw class or function slugs. Normalize changed symbols through the canonical folder/category map before comparing with Feishu records.
- Examples: `MilvusClient.compact` maps to `Management-compact`, `bulk_import` maps to `BulkImport-bulk_import`, and `MilvusClient.alter_role` maps to `Authentication-alter_role`.
- An unfiltered full-package dry-run can show many false `CREATE` and `ORPHAN` actions when scanner slugs do not match bitable slugs. Treat that as non-approval-grade; use Git diff for release scope and targeted scanner extraction for changed symbols.
- Treat release scout output as public-surface candidates, not as final docs. Prefer docs for exported or user-facing APIs: `MilvusClient`, `AsyncMilvusClient`, `CollectionSchema`, `FieldSchema`, `StructFieldSchema`, `AnnSearchRequest`, `FieldOp`, `FieldOpType`, BulkImport/DataImport functions, volume managers/writers, result classes, and existing ORM/utility pages when behavior changes.
- Do not create standalone docs for generated `grpc_gen/*`, protobuf `DESCRIPTOR`, low-level `GrpcHandler` / `AsyncGrpcHandler`, `Prepare` request builders, `_version.py`, `type_info`, `field_data_extractors`, or internal validators unless existing Feishu records already expose them and the task explicitly asks to keep them documented.
- Normalize variadic Python parameters with missing type metadata as `Any`; never render empty types for `*args` or `**kwargs`.

**v2.6.x blocked dry-run recovery:**

- Use a run-local candidate spec with `scripts/build-reviewed-release-context.js` to create the reviewed user-facing scope and `--reference-context` after a blocked scoped dry-run. Store it under `tmp/sdk-release-scout/`, not in the skill, unless the content is durable across future runs. The spec is the executable source for candidate grouping, exclusion rules, category folder placement, and minimum reviewed examples.

**Canonical Python folder map (verified 2026-05-09):**

- **v3.0.x root** `UxyTfjS3wl0TF8dn9tZcRT39nUe`
  - MilvusClient: `BBPZfcRbOlWEnjdbIJgc3wgynsg`
  - DataImport: `SIN6f7FuAlseoDdllIXck663nBg`
  - FileResource: `PWyVfD7HUl1x3ydji7RcraKin1g`
- **v2.6.x root** `IaWgf4osAlpdwqdVIclct97wnCg`
  - MilvusClient: `B2fdfjb1nl9Pjidkaa9cM6lAngd`
  - DataImport: `LJfHfKQ8QlHpC1dCjxvcurBunGQ`
- **v3.0.x MilvusClient categories** (`BBPZfcRbOlWEnjdbIJgc3wgynsg`)
  - Client: `M9bMfXz3llm0ebdks4Hc3KdMnCd`
  - Collections: `WidffJPNIlfIlZdHlU8cMiGOnpg`
  - CollectionSchema: `EBJgfcRHNlrAHEdOPtMcGOKpnvb`
  - ResourceGroup: `BOTAfAdGJl7C9Ad00CWcOawendd`
  - Snapshot: `RoBzflamplZFzYd1ZSWccuVfnnc`
  - Vector: `KSDYfo9pCl89wKdRNGccbzT2nid`
- **v2.6.x MilvusClient categories** (`B2fdfjb1nl9Pjidkaa9cM6lAngd`)
  - The executable canonical map is `references/identity/python-v26.json`. Update that file and its release-scope golden tests when adding or correcting category mappings. Do not rely on prose-only slug examples for deterministic release plans.
  - Authentication: `Tjnufe7LvlX9wtddOfEctVJ6nKB`
  - Collections: `CqXrfDyXZlkNSrdh5eJcI0Fznjh`
  - CollectionSchema: `GkYpfpsV4likQDdoQLncs4NUnud`
  - Database: `JT0gfXjE3lCqEAdn6jPcFbHgnnd`
  - EmbeddingList: `KE7AfgsvalVIwFd1zdMcOXfRnge`
  - Function: `PfEBfBmYBljSWFd1zdMcOXfRnge`
  - Highlighter: `O7mqfZp5fleHncduy7HcWkdTnPb`
  - Management: `KrK5fBnFDlG6CedvqyHcfZLynre`
  - Partitions: `Snf8fZZTklTziidxXP2cL4cRnOf`
  - ResourceGroup: `Lr8lfQ7TjlcKntdAB97ctH2Qnjd`
  - Snapshot: `OTjrfKAXFlLdE4dLAfccqXStnNh`
  - StructFieldSchema: `QmzcfpTxAlAaTqdRRbLc6fAanv7`
  - Vector: `N5ynfBUN2l7doCdZw7ecFSl5nqb`

**Scripts:** `scripts/scan-pymilvus.js` (scan only; create/update via `bin/sdk-doc-sync.js`)
