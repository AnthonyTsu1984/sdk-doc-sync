# C++ SDK Reference (milvus-sdk-cpp)

**Scanner:** `src/sdk-doc-sync/scanners/cpp-scanner.js`
**Root dir:** `repos/milvus-sdk-cpp`; include dir: `src/include/milvus/`
**Latest verified v2.6.x release:** `v2.6.4` (2026-06-17)
**Note:** 3-phase scan — MilvusClientV2.h virtual methods → request header With*/Add* params (with base class inheritance) → enum types. `using` aliases resolved via alias chain. Export macros such as `MILVUS_SDK_API` must not change symbol identity.

| Version | Bitable Token              | Drive Root            | v2.6.x Folder         |
|---------|----------------------------|-----------------------|-----------------------|
| v2.6.x  | XmndbkxkQaigA8soRiCcTT41nMd | `PImWfhhIaleQUZd3qrWcsIgOncb` | `CSzVfDgfAlne87dDj3vcnR3nnsg` |
| v3.0.x  | QdLkbfmnFatl4TsThKDc5Dobn5g | `NVjgfJr5aleBsedDoKCcDpnJn9b` | `NVjgfJr5aleBsedDoKCcDpnJn9b` |

**Note:** C++ bitable has 8 shared VirtualNodes (targets=Milvus,Zilliz) — reuse them, do NOT create new ones. Live folder/record tokens in `memory/cpp-doc-audit.md`.

## Release Scanning

Use release scout first:

```bash
node .claude/skills/api-reference-sync/bin/sdk-release-scout.js \
  --language cpp \
  --sdk-name milvus-sdk-cpp \
  --track v2.6.x \
  --baseline-tag v2.6.3 \
  --target-tag v2.6.4 \
  --json \
  --output tmp/sdk-release-scout/cpp-v26.json
```

Do not rely on the legacy `cpp` scan-state key when it points at `origin/master`; pass an explicit v2.6.x baseline until a successful approved sync advances a versioned C++ baseline. Do not update `scan-state.json` during discovery.

For v2.6.4, source-backed public documentation candidates are:

- New methods: `FlushAll`, `GetFlushAllState`, `GetReplicateConfiguration`, `UpdateReplicateConfiguration`, `GetReplicateInfo`.
- Embedded request/result updates: `FlushAllRequest`, `FlushAllResponse`, `GetFlushAllStateRequest`, `GetFlushAllStateResponse`, CDC request/response classes, and `ReplicateConfiguration` helper types belong in each owning method document.
- Updates: `LoadCollection`, `LoadPartitions`, `GetLoadState` load/refresh progress behavior; `SegmentInfo`, `QuerySegmentInfo`, and `SegmentLevel` segment metadata.
- Build/reference note: `MILVUS_SDK_API` export annotations are packaging visibility changes; document only if the page exposes class signatures or build guidance.

If release scout emits unmapped identity diagnostics, fix `references/identity/cpp-v26.json` before asking for write approval. A full C++ scanner dry-run remains diagnostic only.

**Doc format — Methods (API functions):**

```
[Description]

```cpp
Status MethodName(const RequestType& request)
```

## Request Syntax{#request-syntax}

```cpp
auto request = RequestType()
    .WithParam1(value1)
    .WithParam2(value2);
```

### RequestType

**REQUEST METHODS:**

- `WithParam1(Type value)`
Description.

**RETURNS:**

*Status*

**EXCEPTIONS:**

- **std::exception**
Description.

## Example{#example}

```cpp
auto client = milvus::MilvusClientV2::Create();
milvus::ConnectParam connect_param{"http://localhost:19530", "root:Milvus"};
auto status = client->Connect(connect_param);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

[method-specific example with inline milvus:: prefixed request objects]
```
```

**Embedded request and result sections:** Put request builders, responses, result payloads, tasks, iterators, descriptors, transport types, and wrappers in every owning method document. Do not create sibling Type/Class records for those helpers.

For C++ request-bearing methods, `Request Syntax` and `XxxRequest` have distinct responsibilities:

- `Request Syntax` is only a minimal, copyable construction snippet. Do not put parameter descriptions, validation prose, or a second request contract in this section.
- `XxxRequest` is the canonical embedded request contract and uses an H3 beneath `Request Syntax`. List the source-backed request methods/signatures, types, required/default/validation behavior, and concise descriptions there.
- Generate both sections from the same Reference IR request variant and callable-member metadata so they cannot drift.
- Omit `Request Syntax` when it would only show a trivial empty construction and the request has no builder methods. Keep the authoritative request contract or normal parameters as applicable.
- Keep structured response/result fields embedded under `RETURNS` on the owning method page, using H3 for each embedded response/result/helper type. Methods that return only `Status` do not need a synthetic response shape.
- Do not repeat construction examples under `XxxRequest`; the full usage example remains under `Example`.

For DML methods that accept `FieldDataPtr` values, keep schema identities and payload containers distinct:

- `DataType` remains the canonical standalone schema-type enum page. It explains logical field types and schema constraints, not insertion containers or pointer aliases.
- `Insert()` and `Upsert()` embed one `Column payload types` H3 after their request methods and before `RETURNS`. Use a compact mapping table with `DataType`, concrete field-data type, C++ representation, and exceptional behavior.
- Do not publish separate scalar, vector, array, or shared-pointer alias sections. Do not create standalone pages for every `XxxFieldData` or `XxxFieldDataPtr` alias.
- Document the pointer convention once: `XxxFieldDataPtr` is `std::shared_ptr<XxxFieldData>`, and DML requests accept the common `FieldDataPtr` base pointer.
- Call out non-one-to-one mappings: arrays carry an element type, geometry and timestamptz use string payloads, binary vectors use a dedicated class, structs use array-style JSON storage, and `UNKNOWN` has no insertion payload.
- Link payload mappings to the canonical `DataType` document. A shared `DataType` document should name `Insert()` and `Upsert()` without linking to one version-specific method document.

**Independent types only:** A type receives its own page only when the scanner and identity ownership harness classify it as an explicitly reviewed standalone concept, such as an independently used enum or domain model.

**Notes:**
- Request Syntax uses chained constructor format (`auto request = Class()\n    .With...;`), NOT two-step, and contains no descriptive prose
- Example always starts with the connection block above
- Use `util::CheckStatus(status)` for result checking in examples
- C++ `using` aliases (e.g., `using GrantPrivilegeV2Request = PrivilegeV2Request`) resolved via alias chain in `_buildRequestIndex`
- CreateCollection overload disambiguation: second overload → CreateSimpleCollection
- Scanner handles two-line method format: `virtual Status\nMethodName(params)` and `ReturnType&\nWithFoo(params)`
- **`cpp-v261-create.js` has STALE folder/record tokens** — use live values from `memory/cpp-doc-audit.md`

**Scripts:**
- `scripts/cpp-v261-create.js` — greenfield v2.6.1 creation (tokens stale, see audit.md)
- `scripts/cpp-v261-examples-update.js` — add real SDK examples
- `scripts/cpp-v261-fix-code-lang.js` — fix code block language (PlainText → C++)
- `scripts/cpp-request-syntax-fix.js` — targeted block content update (reference impl)
- `scripts/cpp-examples-v2.js` — targeted block prefix/replace (reference impl)
- `scripts/cpp-missing-types-create.js`, `scripts/cpp-connectparam-create.js`, etc. — one-off type additions
- `scripts/cpp-response-types-create.js` — 20 response/helper type Class docs (v2.6.1, 2026-03-15)
- `scripts/cpp-fix-describe-resource-group.js` — fix DescribeResourceGroup example (response.Name() → response.Desc().Name())
- `scripts/cpp-fix-methods-heading.js` — re-push docs that had h2 Methods headings, replace with **METHODS:** bold
- `scripts/cpp-v263-fix-returns-format.js` — targeted block patch for v2.6.3 function RETURNS lines (`*Status with Type*` → `*Status* with *Type*`)
- `scripts/cpp-add-ptr-type-links.js` — C++ pointer-alias cross-reference pass (`XxxPtr` → `Xxx` class doc link)
- `scripts/cpp-audit-util.js` — audit helper
