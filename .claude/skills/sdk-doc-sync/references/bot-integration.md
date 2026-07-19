# Bot Integration Reference

Use this reference when connecting `sdk-doc-sync` to a Feishu bot or another chat-driven workflow. The bot should behave as a deterministic phase runner, not as a free-form approval interpreter.

## Contract

Each bot run has one active release-sync session. Store these fields outside the model context so the next message can resume deterministically:

```json
{
  "sessionId": "sdk-doc-sync:<language>:<track>:<timestamp-or-run-id>",
  "phase": "release_scope|candidate_proposal|reviewed_planning|execution",
  "status": "release_scope_ready|grouping_review_required|approval_ready|executed|blocked",
  "language": "<sdk-language>",
  "sdkName": "<sdk-name>",
  "track": "<version-track>",
  "artifacts": {
    "releaseScope": "<path>",
    "candidateProposal": "<path>",
    "candidateSpec": "<path>",
    "filteredScope": "<path>",
    "referenceContext": "<path>",
    "dryRunFull": "<path>",
    "dryRunSummary": "<path>",
    "approvalActions": "<path>"
  },
  "pendingDecision": "GROUPING_REVIEW|WRITE_APPROVAL|null",
  "proposalIds": [],
  "actionIds": []
}
```

The bot may read artifacts and run dry-runs. It must not call mutating Feishu tools, write documents, update records, move folders, or update `scan-state.json` until the session is in `approval_ready` and the user replies with `APPROVE_WRITES`.

## Phase Behavior

| Phase | Bot action | User-facing stop |
|-------|------------|------------------|
| `release_scope` | Run release scout and validate no-write flags. | Stop only on no changes or blocked discovery. |
| `candidate_proposal` | Build proposed user-facing candidates, exclusions, grouping decisions, doc identities, and target placements. | Send `Decision requested: GROUPING_REVIEW`. |
| `reviewed_planning` | Convert approved grouping to candidate spec, build reviewed context, rerun scoped dry-run, and generate exact action list. | Send `Decision requested: WRITE_APPROVAL`. |
| `execution` | Execute only exact approved actions, refetch, verify, and report scan-state update decision. | Stop on completion, partial failure, or cleanup approval need. |

## Decision Parsing

Accept only command-style replies for gates:

- Grouping review: `APPROVE_GROUPING`, `REVISE_GROUPING <proposal-id> <decision>`, `DEFER_GROUPING <proposal-id>`, `REJECT_GROUPING`
- Write approval: `APPROVE_WRITES`, `REJECT_WRITES`, `REQUEST_CHANGES <action-id>`

If a reply is conversational or ambiguous, do not transition phases. Respond with:

```text
I cannot treat that as approval.
Decision requested: <GROUPING_REVIEW|WRITE_APPROVAL>
Allowed replies: <commands>
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
- `Table`: compact proposal/action rows with stable IDs.

Keep tables compact. Put long evidence in artifacts, not chat.

## Stable IDs

Use deterministic IDs:

- Proposal ID: `proposal:<documentation-stable-id>` when known.
- Exclusion ID: `exclude:<canonical-slug>`.
- Action ID: `action:<stable-id>:<action-type>`.

Do not use row numbers as IDs. Row order can change after filtering, regrouping, or rerunning dry-runs.

## Safety Rules

- `APPROVE_GROUPING` only permits building reviewed planning artifacts. It does not permit writes.
- `APPROVE_WRITES` applies only to the exact action list and artifact digests shown in the write approval prompt.
- If any artifact changes after approval, return to the relevant review gate.
- If planning produces `planningErrorCount > 0`, do not request write approval.
- If execution partially succeeds, do not auto-retry mutating actions unless the retry was included in the approved recovery plan.
