---
name: localization-docs
description: Use when aligning paired source and localized Zilliz documentation across Feishu/Lark wiki roots and bitables, including record diffs, localized document creation or updates, metadata synchronization, parent mapping, and preservation of images, boards, Figma embeds, sheets, or Supademo blocks. Do not use for same-language SDK release synchronization.
---

# Localization Docs

Use this skill for Zilliz docs localization workflows where an English Feishu wiki/bitable is the source of truth and another Feishu wiki/bitable is the localized target.

Before live writes, always produce a dry-run summary and get explicit approval for the concrete records/documents that will be created or updated.

## Core Workflow

1. Read [references/zilliz-localization.md](references/zilliz-localization.md) for the canonical base tokens, wiki roots, all table IDs, table-pair mapping, field rules, library paths, and media handling notes. For Development -> 开发指南 work, also read [references/development-alignment.md](references/development-alignment.md).
2. Confirm `.env` has Feishu credentials and any translator/media credentials required by the chosen workflow.
3. Index every mapped source and target table. Do not limit work to the `table=` parameter in a pasted Base URL; those URLs point at one visible table, while the Base contains multiple required documentation tables.
4. Align table metadata before touching docs: compare fields, canonical field names, select options, link field behavior, parent-record fields, and required target-only fields.
5. Diff records by stable slug within each table pair. Treat title as display text, not identity.
6. Classify each record as `NEW`, `UPDATE`, `SKIP`, `ORPHAN`, or `META_ONLY`.
7. For `NEW`, create the localized doc under the corresponding localized wiki parent, then create the target bitable record.
8. For `UPDATE`, fetch English Markdown, translate or merge only the changed content, preserve media metadata, then update the existing localized document.
9. Refetch the changed records and docs after live writes. Verify links, parent records, slug, type, progress/status, dates, and visible media blocks.

## Preferred Implementation

Reuse the existing SDK sync library rather than writing one-off Feishu API code. The translator CLI supports table-aware reads and writes through `--source-table` and `--target-table`; always provide both options for these multi-table bases.

```bash
npm run translate -- \
  --source-bitable Ac7xbs2k1ad7bjsCXr0ccHe9nMh \
  --target-bitable I6YUb1M0JajHrqsJGcLcZNh7neP \
  --source-table tblWv7PjNDsexddH \
  --target-table tblYpqCgevikMomb \
  --source-root OUWXw5c4gia34ZkQUcEcMFbWn6s \
  --target-root XyeFwdx6kiK9A6kq3yIcLNdEnDd \
  --source-lang en \
  --target-lang zh \
  --drive-type wiki \
  --dry-run
```

Run once per mapped table pair using the canonical table IDs in [references/zilliz-localization.md](references/zilliz-localization.md). Use `--action new` or `--action update` only after reviewing the dry-run output and obtaining explicit approval. Add `--translator claude`, `--translator feishu`, `--translator deepl`, or `--translator ollama` according to the available credentials and quality requirements.

## Metadata Rules

- Never overwrite source records while localizing. Source bitable and English docs are read-only unless the user explicitly asks otherwise.
- Never write auto-derived slug fields directly if the target table computes them.
- Preserve source `Type`, `Labels`, `Keywords`, `Targets`, and deprecation metadata unless the target table has a documented localized equivalent.
- Set target `Last Modified At` to the source modification date for content parity, or to the live update date only when the target table tracks localization update time.
- Preserve parent hierarchy by resolving the source parent slug, then finding the target parent record by slug. If the target parent is missing, create or align the parent before creating child docs.
- Do not delete orphans without a separate approval. Report them as target-only docs.

## Content Rules

- Keep code blocks, inline code, API names, env vars, URLs, and frontmatter tokens unchanged unless the user explicitly asks for localized examples.
- Translate prose, headings, captions, callouts, table prose, and UI text that should appear localized.
- Preserve Markdown comments beginning with `<!-- feishu-block:`. They are required to round-trip boards, Figma iframes, and sheets.
- Preserve `<Supademo ... />` components. They round-trip to Feishu add-on blocks.
- For image Markdown, let `MarkdownToFeishu.push_markdown()` upload images unless explicitly running a metadata-only dry run.
- If a doc contains board, Figma, sheet, or Supademo blocks, prefer a scoped update or verified full rewrite. Inspect the result in Feishu blocks afterward because Markdown export alone can hide embed loss.

## Tooling Notes

- Read `.claude/skills/sdk-doc-sync/SKILL.md` before changing shared SDK sync behavior.
- Use `.claude/skills/sdk-doc-sync/src/feishu-doc-translator/` for localization indexing, diffing, translation, creation, and updates.
- Use `.claude/skills/sdk-doc-sync/src/markdown-to-feishu.js` and `src/feishu-to-markdown.js` for round-trip conversion.
- Use `.claude/skills/sdk-doc-sync/lib/lark-docs/` for lower-level scraping, Markdown export, image downloading, board previews, and Figma preview capture.
- Use `lark-cli` for direct field/table inspection, targeted record updates, and block-level verification when the library does not expose a safe operation.

## Completion Report

Report:

- Source and target base/table/root tokens used.
- Dry-run counts by action type.
- Live write counts by action type.
- New or updated doc URLs.
- Metadata fields changed.
- Media/embed verification results.
- Any records skipped because parent mapping, field schema, credentials, or media round-trip support was uncertain.
