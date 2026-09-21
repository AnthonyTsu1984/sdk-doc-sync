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
60-block page with three tables).

## Native table contract

The converter drops markdown-it pipe-table tokens but converts raw HTML tables,
so the adapter translates on the write side only:

- Draft keeps standard pipe tables (`| a | b |` header + `| --- | --- |` separator).
- Table cells are **plain text only**: no bold, no backticks, no `\|`, `<`, `>`.
- Underscores in cells are written `\_` in the draft; Feishu displays `_` and
  renderMarkdown re-escapes on refetch (stable fixed point).
- `normalizeRefetchMarkdown` strips the trailing `<br>` that the Feishu cell
  model adds to every single-line cell; in-cell line breaks are preserved.

**Warning:** hand-polished cell formatting added directly in Feishu (inline code,
bold) exceeds what this pipeline can reproduce — a later replace write flattens
it. After hand edits, export the page and treat it as the draft baseline.

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
