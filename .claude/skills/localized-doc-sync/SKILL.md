---
name: localized-doc-sync
description: Use when aligning paired source and localized Zilliz documentation across Feishu/Lark wiki roots and bitables, including record diffs, localized document creation or updates, metadata synchronization, parent mapping, and preservation of images, boards, Figma embeds, sheets, or Supademo blocks. Do not use for same-language SDK release synchronization.
---

# Localized Doc Sync

Align a read-only source documentation set with a localized target while preserving identity, hierarchy, metadata, and rich media.

## Trigger Boundary

Use for paired source/target Feishu wiki roots and Bitables that need localization record diffing, document creation/update, metadata alignment, parent mapping, or media preservation.

Do not use for same-language SDK release synchronization, narrative authoring without paired records, or verification-only code checks.

## Permission Boundary

- Source records and source documents are read-only unless the user separately requests and approves a source-side change.
- Indexing, diffing, translation previews, and dry-run are allowed by default.
- Target writes require explicit approval of exact records/documents and batch digest. Never delete `ORPHAN` records without separate approval.
- An `ORPHAN` decision must explicitly preserve the target record unchanged while reporting it; reporting alone must not be interpreted as deletion, archival, or mutation authority.
- Refetch every written record and document; uncertain parent mapping, schema, credentials, or protected media blocks completion.
- Before deciding any source-side change, ORPHAN handling, or partial table-pair selection, inspect the complete configured `table_pairs` inventory. A single document or record lookup is not sufficient evidence.

## Shared Contract

- Capability baseline: [capabilities.json](capabilities.json).
- Build reviewed `NEW`, `UPDATE`, and `META_ONLY` operations with `node .claude/skills/doc-ops-core/bin/build-action-batch.js --skill localized-doc-sync --operation sync --input <actions.json> --output <batch.json>`.
- Approval must match the exact `batchDigest`, targets, action count, and side effects. Verify the live precondition for record identity, revision, parent mapping, and media inventory immediately before mutation.
- After writes, refetch and apply the shared `../doc-ops-core/` round-trip guard to content, metadata, hierarchy, images, boards, Figma, sheets, Supademo, and opaque blocks.

## Domain Workflow

1. Load and inspect the canonical table-pair map, wiki roots, fields, and media rules before making a sync decision. Index every configured source and target table; a pasted Base URL's visible `table=` is not the full Base.
2. Align table schemas and diff records by stable slug, not display title.
3. Classify records as `NEW`, `UPDATE`, `SKIP`, `ORPHAN`, or `META_ONLY`.
4. Resolve target parents by mapped source-parent slug. Create or align missing parents before child documents.
5. Translate prose, headings, captions, callouts, table prose, and localized UI text. Preserve code, inline code, API names, env vars, URLs, frontmatter tokens, `<!-- feishu-block:` comments, and `<Supademo ... />` components unless explicitly requested otherwise.
6. Produce a dry-run for each table pair, build the immutable action batch, and obtain explicit approval. Omitting a pair, adding source-side work, or adding ORPHAN deletion changes the side-effect scope and requires a new batch and digest.
7. Apply only approved target writes, then refetch and verify links, parent records, slug, type, progress/status, dates, content, and visible media.

Table-aware dry-run:

```bash
npm run translate -- \
  --source-bitable <source-base> \
  --target-bitable <target-base> \
  --source-table <source-table> \
  --target-table <target-table> \
  --source-root <source-wiki-root> \
  --target-root <target-wiki-root> \
  --source-lang en \
  --target-lang zh \
  --drive-type wiki \
  --dry-run
```

## Required References

- Canonical tokens, table pairs, field rules, libraries, and media handling: [references/zilliz-localization.md](references/zilliz-localization.md).
- Development/开发指南 alignment only: [references/development-alignment.md](references/development-alignment.md).
- Reuse `../api-reference-sync/src/feishu-doc-translator/`, its Markdown converters, and `lark-cli`; do not create one-off Feishu API clients.

## Output

Report source/target base, table, and root identities; dry-run and live counts by action; batch digest; changed document links and metadata; hierarchy/media verification; orphans; and every blocked or skipped record with reason.
