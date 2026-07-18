# Schema-First SDK/API Documentation Generation — Design Spec

**Date:** 2026-07-18
**Status:** Awaiting written-spec review

---

## 1. Overview

Replace the current scanner-to-Markdown scaffold flow with a schema-first documentation pipeline. Source scanners, OpenAPI readers, and Feishu readers produce validated intermediate representations. Dedicated SDK, CLI, REST, Markdown, and Feishu renderers consume those representations. Only validated, reviewed artifacts may reach the existing approval-gated publication workflow.

This design also repairs the legacy `larkDocWriter` conversion boundary before relying on it for production generation. Live Feishu pages confirmed that the documentation model must represent semantic differences such as Java builder methods, Go option methods, C++ request methods, Node.js request variants, complex return types, and CLI options rather than flattening all inputs into one parameter list.

## 2. Goals

- Define a versioned, normalized schema for SDK/API reference content.
- Preserve language-specific documentation behavior without duplicating whole templates.
- Represent Feishu document structure without silent content loss.
- Generate deterministic, placeholder-free artifacts before publication.
- Make dry-run produce the same read and planning result as a live run while suppressing mutations only.
- Enforce version-folder, shared-token, reviewed-content, and document-link preconditions.
- Provide offline golden tests for conversion, rendering, planning, and publisher boundaries.
- Keep live Feishu verification separate, explicitly approved, and disposable.

## 3. Non-Goals

- Rebuild every historical one-off migration script before the new pipeline is usable.
- Make Markdown the canonical representation of Feishu block structure.
- Automatically invent descriptions, examples, constraints, or exceptions when source evidence is absent.
- Publish generated scaffolds without review.
- Run mutating Feishu integration tests in ordinary CI.
- Change existing historical SDK documents unless they are part of an approved version-targeted action.

## 4. Verified Constraints

Representative live Feishu pages established these document families:

| Family | Required shape |
| --- | --- |
| Python method | Description, signature/request syntax, parameters, return type, returns, exceptions, examples |
| Java method | Canonical signature, optional request syntax, builder methods, returns, exceptions, example |
| Go method | Canonical signature, constructor parameters, option methods, return type, returns, exceptions, example |
| Node.js method | Canonical call, one or more request variants, nested request fields, promise/result fields, example |
| C++ method | Canonical signature, request syntax, request methods, status/result behavior, example |
| SDK class/type | Constructor or type signature, nested fields/members, return or usage behavior, example |
| CLI command | Description, synopsis, required/options/defaults/choices, notes, examples; no SDK return/exception sections |
| REST operation | Endpoint, authentication, path/query/body inputs, request schema, response/status schemas, examples |

The live pages also contain formatting drift and incorrect code-language labels. Therefore, current rendered Markdown is evidence but not the schema source of truth.

## 5. Architecture

```text
SDK source scanners ───────┐
OpenAPI readers ───────────┼─> SDK Reference IR ─> semantic validation
Curated evidence ──────────┘                         │
                                                    v
Feishu API ─> FeishuClient ─> DocxReader ─> General Document IR
                                                    ^
                                                    │
SDK Reference IR ─> language renderer ──────────────┘
                                                    │
                                                    v
                                  Markdown / Feishu artifact renderers
                                                    │
                                                    v
                            artifact validation ─> SyncPlanner
                                                    │
                                      immutable approval artifact
                                                    │
                                                    v
                                      SyncExecutor ─> Verifier
```

The system uses two related schemas:

1. **SDK Reference IR** models documentation meaning: signatures, request variants, inputs, callable members, outputs, errors, examples, evidence, and audience variants.
2. **General Document IR** models presentation structure: headings, paragraphs, code, lists, tables, callouts, includes, citations, media, references, and opaque unsupported blocks.

The SDK Reference IR renders into the General Document IR. Markdown and Feishu blocks are terminal formats, not intermediate sources of truth.

## 6. SDK Reference IR

Every document has this top-level contract:

```js
{
  schemaVersion: 1,
  identity: {
    kind: "method | function | class | enum | struct | interface | command | rest-operation",
    language: "python | java | node | go | cpp | zilliz-cli | rest",
    name: "createCollection",
    title: "createCollection()",
    stableId: "node:Collections:createCollection"
  },
  source: {
    repository: "milvus-sdk-node",
    revision: "v3.0.0",
    file: "src/...",
    line: 120
  },
  summary: "This operation creates a collection.",
  signatures: [],
  requestVariants: [],
  callableMembers: [],
  result: null,
  errors: [],
  examples: [],
  notes: [],
  related: [],
  audienceVariants: ["milvus", "zilliz"],
  evidence: []
}
```

### 6.1 Inputs and nested fields

Inputs are recursive typed nodes rather than preformatted Markdown:

```js
{
  name: "schema",
  type: { display: "FieldType[]", references: ["node:type:FieldType"] },
  required: true,
  defaultValue: null,
  description: "Fields in the collection schema.",
  constraints: [],
  children: [],
  appliesWhen: null,
  evidence: []
}
```

Required status, defaults, choices, ranges, repeatability, mutual exclusion, deprecation, and conditional applicability must remain structured properties.

### 6.2 Request variants

Overloads and alternative request bodies are separate variants. A Node.js method such as `createCollection()` may contain a simple request and a customized-schema request. Renderers must not merge their fields into one ambiguous list.

### 6.3 Callable members

Builder, option, and request methods use one shared node shape with a distinct `kind`:

- Java: `builder`
- Go: `option`
- C++: `request`
- Other fluent APIs: explicitly selected by the language adapter

This preserves common validation while allowing language-specific headings and syntax.

### 6.4 Results

Results contain a type, prose description, and recursive fields. The schema supports status wrappers, promises, tuples, collection types, and output-only classes without forcing them into parameter sections.

### 6.5 Evidence

Authored or inferred content records its origin:

```js
{
  kind: "source | openapi | existing-doc | curated",
  locator: "src/client.ts:120",
  revision: "v3.0.0",
  confidence: "direct | derived | reviewed"
}
```

Required content without acceptable evidence blocks production rendering.

## 7. General Document IR

The General Document IR is a typed block tree. Supported node types include:

- document, heading, paragraph, text span
- unordered list, ordered list, list item
- code block and inline code
- table, row, cell
- callout and quote
- include/exclude audience region
- citation and document reference
- image, file, iframe, board, and other media references
- opaque block containing the original Feishu payload

Unknown or unsupported Feishu blocks must never disappear. They become opaque blocks and produce a validation error for lossless workflows or a visible warning for explicitly lossy exports.

Block types and code-language mappings live in one shared registry used by both conversion directions.

## 8. Component Boundaries

### 8.1 `FeishuClient`

- Accepts an injected transport and token provider.
- Supports explicit application or user identity selection.
- Validates HTTP and Feishu response envelopes.
- Implements bounded retries using `Headers.get()` and correct retry delays.
- Handles pagination for Docx blocks and Bitable records.
- Exposes no Markdown-specific behavior.

### 8.2 `BitableRepository`

- Requires an explicit table ID or a validated unique table selection policy.
- Normalizes legacy and current field shapes in one adapter.
- Returns stable record identities and document links.
- Detects missing links, missing slugs, and malformed parent fields.

### 8.3 `DocxReader`

- Fetches raw block trees.
- Resolves wiki tokens.
- Expands reference-synced blocks once without duplication.
- Preserves source IDs and opaque payloads.

### 8.4 `DocxToDocumentIr`

- Converts raw blocks into the General Document IR.
- Preserves C++, TypeScript, and every supported code language.
- Produces one representation for nested lists.
- Reports unsupported or malformed structures instead of silently dropping them.

### 8.5 Scanner adapters

Existing scanners remain initially unchanged. Per-language adapters normalize scanner output into the SDK Reference IR. This makes migration incremental and keeps source extraction separate from documentation presentation.

### 8.6 Language renderers

- A common SDK renderer controls shared ordering and block construction.
- Python, Java, Go, Node.js, and C++ adapters supply section policies, syntax, and terminology.
- The CLI renderer produces Description, Synopsis, Options, Notes, and Example.
- The REST renderer produces endpoint and schema-oriented sections.

Renderers are pure and deterministic: the same validated IR produces the same General Document IR.

### 8.7 Artifact renderers

- `DocumentIrToMarkdown` produces repository artifacts and review diffs.
- `DocumentIrToDocx` produces Feishu block requests.
- Neither renderer performs network operations.

### 8.8 `SyncPlanner`

The planner performs all reads in both dry-run and live modes. It creates an immutable plan containing:

- action type and stable symbol identity
- source and target versions
- existing record and document tokens
- canonical target folder and verified ancestry
- shared-token references
- artifact digest and evidence summary
- expected preconditions and postconditions

Dry-run suppresses only executor mutations.

### 8.9 `SyncExecutor`

The executor accepts only an approved immutable plan. It must not generate replacement content or reinterpret actions.

Write preconditions:

- reviewed content is present; scaffold fallback is forbidden
- target folder belongs to the canonical version root
- in-place updates are target-version-local and not shared with older versions
- cross-version updates create or copy into the target version before repointing
- created documents yield a nonempty usable URL
- Bitable link updates include both title and link

Partial failures stop the action and return recovery information.

### 8.10 `Verifier`

After execution, the verifier refetches the document, record, and folder state. It compares them with the approved plan and confirms that older-version documents remain unchanged.

## 9. Validation Policy

Production generation fails when:

- TODO, placeholder, or incomplete markers remain
- a required description, signature, example, or evidence record is absent
- required/default metadata conflicts
- duplicate inputs exist within a request variant
- a referenced internal type is unresolved
- logical signatures and descriptions are joined into one rendered block
- the renderer emits sections forbidden for that document family
- a code fence violates the language policy
- an unsupported block would be lost
- repeated rendering is not byte-stable
- the planned document or Bitable link is empty

Warnings are permitted for missing related links, shallow examples, optional external types, and intentionally lossy exports explicitly selected by the caller.

## 10. Migration of Existing Consumers

Read-only consumers migrate first:

1. `bin/export-doc.js`
2. `scripts/cli-fetch-and-diff.js`
3. translation source reads
4. SDK sync indexing
5. legacy Docusaurus `fetch-lark-docs` export flow

Write consumers migrate only after conversion and rendering golden tests pass. During migration, `larkDocWriter` remains a legacy compatibility adapter, not the canonical document model.

The CLI comparison script becomes a thin command over shared reader, planner, and renderer services. Hard-coded version/base/repository values move to explicit configuration. Its summary distinguishes identical, different, fetch-only, and scanner-only documents.

## 11. Testing Strategy

### 11.1 Offline unit tests

- every block type and code-language mapping
- C++ and TypeScript preservation
- tight and loose nested lists without duplication
- include/exclude matching, nesting, malformed tags, and multiple targets
- null, unknown, missing, and malformed blocks
- adjacent multilingual code-tab behavior
- front matter, headings, links, citations, tables, callouts, and references
- pagination, retries, invalid responses, and authentication failures

### 11.2 Golden tests

Golden fixtures cover representative Python, Java, Go, Node.js, C++, CLI, class/type, and REST pages. Tests compare:

- source fixture to normalized IR
- SDK Reference IR to General Document IR
- General Document IR to Markdown
- stable repeated output
- approved intentional differences from current live pages

### 11.3 Planner and publisher contract tests

- dry-run performs zero POST, PATCH, PUT, or DELETE requests
- dry-run and live planning produce the same action set
- shared and older-version tokens reject in-place mutation
- missing page blocks, missing URLs, and malformed records fail safely
- batching boundaries at 49/50/51 and 199/200/201
- partial top-level success followed by child failure returns recovery state
- retries are bounded and observable

### 11.4 Live smoke test

A manually approved release smoke test uses a disposable Feishu document and Bitable record. It verifies create, read, round-trip, patch, refetch, and cleanup. It never runs in ordinary CI.

## 12. Developer and QA Responsibilities

### Developer

- Implement schema and component boundaries test-first.
- Fix confirmed P0 conversion defects before adding generator behavior.
- Keep network access behind injectable interfaces.
- Migrate one consumer at a time with compatibility tests.
- Provide recovery data for every partial write failure.

### QA

- Own block, language, SDK-family, and REST golden fixtures.
- Maintain zero-write dry-run assertions.
- Add failure injection for transport, token, pagination, malformed data, retries, and partial writes.
- Review intentional golden changes independently.
- Run the approved disposable-document smoke test before release.

## 13. Delivery Stages and Gates

### Stage 1: Conversion safety

Fix C++ loss, nested-list duplication, null-target crashes, null block-type crashes, reference duplication, malformed front matter, and Drive writer runtime failures.

**Gate:** offline regression suite is green and no supported block is silently lost.

### Stage 2: Shared clients and General Document IR

Introduce transport, token, Bitable, Docx reader, block registry, and bidirectional conversion boundaries.

**Gate:** deterministic round-trip golden tests pass for all required block families.

### Stage 3: SDK Reference IR and renderers

Add schema validation, scanner adapters, and SDK/CLI/REST renderers.

**Gate:** all representative page-family goldens pass with no placeholders.

### Stage 4: Planning and read-only migration

Introduce the immutable planner and migrate read-only commands.

**Gate:** dry-run matches live planning and performs zero mutation calls.

### Stage 5: Publisher migration

Add write preconditions, execution, recovery, and verification.

**Gate:** publisher contract tests pass and the approved disposable Feishu smoke test succeeds.

### Stage 6: Cleanup

Remove duplicated mappings, dead legacy branches, and superseded one-off scripts.

**Gate:** all supported commands use the shared schema-first path and repository documentation matches executable tests.

## 14. Success Criteria

- Node.js no longer falls through to a Python scaffold.
- C++ and nested-list round trips preserve content exactly.
- No production artifact contains placeholders.
- Every generated section is traceable to evidence.
- All supported language and document families have golden fixtures.
- Dry-run produces an accurate approval artifact without mutations.
- Historical documents cannot be changed by a target-version update.
- Publication requires reviewed content and returns a verified document link.
- Current consumers operate through shared reader, schema, planner, and renderer boundaries.

