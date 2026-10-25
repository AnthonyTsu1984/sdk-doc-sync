# Workspace Contract: tmp Layout, Worktrees, Gate Rounds

Three working disciplines every session (operator-driven or board-dispatched) follows: where artifacts live, which checkout does the work, and how a gate round turns.

## tmp/ Layout (canonical directories)

`tmp/` is gitignored scratch with a governed core. Every path below is load-bearing — hardcoded in harness code (ledger scan roots, close-session learning capture, admission rituals, dashboard telemetry) — so nothing here may be renamed or relocated without changing that code first.

| Directory | Contents | Lifecycle |
|---|---|---|
| `tmp/api-reference-sync/` | Governance core: execution journals, run-manifests, campaign approval receipts (`campaign-approvals/`), gate presentations (`gate-presentation/`), disposal journals, and `archive/` for superseded gate artifacts | Journals of live sessions are never deleted (iron rule: replay); superseded manifests move to `run-manifest-archive/` or `archive/` during the admission ritual |
| `tmp/api-reference-sync/harvest/` | Pod evidence harvest landing (2026-10-25 evidence-lifecycle ruling): `markers/<pod>.json` (sha256+size per artifact — the teardown lock's truth, rewritten only by a successful harvest) and per-pod private snapshots (`scan-state.json`, `pr-findings.jsonl`, `events.jsonl`, `supervisor.log`, card state) awaiting `scripts/harvest/*-merge.js` | Snapshots durable until merged (`--apply`) and then archived with the campaign; canonical-landing conflicts (same name, different bytes) are never overwritten — operator adjudicates |
| `tmp/sdk-release-scout/` | Daily scout artifacts (`daily/`), campaign session files (`<track>-session.json` — top level only, the board's scan roots), Bitable/Drive snapshots, per-intake workdirs (`<track>-intake-<date>/`), campaign gate manifests (top level) | Session files persist as the campaign registry; snapshots are per-campaign evidence; closed-campaign stdout/stderr diagnostics move to `tmp/archive/` |
| `tmp/sdk-doc-sync-runs/` | Campaign run directories (`<language>-<track>/review-session.json` + run artifacts) | Same as session files — persist while the campaign is on the board |
| `tmp/skill-feedback/` | Rule candidates (`api-reference-sync/candidates/`) written by close-session learning capture (打回即铸) | Durable until promoted into harness rules or explicitly rejected |
| `tmp/skill-feedback-rollout/` | Admission ledger (`admitted-fingerprints.jsonl`) | Append-only |
| `tmp/dashboard-events/` | Dashboard telemetry: event stream, usage db, intake dispatch ledger | Derived and deletable |
| `tmp/run-manifest-archive/` | Retired run-manifests (the admission ritual's move target) | Historical |
| `tmp/skill-evals/` and the other skill workspaces, eval fixtures, and reference caches under `tmp/` (each referenced by tests or scripts) | Per-skill scratch and fixtures | Keep |
| `tmp/archive/` | The single retirement root: dated cleanup batches (`<date>-cleanup/`) and pre-convention retirements | Bytes are preserved, never deleted; delete a batch only by explicit operator decision |

Rules:

- **One-off scripts never live at `tmp/` top level.** A throwaway script goes in a topic subdirectory (`tmp/<topic>/…`) or the run directory it serves; when its campaign closes it archives with that campaign.
- **Campaign diagnostics (stdout/stderr dumps of dry-runs and executes) are not evidence.** The journal is the evidence. Diagnostics of a closed campaign move to `tmp/archive/` at campaign close.
- **Cleanup is archival, not deletion** (`mv` into a dated `tmp/archive/` batch), and never touches: live-session journals, campaign receipts, run-manifests of the current admission window, session files, scan-state, or the admission ledger.
- Nothing outside `tmp/` is scratch: evidence, references, and configs referenced from the repository are repository content.

## Worktree Principles

The main checkout is the governance truth: it carries the ADMITTED fingerprint, runs the canonical CLIs, and feeds the dashboard. Protect it.

1. **Read-only work may run in the main tree** (reconnaissance, planning, dry-runs, dashboard operation). Read-only means no file mutations that dirty the tree — an intake that must edit the identity map does so knowingly, as an explicit disclosed edit.
2. **Tree-mutating campaigns run in a dedicated worktree**: `git worktree add <sibling-path> -b <branch>`, named `<repo>-<purpose>` beside the main checkout (the dashboard auto-discovers sibling worktrees and shows their cards per checkout). One campaign, one worktree, one branch — concurrent sessions never share a worktree.
3. **Why**: a dirty main tree breaks the admission fingerprint (ADMISSION_DIRTY_WORKTREE), and concurrent sessions racing in one tree corrupt shared files. The worktree isolates both.
4. **Closeout**: merge the branch → migrate durable evidence into the main tree's `tmp/` (canonical locations above) → `git worktree remove` → retire the branch. A merged branch is never reused.

## Gate Rounds (回合机制)

A round is the unit of governed progress: it starts at dispatch/attach/resume and ends at the next gate stop or a terminal state.

1. **Stop at the campaign gate.** When work reaches the `APPROVE_CAMPAIGN` gate, present it (`gate-presentation.js`) with the exact digest-bound reply line, then END the round. Never self-approve, never continue past an unapproved gate.
2. **An approval becomes real only as a durable receipt** (`tmp/api-reference-sync/campaign-approvals/`). A verbal/ejected reply without its receipt did not happen.
3. **The next round resumes from durable state** — the board re-dispatches the card (attach brief re-hydrates from the session file), or the operator's board approval forwards the exact reply line into the waiting session. A resumed session never replays from memory; it re-reads the session file and journals.
4. **Any re-planning or re-scan voids the digest** — the old approval line is dead; the gate must be re-presented with the new digest. One approval, one round, one digest.
5. **Round products land in their canonical locations** (journals, manifests, receipts — see the layout table) before the round ends. A round that produced no durable artifact must say so explicitly in its final report.
