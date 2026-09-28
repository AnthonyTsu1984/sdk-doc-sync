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

## Post-Verbatim Polish (api.pr-polish-governed)

After a merged-PR page lands verbatim and its `content-fidelity` outcome is journaled `PASS`, the unit may run one language-polish phase — inside the same review unit, before `DOCUMENT_REVIEW` closes it. Polish is governed in both directions: it cannot run before the verbatim proof exists, and it cannot touch a page after final acceptance (a finalized page needs a corrective release).

Phase order per unit:

1. **Precondition** — the verbatim execution's `content-fidelity` journal entry (`invariantId: api.pr-verbatim-content`, `ok: true`, carrying the `contentDigest` of the exact bytes the verbatim phase compared) is the gate. `bin/pr-polish.js` refuses to start without it and refuses a proof bound to different bytes (`PR_POLISH_VERBATIM_NOT_PROVEN` both ways) — a passing outcome for page X cannot unlock polish for page Y.
2. **Subagent proposal** — dispatch a polish subagent with the exact artifact bytes the verbatim phase compared (the bytes behind the journaled `contentDigest` — NOT a re-normalized derivative, which would fail the digest gate) and the protected-content contract below. The subagent returns a polish manifest as data and performs no Feishu I/O.
3. **Deterministic validation and recompute** — `bin/pr-polish.js --base-content <verified.md> --fidelity-outcome <journal-entry.json> --manifest <manifest.json> --polished-output <polished.md> --provenance-output <provenance.json>` validates the manifest and emits the exact terminal bytes plus the digest chain (`baseContentDigest`, `manifestDigest`, `polishedContentDigest`). Preservation is judged over each edit's whole affected region — the base lines it touches, compared against their spliced candidate — so partial anchors starting inside a code span or link URL, and protected shapes forged at the splice boundary, are rejected rather than compared as bare substrings. Any typed rejection aborts the phase; the manifest is repaired and revalidated, never applied partially.
4. **Application** — the validated edits are applied to the live page through the governed writer as a separately approved batch: anchored text replacements over prose blocks only. Pages carrying `<include target="...">` markers stay surgical-only (`api.literal-include-preserved`); polish never rebuilds a body.
5. **Terminal verification** — refetch `raw_content` and run the same CLI with `--verify-raw-content <raw.txt>`: the page must compare line-for-line against the recomputed polished content through the declared canonicalization (`PR_POLISH_CONTENT_VERIFICATION_FAILED` on divergence; no artifacts are written on failure). Journal the polish outcome with the provenance digests before the completion sentinel.
6. **Binding** — `DOCUMENT_REVIEW` presents the polished page and the polish manifest summary (edit count + the three digests). The unit's reviewed context records `{ content, contentDigest, polish: { manifest, polishedContent, provenance } }`; acceptance and reconciliation then bind the polished terminal state, and a chain that no longer deterministically reproduces the terminal bytes (including a stale recorded provenance) is `CONTENT_POLISH_CHAIN_INVALID` at reconciliation.

Polish manifest schema:

```json
{
  "schemaVersion": 1,
  "unit": "<review-unit-id>",
  "baseContentDigest": "sha256:<digest of the verified verbatim content>",
  "rationale": "<one-line human summary from the polish subagent>",
  "edits": [
    { "anchor": "<exact unique substring of the verified content>", "replacement": "<reworded prose>" }
  ]
}
```

Protected content — an edit whose anchor overlaps any of these, or whose affected region after splicing introduces them, is rejected. Every rule is additionally asserted on the COMPOSED output of all edits (base vs spliced document): two individually-clean edits cannot assemble a fence line, an `<include>` marker, or a complete link URL at their junction:

| Rejection code | Rule |
|----------------|------|
| `PR_POLISH_PROTECTED_REGION` | anchor overlaps fenced code, a fence delimiter, a table row, a heading, an `<include …>` line, the web-content footer, or a `**REQUEST METHODS:**` marker |
| `PR_POLISH_CODE_SPAN_CHANGED` | inline code spans in the affected region must survive identically as a multiset, document-wide too (API identifiers are not prose; reordering two identifiers within prose is allowed — identifiers are reference-neutral, unlike URLs whose order binds the reference sequence) |
| `PR_POLISH_URL_SET_CHANGED` | every absolute link URL in the affected region must survive, in order (link text may be reworded; re-pairing link text with a different URL while keeping the URL sequence is a document-review concern) |
| `PR_POLISH_FORBIDDEN_INTRODUCTION` | the spliced affected region introduces a fence, table, heading, include marker, footer, or `**REQUEST METHODS:**` line — including shapes forged at the splice boundary (e.g. a prefix backtick joining a replacement's backticks into a fence delimiter) |
| `PR_POLISH_FULL_REWRITE` | edit footprints (each edit's larger side: anchor or replacement) cover ≥ 90% of the verified content, per edit or in aggregate — a small anchor expanded into unbounded new prose is a rewrite wearing a polish anchor, and a whole-body change is a new verbatim intake, not polish |
| `PR_POLISH_ANCHOR_NOT_FOUND` / `PR_POLISH_ANCHOR_NOT_UNIQUE` | anchors must match exactly once in the verified content |
| `PR_POLISH_EDIT_OVERLAP` | anchors must not overlap each other |
| `PR_POLISH_BASE_DIGEST_MISMATCH` | the manifest must bind the digest of the exact content the verbatim phase proved |
| `PR_POLISH_MANIFEST_INVALID` | shape violations (schemaVersion, missing edits, empty anchors) |

Diagnostics: `PR_POLISH_VERBATIM_NOT_PROVEN` (fail-closed sequencing), `PR_POLISH_CONTENT_VERIFICATION_FAILED` (post-write terminal divergence), `CONTENT_POLISH_CHAIN_INVALID` (reconciliation: recorded polish no longer reproduces the terminal bytes).

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
