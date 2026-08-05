# Node.js SDK Reference (milvus2-sdk-node)

**Ownership:** Public helper visibility alone does not create a standalone documentation identity. Embed method-owned request and response helpers in every owning interface document.

**Scanner:** `src/sdk-doc-sync/scanners/node-scanner.js`
**Root dir:** `repos/milvus-sdk-node` (repo root)
**Release scout sdk-name:** `milvus-sdk-node`
**Latest release:** `v3.0.4` (as of 2026-08-05)
**Category mapping:** Data.ts→Vector, Collection.ts→Collections, etc.

| Version | Bitable Token              | Drive Root            |
|---------|----------------------------|-----------------------|
| v2.4.x  | DVVobtXQMamuLqsQij5c29nVn3c | `Vg1kfluyll0h7MdlUMaciXfEnZd` |
| v2.5.x  | JTBebezMDaV8ZhsHF5wc7lJSnuh | `U9fWfMPdelsPMydYnolcr2aEnBf` |
| v2.6.x  | R9i8bww4faNsR6smwQwcAtHGnkb | `NFmOfwILlln3JgdePZUclweZnIe` |
| v3.0.x  | LlrPbysPZau2dGsSVuicHmvCn0e | `LW67fVlTvlNCZRdxOVYcQZyJnFQ` |

**Canonical folder map (verified 2026-06-17):**

- **Node root:** `WXiqfeczjlpK0RdlN87c8hVWnag`
- **v2.4.x folder:** `Vg1kfluyll0h7MdlUMaciXfEnZd`
  - Data Import: `Oo7HfeLk7l8gsRdVOJ8c6Amhnpg`
- **v2.5.x folder:** `U9fWfMPdelsPMydYnolcr2aEnBf`
  - Data Import: `TfwNftdbKlAuQJd1qS1c7KymnEb`
- **v3.0.x folder:** `LW67fVlTvlNCZRdxOVYcQZyJnFQ`
  - Collections: `CsRZfOAHhly4fSd5kxvcAfkFnpf`
  - Client: `DNpsf7mK9l2ruTdk4fCcwoudnFe`
  - ResourceGroup: `Karwf466pld78UdaQ2DcX4F3nce`
  - Management: `E5cpfv4EPlpWJ5dV0iJcPwo4nyf`
  - Vector: `HgpMfqiBwlO0sudMbiVcYpHHn5f`
  - Data Import: `OE6ef37Ztlb6FgdouLvcTcrpnAp`
  - Snapshot: `IxaefGzWtlPFlTd617bcYS4cn4d`
- **v2.6.x folder:** `NFmOfwILlln3JgdePZUclweZnIe`
  - Client: `WlKqf2dXKljRPDdiiUIcdsh5nxd`
  - Collections: `LOD4fz3qilpPyOdlfencoVEJnwd`
  - ResourceGroup: `FsXcfY36qlOQAkdMEfKc80GInqe`
  - Management: `UmOafcFDglyFe3dayhAcRA0RnEd`
  - Vector: `DFjqfW5yclNaqWdpjpqckLM2nud`
  - Data Import: `YJbpf38t6lDwaldXkCRcj2yxnHg`
  - Database: `F0ZXfs6XSlspHxdg7DwcYb84nMf`
  - Authentication: `KWn3ff3dRlg3zndqerbcW0QXn1c`
  - Partitions: `Hg5PfTIHll3FK4dbYdxcaURHn2n`

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
| Data Import   | `YJbpf38t6lDwaldXkCRcj2yxnHg` | `recvmMGXu6OzGy`     |

**Data Import parent records (verified 2026-06-17):**

| Version | Folder Token                  | Parent Record     |
|---------|-------------------------------|-------------------|
| v2.4.x  | `Oo7HfeLk7l8gsRdVOJ8c6Amhnpg` | `recvmMGUQEYdo6` |
| v2.5.x  | `TfwNftdbKlAuQJd1qS1c7KymnEb` | `recvmMGW7GhbEt` |
| v2.6.x  | `YJbpf38t6lDwaldXkCRcj2yxnHg` | `recvmMGXu6OzGy` |
| v3.0.x  | `OE6ef37Ztlb6FgdouLvcTcrpnAp` | `recvis4qucFpFm` |

**Data Import placement notes:**
- Import APIs belong under `Data Import`, not `Vector`.
- If v2.4/v2.5/v2.6 Data Import folders or VirtualNode records are missing in a stale environment, create them under the canonical version root and repoint the touched records in the same run.
- Use version-local doc copies when reparenting records that previously shared older-version doc tokens. In the 2026-06-17 backfill, v2.5 `bulkInsert()`, v2.6 `bulkInsert()`, and v2.6 `listImportTasks()` were copied into their version-local Data Import folders before record repointing.
- For APIs traced to releases before v2.4.x, set `Added Since` to `inherit`.
- BulkWriter docs were introduced from the v2.6.12 lineage and live in the v2.6.x Data Import folder; v3.0.x records can point to those v2.6.x docs unless the user asks for v3.0-local copies.
- HTTP import docs were introduced from the v2.4.x lineage and live in the v2.4.x Data Import folder; v2.5.x, v2.6.x, and v3.0.x records can point to those v2.4.x docs unless the user asks for version-local copies.
- Skip gRPC import request/response type docs unless the user explicitly asks for them.

**Data Import API inventory (backfilled 2026-06-17):**

| Group | Symbols | Doc home | Record versions |
|-------|---------|----------|-----------------|
| Existing import methods | `bulkInsert()`, `listImportTasks()`, `getImportState()` | Version-local where copied/repointed; v3.0.x existing docs remain in v3.0.x Data Import | `bulkInsert()` v2.5.x+; `listImportTasks()` v2.6.x+; `getImportState()` v3.0.x |
| BulkWriter | `BulkWriter`, `BulkWriterOptions`, `BulkWriterSchema`, `Formatter`, `Storage`, `FlushEvent` | v2.6.x Data Import | v2.6.x, v3.0.x |
| HTTP import | `listImportJobs()`, `createImportJobs()`, `getImportJobProgress()`, `HttpImportCreateReq`, `HttpImportCreateResponse`, `HttpImportListResponse`, `HttpImportProgressReq`, `HttpImportProgressResponse` | v2.4.x Data Import | v2.4.x, v2.5.x, v2.6.x, v3.0.x |

**Node Data Import backfill workflow (2026-06-17 pattern):**
1. Trace symbol first appearance before writing docs. BulkWriter belongs to the v2.6.12 lineage; HTTP import belongs to the v2.4.x lineage; existing pre-v2.4 import APIs use `Added Since: inherit`.
2. Create or verify the `Data Import` folder and VirtualNode in every target version before creating Function/Class records.
3. Reparent existing import records from `Vector` to `Data Import`. If a doc token is shared with older versions, copy it into the target version's `Data Import` folder first, then repoint the record.
4. Create docs in the earliest requested home folder only: BulkWriter docs in v2.6.x, HTTP import docs in v2.4.x. Later-version records may point to those docs unless the user requests version-local copies.
5. Do not create gRPC import request/response type docs unless explicitly requested.
6. After creation, run `add-type-links.js` with repeated `--title` filters for only the new BulkWriter pages, then verify the scoped dry-run is clean.
7. Verify with `feishu-doc.js list-folder` for all Data Import folders and inspect at least one new page with `feishu-doc.js get-blocks`; Markdown export may flatten correct child blocks.

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

**Method aliases (do not create separate docs):**

| Method | Alias/Caller | Bitable slug (already documented) |
|--------|-------------|-----------------------------------|
| `selectGrant` | `listGrant` (alias, line 627 User.ts) | `Authentication-listGrant` |
| `deleteEntities` | `delete` (wrapper, calls `deleteEntities` internally) | `Vector-delete` |

**Notes:**
- `## Request Syntax` has **NO anchor** (no `{#request-syntax}`)
- Omit the Request Syntax section entirely for methods with no parameters
- Under Request Syntax, omit the H3 variant title when there is only one request shape. Add H3 titles only when two or more request shapes need labels.
- Under Example, omit the H3 example title when there is only one example. Add H3 titles only when two or more examples need labels.
- Start with an enduring description of the interface semantics. Do not describe the current release, review batch, documentation change, or implementation plan in user-facing copy.
- Preserve the existing Bitable `Description` when the interface semantics have not changed. A release reason or current patch summary is not a replacement for the enduring interface description.
- Put a user-facing warning, deprecation notice, or note callout immediately after the opening description and before the signature block. In the native callout, render `Notes` as the first paragraph and the guidance as a separate following paragraph.
- Do not repeat the same guidance in a separate Notes section. Put new or changed parameter fields, response keys, enum members, and field-specific constraints in their normal PARAMETERS, RETURNS, or Constants location rather than using a callout as a catch-all.
- If the approved guidance already exists in a native Feishu callout, preserve that block and place it after the opening description instead of rendering a duplicate replacement.
- When a callout refers to a successor or another documented Node.js interface, link the interface name to its exact current document when that link is known.
- Generated prose must be a complete, grammatical sentence. Reject fragmentary templates such as `The is ...` before rendering or writing.
- Database category has no VirtualNode — bitable slugs lack prefix (e.g., `useDatabase` not `Database-useDatabase`)
- Example code blocks use `javascript` language (not `typescript`) — required by CI
- Signature and Request Syntax blocks use `typescript` language

**Return objects:**

- Use the exact public return type resolved from the pinned SDK source. `unknown` is allowed only when the public source is genuinely untyped and the planning evidence records that fact; an unresolved exported SDK type blocks publication.
- For an SDK-owned response object, place its TypeScript object shape immediately after `RETURNS`, then add a second **PARAMETERS:** list that explains every public field, matching the established `ResStatus`, `BackupRBACResponse`, and `StatisticsResponse` pattern.
- Expand meaningful nested SDK-owned objects in the same field reference when they are part of the public response contract. If a nested type is owned by another established interface, keep the local description brief and refer to the exact owning document.
- Do not reduce a typed response wrapper to a one-line type name or generic sentence. The reader must be able to understand the returned fields without opening the SDK source.

**Enumerations:**

- An enum page starts with its enduring description and a `## Constants` section.
- List every public enum member with its exact source name, numeric or string value, and a user-facing explanation. A release note or `Notes` callout never substitutes for the constants list.
- When a release adds enum members, update the Constants list in source order and keep unrelated descriptions stable.

**Class hierarchy:**

- A stateful public class with callable public methods has both a physical class directory and a Bitable class node beneath its module. Create or reuse a same-named Drive folder under the module folder, place the constructor/landing Docx and all public method Docx pages inside it, keep the Bitable record type as `Class`, and keep its `Docs` link pointing to the landing Docx rather than the folder.
- The landing page is constructor-focused: document class semantics, constructor overloads and parameters, and a constructor example. Do not collapse the public method inventory into a `METHODS` list on that page.
- Give each independently documented public instance method its own `Function` record and Docx inside the class Drive folder, with `父记录` pointing to the Class record. For `BulkWriter`, the physical path is `Data Import/BulkWriter/`, and the Bitable shape is `Data Import -> BulkWriter -> append()/commit()/close()/writeFrom()`.
- The Node scanner emits `DataImport.BulkWriter` plus the four child identities `DataImport.BulkWriter.append`, `.commit`, `.close`, and `.writeFrom`; the v2.6.x and v3.0.x identity maps bind them to the `node-stateful-class@1` organization profile. An approval-ready candidate spec must provide the matching reviewed organization and release-placement contracts; embedded-only methods or category-folder targets are planning errors.
- The current v2.6.x and v3.0.x Node Bitables are flat (`VirtualNode -> Class/Function/Enum`) and have no `Class -> Function` links. Treat that as current-state evidence to repair for reviewed stateful classes, not as the template for new grouping.
- The tracked evidence snapshot is [references/evidence/node-v30-document-organization.json](references/evidence/node-v30-document-organization.json). It records the shared v2.6.x Docx lineage used by v3.0.x records, exact revisions and content hashes, and the observed absence of a `BulkWriter` Drive folder. The required `same_named_class_folder` contract is the repair target, not a claim about current state.
- If a v3.0.x child method keeps an unchanged v2.6.x Docx, repair only its v3.0.x `父记录` and `Type` with `UPDATE_RECORD_METADATA`; do not copy the inherited document solely for reparenting.
- Treat this hierarchy as one grouping decision: review the Class landing page, complete public-method inventory, every child identity, and every parent change before any write batch.

**Observed page profiles (verified 2026-08-05):**

- Standard function pages use an enduring opening, signature, optional Request Syntax, request PARAMETERS, RETURNS, an expanded returned-object PARAMETERS list when applicable, EXCEPTIONS when applicable, and Example.
- A complex function may have multiple labeled H3 request variants, each with its own PARAMETERS list. A single request or example remains unlabeled.
- Enum pages use `## Constants` and a complete member list.
- `MilvusClient` is the constructor-focused Class reference. Existing `BulkWriter` and `Formatter` pages demonstrate legacy mixed class/helper layouts; do not copy their inline `METHODS` or implementation inventory without an ownership and grouping review.
- Before a new Node interface kind is planned, sample at least one comparable live page and record its revision and block structure. Do not substitute a Python, Java, Go, or C++ body layout.

**Signature integrity:**

- Preserve complete TypeScript signatures and object shapes in code blocks. HTML entities, injected spacing markers, collapsed line breaks, truncated generics, or joined parameters are publication blockers.
- A complex method or implementation signature must be followed by a structured field reference with its own **PARAMETERS:** list; do not leave it as an unreadable inline signature or summarize its fields in one prose sentence.

**Complex type documentation:**

When a parameter type is a complex object (e.g., `HybridSearchSingleReq[]`, `FunctionObject`), do NOT describe its fields inline in one prose sentence. Instead:
1. Keep the parameter description brief: "For the full field reference, see the TypeName section below."
2. Add a new `## TypeName{#anchor}` section after `## Example{#example}` with its own **PARAMETERS:** bullet list.
3. For cross-references (e.g., `alterCollectionFunction.function` pointing to `addCollectionFunction`), use plain text: "For the FunctionObject field reference, refer to `addCollectionFunction()`."

**CRITICAL — No markdown links inside bullet descriptions.** A markdown link (`[text](#anchor)`) inside a bullet description causes a Feishu schema mismatch error that silently drops that bullet's content AND all subsequent bullets. Use plain text references instead.

**Scripts:**
- `bin/sdk-release-scout.js --language node --sdk-name milvus-sdk-node --track v2.6.x` — v2.6.x release scope discovery
- `scripts/node-v26-update.js` — v2.6.x create/update run
- `scripts/node-v26-request-syntax.js` — doc rebuild (version migration reference)
- `scripts/node-v2610-fix.js`, `scripts/node-v2610-update.js` — v2.6.10 patch runs
- `scripts/node-doc-quality-fix.js` — batch quality fixes (signatures, Request Syntax, constructors)
- `scripts/node-add-token.js` — add `token: 'root:Milvus'` to all MilvusClient constructors
- `scripts/node-data-import-docs.js` — v2.4/v2.5/v2.6/v3.0 Data Import folder, VirtualNode, doc, and record backfill
- `scripts/node-reformat-constructor.js` — reformat single-line constructor to multi-line
- `scripts/node-fix-code-lang.js` — change code block language TypeScript→JavaScript
- `scripts/node-inline-type-fix.js` — extract complex inline types into dedicated ## sections
