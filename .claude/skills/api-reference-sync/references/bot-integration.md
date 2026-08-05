# Bot Integration Reference

Use this reference when connecting `sdk-doc-sync` to a Feishu bot or another chat-driven workflow. The bot should behave as a deterministic phase runner, not as a free-form approval interpreter.

## Contract

Each bot run has one active release-sync session. Store these fields outside the model context so the next message can resume deterministically:

```json
{
  "sessionId": "sdk-doc-sync:<language>:<track>:<timestamp-or-run-id>",
  "phase": "release_scope|candidate_proposal|reviewed_planning|execution|acceptance_finalization",
  "status": "release_scope_ready|grouping_review_required|approval_ready|executed|acceptance_review_required|accepted|blocked",
  "language": "<sdk-language>",
  "sdkName": "<sdk-name>",
  "track": "<version-track>",
  "artifacts": {
    "releaseScope": "<path>",
    "candidateProposal": "<path>",
    "inheritanceProposal": "<path>",
    "candidateSpec": "<path>",
    "filteredScope": "<path>",
    "referenceContext": "<path>",
    "dryRunFull": "<path>",
    "dryRunSummary": "<path>",
    "approvalActions": "<path>"
  },
  "pendingDecision": "GROUPING_REVIEW|WRITE_APPROVAL|ACCEPTANCE_REVIEW|null",
  "proposalDigest": "sha256:<proposal-digest>|null",
  "proposedBatchDigest": "sha256:<batch-digest>|null",
  "executionJournalDigest": "sha256:<execution-journal-digest>|null",
  "proposalIds": [],
  "actionIds": []
}
```

The bot may read artifacts and run dry-runs. It must not call mutating Feishu tools, write documents, update records, move folders, or update `scan-state.json` until the session is in `approval_ready` and the user replies with `APPROVE_WRITES sha256:<batch-digest>` matching the current full `proposedExecutionBatch.batchDigest`.

## Phase Behavior

| Phase | Bot action | User-facing stop |
|-------|------------|------------------|
| `release_scope` | Run release scout and validate no-write flags. | Stop only on no changes or blocked discovery. |
| `candidate_proposal` | Build proposed user-facing candidates, exclusions, grouping decisions, version-table detected inheritance decisions, doc identities, and target placements. | Send `Decision requested: GROUPING_REVIEW`. |
| `reviewed_planning` | Convert approved grouping to candidate spec, build reviewed context, rerun scoped dry-run, and generate exact action list. | Send `Decision requested: WRITE_APPROVAL`. |
| `execution` | Execute only exact approved actions, refetch, verify, leave touched records at `WIP`, and leave scan state unchanged. | Stop with `ACCEPTANCE_REVIEW` on success, or on partial failure/cleanup approval need. |
| `acceptance_finalization` | After explicit acceptance, change every touched record from `WIP` to `Draft`, refetch and verify, then update scan state. | Stop as `accepted` only when every transition and scan-state update passes. |

## Decision Parsing

Accept only digest-bound command-style replies for gates:

- Grouping review: `APPROVE_GROUPING sha256:<proposal-digest>`, `REVISE_GROUPING <proposal-id> <decision>`, `REVISE_INHERITANCE <inheritance-id> <decision>`, `DEFER_GROUPING <proposal-id>`, `REJECT_GROUPING`
- Write approval: `APPROVE_WRITES sha256:<batch-digest>`, `REJECT_WRITES`, `REQUEST_CHANGES <action-id>`
- Acceptance review: `APPROVE_ACCEPTANCE sha256:<execution-journal-digest>`, `REQUEST_ACCEPTANCE_CHANGES <action-id>`, `REJECT_ACCEPTANCE`

A bare `APPROVE_GROUPING`, `APPROVE_WRITES`, or `APPROVE_ACCEPTANCE` is not approved. The parser must compare the submitted digest with the current bound artifact before changing phase.

If a reply is conversational or ambiguous, do not transition phases. Respond with:

```text
I cannot treat that as approval.
Decision requested: <GROUPING_REVIEW|WRITE_APPROVAL>
Allowed replies: <commands>
If approved, reply exactly: <digest-bound-command>
```

For partial grouping replies, apply only explicit decisions and keep `pendingDecision=GROUPING_REVIEW` until all non-deferred proposal IDs have an accepted decision.

## Message Shape

Every bot message at a gate should include:

- `Session`: stable session ID.
- `Phase`: current phase and status.
- `Artifacts`: paths or links to generated artifacts.
- `Summary`: counts and blockers.
- `Decision requested`: exact gate name.
- `Allowed replies`: command list.
- `Bound digest`: the full current proposal, batch, or execution-journal digest.
- `If approved, reply exactly`: one copy-ready command containing that digest, with no placeholders.
- `Table`: compact proposal/action rows with stable IDs, including successor-track inheritance status when required.

Determine required successor tracks from the per-SDK reference version table used by the run. Do not infer or hard-code release-line pairs in the bot prompt.

Keep tables compact. Put long evidence in artifacts, not chat.

## Stable IDs

Use deterministic IDs:

- Proposal ID: `proposal:<documentation-stable-id>` when known.
- Exclusion ID: `exclude:<canonical-slug>`.
- Inheritance ID: use the source proposal ID plus successor track, for example `proposal:<documentation-stable-id>#<successor-track>`. Use this ID in `REVISE_INHERITANCE` so the bot can deterministically identify the successor track.
- Action ID: `action:<stable-id>:<action-type>`.

Do not use row numbers as IDs. Row order can change after filtering, regrouping, or rerunning dry-runs.

## Safety Rules

- `APPROVE_GROUPING sha256:<proposal-digest>` only permits building reviewed planning artifacts. It does not permit writes.
- The grouping command also approves inheritance decisions shown in the same digest-bound proposal. If a successor-track decision is absent, ambiguous, or stale, keep the session in `candidate_proposal`.
- `APPROVE_WRITES sha256:<batch-digest>` applies only to the exact action list and artifact digests bound into that batch.
- Write approval does not accept the resulting documentation and never authorizes a scan-state update.
- `APPROVE_ACCEPTANCE sha256:<execution-journal-digest>` is valid only after successful execution and explicit review of the complete touched-record inventory. It authorizes only the listed interface-document `WIP` to `Draft` transitions and the subsequent verified `scan-state.json` update. Structural VirtualNode or Module records are excluded from that transition.
- If any artifact changes after approval, return to the relevant review gate.
- If planning produces `planningErrorCount > 0`, do not request write approval.
- If execution partially succeeds, do not auto-retry mutating actions unless the retry was included in the approved recovery plan.
