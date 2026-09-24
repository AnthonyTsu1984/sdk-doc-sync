# verified-doc-authoring run tooling

Reusable adapter and verification harness for live Feishu writes through the
`verified-doc-authoring` canonical CLI (`.claude/skills/verified-doc-authoring/`).
Everything here is git-tracked; run-local drafts, plans, and journals live under
`tmp/verified-doc-authoring/<run>/`.

## Files

- `feishu-authoring-adapter.js` — journaled adapter (`snapshot` / `patch` / `refetch`)
  passed to `execute --adapter-module`. Draft path: `$VERIFIED_DOC_DRAFT`
  (fallback `draft.md` next to the adapter).
- `roundtrip-sim.js <draft.md>` — pre-write gate: converts the draft through the
  exact write path (pipe tables → HTML → blocks → IR → markdown) and requires a
  byte-exact match. Run on every draft before planning.
- `preflight-snapshot.js <plan.json>` — read-only live check of revision,
  protected-block digest, and content digest against a plan.
- `journal-repair.js` — ledger recovery only (`split` / `complete`), never
  touches the live document.

## Canonical write sequence

```bash
node .claude/skills/verified-doc-authoring/bin/verified-doc-authoring.js claims \
  --input <claims-input.json> --markdown <draft.md> \
  --inventory-output <claim-inventory.json> --draft-output <draft-artifact.json>

node scripts/verified-doc-authoring/roundtrip-sim.js <draft.md>   # must be MATCH

node .claude/skills/verified-doc-authoring/bin/verified-doc-authoring.js plan \
  --target <target.json> --semantic-diff <semantic-diff.json> \
  --claim-inventory <claim-inventory.json> --draft-artifact <draft-artifact.json> \
  --output <plan.json> --session <session.json> --session-id <id>

node scripts/verified-doc-authoring/preflight-snapshot.js <plan.json>

# user replies: APPROVE_WRITES verified-doc-authoring sha256:<batchDigest>

VERIFIED_DOC_DRAFT=<draft.md> node .claude/skills/verified-doc-authoring/bin/verified-doc-authoring.js execute \
  --plan <plan.json> --approval <approval.json> \
  --adapter-module scripts/verified-doc-authoring/feishu-authoring-adapter.js \
  --journal <execution.jsonl> --output <execution.json> --session <session.json>
```

Always use a **fresh journal file per execution**. One execution bumps the
document revision by roughly the block count plus one per table cell (~70 for a
60-block page with three tables); surgical writes bump it only by their block
operations (typically 2).

## Environment contract (live writes)

- `VERIFIED_DOC_DRAFT` — draft markdown path (fallback: `draft.md` beside the adapter)
- `VERIFIED_DOC_PLAN` / `VERIFIED_DOC_APPROVAL` — **required**: Phase 4 writer
  governance binds the approval envelope (re-checked against the plan's batch
  facts) before any mutation is allowed
- `VERIFIED_DOC_SURGICAL` — optional anchor list (`substring|substring`): when
  set, the patch replaces only the live blocks whose text contains an anchor
  with the draft blocks containing the same anchor (types must match).
  Everything else — including foreign rich blocks — is untouched, with a
  before/after assertion that foreign blocks (board/iframe/sheet/synced,
  block types 43/26/30/49) survived. Use this whenever the page contains
  foreign rich blocks or hand-polished regions a whole-page write would
  flatten or delete.

## Incident record (keep this lesson)

The `update_document` pipeline deletes ALL children first and creates after.
A create-side refusal (e.g. the absolute-link invariant rejecting a foreign
placeholder link like `[Board](#feishu-board-...)`) therefore fires AFTER the
wipe — one such run blanked a fully polished page (recovered via Feishu
version history, byte-exact). Defenses now in the adapter:

1. `__assert_absolute_block_links` runs BEFORE any deletion on both write paths.
2. Drafts must EXCLUDE foreign rich blocks; refetch normalization strips their
   rendered placeholders (`[Board](#feishu-board-...)`) so the whole-page
   digest comparison covers pipeline-owned content only, while the surgical
   path's structural assertion covers the foreign blocks themselves.
3. `patch_document(strategy: smart)` is NOT safe for pages with foreign blocks:
   smart matching sends unmatched preserve-only blocks to `toDelete`.

## Native table contract

The converter drops markdown-it pipe-table tokens but converts raw HTML tables,
so the adapter translates on the write side only:

- Draft keeps standard pipe tables (`| a | b |` header + `| --- | --- |` separator).
- Table cells support plain text plus backtick/`**` inline formatting (parsed
  via `__parse_inline_markdown` and re-emitted on refetch); never put `\|`,
  `<`, or `>` in cell text.
- Underscores in cells are written `\_` in the draft; Feishu displays `_` and
  renderMarkdown re-escapes on refetch (stable fixed point).
- `normalizeRefetchMarkdown` strips the trailing `<br>` that the Feishu cell
  model adds to every single-line cell; in-cell line breaks are preserved.

**Warning:** hand edits that change STRUCTURE (inserted boards, sheets, synced
blocks) are foreign to this pipeline. Seed drafts from a live export, then
remove the foreign placeholder lines before planning; prefer the surgical
mode for any later write on such pages.

## Operational lessons (2026-09-21 membership-match run)

1. **Approval binds the batch digest byte-exactly.** Any artifact regenerated
   after the approval request (draft fix, rebase onto user edits, revision
   rebind) changes the digest and requires a fresh `APPROVE_WRITES` round; the
   executor mechanically rejects stale approvals.
2. **Users edit the page mid-flight.** Before every plan, refetch and compare
   the live content digest; on drift, export, fold the edits into the draft,
   re-run the roundtrip sim, re-plan. The edited page is the newest editorial
   intent — never overwrite it from a stale draft.
3. **One journal file per execution.** Reusing a journal path appends new
   entries after the previous completion sentinel and fails with
   `DUPLICATE_COMPLETION_SENTINEL` after the mutation already happened.
4. **A failed refetch verification after a successful mutation is a live
   incident**, not a no-op: the page is modified but the cycle is unverified.
   Diagnose with the adapter's `refetch`, fix the normalization, re-verify
   independently, then close the ledger with a clean re-execution (journal
   repair tools cannot turn a failure record into success).
5. **Title renames change the protected-block digest** — rebind the target and
   expect a fresh approval round.

## Known editorial preferences observed (candidates, not active rules)

- Terminology: "entities" over "rows" in Milvus docs.
- Bold key terms at first use in prose; backtick identifiers and parameters.
- Semicolons for coordinate clauses; "fail-closed state" phrasing.
- Strikethrough marks checklist items the editor considers unnecessary.
