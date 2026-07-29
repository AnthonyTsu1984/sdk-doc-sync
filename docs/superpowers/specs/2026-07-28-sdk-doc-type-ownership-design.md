# SDK Reference Type Ownership Design

## Objective

Prevent request, response, result, task, info, iterator, descriptor, transport, and other method-owned helper types from becoming sibling API-reference documents. Embed their public shape and behavior in every owning interface document instead. Preserve standalone pages only for APIs that users intentionally consume as independent public concepts.

The policy applies to all SDK reference generation. C++ is the first complete implementation because its current reference Bitable contains many incorrectly promoted helper records.

## Documentation Model

Every scanned public symbol receives one of three documentation ownership classifications:

- `standalone`: the symbol intentionally owns an API-reference document.
- `method_owned`: the symbol is documented inside one or more owning interface documents.
- `ambiguous`: ownership cannot be established safely and planning must stop for review.

Methods, functions, commands, and explicitly approved independent public types may be `standalone`. Request builders, response containers, intermediate result models, asynchronous task handles, transport structs, nested payloads, and implementation-facing wrappers default to `method_owned` when an owning public interface can be derived.

Naming is evidence, not the decision mechanism. Suffixes such as `Request`, `Response`, `Result`, `Task`, `Info`, `Desc`, and `Iterator` may identify likely helpers, but ownership must come from signatures, source relationships, canonical identity maps, or an explicit reviewed override.

Enums, reusable schemas, user-constructed domain models, and independently callable classes may remain standalone when source and existing documentation demonstrate independent use. Exceptions must be explicit so an unknown helper cannot silently become a new sibling page.

## Shared Ownership Representation

Add a stable ownership representation usable by every scanner and release-scope adapter:

```json
{
  "classification": "method_owned",
  "owners": [
    {
      "stableId": "cpp:Management:Optimize",
      "canonicalSlug": "Management-Optimize",
      "category": "Management"
    }
  ],
  "evidence": [
    {
      "kind": "signature",
      "locator": "src/include/milvus/MilvusClientV2.h:123"
    }
  ]
}
```

The representation may be produced directly by a scanner or resolved through a track-specific identity map. Multiple owners are valid and cause one changed helper to fan out into an update for every owning interface.

Identity maps remain the reviewed override layer for aliases, non-obvious ownership, and cross-file relationships. They must not be required for relationships that the language scanner can derive reliably.

## Shared Enforcement Harness

The stable core will enforce ownership at three boundaries.

### Release scope

When a method-owned helper changes, release scope emits actions for its owners rather than an action for the helper identity. A shared helper may emit multiple owner actions. Evidence must retain the helper source file so the reason for each owner update remains auditable.

An unowned helper-like symbol becomes an `AMBIGUOUS_DOCUMENTATION_OWNERSHIP` diagnostic. It must not fall back to a generated standalone stable ID.

### Candidate grouping

Phase 2 must show the helper-to-owner relationship in its evidence. It may propose embedding, fan-out to multiple owners, an explicit standalone exception, exclusion, or deferral.

A proposal to create a standalone document for a `method_owned` symbol is invalid. Existing sibling records discovered in Bitable are reported as cleanup candidates, not treated as proof that the incorrect granularity should continue.

### Approval-ready planning

Phase 3 validation rejects:

- standalone create or update plans for method-owned helpers;
- owners without canonical stable IDs, slugs, categories, or placement;
- ambiguous helpers without reviewed decisions;
- embedded helper content lacking source evidence;
- helper changes that omit one or more known owners.

These failures are `planning_blocked`; they cannot be bypassed by write approval.

## C++ Ownership Discovery

The C++ scanner will construct a transitive method-to-type graph from public headers.

For each `MilvusClientV2` or other documented public entry point, it will collect:

1. Request types from input parameters.
2. Response and output types from output parameters and return types.
3. Public field, accessor, builder, and nested payload types referenced by those request and response types.
4. Aliases and public inheritance relationships.
5. Iterator, task, result, descriptor, and info types reachable from the method-owned graph.

Traversal must be cycle-safe and retain the source header for every relationship. The scanner will attach all reachable headers to the owning method's `relatedFiles`, so a helper-only source change updates the correct method documents.

Examples of expected ownership include:

- `Optimize()` owns `OptimizeRequest`, `OptimizeResponse`, and `OptimizeTask`.
- `DescribeReplicas()` owns `DescribeReplicasRequest`, `DescribeReplicasResponse`, `ReplicaInfo`, and `ShardReplica`.
- Collection-function methods own their respective request types.
- Batch describe, refresh load, search, query, insert, and upsert methods own their request, response, result, and nested payload types.
- A helper used by multiple methods updates every owner rather than receiving its own page.

C++ enums and explicitly reviewed independent configuration concepts remain standalone. All other unowned public types are ambiguous until allowlisted or assigned owners.

## Embedded Content Generation

The SDK Reference IR will represent embedded types structurally rather than as prose pasted into a method summary.

An owning document may contain:

- request variants and builder methods;
- response fields and nested result structures;
- public accessors or iterator operations relevant to consuming the method result;
- source-backed descriptions and type relationships;
- platform or audience variants when applicable.

Renderers remain language-specific, but they consume the same ownership semantics. Embedded sections use stable anchors derived from type names and must not create new Bitable identities or sibling documents.

For a type shared by multiple owners, each owner receives the subset required to understand that interface. The system does not create a synthetic umbrella page merely to avoid repeated field documentation.

## Language Adoption

The shared policy applies immediately, while scanner adoption proceeds incrementally:

- Java reuses and formalizes its existing helper-to-owner identity maps and `targets` fan-out.
- Python migrates request helpers and intermediate response wrappers to explicit ownership while preserving intentionally independent schemas and result objects.
- Go distinguishes option/request/result transport structs from independently documented entities and constructors.
- Node.js promotes its existing embedded complex-type sections into explicit ownership metadata and planner validation.
- C++ receives the first complete scanner graph, renderer coverage, and end-to-end enforcement.

Until a language adapter produces complete ownership metadata, existing reviewed identity maps remain authoritative. Shared planning validation still prevents a known `method_owned` symbol from becoming standalone.

## Existing Bitable Cleanup

Add a read-only audit that compares live SDK reference records with ownership classifications. It reports:

- existing sibling helper record and document identity;
- owning interface record or records;
- whether the helper content is already embedded;
- proposed cleanup disposition;
- unresolved links, parent relationships, or shared-version risks.

The audit performs no writes. Removing, deprecating, unlinking, or reparenting existing records requires a separate sdk-doc-sync candidate proposal and the normal grouping, write, and acceptance approvals.

## Error Handling

The system must prefer a visible blocker over a guessed documentation identity.

- Cycles in the type graph are deduplicated and reported only if they prevent ownership resolution.
- Missing headers or unresolved aliases produce source diagnostics with the referring method and type.
- Conflicting owners are allowed when fan-out is valid; conflicting ownership classifications are blockers.
- A standalone exception without evidence or reviewed configuration is a blocker.
- Existing incorrect Bitable siblings do not automatically override scanner-derived ownership.

## Testing Strategy

Follow test-driven development for implementation.

Shared tests will cover:

- one helper mapping to one owner;
- one helper fanning out to multiple owners;
- rejection of standalone plans for method-owned helpers;
- blocking ambiguous helper-like symbols;
- explicit standalone exceptions;
- preservation of source evidence through release scope and planning.

C++ fixtures will cover every family observed in the current Bitable review: collection-function requests, batch describe request/response types, database descriptors, field and DML result payloads, embedding and search/query results, sub-search requests, iterators, analyzer results, refresh-load requests, optimization request/response/task types, replica request/response/info/shard types, and shared nested helpers.

Regression tests must first demonstrate the current failure: helper changes either become standalone candidates or fail to update all owning methods. The implementation then makes those tests pass without changing unrelated SDK behavior.

The full stable sdk-doc-sync test suite must pass. The five pre-existing Node.js IR and renderer edits are outside this change and must not be staged or committed with the ownership work.

## Stable-Core Boundary

Reusable ownership classification, scanner traversal, validation, render support, identity-map schema support, audit logic, and synthetic regression fixtures belong in the stable core.

Live Bitable snapshots, exact cleanup record IDs, generated cleanup proposals, migration scripts for this specific incident, previews, receipts, and verification artifacts remain ignored run-local material under `tmp/`.

## Success Criteria

The design is complete when:

- no method-owned helper can reach an approval-ready plan as a standalone document;
- a helper source change updates every known owning interface;
- C++ method pages render the relevant request and result structures inline;
- independent public types can remain standalone only through clear scanner evidence or an explicit reviewed exception;
- existing incorrect sibling records can be identified without mutating Feishu;
- all stable tests pass without incorporating unrelated worktree changes.
