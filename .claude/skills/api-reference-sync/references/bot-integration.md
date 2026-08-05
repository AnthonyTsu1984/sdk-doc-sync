# Bot Integration Reference

Use this reference when connecting `sdk-doc-sync` to a Feishu bot or another chat-driven workflow. The bot should behave as a deterministic phase runner, not as a free-form approval interpreter.

## Contract

Each bot run has one active release-sync session. Store these fields outside the model context so the next message can resume deterministically:

```json
{
  "sessionId": "sdk-doc-sync:<language>:<sdk-name>:<track>:sha256:<review-unit-manifest-digest>",
  "phase": "release_scope|candidate_proposal|reviewed_planning|execution|rollback|acceptance_finalization",
  "status": "release_scope_ready|grouping_review_required|review_unit_selection_required|approval_ready|document_review_required|rollback_approval_required|rollback_reconciliation_required|acceptance_review_required|accepted|blocked",
  "language": "<sdk-language>",
  "sdkName": "<sdk-name>",
  "track": "<version-track>",
  "artifacts": {
    "reviewSession": "<path>",
    "releaseScope": "<path>",
    "candidateProposal": "<path>",
    "inheritanceProposal": "<path>",
    "candidateSpec": "<path>",
    "filteredScope": "<path>",
    "referenceContext": "<path>",
    "dryRunFull": "<path>",
    "dryRunSummary": "<path>",
    "approvalActions": "<path>",
    "reviewUnitManifest": "<path>",
    "activeUnitDryRun": "<path-or-null>",
    "activeUnitJournal": "<path-or-null>",
    "acceptanceManifest": "<path-or-null>",
    "rollbackManifest": "<path-or-null>",
    "rollbackJournal": "<path-or-null>"
  },
  "pendingDecision": "GROUPING_REVIEW|WRITE_APPROVAL|DOCUMENT_REVIEW|ROLLBACK_APPROVAL|ACCEPTANCE_REVIEW|null",
  "proposalDigest": "sha256:<proposal-digest>|null",
  "proposedBatchDigest": "sha256:<batch-digest>|null",
  "executionJournalDigest": "sha256:<execution-journal-digest>|null",
  "rollbackManifestDigest": "sha256:<rollback-manifest-digest>|null",
  "acceptanceManifestDigest": "sha256:<acceptance-manifest-digest>|null",
  "reviewUnitManifestDigest": "sha256:<review-unit-manifest-digest>|null",
  "activeReviewUnitId": "review:<document-stable-id>|null",
  "acceptedReviewUnits": [
    {
      "reviewUnitId": "review:<document-stable-id>",
      "executionJournalPath": "<path>",
      "executionJournalDigest": "sha256:<execution-journal-digest>",
      "touchedRecords": [
        {
          "actionId": "<verified-journal-action-id>",
          "recordId": "<bitable-record-id>",
          "documentToken": "<docx-token-or-null>"
        }
      ],
      "commentsResolved": true
    }
  ],
  "proposalIds": [],
  "actionIds": []
}
```

Store this state in the review-session JSON created by `sdk-doc-sync --session-state`; do not reconstruct it from the conversation. Every later bot process must load it with `--resume-session`. Accepted IDs are derived only from journal-verified receipts written by `sdk-review-session.js accept-document`; a model message, prompt field, or caller-supplied ID is not evidence.

The bot may read artifacts and run dry-runs. It must not call mutating Feishu tools, write documents, update records, move folders, or update `scan-state.json` until the session is in `approval_ready` and the user replies with `APPROVE_WRITES sha256:<batch-digest>` matching the active document unit's `proposedExecutionBatch.batchDigest`. A release-level multi-document batch is never approvable.

## Phase Behavior

| Phase | Bot action | User-facing stop |
|-------|------------|------------------|
| `release_scope` | Run release scout and validate no-write flags. | Stop only on no changes or blocked discovery. |
| `candidate_proposal` | Build proposed user-facing candidates, exclusions, grouping decisions, version-table detected inheritance decisions, doc identities, and target placements. | Send `Decision requested: GROUPING_REVIEW`. |
| `reviewed_planning` | On the initial complete dry-run create the review-session file. On later runs resume it, validate accepted journals and live `WIP` records, select exactly one remaining document, then regenerate that unit against current live state with all required resource actions. | Send `WRITE_APPROVAL` only for the active unit; otherwise stop at `review_unit_selection_required`. |
| `execution` | Execute only the active unit's approved actions, refetch and verify, leave touched records at `WIP`, and leave scan state unchanged. | Stop with `DOCUMENT_REVIEW`; never start the next unit automatically. |
| `rollback` | Build the selected executed unit's inverse manifest read-only. After exact rollback approval, preflight live state, execute inverse actions in reverse dependency order, verify each result, and update the session only from a completed rollback journal. | Stop with `ROLLBACK_APPROVAL`, dependency blockers, or reconciliation instructions. |
| `acceptance_finalization` | Record each accepted unit journal. After every planned unit is accepted, build the complete accepted-unit manifest; only final acceptance changes touched records to `Draft` and updates scan state. | Return to the same unit on comments, select the next unit after document acceptance, or stop as fully accepted after finalization. |

## Decision Parsing

Accept only digest-bound command-style replies for gates:

- Grouping review: `APPROVE_GROUPING sha256:<proposal-digest>`, `REVISE_GROUPING <proposal-id> <decision>`, `REVISE_INHERITANCE <inheritance-id> <decision>`, `DEFER_GROUPING <proposal-id>`, `REJECT_GROUPING`
- Write approval: `APPROVE_WRITES sha256:<batch-digest>`, `REJECT_WRITES`, `REQUEST_CHANGES <action-id>`
- Document review: `APPROVE_DOCUMENT <review-unit-id> sha256:<execution-journal-digest>`, `REQUEST_DOCUMENT_CHANGES <review-unit-id>`, `REQUEST_DOCUMENT_ROLLBACK <review-unit-id>`, `REJECT_DOCUMENT <review-unit-id>`
- Rollback approval: `APPROVE_ROLLBACK <review-unit-id> sha256:<rollback-manifest-digest>`, `REJECT_ROLLBACK <review-unit-id>`
- Acceptance review: `APPROVE_ACCEPTANCE sha256:<acceptance-manifest-digest>`, `REQUEST_ACCEPTANCE_CHANGES <review-unit-id>`, `REJECT_ACCEPTANCE`

A bare approval command is not approved. The parser must compare both the review-unit ID and submitted digest with the active bound artifacts before changing phase.

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
- `Bound digest`: the full current proposal, unit batch, unit execution-journal, or acceptance-manifest digest.
- `Active review unit`: when applicable, the stable `review:<document-stable-id>` and the single document under review.
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
- Review-unit ID: `review:<documentation-stable-id>`.

Do not use row numbers as IDs. Row order can change after filtering, regrouping, or rerunning dry-runs.

## Safety Rules

- `APPROVE_GROUPING sha256:<proposal-digest>` only permits building reviewed planning artifacts. It does not permit writes.
- The grouping command also approves inheritance decisions shown in the same digest-bound proposal. If a successor-track decision is absent, ambiguous, or stale, keep the session in `candidate_proposal`.
- `APPROVE_WRITES sha256:<batch-digest>` applies only to the exact action list and artifact digests bound into that batch.
- Write approval does not accept the resulting documentation and never authorizes another document unit or a scan-state update.
- `APPROVE_DOCUMENT <review-unit-id> sha256:<execution-journal-digest>` is valid only for the active, successfully verified unit. It records review completion but leaves interface records at `WIP` and leaves scan state unchanged.
- `APPROVE_ROLLBACK <review-unit-id> sha256:<rollback-manifest-digest>` is a separate destructive approval. It is valid only for an executed active unit or an accepted unit before finalization. It never authorizes a different unit and never changes `scan-state.json`.
- For `COPY_PATCH_AND_REPOINT`, rollback must restore the complete captured Bitable fields so `Docs` points back to the untouched COPY source, verify that pointer, and delete only the copied-and-patched Docx. Never history-revert the source because the source was not modified.
- For `CREATE`, delete and verify the new Bitable record before deleting and verifying the new Docx. Delete newly created VirtualNode records and folders only in reverse dependency order; restore a repointed pre-existing VirtualNode before deleting its new folder.
- If another executed or accepted unit uses a created resource, block rollback and name the dependent review-unit IDs. If the rollback journal is partial or has an unresolved prepared action, do not mutate the session or relaunch automatically.
- Persist `APPROVE_DOCUMENT` with `sdk-review-session.js accept-document`. The command must re-read the matching completed execution journal, require resolved comments, bind every touched record to a verified journal action, and reject a journal for a different document unit.
- Before a new process selects the next unit, rerun `sdk-doc-sync` with `--resume-session`. Manifest drift, journal drift, missing records, a non-`WIP` progress value, nonblank `Targets`, or a changed Docx token blocks the phase transition.
- `REQUEST_DOCUMENT_CHANGES` freezes progression, requires reading the active document's comments, and returns only that unit to reviewed planning. Any changed artifact or resource plan invalidates the previous batch and execution-journal digest.
- `APPROVE_ACCEPTANCE sha256:<acceptance-manifest-digest>` is valid only after every unit in the original review-unit manifest has one accepted journal in the complete acceptance manifest. It authorizes only the listed interface-document `WIP` to `Draft` transitions and the subsequent verified `scan-state.json` update. Structural VirtualNode or Module records are excluded from that transition.
- Build that digest with `sdk-review-session.js build-acceptance`. After finalization, mark the session complete only with `record-finalization` and a successful finalization journal bound to the same digest.
- If any artifact changes after approval, return to the relevant review gate.
- If planning produces `planningErrorCount > 0`, do not request write approval.
- If execution partially succeeds, do not auto-retry mutating actions unless the retry was included in the approved recovery plan.
