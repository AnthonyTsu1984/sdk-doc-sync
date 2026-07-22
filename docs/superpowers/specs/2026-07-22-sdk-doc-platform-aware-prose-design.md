# Platform-Aware, Human-Readable SDK Reference Content

**Date:** 2026-07-22

## Purpose

Make generated PyMilvus reference pages human-readable and platform-correct without turning release-specific wording into permanent generator logic.

The first target is the Python v2.6.x documentation batch, especially BulkImport functions whose current reviewed descriptions contain fragments such as `url of the server.`, `name of the target collection.`, and `id of a milvus instance(cloud).`

This design treats article or plural-noun sentence starts as one useful prose check, not as the definition of quality. A description must tell a reader what the value represents, which platform it applies to, and any important constraints or examples.

## Goals

- Produce clear, grammatical parameter descriptions.
- Distinguish shared, Milvus-only, and Zilliz Cloud-only parameters.
- Keep one logical parameter entry when its type and requirement metadata are shared but its meaning differs by platform.
- Give every supported platform accurate request syntax and examples.
- Follow zdoc's Lark code-variant directive format.
- Validate platform coverage and prevent audience leakage before writes.
- Keep reusable schema, rendering, validation, and guidance stable across release runs.
- Keep exact release-specific classifications and wording in reviewed run artifacts.

## Non-goals

- Automatically rewrite arbitrary source docstrings into polished prose.
- Infer platform ownership from markers such as `(cloud)`.
- Add platform-aware enforcement to every SDK in the first implementation.
- Commit the Python v2.6.x generated previews or release-specific reviewed context as core behavior.
- Change established PyMilvus page grouping or create new symbol pages as part of this work.

## Baseline Failures

The current Python path has five relevant limitations:

1. Production validation requires only a non-empty field description.
2. A field has one description and no audience metadata.
3. The Python adapter creates one request variant from one combined signature.
4. Examples have no audience metadata.
5. Existing audience variants render summary paragraphs only.

Consequently, the current BulkImport preview renders one combined signature, one mixed parameter list, and one unwrapped Zilliz Cloud example. Superficially prefixing descriptions with `The` would improve grammar but would not fix vague server terminology or platform ownership.

## Chosen Approach

Use explicit, reviewed audience metadata in the SDK reference IR. Render prose with structural audience regions and render code variants with zdoc-compatible comment directives.

Raw HTML-like markup will not be stored inside reviewed code strings. The renderer owns all code-directive syntax.

## Platform Vocabulary

The initial audience identifiers are:

- `milvus`
- `zilliz`

Use these terms in prose:

- **Milvus server endpoint**, such as `http://localhost:19530`
- **Zilliz Cloud API server endpoint**, `https://api.cloud.zilliz.com`

Do not use bare `(cloud)` annotations. Name Zilliz Cloud explicitly.

## Reviewed Content Model

### Fields

A reviewed field has one of three audience shapes.

#### Shared field with shared meaning

```json
{
  "name": "collection_name",
  "type": "str",
  "audience": "shared",
  "description": "The name of the target collection."
}
```

#### Shared field with audience-specific meaning

```json
{
  "name": "url",
  "type": "str",
  "required": true,
  "audience": "shared",
  "descriptions": {
    "milvus": "The Milvus server endpoint, such as `http://localhost:19530`.",
    "zilliz": "The Zilliz Cloud API server endpoint, which is `https://api.cloud.zilliz.com`."
  }
}
```

The field header, type, default, and required qualifier render once. Only the description paragraphs vary by audience.

#### Platform-only field

```json
{
  "name": "project_id",
  "type": "str",
  "audience": "zilliz",
  "description": "The ID of the Zilliz Cloud project containing the target database."
}
```

The entire parameter entry is platform-specific.

`audience` accepts only `shared`, `milvus`, or `zilliz`. A field must define exactly one of `description` or `descriptions`. Audience-specific descriptions are permitted only on a shared field.

### Request variants

Reviewed context supplies complete signatures rather than asking the renderer to remove parameters from a combined source signature:

```json
{
  "requestVariants": [
    {
      "id": "milvus",
      "audience": "milvus",
      "parameters": ["url", "collection_name", "files"],
      "signature": "bulk_import(...) -> requests.Response"
    },
    {
      "id": "zilliz",
      "audience": "zilliz",
      "parameters": ["url", "collection_name", "object_urls", "project_id", "region_id", "api_key"],
      "signature": "bulk_import(...) -> requests.Response"
    }
  ]
}
```

The explicit `parameters` list is the validation source of truth; validators do not reverse-parse the display signature. If all supported platforms use the same signature, reviewed context may provide one shared variant without audience directives.

### Examples

Examples use the same audience vocabulary:

```json
{
  "examples": [
    {
      "title": "Milvus example",
      "audience": "milvus",
      "language": "python",
      "code": "response = bulk_import(...)"
    },
    {
      "title": "Zilliz Cloud example",
      "audience": "zilliz",
      "language": "python",
      "code": "response = bulk_import(...)"
    }
  ]
}
```

Shared examples remain possible when the code is genuinely identical and contains no platform-specific values.

## Rendering Rules

### Parameter prose

- Shared fields with one description render without wrappers.
- Shared fields with audience-specific descriptions render one list item containing one `<include>` region per description.
- Platform-only fields render their complete list item inside the matching `<include>` region.
- The renderer creates audience-region Document IR nodes. Reviewed strings do not contain wrapper markup.

Example output:

```md
- **url** (*str*) -
  **[REQUIRED]**

  <include target="milvus">
  The Milvus server endpoint, such as `http://localhost:19530`.
  </include>

  <include target="zilliz">
  The Zilliz Cloud API server endpoint, which is `https://api.cloud.zilliz.com`.
  </include>
```

### Request syntax and examples

Authoritative Lark code blocks follow `CODE_VARIANTS.md`:

- Directive lines occupy their complete physical line.
- Python uses `# include-start TARGET` and `# include-end`.
- Directive indentation matches the code it controls.
- The renderer does not insert blank spacer lines to compensate for removed directives.
- New HTML-like `<include>` or `<exclude>` tags are forbidden inside code blocks.

For distinct platform variants, the renderer creates one physical code block containing complete regions:

```python
# include-start milvus
bulk_import(
    url: str,
    collection_name: str,
    files: Optional[List[List[str]]] = None,
) -> requests.Response
# include-end
# include-start zilliz
bulk_import(
    url: str,
    collection_name: str,
    object_urls: Optional[List[List[str]]] = None,
    project_id: str = "",
    region_id: str = "",
    api_key: str = "",
) -> requests.Response
# include-end
```

The same composition applies to the Examples section. If one shared code variant is sufficient, the renderer emits a normal code block without directives.

The initial implementation needs only the Python `#` directive style. The IR remains language-neutral so other SDK renderers can adopt their appropriate comment syntax later.

## Human-Readability Policy

Reviewed descriptions, not the renderer, own meaning and wording. The renderer must never repair prose by blindly adding an article.

Python production descriptions must:

- be complete sentences with terminal punctuation;
- start with a readable noun phrase, normally `The`, `A`, `An`, or an unambiguous plural noun phrase;
- use correct acronym and product capitalization;
- contain normal spacing around parentheses and punctuation;
- identify platform-specific concepts by platform name;
- explain what the value represents rather than merely restating the parameter name;
- include useful constraints, formats, or examples when they materially help the reader.

Validation should reject known fragment patterns such as lowercase `url of`, `id of`, or `name of` openings. Plural-noun recognition should remain conservative: if the validator cannot identify a valid plural lead confidently, the author should rewrite the sentence with an article rather than add an ever-growing exception list.

The quality gate does not attempt full natural-language scoring. Human review remains mandatory for release-specific descriptions.

## Validation

Validation runs on structured reference IR before rendering and on rendered Document IR or Markdown before a write.

### Structured IR checks

- Audience values are from the supported vocabulary.
- A field's description shape matches its audience shape.
- Shared and platform-only parameters do not duplicate the same name.
- Every parameter referenced by a request variant exists and is available to that audience.
- Platform-only parameters do not occur in another audience's signature.
- Every supported audience has request-syntax coverage when signatures differ.
- Every supported audience has example coverage.
- Example endpoint values match the example audience.
- Production Python descriptions pass the readability policy.

### Rendered-output checks

- Prose audience regions are balanced and target valid audiences.
- Code directives occupy complete lines and use valid bodies.
- Code does not contain new HTML-like audience tags.
- Request syntax and examples expose the same audience set.
- Platform-specific parameter prose does not leak outside audience regions.

Failures are blocking errors for approval-grade plans. Warnings may identify shallow descriptions, but no warning may be used to permit audience leakage or malformed variants.

## Pipeline Changes

The data flow becomes:

1. Scanner extracts source facts without assigning platform meaning.
2. Run-local reviewed context supplies polished descriptions, audience classifications, request variants, and examples.
3. The Python adapter preserves the reviewed audience structure in SDK reference IR.
4. Reference validation rejects prose and platform inconsistencies.
5. The SDK renderer creates prose audience regions and code-variant directives.
6. Layout and Markdown validation verify the rendered structure.
7. Previews are reviewed before Feishu writes.

The scanner must not infer `zilliz` from `(cloud)`, parameter names, or example URLs. Missing audience review is a blocker when platform-specific behavior is detected.

## Implementation Boundaries

The implementation has two deliberately separate layers. Release content depends on the stable core; the stable core never imports, reads, or names a release artifact.

### Stable core

The stable core contains small, data-driven units with no method, release, or document IDs embedded in their behavior.

#### Audience model

Owns the audience vocabulary and projection rules:

- validates `shared`, `milvus`, and `zilliz`;
- determines whether a field is visible to an audience;
- validates shared versus audience-specific descriptions;
- compares the audiences represented by fields, request variants, and examples.

This logic belongs in a focused reference-IR module rather than being repeated in the Python adapter and renderer.

#### Prose-quality validator

Owns deterministic human-readability checks:

- sentence completion and terminal punctuation;
- fragment and identifier-derived opening detection;
- capitalization and spacing defects;
- vague platform markers such as bare `(cloud)`;
- platform terminology requirements when an audience is declared.

It reports defects but never rewrites prose. It must not contain parameter-name-specific replacements such as `url -> The URL...`.

#### Code-variant composer

Accepts structured shared or audience-specific code variants and a language directive policy. It returns code text with complete-line zdoc directives.

The initial policy supports Python `#` comments. The composer itself is language-neutral and must not contain `bulk_import`, endpoint values, or v2.6.x logic.

#### Reference adapter and renderer integration

The Python adapter maps reviewed audience data into reference IR without interpreting its meaning. The SDK renderer consumes that IR through the shared audience model and code-variant composer.

The adapter must not infer audiences or polish descriptions. The renderer must not branch on method names.

#### Core validation and tests

Core tests use synthetic names and compact fixtures wherever possible. One end-to-end BulkImport-shaped fixture is acceptable to demonstrate the interaction, but it must be authored as a stable synthetic fixture rather than copied from the 25-document run context.

### One-off release content

The Python v2.6.x run layer contains reviewed data and disposable transformation tooling:

- parameter classifications for the 25 documents;
- exact human-authored descriptions;
- complete Milvus and Zilliz request signatures;
- platform-specific examples and endpoint values;
- migration scripts that convert the existing reviewed context to the new schema;
- previews, platform projections, validation reports, and approval manifests;
- canary-specific investigation notes and cleanup scripts.

These artifacts stay under `tmp/sdk-release-scout/` or another explicit run directory. They do not become imports, fixtures, lookup tables, or special cases in `.claude/skills/sdk-doc-sync/src/`.

One-off scripts may call stable core APIs, but stable core code may not call or require one-off scripts.

### Proposed file ownership

| Path | Ownership |
|---|---|
| `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/audience.js` | Stable audience vocabulary, visibility, and coverage rules |
| `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/prose-quality.js` | Stable deterministic prose checks |
| `.claude/skills/sdk-doc-sync/src/renderers/code-variants.js` | Stable directive composition and language policies |
| `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/schema.js` | Stable IR shape additions |
| `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/validate.js` | Stable production validation integration |
| `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/adapters/python.js` | Stable reviewed-context adaptation |
| `.claude/skills/sdk-doc-sync/src/renderers/sdk-renderer.js` | Stable structural rendering integration |
| `.claude/skills/sdk-doc-sync/tests/` | Stable synthetic regression tests |
| `.claude/skills/sdk-doc-sync/sdk-python.md` | Stable authoring and platform terminology guidance |
| `tmp/sdk-release-scout/python-v26-platform-content/` | One-off reviewed content, migrations, previews, and reports |

The exact filenames may change during the implementation plan if an existing focused module already owns the responsibility, but the dependency direction and ownership classification do not change.

### Forbidden coupling

The following implementation patterns are explicitly out of scope:

- `if (symbol.name === 'bulk_import')` or equivalent method-name branches in core code;
- maps of v2.6.x parameter names to audiences in committed source;
- hard-coded 25-document IDs, slugs, or descriptions in validators or renderers;
- copying the complete reviewed release context into test fixtures;
- embedding code-variant directive strings manually in every reviewed code sample;
- keeping a temporary repair path in core after the run has been migrated.

## Promotion and Commit Policy

Every changed file is classified before commit.

| Classification | Definition | Action |
|---|---|---|
| Stable core | Reusable schema, projection, rendering, validation, or guidance that is independent of method and release | Commit with focused tests |
| Stable fixture | Minimal synthetic evidence needed to lock a reusable behavior | Commit with the core test |
| Run content | Exact wording, classifications, signatures, examples, previews, and reports for the current batch | Keep in the run directory; do not include in a core commit |
| Migration tool | Script needed only to reshape or repair this batch | Keep run-local and delete or archive after verified use |
| Suspected reusable rule | A pattern observed during the run but not yet expressed generically | Pause and either generalize with a failing core test or leave it run-local |

A release detail may move into the stable core only when all of these are true:

1. It can be stated without naming a method, document, release, or record ID.
2. It represents a schema contract, rendering rule, validation invariant, or stable platform term.
3. It has a synthetic failing test that demonstrates the reusable behavior.
4. The core implementation does not need a release-content lookup table.

Before any commit, produce a run-local change-classification report listing:

- files proposed for the stable core commit;
- files retained as run content;
- temporary files to discard after validation;
- unexpected or unclassified changes that block the commit.

Core commits must be isolated from run-content commits. An approval-grade run cannot proceed while files remain unclassified.

## Core Versus Run-Local Deliverables

### Commit to the core

- Audience-aware field, request-variant, and example schema.
- Shared audience projection and consistency logic.
- Deterministic prose-quality validation without automatic rewriting.
- Language-neutral code-variant composition with a Python directive policy.
- Python adapter and structural renderer integration.
- Small synthetic fixtures and regression tests.
- Durable Python authoring guidance and stable platform terminology.
- The run-change classification contract.

### Keep run-local

- The 25-document v2.6.x classification decisions.
- Exact descriptions for individual parameters.
- Release-specific request signatures and examples.
- Generated previews, audits, dry-run JSON, and review notes.
- Temporary migration or cleanup scripts that only repair the current batch.
- The generated change-classification report itself.

A release-specific behavior is promoted into the core only through the promotion policy above. Method-specific wording and one-time corrections remain outside the core.

## Test Strategy

Implementation follows test-driven development.

### Reference IR tests

- Shared field with one description.
- Shared field with Milvus and Zilliz descriptions.
- Milvus-only and Zilliz-only fields.
- Invalid audience and invalid description shapes.
- Audience-aware request variants and examples survive adaptation.

### Renderer tests

- Shared prose renders without wrappers.
- One shared parameter entry renders two wrapped description paragraphs.
- A platform-only parameter wraps the complete entry.
- Distinct Python variants render one code block with valid comment directives.
- Shared code renders without directives.
- Examples use the same variant behavior.

### Validation tests

- Reject current fragment-style BulkImport descriptions.
- Reject mechanical but unclear fixes such as `The URL of the server.` when two platform meanings are declared without variants.
- Reject Cloud-only parameters in a Milvus signature.
- Reject missing Milvus or Zilliz examples.
- Reject incorrect endpoint values.
- Reject HTML-like tags inside code.
- Reject malformed or partial directive lines.

### Integration fixture

A synthetic BulkImport fixture covers both audiences end to end. It must produce readable parameter prose, filtered request syntax, and filtered examples without depending on the current v2.6.x run artifact.

## Rollout

1. Add failing tests for schema, prose validation, audience coverage, and directive rendering.
2. Implement the stable audience model, prose validator, and code-variant composer until those tests pass.
3. Integrate the Python adapter, renderer, and rendered-output validation without method-specific branches.
4. Update durable Python guidance.
5. Create a run-local migration tool and migrate one BulkImport canary.
6. Generate and review Milvus and Zilliz views of the canary.
7. Apply the reviewed model to the remaining v2.6.x documents through run-local data.
8. Generate the change-classification report and resolve every unclassified file.
9. Commit stable core changes separately from any approved release-content changes.
10. Remove or archive temporary migration tooling after the batch is verified.

No Feishu write becomes approval-ready until both platform views pass validation and human review.

## Success Criteria

- Readers see clear descriptions rather than identifier-derived fragments.
- `url` has correct Milvus and Zilliz Cloud meanings in one logical parameter entry.
- Platform-only parameters appear only for their platform.
- Each platform receives correct request syntax and examples.
- Authoritative code blocks use zdoc comment directives.
- No new HTML-like audience tags appear inside code.
- Re-running the release workflow does not require new method-specific core logic.
- The committed core diff contains reusable behavior and tests, while release-specific content remains reviewable and disposable.
