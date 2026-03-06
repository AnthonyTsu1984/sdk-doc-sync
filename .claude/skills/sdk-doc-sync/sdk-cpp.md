# C++ SDK Reference (milvus-sdk-cpp)

**Scanner:** `src/sdk-doc-sync/scanners/cpp-scanner.js`
**Root dir:** `repos/milvus-sdk-cpp`; include dir: `src/include/milvus/`
**Note:** 3-phase scan — MilvusClientV2.h virtual methods → request header With*/Add* params (with base class inheritance) → enum types. `using` aliases resolved via alias chain.

| Version | Bitable Token              | Drive Root            | v2.6.x Folder         |
|---------|----------------------------|-----------------------|-----------------------|
| v2.6.x  | XmndbkxkQaigA8soRiCcTT41nMd | `PImWfhhIaleQUZd3qrWcsIgOncb` | `CSzVfDgfAlne87dDj3vcnR3nnsg` |

**Note:** C++ bitable has 8 shared VirtualNodes (targets=Milvus,Zilliz) — reuse them, do NOT create new ones. Live folder/record tokens in `memory/cpp-doc-audit.md`.

**Doc format:**

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

**Notes:**
- Request Syntax uses chained constructor format (`auto request = Class()\n    .With...;`), NOT two-step
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
- `scripts/cpp-audit-util.js` — audit helper
