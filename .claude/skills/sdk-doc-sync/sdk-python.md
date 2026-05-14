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

**v3.0.x specific notes:**

- **Tag + commit tracking:** v3.0.x now has tag `v3.0.0`. Track both `lastScannedTag` and `lastScannedCommit` in `scan-state.json` under `python-v3`.
- **Added Since correctness:** Determine `Added Since` by checking first appearance across older tags, not by the current publish target. Example: `get_replicate_configuration` exists in `v2.6.13`, so `Added Since` is `v2.6.x`.
- **ORM is deprecated:** Do not create ORM folder docs for v3.0.x. `Collection.truncate` and `Collection.alter_index` already have MilvusClient equivalents (`truncate_collection`, `alter_index_properties`) under their respective categories.
- **Folder structure:** MilvusClient docs live in category subfolders (e.g., `Client`, `Vector`, `Collections`, `Management`). Create missing folders via Feishu API before pushing docs. Never place docs in the MilvusClient root or in an ORM folder.
- **Async methods:** The scanner regex must match `async def` as well as `def`. If `AsyncMilvusClient` shows only a handful of methods, the regex is broken. Both the detection regex (`/^\s+(?:async\s+)?def\s+(\w+)\s*\(/`) and the signature parsing regex must include `(?:async\s+)?`.

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
