# Go SDK Reference (milvus-sdk-go)

**Scanner:** `src/sdk-doc-sync/scanners/go-scanner.js`
**Root dir:** `repos/milvus-sdk-go`; source dir: `client/milvusclient/`

| Version | Bitable Token | Drive Root (v2.6.x) |
|---------|---------------|---------------------|
| v2.6.x  | Yc7gbtmgSal2ewsdqlhcLWVanbh | `Pzejf3x4WlXq1HdtTndcfMjVnxh` |

## Doc Format

```
[Description]

```go
func (c *Client) MethodName(ctx context.Context, option MethodOption, callOptions ...grpc.CallOption) (ReturnType, error)
```

## Request Syntax{#request-syntax}

```go
client.MethodName(ctx, milvusclient.NewMethodOption(
    collectionName,
).WithParam(value))
```

**PARAMETERS:**

- **paramName** (*type*)
  Description. [REQUIRED params noted in description prose]

**OPTION METHODS:**

- `WithParam(type)`
  Description.

**RETURN TYPE:**

*ReturnType, error*

**RETURNS:**

Description of return value. Returns an error if the operation fails.

**EXCEPTIONS:**

- **error**
  Check err != nil for failure details.

## Example{#example}

```go
import (
	"context"
	"fmt"

	"github.com/milvus-io/milvus/client/v2/milvusclient"
)

ctx, cancel := context.WithCancel(context.Background())
defer cancel()

milvusAddr := "127.0.0.1:19530"

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
	Address: milvusAddr,
})
if err != nil {
	// handle error
}

defer cli.Close(ctx)

result, err := cli.MethodName(ctx, milvusclient.NewMethodOption("quick_setup").
	WithParam(value))
if err != nil {
	// handle error
}

fmt.Println(result)
```
```

## Block-Level Formatting Rules

Go SDK docs are created via **direct Feishu block API** (not `push_markdown`). Each bullet section has a specific element style:

- **PARAMETERS bullet:** `paramName[BOLD] (type[ITALIC])` — description in a **separate indented paragraph** immediately after the bullet (never inline)
- **OPTION METHODS bullet:** entire `signature[CODE]` (inline_code style) — description in a separate indented paragraph
- **EXCEPTIONS bullet:** `error[BOLD]` — description in a separate indented paragraph
- Both `RETURN TYPE:` and `RETURNS:` sections exist in every doc — `RETURN TYPE:` shows the type, `RETURNS:` shows the description
- **Canonical reference:** `Delete()` doc — inspect with `scripts/inspect-go-blocks.js` when unsure about element styles

## Example Requirements

- **Import block:** always at the top. Stdlib group first (`"context"`, `"fmt"`, `"log"`), then blank line, then third-party (`github.com/milvus-io/milvus/client/v2/*`). Tab-indented.
- **Import detection** by identifier prefix: `context.` → `"context"`, `fmt.` → `"fmt"`, `log.` → `"log"`, `milvusclient.` → `client/v2/milvusclient`, `entity.` → `client/v2/entity`, `index.` → `client/v2/index`, `column.` → `client/v2/column`, `common.` → `pkg/v2/common`
- **Context:** always `ctx, cancel := context.WithCancel(context.Background())` + `defer cancel()`
- **Client:** `milvusAddr := "127.0.0.1:19530"` inline; auth examples also `token := "root:Milvus"` + `APIKey: token`
- **Deferred close:** `defer cli.Close(ctx)` immediately after successful client creation
- **Error handling:** `// handle error` comment for normal paths; `log.Fatal(...)` for fatal/setup errors
- **Output:** `fmt.Println(result)` for single values; `log.Println(...)` for multiple struct fields
- **No package/func wrapper:** examples are raw code blocks (no `package main`, no `func main()`)
- Run `scripts/go-add-imports.js` to auto-detect and prepend import blocks if missing

## Entity/Type Doc Strategy

After greenfield creation, run `scripts/audit-go-todos.js` to find docs with `// TODO:` markers. Categorize by usage:

| Category | Examples | Action |
|----------|----------|--------|
| **Output-only** (returned by APIs) | Collection, ResourceGroup, ResultSet, InsertResult, DeleteResult, UpsertResult, Alias, IndexDescription, *Task types, LoadState, CompactionState, Segment, Index, User, Role, RBACMeta, PrivilegeGroup, Database | Remove Example section (heading2 + code) via `batch_delete` |
| **Input types** (passed as parameters) | Schema, Field, FieldType, Function, ConsistencyLevel, IndexType, MetricType, AnnParam, ResourceGroupConfig | Replace TODO with real usage example showing the type in context |

Reference: `scripts/go-fix-entity-examples.js`

## Scanner Details

5-phase scan:
1. `*Client` methods from `*.go`
2. Option constructors + `With*` from `*_option(s).go`
3. Examples from `*_example_test.go`
4. Entity types via ENTITY_DEFS
5. Index/AnnParam constructors from `client/index/`

Entity hierarchy: Index entity + 25 `New*Index` constructors in `Index/` subfolder; AnnParam entity + 9 `New*AnnParam` constructors in `AnnParam/` subfolder

**Skip list:** GetService, OperatePrivilegeGroup, GrantV2, RevokeV2, all Replicate methods, NewRTreeIndexWithParams, NewRTreeIndexBuilder

**Duplicate symbol cleanup:** After greenfield, Class-type stubs may share a slug with their Method version (e.g., `SearchIterator` class vs `SearchIterator()` method). Keep the Method version; delete the Class doc + bitable record.

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/go-v26-create.js` | Greenfield v2.6.x creation |
| `scripts/go-fix-param-layout.js` | Split inline "param — desc" bullets into bullet + paragraph |
| `scripts/go-fix-option-code.js` | Restore inline_code style on option method signature bullets |
| `scripts/go-fix-entity-examples.js` | Remove Example sections from output types; add real examples to input types |
| `scripts/go-fix-examples.js` | Bulk example replacement |
| `scripts/go-add-imports.js` | Auto-detect and prepend import block to example code blocks |
| `scripts/go-add-clientconfig.js` | Add ClientConfig section to docs |
| `scripts/audit-go-todos.js` | Find all docs with `// TODO:` markers (post-greenfield audit) |
| `scripts/audit-go-docs.js`, `audit-go-docs2.js` | Doc content audit helpers |
| `scripts/inspect-go-blocks.js` | Debug: print all block types and element styles for a doc |
| `scripts/cleanup-go-iterators.js` | Remove duplicate class-type docs |
| `scripts/fix-go-iterator-examples.js` | Fix iterator example code |
| `scripts/go-fix-indent.js` | Fix tab → 4-space indentation in code blocks |
| `scripts/go-fix-clientconfig.js` | Patch ClientConfig content |
