# ztrans Lark Interface MVP V2 Design

Date: 2026-07-03
Status: Approved for implementation planning
Owner: Codex + Anthony

## Objective

Improve the existing Feishu/Lark doc-agent MVP so humans interact with the automation through the `ztrans` bot in Lark messages. The MVP should feel like a readable workbench: people can `@ztrans` with instructions, understand scan results without opening artifacts, and approve or reject concrete work from a clear thread.

## Current Baseline

The repository already has a working localization-first control plane in `.claude/agent-team`:

- `doc-agent-scan` creates localization scan tasks, artifacts, and a daily card.
- `doc-agent-dry-run` filters actionable localization changes and can ask for live-write approval.
- `doc-agent-live-write` applies approved `NEW`, `UPDATE`, and `META_ONLY` localization actions.
- `doc-agent-verify` checks remaining localization diffs and broken links.
- `doc-agent-approval-consumer` listens to Lark messages and dispatches GitHub workflows.

The weak point is the human interface. Cards currently show compact counts and raw command strings, but not enough document context or plain-language guidance.

## Scope

This MVP V2 covers the interaction layer for the existing localization lane only.

In scope:

- Treat `ztrans` as the Lark bot name users mention.
- Parse `@ztrans` messages and fixed friendly commands.
- Preserve the existing command parser for backward compatibility.
- Make scan and live-write cards human-readable.
- List affected document titles in cards, grouped by action type.
- Cap long card lists and point to the artifact summary for full details.
- Reply or post summaries in the same chat/thread when possible.
- Keep explicit approval before live writes.

Out of scope:

- Enabling SDK reference, guide-doc, REST, CLI, or verified-doc lanes.
- Applying `patch-code-blocks` automatically.
- Free-form LLM intent classification for arbitrary natural language.
- Deleting or archiving orphan target docs.
- Replacing GitHub Actions as the execution runner.

## User Interaction Model

Users should be able to write messages like:

```text
@ztrans scan localization
@ztrans show latest scan
@ztrans explain loc-scan-20260703-abc123
@ztrans dry run loc-scan-20260703-abc123
@ztrans patch loc-scan-20260703-abc123
@ztrans approve loc-scan-20260703-abc123
@ztrans reject loc-scan-20260703-abc123
@ztrans changes loc-scan-20260703-abc123: only sync metadata first
```

The implementation should strip the bot mention from Lark event content before command parsing. The parser should remain deterministic and conservative. It may accept friendly aliases such as `dry run`, `dry-run`, `show`, `explain`, and `latest scan`, but it should not guess at ambiguous instructions that could trigger writes.

When an instruction is understood, `ztrans` should acknowledge it in plain language before dispatch:

```text
I understood this as: create a dry-run plan for task loc-scan-20260703-abc123.
No Feishu docs will be changed by this step.
```

When an instruction is not understood, `ztrans` should reply with a small help message showing safe examples.

## Readable Card Design

Cards should be decision aids, not raw payload dumps.

Daily scan card:

- Headline: "ztrans found localization work"
- Summary counts grouped by `NEW`, `UPDATE`, `META_ONLY`, `ORPHAN`, and broken links.
- Affected document titles grouped by action type.
- Risk note:
  - no writes have happened yet;
  - `ORPHAN` is report-only;
  - live writes require explicit approval.
- Recommended next step.
- Fallback text commands for users who prefer replies.

Live-write approval card:

- Headline: "Approve localization writes?"
- Only list actions that may be written: `NEW`, `UPDATE`, `META_ONLY`.
- Mention excluded/report-only `ORPHAN` count separately when relevant.
- Show affected document titles and action type.
- State exactly what approval will allow.
- Include fallback approval, rejection, and changes commands.

## Affected Document Title Rules

Use the existing action data from `actions.json`.

Title selection order:

1. `action.source.metadata.title`
2. `action.target.metadata.title`
3. `action.slug`
4. `(untitled)`

Group titles by action type. Card lists should remain readable:

- Show at most 5 titles per action type in cards.
- If a group has more than 5 items, append `...and N more`.
- Full details stay in `summary.md` and `actions.json`.
- For `ORPHAN`, label the group as report-only and say no deletion will happen.

Example:

```text
Affected docs

NEW
- Search with StructArray
- Configure Private Link

UPDATE
- Manage On-Demand Cluster
- Billing Overview
...and 3 more

ORPHAN (report only)
- Legacy Pricing
```

## Message And Thread Behavior

The MVP should prefer one task thread per scan or approval cycle when the Lark event gives enough message context.

Minimum behavior:

- Send readable cards to the configured chat.
- Include task id and source run id in every card.
- Accept replies that contain either raw commands or `@ztrans` friendly commands.

Preferred behavior:

- Reply in-thread to the triggering message for command acknowledgements.
- Use thread replies for status updates after dispatch, dry-run completion, approval, live-write start, and verification result.

If thread ids are not available from the event payload, fall back to normal chat messages.

## Command And Intent Mapping

The parser should normalize these inputs:

| Input pattern | Action |
| --- | --- |
| `ignore <task>` | `ignore` |
| `dry-run <task>` / `dry run <task>` | `dry_run_only` |
| `patch <task>` / `create patch plan <task>` | `patch_after_approval` |
| `custom <task>: <instruction>` | `custom` |
| `approve <task>` / `approve live write <task>` | `approve_live_write` |
| `reject <task>` | `reject` |
| `changes <task>: <instruction>` | `changes_requested` |
| `show <task>` / `explain <task>` | local explanation response, no GitHub dispatch |
| `help` | local help response, no GitHub dispatch |

`scan localization` and `show latest scan` are useful chat intents, but can be implemented after card readability if they need GitHub workflow dispatch or task lookup beyond the current approval flow.

## Safety

- Only configured approvers can dispatch workflow actions.
- Unknown or ambiguous `@ztrans` instructions must not dispatch workflows.
- Live writes still require `approve <task> <source-run-id>` or an equivalent parsed approval.
- `ORPHAN` remains report-only.
- The bot should explain whether an action is read-only, dry-run-only, or live-write-capable.
- The parser must preserve the existing raw command support so current cards and tests keep working.

## Implementation Boundaries

Expected code areas:

- `.claude/agent-team/src/cards.js`
  - render readable card sections;
  - include affected doc titles.
- `.claude/agent-team/src/report-renderer.js`
  - expose reusable affected-doc summary helpers.
- `.claude/agent-team/src/approval-commands.js`
  - strip/normalize `@ztrans` mentions;
  - parse friendly aliases;
  - parse local non-dispatch intents.
- `.claude/agent-team/src/event-consumer.js`
  - distinguish dispatching approval actions from local help/explain responses.
- `.claude/agent-team/src/feishu-im.js`
  - add text/markdown reply support if needed.
- `.claude/agent-team/tests/*.test.js`
  - cover title rendering, list caps, mention stripping, friendly aliases, and local intents.

## Acceptance Criteria

1. Daily scan cards list affected document titles grouped by action type.
2. Live-write approval cards list only write-capable affected document titles and clearly call out `ORPHAN` as report-only.
3. Long title lists are capped with `...and N more`.
4. Existing raw commands still parse and dispatch.
5. `@ztrans dry run <task>` and `@ztrans approve <task>` parse to the existing workflow actions.
6. Ambiguous `@ztrans` messages do not dispatch workflows.
7. `npm run test:agent-team` passes.

## Future Lanes

After the localization interface feels good, reuse the same interaction model for:

- guide-doc code-gap reports;
- SDK reference update reports;
- source-verified drafting tasks;
- REST/CLI reference update tasks.

Those lanes should plug into the same task card, thread, approval, and verification vocabulary rather than inventing separate chat behavior.
