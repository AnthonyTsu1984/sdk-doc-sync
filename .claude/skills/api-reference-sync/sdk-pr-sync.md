# PR Intake (web-content → Feishu)

**Scanner:** `src/sdk-doc-sync/release-scope/pr-scan.js`
**CLI:** `bin/sdk-pr-scan.js`
**Upstream:** `milvus-io/web-content` PRs that change `API_Reference/<sdk>/<track>/` markdown, produced by the maintainers' own `update-milvus-sdk-docs` skill (pages carry `<!-- category: X; action: CREATE; addedSince: vX.Y.x -->` footers).

milvus.io maintainers now edit SDK API-reference content directly through web-content PRs, in parallel with our Feishu syncs. PR intake turns a merged PR into a standard release-scope artifact: every PR page change is resolved to a canonical identity and verified against SDK source at a pinned revision, then flows through the unchanged candidate → grouping → planning → gated-write pipeline.

## Pinning Rules

- The web-content side is pinned to the PR's full 40-char merge commit (or head SHA for open PRs). Page content is read with `git show <sha>:<path>` from the local `repos/web-content` clone — never from the working tree.
- The SDK side is pinned to the target tag resolved from the PR's `About.md` version-pin table row for the track (e.g. `| 3.0.x | v3.0.3 |` → `v3.0.3`), overridable with `--target-tag`. The baseline tag comes from `scan-state.json` (overridable with `--baseline-tag`).
- A PR must target exactly one `(sdk, track)` pair. Multi-track PRs are rejected (`PR spans multiple SDK tracks`).

## Verification Tiers

Every page action is verified against the SDK scan at the target tag:

| Tier | Page kind | Check |
|------|-----------|-------|
| method | MilvusClientV2 method page | symbol exists in the scan under the page category; fenced signature method name matches; every `**REQUEST METHODS:**` builder exists in the scanned request params or in the pinned headers |
| enum | Enum page (`DataType`, `IndexType`, ...) | enum symbol exists; every `**VALUES:**` name exists in the scanned enum values |
| type-page | Class/config pages (`ConnectParam`, `TelemetryConfig`, `FunctionChain`, ...) | page name and every declared builder name exist lexically in the pinned SDK headers; emits `PR_SYMBOL_NOT_SCANNED` (warn) because the scanner does not index these symbols |

`REQUEST METHODS` bullets are collected page-wide, including `### XxxRequest` H3 sections that document embedded request types (e.g. `SubSearchRequest` builders on the HybridSearch page), so those builders verify against the pinned headers rather than the owning method's own params.

A failure emits an `error` diagnostic `PR_CONTENT_UNVERIFIED` and forces `approvalGrade: false`. An unmerged PR also forces `approvalGrade: false` (`PR_OPEN_READ_ONLY`) — open PRs are scannable but never solidifiable.

Action classification uses the live Feishu record first and the diff `changeType` second — the maintainers' page footers keep the original creation action and are metadata only. With `--feishu-snapshot` provided, a page whose live record exists is always `UPDATE` (`pr-doc-update`), even when the PR adds the page (`PR_PAGE_EXISTS_LIVE` info notes the reconciliation). Only pages with no live record classify as `CREATE` (`pr-new-page`) or `BACKFILL` (`pr-backfill-page`, when the SDK symbol already existed at the baseline tag). Without a snapshot the classification falls back to SDK-baseline semantics and emits `FEISHU_STATE_UNRESOLVED` (warn) — always pass the snapshot for approval-grade classification.

## Feishu Conflict Policy (flag-and-block)

Intake performs record-level checks only (`--feishu-snapshot <file>` with live Bitable rows):

- `FEISHU_RECORD_ABSENT_FOR_UPDATE` — the PR updates a page whose live record does not exist; replan as CREATE or fix the slug.
- `FEISHU_RECORD_WIP` — the live record is `WIP`; an in-flight Feishu edit must be resolved first.

Content-level reconciliation is deliberately NOT done at intake: the downstream diff engine computes block patches against live documents during planning, and every divergence surfaces at the grouping review gate, where each page is decided explicitly (adopt the PR version or keep the Feishu version). Intake never overwrites a Feishu-local edit silently.

## Languages Without a Track

`milvus-sdk-csharp` (and any future `rust` SDK) has no scanner, identity map, or Feishu Bitable in this skill. PR intake still parses and inventories such PRs but emits `NO_FEISHU_TRACK` (error) with zero write actions and `approvalGrade: false`. When a track is established later, the same PR scan becomes actionable without changes.

## Inheritance

Track inheritance is bidirectional:

- **Forward (v2.6 → v3.0)**: after a v2.6 PR/tag sync, run the v3.0 scan for the same symbols before closing the release; the v3.0 identity map must cover every symbol a v2.6 PR introduces before write approval is requested.
- **Backward (v3.0 → v2.6)**: when a v3.0 scan classifies a page as CREATE or BACKFILL, the tool checks the lower track (derived from scan-state keys) and flags:
  - `PR_CROSS_TRACK_BACKFILL` (warn) — the symbol already existed at the lower track's documented baseline (e.g. `TruncateCollection` existed at v2.6.4): the page must be added to the v2.6.x folder and Bitable as part of this sync, not only to v3.0.x. The action carries `pr.lowerTrack`.
  - `PR_LOWER_TRACK_PENDING_DELTA` (info) — the symbol appears in the lower track only after its baseline (within the unscanned range, e.g. `GetServerVersionV2` arrived in v2.6.5-7): the pending lower-track delta sync already covers it.

Verify cross-track presence with exact symbol names, not substring greps: v2.6.x exposes `GrantPrivilegeV2`/`RevokePrivilegeV2` while the plain `GrantPrivilege`/`RevokePrivilege` are v3.0-only interfaces.

## Commands

```bash
# Online scan of a merged PR (writes a release-scope artifact)
node .claude/skills/api-reference-sync/bin/sdk-pr-scan.js \
  --repo milvus-io/web-content --pr 1140 \
  --feishu-snapshot tmp/sdk-release-scout/bitable-snapshot-cpp-v30.json \
  --output tmp/sdk-release-scout/cpp-v30-pr1140.json

# Union with the tag-based scout artifact for the same range
node .claude/skills/api-reference-sync/bin/sdk-pr-scan.js \
  --repo milvus-io/web-content --pr 1140 \
  --merge-release-scope tmp/sdk-release-scout/cpp-v30.json \
  --feishu-snapshot tmp/sdk-release-scout/bitable-snapshot-cpp-v30.json \
  --output tmp/sdk-release-scout/cpp-v30-pr1140-merged.json

# Offline (tests, no gh call)
node .claude/skills/api-reference-sync/bin/sdk-pr-scan.js --pr-json <file> ...
```

The artifact passes `validateReleaseScope` and is consumed by `bin/sdk-doc-sync.js --release-scope --changed-only` like any scout artifact. PR provenance rides in the top-level `pr` block (repository, number, state, `webContentRevision`, per-file `changeType`/`symbol`) and per-action `evidence[]` entries with `kind: 'pr'`.

Diagnostics: `PR_MERGED` / `PR_OPEN_READ_ONLY` (info), `PR_PATH_SKIPPED` (info), `PR_PAGE_REMOVED` (warn — removal needs a separate deprecation plan), `UNMAPPED_CANONICAL_IDENTITY` (warn), `PR_SYMBOL_NOT_SCANNED` (warn — type pages verified lexically only), `FEISHU_RECORD_ABSENT_FOR_UPDATE` / `FEISHU_RECORD_WIP` (warn), `PR_CONTENT_UNVERIFIED` / `NO_FEISHU_TRACK` (error), `IDENTITY_MAP_INCOMPLETE` (warn — with a Feishu snapshot, governed record slugs that resolve to no canonical identity and can therefore never surface in delta scans or intakes; detect-only), `COVERAGE_UNTRACKED_METHODS` (warn — public client methods missing from the scanner's category map, surfaced through the scanner's `lastScanDiagnostics`).

Standing reconciliation: run `node bin/identity-reconcile.js --snapshot <bitable-snapshot.json> --identity-map references/identity/<lang>-<track>.json [--emit-draft <file>] [--strict]` at task start. It reports every governed record slug the map does not resolve plus map keys no record represents; `--emit-draft` writes evidence-backed entry drafts derived from the same records (merging stays a manual, master-compared map edit); `--strict` exits non-zero on drift.

## Notes

- Pinned page reads use the sibling checkout `../web-content` (override with `--web-content-dir`). The checkout may lag master as long as the PR merge commit is present (`git fetch origin master` refreshes it); content is always read with `git show <sha>:<path>`, never from the working tree.
- PR page paths define the symbol identity (`<Category>/<Page>.md` → `<Category>.<Page>`); the identity map remains the authority for stableId/canonicalSlug. Add PR-introduced symbols to `references/identity/cpp-*.json` (evidence-backed, same discipline as tag scans) before requesting write approval.
- Scanner category coverage: methods absent from `METHOD_CATEGORIES` are invisible to verification; when a PR documents a method the scanner does not know, add the category entry in the same change.
