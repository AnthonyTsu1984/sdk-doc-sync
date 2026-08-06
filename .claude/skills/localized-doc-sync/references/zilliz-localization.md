# Zilliz Localization Reference

Load this reference when using `localized-doc-sync` for the Zilliz English and Chinese Feishu Bases and wiki roots.

## Canonical Endpoints

English source:

- Base token: `Ac7xbs2k1ad7bjsCXr0ccHe9nMh`
- Wiki root token: `OUWXw5c4gia34ZkQUcEcMFbWn6s`
- Locale: `en`

Chinese target:

- Base token: `I6YUb1M0JajHrqsJGcLcZNh7neP`
- Wiki root token: `XyeFwdx6kiK9A6kq3yIcLNdEnDd`
- Locale: `zh`

Tokens identify the configured endpoints; they do not freeze table count, table names, field IDs, views, record counts, or mappings.

## Discovery Authority

The live full-Base scan is authoritative for every run. Enumerate every table, field schema, active view scope, and complete paginated record set in both Bases before reading `table-map.json` or forming review units.

`table-map.json`, `identity-overrides.json`, and `locale-policy.json` are reviewed policy overlays. They may explain a discovered relation or exception, but they cannot hide a new, removed, renamed, split, merged, or unmapped table. Any inventory or schema difference becomes a typed scan issue.

Partial table scans are diagnostic only. They cannot authorize writes or finalize the overall run.

Before classifying or acting on a target-only row, inspect the complete discovered table-pair inventory, including unmapped and cross-table relations. A missing source slug alone cannot establish an orphan because `link/ref` rows are slugless. Without a separately approved deletion batch, emit both `preserve_orphan` and `report_orphan` and leave the target unchanged.

## Field And Identity Policy

Use the placement matrix in `locale-policy.json`:

- `canonical`: requires `Slug` and publication-critical `Targets`.
- `section`: requires `Slug` and must not carry `Targets`.
- `link`: carries neither `Slug` nor `Targets`; `/...` is an internal link and `http...` is an external link.
- `ref`: carries neither `Slug` nor `Targets`; it points to the locale-specific reference source in an ordinary translation pair and does not create a separate pair or review unit.

`Chapter` is an ignored field. Inventory may observe it, but it does not participate in drift, diffing, approval, or writes.

Validate `Parent` independently in each locale. Cross-locale equality is not an invariant. `Labels`, `Keywords`, `Progress`, `Notebook`, `Beta`, `Book`, `Alias1`, and `Alias2` follow each locale's own source metadata.

Use translation receipts, not Bitable date fields, to classify source-only changes, target local edits, concurrent divergence, and missing baselines.

## Durable Locale Exceptions

- Deployment is currently governed as a discovered source-only table-level relation. `canonical:byoc-intro` has a reviewed cross-table override into Chinese Get Started. Revalidate both facts on every full scan.
- Provider substitutions such as SiliconFlow belong in `identity-overrides.json`; they are locale applicability policy, not slug guesses.
- Publication routing comes only from canonical `Targets` and requires Chinese-source evidence plus exact approval. Never copy source `Targets` blindly.
- Duplicate `ref` rows that resolve to the same underlying translation pair are valid.

Table-specific alignment references preserve durable title, provider, and hierarchy intent. Their dated evidence snapshots are non-authoritative; recompute current issues from the scan manifest.

## Canonical Workflow

1. Export complete source and target Base snapshots with current revisions, all tables, schemas, views, and records.
2. Build the immutable scan manifest:

```bash
node .claude/skills/localized-doc-sync/bin/localized-doc-sync.js scan \
  --source-snapshot <source-base.json> \
  --target-snapshot <target-base.json> \
  --table-map .claude/skills/localized-doc-sync/references/table-map.json \
  --identity-overrides .claude/skills/localized-doc-sync/references/identity-overrides.json \
  --locale-policy .claude/skills/localized-doc-sync/references/locale-policy.json \
  --output <scan-manifest.json>
```

3. Plan one issue queue from the complete manifest:

```bash
node .claude/skills/localized-doc-sync/bin/localized-doc-sync.js plan \
  --scan-manifest <scan-manifest.json> \
  --output <review-units.json>
```

4. Review and execute one unit at a time with an exact action-batch approval, reviewed adapter, and write-ahead journal.
5. Refetch the affected table pair after every accepted unit. Before finalization, repeat the complete full-Base scan and account for every original and newly discovered issue.

The legacy translator remains a domain adapter only. Its default-table, slug-only, date-based, interactive, or auto-approve behavior is never discovery or authorization authority.

## Media And Embeds

Preserve boards, Figma iframes, sheets, Supademo blocks, images, opaque blocks, and source-side read-only behavior. After content writes, verify the live Feishu block structure rather than relying only on Markdown output.

## Approval And Acceptance

Before a write, show the parent scan-manifest digest, issue IDs, exact targets, actions, side effects, preconditions, publication effects, and full batch digest. After execution, require journal-derived verification, document review for content units, an affected-pair re-scan, and a final full scan.
