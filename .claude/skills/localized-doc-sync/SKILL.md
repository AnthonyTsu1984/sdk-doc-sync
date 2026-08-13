---
name: localized-doc-sync
description: Use when aligning paired source and localized Zilliz documentation across Feishu/Lark wiki roots and bitables, including record diffs, localized document creation or updates, metadata synchronization, parent mapping, and preservation of images, boards, Figma embeds, sheets, or Supademo blocks. Do not use for same-language SDK release synchronization.
---

# Localized Doc Sync

Align a read-only source documentation set with a localized target through a complete dynamic Base scan, placement-aware identity, review units, durable translation receipts, and recoverable writes.

## Trigger Boundary

Use for paired source/target Feishu wiki roots and Bitables that need localization record diffing, document creation/update, metadata alignment, parent mapping, or media preservation.

Do not use for same-language SDK release synchronization, narrative authoring without paired records, or verification-only code checks.

## Permission Boundary

- Source records and source documents are read-only unless the user separately requests and approves a source-side change.
- Indexing, diffing, translation previews, and dry-run are allowed by default.
- Target writes require explicit approval of exact records/documents and batch digest. Never delete `TARGET_ONLY` records (legacy reports may call them `ORPHAN`) without separate approval.
- A target-only decision preserves the target record unchanged unless a distinct deletion batch is approved; reporting alone is not deletion, archival, or mutation authority.
- Before any orphan decision, inspect the complete discovered table-pair inventory. A missing source slug is insufficient evidence because link/ref rows are slugless and reviewed mappings may cross tables.
- The canonical no-delete result records both observable actions: `preserve_orphan` first, then `report_orphan`. Do not collapse preservation into reporting.
- Refetch every written record and document; uncertain parent mapping, schema, credentials, or protected media blocks completion.
- Before any queue or write decision, re-enumerate both complete Bases. A configured map, pasted table/view URL, previous count, or first-table default is not completeness evidence.

## Shared Contract

- Capability baseline: [capabilities.json](capabilities.json).
- Build reviewed `NEW`, `UPDATE`, and `META_ONLY` operations with `node .claude/skills/doc-ops-core/bin/build-action-batch.js --skill localized-doc-sync --operation sync --input <actions.json> --output <batch.json>`.
- Approval must match the exact `batchDigest`, targets, action count, and side effects. Verify the live precondition for record identity, revision, parent mapping, and media inventory immediately before mutation.
- After writes, refetch and apply the shared `../doc-ops-core/` round-trip guard to content, metadata, hierarchy, images, boards, Figma, sheets, Supademo, and opaque blocks.

## Domain Workflow

1. Run `localized-doc-sync.js scan` from complete source and target inventory snapshots. Discover every table, schema, view scope, and record set before loading the reviewed table map.
2. Resolve active schema roles from live field names and types. Ignore unconfigured `Chapter`; treat canonical `Targets` as publication-critical.
3. Resolve `canonical:<slug>`, `section:<slug>`, typed internal/external link identity, and locale-specific ref reference sources. Ref rows never form independent translation pairs or review units.
4. Build a complete immutable issue queue. Validate Parent within each locale; do not require cross-language Parent equality or compare locale-owned metadata directly across languages.
5. Translate prose, headings, captions, callouts, table prose, and localized UI text. Preserve code, inline code, API names, env vars, URLs, frontmatter tokens, `<!-- feishu-block:` comments, and `<Supademo ... />` components unless explicitly requested otherwise.
6. For content units, load the versioned locale/audience/product contract, expose only stable semantic units, and replace protected bytes with protected markers. Never execute a whole-document model response directly.
7. Validate reviewer evidence against contiguous source/draft quotes from the same semantic unit. A reviewer allegation is not correction authority; Correction may edit only runner-authorized unit IDs and must preserve every protected marker.
8. Use `localized-doc-sync.js plan` to form one canonical content unit per pair or a strictly homogeneous metadata unit. Every unit cites its scan digest and issue IDs.
9. Use `localized-doc-sync.js execute` only with an exact action batch, approval envelope, adapter, and write-ahead journal. After each accepted unit, rescan the affected scope; before finalization, perform a fresh full-Base scan.
10. Write a schema-v2 receipt containing `translationContractDigest`, prompt and semantic-unit digests, source/target revisions, model, adapter version, and accepted journal lineage. Any identity change invalidates recovery and prior approval. Preserve or explicitly merge `TARGET_LOCAL_EDIT`/`TRANSLATION_DIVERGED`; never overwrite target-local prose implicitly.

Translator adapter diagnostic only; its interactive or auto-approve path is never executable authority:

```bash
npm run translate -- \
  --source-bitable <source-base> \
  --target-bitable <target-base> \
  --source-table <source-table> \
  --target-table <target-table> \
  --source-root <source-wiki-root> \
  --target-root <target-wiki-root> \
  --source-lang en \
  --target-lang zh-CN \
  --drive-type wiki \
  --localization-contract \
  --audience-profile <audience-profile> \
  --product-profile <product-profile> \
  --translator-adapter-version <adapter-version> \
  --translation-receipts <receipts.jsonl> \
  --dry-run
```

## Required References

- Dynamic table policy: [references/table-map.json](references/table-map.json).
- Placement, field ownership, publication, and reminder policy: [references/locale-policy.json](references/locale-policy.json).
- Cross-table and provider identity decisions: [references/identity-overrides.json](references/identity-overrides.json).
- Canonical tokens, historical alignment evidence, libraries, and media handling: [references/zilliz-localization.md](references/zilliz-localization.md).
- Development/开发指南 alignment only: [references/development-alignment.md](references/development-alignment.md).
- Content edit boundary and receipt identity: [references/content-translation-contract.md](references/content-translation-contract.md).
- Simplified Chinese terminology, audience, and product profiles: [references/zh-CN-localization-contract.json](references/zh-CN-localization-contract.json).
- Runtime prompts: [prompts/translation-agent.zh-CN.md](prompts/translation-agent.zh-CN.md), [prompts/review-agent.zh-CN.md](prompts/review-agent.zh-CN.md), and [prompts/correction-agent.zh-CN.md](prompts/correction-agent.zh-CN.md).
- Reuse `../api-reference-sync/src/feishu-doc-translator/`, its Markdown converters, and `lark-cli`; do not create one-off Feishu API clients.

## Output

Report source/target base, table, and root identities; dry-run and live counts by action; batch digest; changed document links and metadata; hierarchy/media verification; orphans; and every blocked or skipped record with reason.
