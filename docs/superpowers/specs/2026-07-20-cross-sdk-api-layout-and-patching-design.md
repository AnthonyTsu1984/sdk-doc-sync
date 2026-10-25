# Cross-SDK API Layout and Deterministic Patching Design

## Summary

Replace the current merged SDK document template with shared rendering primitives plus explicit per-language layout profiles, and replace generic smart block matching for API references with a semantic, section-aware patch planner. The new pipeline must preserve the established live formats for Python, Java, Node.js, Go, and C++, reject duplicate or misordered sections before writes, repair the three PyMilvus v2.6.x canary pages, and regenerate the remaining PyMilvus v2.6.x approval batch from live state.

## Context

The PyMilvus v2.6.x canary exposed three structural defects:

1. Generated pages repeated the Feishu document title as an H1 inside the body.
2. Python pages repeated the same callable signature before and inside `Request Syntax`.
3. Updates performed with the generic `smart` patch strategy left matched blocks in their old positions and appended unmatched blocks, producing scrambled section order.

The live cross-language review showed that the present abstraction is too coarse. All SDKs share low-level concepts such as descriptions, signatures, parameter lists, returns, exceptions, and examples, but they do not share one block sequence.

## Evidence From Existing Live Documentation

| Language | Body title | Preface signature | Request Syntax | Language-specific structure |
|---|---|---|---|---|
| Python | No body H1 | Omitted | One callable signature | `PARAMETERS`, `RETURN TYPE`, `RETURNS`, `EXCEPTIONS`, `Examples` |
| Java | No body H1 | Java method declaration | Builder invocation | `BUILDER METHODS`, `RETURNS`, `EXCEPTIONS`, `Example`; requestless methods omit builder sections |
| Node.js | No body H1 | Short client invocation | Request object, possibly multiple variants | Variant H3 sections, `PARAMETERS`, `RETURNS`, `EXCEPTIONS`, `Example`, optional complex-type sections |
| Go | No body H1 | Go client method declaration | Option construction and invocation | `PARAMETERS`, `OPTION METHODS`, `RETURN TYPE`, `RETURNS`, `EXCEPTIONS`, `Example`, optional validation sections |
| C++ | No body H1 | C++ API declaration or type usage | Request builder for request types | `REQUEST METHODS` or `METHODS`, `RETURNS`, `EXCEPTIONS`, `Example`, optional multi-class sections |

The key distinction is that Java, Node.js, Go, and C++ often need two different code blocks: a canonical API declaration or invocation and a request-construction example. Python's established v2.6.x method format uses only the signature inside `Request Syntax`.

## Goals

- Preserve the established live layout of each supported SDK language.
- Keep reusable rendering logic shared where the semantics are genuinely shared.
- Make language layout and section cardinality explicit and inspectable.
- Reject duplicate titles, duplicate signatures, empty sections, and invalid ordering before Feishu mutation.
- Make API-reference updates deterministic without deleting unrelated rich content.
- Preserve callouts, citations, media, embedded resources, and language-specific extension sections.
- Support safe normalization of already malformed pages through an explicitly reviewed repair plan.
- Repair and verify the three PyMilvus canary pages.
- Reconcile live PyMilvus state and regenerate the remaining v2.6.x approval batch.

## Non-Goals

- Reformat every historical SDK page.
- Make all SDK languages use identical headings or section names.
- Replace language scanners, Reference IR adapters, release-scope discovery, or Bitable identity logic.
- Convert Node.js, Go, or C++ direct-block workflows to Markdown-only workflows.
- Automatically repair arbitrary narrative documentation with the API-reference patcher.
- Advance `scan-state.json` as part of the renderer or patcher repair.

## Design Principles

### Shared primitives, explicit composition

Shared code owns how a semantic unit is rendered: code blocks, labels, parameter lists, member lists, return types, return descriptions, exception lists, examples, related links, and audience regions.

Language profiles own which semantic units exist, their order, cardinality, headings, fences, and optional extensions.

### Semantic structure before Markdown

Document IR blocks must carry stable semantic roles. Markdown text and Feishu block types are output encodings, not the source of layout meaning.

### Deterministic planning before mutation

An API patch plan must describe the desired ordered section graph and exact operations before execution. Matching content by similarity is insufficient for API references with repeated paragraphs, lists, and code blocks.

### Preserve rich content by default

Existing blocks outside a changed semantic section remain untouched. A full-body rebuild is allowed only for a page already classified as malformed, after history capture and explicit approval.

## Architecture

### 1. Shared rendering primitives

Retain and refine reusable functions currently hosted in `src/renderers/sdk-renderer.js`:

- field and nested-field lists;
- callable member lists;
- return type and return description blocks;
- exception lists;
- examples;
- related links;
- audience regions;
- code-block construction and language normalization.

The shared module must no longer hard-code one document-wide block sequence.

### 2. Language layout profiles

Each language renderer supplies an explicit layout profile. A profile describes semantic sections rather than merely labels and fences.

Conceptual profile shape:

```js
{
  id: 'python',
  bodyTitle: 'omit',
  canonicalSignature: 'omit',
  request: {
    mode: 'single-signature',
    heading: 'Request Syntax{#request-syntax}',
    fence: 'Python',
  },
  order: [
    'summary',
    'request',
    'parameters',
    'result-type',
    'returns',
    'exceptions',
    'examples',
    'extensions',
    'related',
  ],
}
```

The Java, Node.js, Go, and C++ profiles set `canonicalSignature: 'when-distinct'` or `always` and define their own request and member sections.

#### Python profile

- No body H1.
- No pre-request canonical signature.
- Exactly zero or one `Request Syntax` section.
- Exactly one signature code block inside `Request Syntax` when the method is callable.
- Parameters follow request syntax.
- Return type and return description remain separate semantic sections.

#### Java profile

- No body H1.
- Canonical Java declaration appears before `Request Syntax` when present.
- Builder syntax appears inside `Request Syntax`.
- Builder methods follow request syntax.
- Methods without a request class omit request syntax and builder methods.

#### Node.js profile

- No body H1.
- Canonical client invocation may appear before `Request Syntax`.
- Request syntax may contain multiple named variants.
- Example fence remains JavaScript while declaration and request fences follow the established Node.js policy.
- Complex-type extension sections remain after the example section.

#### Go profile

- No body H1.
- Canonical method declaration remains before request syntax.
- Request syntax contains option construction and invocation.
- Parameters, option methods, return type, returns, exceptions, and example remain distinct.
- Existing direct-block formatting rules remain authoritative.

#### C++ profile

- No body H1.
- Method pages retain the API declaration before request syntax.
- Request classes use request syntax plus request methods.
- Type pages use methods without forcing request syntax.
- Multi-class and type-specific extension sections remain supported.

### 3. Semantic block roles

Add semantic metadata to rendered Document IR nodes. Roles include:

- `summary`;
- `canonical-signature`;
- `request-heading`;
- `request-description`;
- `request-variant-heading`;
- `request-signature`;
- `parameters-label`;
- `parameters-list`;
- `members-label`;
- `members-list`;
- `result-type-label`;
- `result-type-value`;
- `returns-label`;
- `returns-description`;
- `result-fields`;
- `exceptions-label`;
- `exceptions-list`;
- `examples-heading`;
- `example-heading`;
- `example-description`;
- `example-code`;
- `extension-section`;
- `related-section`.

Roles must be deterministic and preserved into immutable plan artifacts. For repeated variants or examples, include stable keys such as `request-signature:<variant-id>` and `example-code:<example-id>`.

### 4. Semantic layout validator

Create a validator that runs after language rendering and before Markdown generation.

It validates:

- body title policy;
- required and forbidden roles;
- role cardinality;
- permitted signature count;
- duplicate normalized signatures;
- language-specific section order;
- labels followed by compatible content;
- non-empty required sections;
- requestless-method exceptions;
- code-fence policy by role;
- extension-section placement;
- internal notes and placeholder text through the existing publish-safety checks.

Validation errors are publish blockers and must include stable codes, paths, roles, and the offending values. Suggested codes include:

- `BODY_TITLE_FORBIDDEN`;
- `DUPLICATE_SIGNATURE`;
- `SECTION_ORDER_INVALID`;
- `SECTION_CARDINALITY_INVALID`;
- `SECTION_CONTENT_MISSING`;
- `CODE_FENCE_POLICY_INVALID`;
- `UNKNOWN_SEMANTIC_ROLE`.

### 5. Live document section model

Convert fetched Docx blocks into an API section model before planning an update. The parser uses block IDs, block types, heading and label text, and known language aliases.

The model records:

- current ordered top-level blocks;
- recognized semantic sections and their block ranges;
- unrecognized or rich blocks attached to a section;
- preserved blocks such as callouts, media, sheets, boards, and synced references;
- structural errors such as duplicate headings or missing anchors.

Recognition must support existing capitalization differences such as `Request syntax` and `Request Syntax`, and `Example` versus `Examples`, without rewriting them unless the touched section requires it.

### 6. API-reference patch planner

Introduce a dedicated API-reference patch planner. It consumes:

- the validated desired semantic layout;
- the current live section model;
- the approved action type and immutable artifact digest;
- the language profile;
- preservation policy.

It returns one of three strategies:

#### Targeted semantic patch

Default for healthy existing pages. Update, insert, or delete only blocks within changed semantic sections. Untouched sections and preserved rich blocks remain in place.

#### Ordered section replacement

Used when one or more complete sections must be replaced. Delete the recognized section range and insert the validated replacement at the section's canonical anchor. Do not rely on type-similarity matching.

#### Reviewed full-body rebuild

Used only when the current page is malformed enough that section boundaries cannot be trusted, or when the page is an approved canary repair. Requirements:

- capture document history first;
- verify there are no unhandled rich or opaque blocks;
- generate a full before/after structural preview;
- require an explicit repair approval;
- rebuild top-level blocks in validated order;
- refetch and verify before updating Bitable metadata.

The generic Markdown `smart` strategy remains available for non-API documents but is not used by `sync-executor` for SDK API-reference plans.

### 7. Executor integration

`sync-executor` selects the API patch planner whenever a plan carries a validated SDK Reference artifact and language layout profile.

- `CREATE`: create the Feishu document title separately, then push only the validated body blocks.
- `UPDATE_IN_PLACE`: plan and execute a targeted semantic patch or approved rebuild.
- `COPY_PATCH_AND_REPOINT`: copy the historical source, parse the copied page, apply the API patch plan, verify, then repoint the target record.
- Other document families retain their existing writers.

The executor must not update `Docs`, parent metadata, or progress until document verification succeeds.

### 8. Post-write semantic verification

Extend live verification beyond forbidden text checks. Refetched blocks are converted back into the section model and validated against the same language profile.

Verification checks:

- title exists only as document metadata;
- semantic section sequence matches the profile;
- signatures have the permitted roles and cardinality;
- required sections contain content;
- examples are not replaced with signatures;
- code-block languages match role policy;
- preserved rich blocks remain present;
- no stale blocks remain outside recognized sections;
- Bitable link, parent, progress, targets, and type match postconditions.

## Cross-Language Compatibility Corpus

Tests and fixtures must be derived from representative live pages, with tokens and user data removed from committed fixtures.

| Language | Required fixture categories |
|---|---|
| Python | Standard method, changed method, class page, requestless interface if available |
| Java | Builder request method, requestless method, enum or class page |
| Node.js | Simple request, multi-variant request, complex-type extension page |
| Go | Option-builder method, page with extension section, entity/type page |
| C++ | Request-builder method, response/type page, multi-class page |

Each fixture records semantic block roles, relative order, block types, and preserved rich-block attachments. The fixture does not need to preserve production text verbatim beyond what is required to test structure.

## Test Strategy

### Renderer tests

- Update language goldens to established layouts.
- Assert no body H1 for all SDK languages.
- Assert Python has one request signature and no canonical preface signature.
- Assert Java, Node.js, Go, and C++ retain distinct canonical and request signatures where appropriate.
- Assert requestless and type-page variants omit irrelevant sections.

### Layout-validator tests

- Reject duplicate signatures after normalization.
- Reject a body H1.
- Reject examples before request syntax.
- Reject labels without their associated list or value.
- Reject wrong fences by semantic role.
- Accept all cross-language compatibility fixtures.

### Patch-planner tests

- Update a parameter without moving examples or returns.
- Add a parameter in canonical order.
- Replace request syntax without matching the example code block.
- Preserve callouts and citations attached to a parameter.
- Preserve unmodified Node.js variants and complex-type sections.
- Preserve Go direct-block list styling.
- Preserve C++ type and multi-class sections.
- Classify a deliberately scrambled Python page as requiring a reviewed rebuild.

### Executor tests

- Assert API plans never call generic `strategy: smart`.
- Assert document verification occurs before Bitable mutation.
- Assert failed semantic verification blocks record updates.
- Assert copied historical source remains unchanged.
- Assert creates pass document title separately and omit body H1.

### Live smoke tests

Use disposable or approved canary pages only:

1. Create one representative page from each language profile in a disposable folder.
2. Apply one targeted update to each page.
3. Refetch and validate semantic order and rich-block preservation.
4. Delete disposable resources only under separate cleanup approval.

## PyMilvus Canary Repair

After the shared pipeline passes offline tests, prepare a separate repair dry-run for:

- `describe_user()` — reviewed full-body rebuild because block order is scrambled;
- `FieldSchema` — validate current structure and use targeted repair or reviewed rebuild depending on the live section model;
- `get_replicate_info()` — remove the body H1 and pre-request duplicate signature while preserving the remaining content order.

The repair plan must include live document history evidence, exact block operations, Bitable postconditions, and confirmation that the historical v2.4.x `FieldSchema` document remains unchanged.

## PyMilvus v2.6.x Batch Regeneration

After repairing the canaries:

1. Refetch the complete v2.6.x Bitable and current document placement.
2. Reconcile completed canaries against live state.
3. Convert `get_replicate_info()` from create-missing evidence to an existing-record identity.
4. Keep `describe_user()` and `FieldSchema` out of duplicate execution unless the regenerated diff finds remaining content changes.
5. Correct the `FieldOp` title and record-type mappings before planning.
6. Rebuild reviewed candidates, filtered release scope, reference context, full dry-run, summary, and approval TSV.
7. Confirm every plan passes semantic layout validation.
8. Present a fresh exact write-approval boundary.

No old artifact digest or prior `APPROVE_WRITES` response remains valid after the renderer changes.

## Rollout

### Stage 1: Offline shared-pipeline repair

- Introduce layout profiles and semantic roles.
- Add semantic validation.
- Add cross-language fixtures and renderer tests.
- Add the API section model and patch planner.
- Wire executor tests without live writes.

### Stage 2: Disposable cross-language smoke test

- Create and update one disposable page for each language.
- Verify ordering, signatures, fences, and preservation.
- Record results as a smoke artifact.

### Stage 3: PyMilvus canary repair

- Generate exact repair plans.
- Obtain repair write approval.
- Repair and verify the three canary pages.

### Stage 4: PyMilvus v2.6.x regeneration

- Rebuild live context and immutable plans.
- Obtain a new approval.
- Resume bounded release execution.

### Stage 5: Broader adoption

- Enable the new patcher for future Java, Node.js, Go, and C++ release actions after their disposable smoke tests pass.
- Do not bulk-rewrite historical pages solely to normalize formatting.

## Error Handling and Recovery

- Unrecognized section structure produces `planning_blocked`, not a guessed patch.
- Preserved rich blocks inside a replacement range require a narrower plan or explicit rebuild review.
- Any post-write semantic mismatch stops the action before Bitable mutation when possible.
- A failure after document mutation retains document token, history evidence, completed operations, and the exact semantic mismatch.
- Cross-version repair never mutates the historical source page.
- Scan state remains unchanged until the separately approved release synchronization is fully completed or explicitly deferred.

## Observability and Artifacts

Each dry-run and execution artifact should include:

- layout profile ID and version;
- semantic role sequence;
- normalized signature inventory;
- current section model summary;
- chosen patch strategy;
- exact section operations;
- preserved block IDs and types;
- semantic validation result before and after execution;
- Bitable postcondition verification;
- artifact digest.

## Risks and Mitigations

### Risk: shared change breaks a language-specific convention

Mitigation: explicit profiles, live-derived fixtures, and per-language smoke tests before activation.

### Risk: section recognition misclassifies historical pages

Mitigation: recognition is conservative; ambiguous pages become `planning_blocked`.

### Risk: targeted replacement removes rich blocks

Mitigation: attach rich blocks to section ranges and forbid replacement unless preservation is proven.

### Risk: full rebuild loses comments or resources

Mitigation: use only for approved malformed pages, capture history, inspect opaque blocks, and verify immediately.

### Risk: old approval artifacts are accidentally reused

Mitigation: include layout-profile version in artifact digests and mark previous PyMilvus artifacts stale.

## Acceptance Criteria

- All five language goldens match their established live section structures.
- Generated SDK bodies contain no H1 duplicate of the Feishu document title.
- Python method pages contain exactly one callable signature inside `Request Syntax`.
- Java, Node.js, Go, and C++ preserve distinct canonical and request signatures where their profiles require them.
- API-reference execution does not invoke generic smart patching.
- Semantic validation rejects duplicated or misordered sections before writes.
- Cross-language disposable create-and-update smoke tests pass.
- The three PyMilvus canary pages pass live semantic verification after approved repair.
- Historical v2.4.x `FieldSchema` remains unchanged.
- The remaining PyMilvus v2.6.x batch is regenerated from live state with new digests and a fresh approval boundary.
- `scan-state.json` remains at the prior baseline until the approved release batch completes.
