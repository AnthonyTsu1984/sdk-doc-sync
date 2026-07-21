# Bitable Type-Link Generation Design

## Goal

Make documented SDK Class and Enum references resolve to Feishu document links during schema-first generation, so links are deterministic, visible in dry-run artifacts, and included in approval digests.

## Architecture

Add a small type-URL index component that reads normalized records from the complete target-version Bitable inventory. It accepts only `Class` and `Enum` records with safe document URLs, indexes their document titles, strips a trailing `()` alias, and omits ambiguous names that point to different documents.

`SdkDocSync` will retain release-scope filtering for diff calculation while separately passing the complete type URL map to the artifact provider. When the diff baseline is the same Bitable, the existing index read is reused. When `--previous-base-token` selects an older diff baseline, a target-version type index reader uses `BASE_TOKEN` instead.

The schema-first artifact provider merges automatic Bitable URLs with reviewed `context.typeUrls`; reviewed context wins. It removes the current document's own title aliases to avoid self-links, then passes the merged map into the renderer. The renderer's existing `typeInlines()` function creates citations, so the links become part of Document IR, Markdown, Feishu blocks, and the artifact digest.

## Scope

- Link exact type references rendered in parameter, result, and nested field type positions.
- Index only Bitable records whose `Type` is `Class` or `Enum`.
- Preserve inline-code prose as inline code; do not turn arbitrary prose identifiers into links.
- Skip invalid URLs, self-links, and ambiguous names.
- Preserve explicit reviewed-context URL overrides.
- Keep `add-type-links.js` as an idempotent audit/legacy repair utility, not the primary generation mechanism.

## Error Handling

Missing or ambiguous type records are non-blocking and render as the existing italic type text. Type-index reads use the same read-only failure behavior as the Bitable index; a target type-index read failure blocks planning rather than silently generating approval artifacts with incomplete resolution.

## Verification

- Unit tests cover Class/Enum filtering, title aliases, invalid URLs, and ambiguity.
- CLI artifact tests prove automatic links appear in Document IR and Markdown, reviewed overrides win, and self-links are omitted.
- Orchestrator tests prove type resolution uses the complete Bitable inventory even when `result.indexed` is release-scoped.
- A PyMilvus v2.6.x dry run proves `DataType` links are embedded before approval and changes the affected artifact digests.
