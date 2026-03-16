# Node.js SDK Reference (milvus2-sdk-node)

**Scanner:** `src/sdk-doc-sync/scanners/node-scanner.js`
**Root dir:** `repos/milvus-sdk-node` (repo root)
**Category mapping:** Data.ts→Vector, Collection.ts→Collections, etc.

| Version | Bitable Token              | Drive Root            |
|---------|----------------------------|-----------------------|
| v2.6.x  | R9i8bww4faNsR6smwQwcAtHGnkb | `WXiqfeczjlpK0RdlN87c8hVWnag` |

**Category folder tokens (v2.6.x):**

| Category      | Folder Token                  | Parent Record         |
|---------------|-------------------------------|-----------------------|
| Client        | `WlKqf2dXKljRPDdiiUIcdsh5nxd` | `recu4NWmmkGZuZ`     |
| Authentication| `KWn3ff3dRlg3zndqerbcW0QXn1c` | `recu4NWhqWAejC`     |
| Collections   | `LOD4fz3qilpPyOdlfencoVEJnwd` | `recu4NWrP0FkyK`     |
| Database      | `F0ZXfs6XSlspHxdg7DwcYb84nMf` | `recvaTCXsgewcl`     |
| Management    | `UmOafcFDglyFe3dayhAcRA0RnEd` | `recu4NWwVB8uMo`     |
| Partitions    | `Hg5PfTIHll3FK4dbYdxcaURHn2n` | `recu4NWDr2iSEm`     |
| ResourceGroup | `FsXcfY36qlOQAkdMEfKc80GInqe` | `recuA2CVlf0gs8`     |
| Vector        | `DFjqfW5yclNaqWdpjpqckLM2nud` | `recu4NWJ6hPqkS`     |

**Doc format:**

```
[Description — starts with "This operation ..." or "This function ..."]

```typescript
await milvusClient.methodName(data: RequestType)
```

## Request Syntax

```typescript
await milvusClient.methodName({
    requiredParam: type,
    optionalParam?: type,
})
```

**PARAMETERS:**

- **paramName** (*type*) -
**[REQUIRED]**
Description.

**RETURNS:**

*Promise\<ReturnType\>*

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

```javascript
[Realistic, runnable usage example]
```
```

**Notes:**
- `## Request Syntax` has **NO anchor** (no `{#request-syntax}`)
- Omit the Request Syntax section entirely for methods with no parameters
- Database category has no VirtualNode — bitable slugs lack prefix (e.g., `useDatabase` not `Database-useDatabase`)
- Example code blocks use `javascript` language (not `typescript`) — required by CI
- Signature and Request Syntax blocks use `typescript` language

**Complex type documentation:**

When a parameter type is a complex object (e.g., `HybridSearchSingleReq[]`, `FunctionObject`), do NOT describe its fields inline in one prose sentence. Instead:
1. Keep the parameter description brief: "For the full field reference, see the TypeName section below."
2. Add a new `## TypeName{#anchor}` section after `## Example{#example}` with its own **PARAMETERS:** bullet list.
3. For cross-references (e.g., `alterCollectionFunction.function` pointing to `addCollectionFunction`), use plain text: "For the FunctionObject field reference, refer to `addCollectionFunction()`."

**CRITICAL — No markdown links inside bullet descriptions.** A markdown link (`[text](#anchor)`) inside a bullet description causes a Feishu schema mismatch error that silently drops that bullet's content AND all subsequent bullets. Use plain text references instead.

**Scripts:**
- `scripts/node-v26-update.js` — v2.6.x create/update run
- `scripts/node-v26-request-syntax.js` — doc rebuild (version migration reference)
- `scripts/node-v2610-fix.js`, `scripts/node-v2610-update.js` — v2.6.10 patch runs
- `scripts/node-doc-quality-fix.js` — batch quality fixes (signatures, Request Syntax, constructors)
- `scripts/node-add-token.js` — add `token: 'root:Milvus'` to all MilvusClient constructors
- `scripts/node-reformat-constructor.js` — reformat single-line constructor to multi-line
- `scripts/node-fix-code-lang.js` — change code block language TypeScript→JavaScript
- `scripts/node-inline-type-fix.js` — extract complex inline types into dedicated ## sections
