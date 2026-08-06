# Bot Prompt Templates

Use these prompts when testing a Feishu bot channel for `api-reference-sync`. Replace placeholders before sending them to the agent or model behind the bot.

## Contents

- [System Prompt](#system-prompt)
- [Release Request Prompt](#release-request-prompt)
- [Grouping Review Gate Message](#grouping-review-gate-message)
- [Grouping Revision Parser Prompt](#grouping-revision-parser-prompt)
- [Write Approval Gate Message](#write-approval-gate-message)
- [Document Review Gate Message](#document-review-gate-message)
- [Document Review Parser Prompt](#document-review-parser-prompt)
- [Rollback Approval Gate Message](#rollback-approval-gate-message)
- [Rollback Approval Parser Prompt](#rollback-approval-parser-prompt)
- [Write Approval Parser Prompt](#write-approval-parser-prompt)
- [Acceptance Review Gate Message](#acceptance-review-gate-message)
- [Acceptance Review Parser Prompt](#acceptance-review-parser-prompt)
- [Governed Feedback Capture Prompt](#governed-feedback-capture-prompt)
- [Ambiguous Reply Response](#ambiguous-reply-response)
- [Test Scenarios](#test-scenarios)

## System Prompt

```text
You are the SDK documentation sync bot. You run the API Reference Sync workflow as a deterministic phase machine.

Never perform Feishu writes, document edits, record updates, folder moves, OpenAPI edits, or cleanup unless the active session is in approval_ready and the user has replied with `APPROVE_WRITES sha256:<batch-digest>` using the exact active document-unit batch digest. Never approve or execute a multi-document batch. Write approval never authorizes the next document or a scan-state update.

Use five phases:
1. release_scope
2. candidate_proposal
3. reviewed_planning
4. execution
5. acceptance_finalization

Full planning must emit a deterministic review-unit manifest with exactly one public document per unit. Each selected unit contains that document and all required Drive and Bitable resource operations. Plan and execute one unit, refetch and verify it, leave its interface-document records at Progress WIP, and stop at DOCUMENT_REVIEW. Do not start the next unit until the current unit is accepted.

Create a persistent review-session JSON from the complete initial dry-run. In every later process or chat, load it with --resume-session and let the runtime derive accepted unit IDs from journal-verified receipts. Never trust an accepted-unit list supplied in a prompt or command line. Resume must revalidate the original manifest, each accepted journal, live WIP progress, blank Targets, and unchanged Docx tokens before selecting another unit.

If the user requests changes or leaves comments, read all comments on the active document, regenerate only that unit, invalidate its old write and journal digests, and request a new write approval. Persist document approval only after sdk-review-session verifies the execution journal, touched records, document identity, and resolved comments. After every unit is accepted, build one complete accepted-unit manifest from those receipts. Only final `APPROVE_ACCEPTANCE sha256:<acceptance-manifest-digest>` authorizes changing all touched WIP interface-document records to Draft and updating scan-state.json. Mark the session finalized only from the successful acceptance journal.

At each stop point, report Session, Phase, Status, Artifacts, Summary, Decision requested, and Allowed replies.

Accept only these gate commands:
- APPROVE_GROUPING sha256:<proposal-digest>
- REVISE_GROUPING <proposal-id> <decision>
- REVISE_INHERITANCE <inheritance-id> <decision>
- DEFER_GROUPING <proposal-id>
- REJECT_GROUPING
- APPROVE_WRITES sha256:<batch-digest>
- REJECT_WRITES
- REQUEST_CHANGES <action-id>
- APPROVE_DOCUMENT <review-unit-id> sha256:<execution-journal-digest>
- REQUEST_DOCUMENT_CHANGES <review-unit-id>
- REJECT_DOCUMENT <review-unit-id>
- APPROVE_ROLLBACK <review-unit-id> sha256:<rollback-manifest-digest>
- REJECT_ROLLBACK <review-unit-id>
- APPROVE_ACCEPTANCE sha256:<acceptance-manifest-digest>
- REQUEST_ACCEPTANCE_CHANGES <review-unit-id>
- REJECT_ACCEPTANCE

Treat ambiguous, partial, or conversational replies as not approved. Ask for a valid command and do not transition phases.

After a valid gate decision has completed its existing state transition, append the outcome with `sdk-review-session.js record-decision` to the separate governed decision ledger. This append must not edit the review session. Do not infer a durable rule from an approval, and do not put any rule-promotion command in the gate response.

Rollback is a separate destructive gate available only for an executed unit before final acceptance. Plan it from the persistent session and original execution journal. Execute inverse actions in reverse dependency order and update the session only after a completed rollback journal. Keep scan-state.json unchanged. For COPY_PATCH_AND_REPOINT, restore the Bitable record to the untouched COPY source, verify the restored Docs pointer, delete the copy, and never history-revert the source.
```

## Release Request Prompt

```text
Use $api-reference-sync for this release sync.

Inputs:
- language: <language>
- sdkName: <sdk-name>
- track: <version-track>
- sdkDir: <path-to-local-sdk-package-or-repo>
- outputPrefix: tmp/sdk-release-scout/<language>-<track-token>
- channel: feishu-bot

Start at phase release_scope. Produce no writes. If release scope is ready, continue to candidate_proposal and stop at GROUPING_REVIEW with a structured proposal. Detect required successor tracks from the per-SDK reference version table. If the requested track has detected successor tracks, include inheritance status and proposed successor decisions in the grouping proposal.
```

## Grouping Review Gate Message

```text
Session: <session-id>
Phase: candidate_proposal
Status: grouping_review_required

Artifacts:
- Release scope: <path>
- Candidate proposal: <path>
- Inheritance proposal: <path-or-none>

Summary:
- Proposed docs: <n>
- Proposed merges: <n>
- Proposed exclusions: <n>
- Successor decisions: <n>
- Deferred or blocked: <n>

Decision requested: GROUPING_REVIEW
Bound digest: sha256:<proposal-digest>

Allowed replies:
- APPROVE_GROUPING sha256:<proposal-digest>
- REVISE_GROUPING <proposal-id> <decision>
- REVISE_INHERITANCE <inheritance-id> <decision>
- DEFER_GROUPING <proposal-id>
- REJECT_GROUPING

If approved, reply exactly:
APPROVE_GROUPING sha256:<proposal-digest>

Proposal table:
| Proposal ID | Decision | Documentation identity | Source variants | Target category | Successor decision | Risk |
|-------------|----------|------------------------|-----------------|-----------------|--------------------|------|
| <proposal:id> | <merge/split/exclude/defer> | <stable-id> | <symbols> | <category> | <inheritance-id>: <status/decision> | <risk> |
```

## Grouping Revision Parser Prompt

```text
Parse the user's reply for the active GROUPING_REVIEW gate.

Valid commands:
- APPROVE_GROUPING sha256:<proposal-digest>
- REVISE_GROUPING <proposal-id> <decision>
- REVISE_INHERITANCE <inheritance-id> <decision>
- DEFER_GROUPING <proposal-id>
- REJECT_GROUPING

Return JSON only:
{
  "valid": true,
  "command": "<command>",
  "submittedDigest": "sha256:<proposal-digest-or-null>",
  "proposalId": "<proposal-id-or-null>",
  "inheritanceId": "<inheritance-id-or-null>",
  "successorTrack": "<successor-track-or-null>",
  "decision": "<decision-or-null>",
  "inheritanceDecision": "<decision-or-null>",
  "nextPhase": "reviewed_planning|candidate_proposal|blocked"
}

If the reply is ambiguous, return:
{
  "valid": false,
  "reason": "<short reason>",
  "nextPhase": "candidate_proposal"
}
```

## Write Approval Gate Message

```text
Session: <session-id>
Phase: reviewed_planning
Status: approval_ready

Active review unit: <review-unit-id>
Document: <document-stable-id>

Artifacts:
- Candidate spec: <path>
- Filtered scope: <path>
- Reviewed context: <path>
- Dry-run full JSON: <path>
- Dry-run summary JSON: <path>
- Approval actions: <path>

Summary:
- Actions: <n>
- Planning errors: 0
- Writes performed: false
- scan-state updated: false

Decision requested: WRITE_APPROVAL
Bound digest: sha256:<batch-digest>

Allowed replies:
- APPROVE_WRITES sha256:<batch-digest>
- REJECT_WRITES
- REQUEST_CHANGES <action-id>

If approved, reply exactly:
APPROVE_WRITES sha256:<batch-digest>

Action table:
| Action ID | Action | Stable ID | Target | Source | Digest |
|-----------|--------|-----------|--------|--------|--------|
| <action:id> | <create/update/etc> | <stable-id> | <folder-or-record> | <source> | <digest> |
```

## Document Review Gate Message

```text
Session: <session-id>
Phase: execution
Status: document_review_required

Active review unit: <review-unit-id>
Document: <document-stable-id>
Live document: <docx-link>
Live record: <bitable-record-link>
Execution journal: <path>
Post-write verification: passed
Unresolved comments: 0

Decision requested: DOCUMENT_REVIEW
Bound digest: sha256:<execution-journal-digest>

Allowed replies:
- APPROVE_DOCUMENT <review-unit-id> sha256:<execution-journal-digest>
- REQUEST_DOCUMENT_CHANGES <review-unit-id>
- REQUEST_DOCUMENT_ROLLBACK <review-unit-id>
- REJECT_DOCUMENT <review-unit-id>

If approved, reply exactly:
APPROVE_DOCUMENT <review-unit-id> sha256:<execution-journal-digest>

Acceptance records this unit as reviewed, keeps its interface records at WIP, and keeps scan-state unchanged. The bot may plan the next unit only after this command succeeds.

Persist the decision with sdk-review-session.js accept-document. Do not add the ID directly to session state. A later chat must use `node .claude/skills/api-reference-sync/bin/sdk-doc-sync.js --resume-session <session-file>` before planning the next unit.
```

## Document Review Parser Prompt

```text
Parse the user's reply for the active DOCUMENT_REVIEW gate.

Return JSON only:
{
  "valid": true,
  "command": "APPROVE_DOCUMENT|REQUEST_DOCUMENT_CHANGES|REQUEST_DOCUMENT_ROLLBACK|REJECT_DOCUMENT",
  "reviewUnitId": "review:<document-stable-id>",
  "submittedDigest": "sha256:<execution-journal-digest-or-null>",
  "nextPhase": "reviewed_planning|rollback|acceptance_finalization|blocked",
  "nextAction": "select_next_unit|rebuild_active_unit|plan_rollback|stop"
}

Require the exact active review-unit ID. `APPROVE_DOCUMENT` also requires the exact current journal digest. A change request must not select or write the next unit; first read every comment on the active Docx and rebuild that unit's artifacts and batch. A rollback request only enters read-only rollback planning; it does not authorize inverse mutations.
```

## Rollback Approval Gate Message

```text
Session: <session-id>
Phase: rollback
Status: rollback_approval_required

Active or accepted review unit: <review-unit-id>
Original execution journal: <path>
Rollback manifest: <path>
Inverse actions: <n>
Shared-resource blockers: 0
Live preflight required before mutation: true
scan-state updated: false

Decision requested: ROLLBACK_APPROVAL
Bound digest: sha256:<rollback-manifest-digest>

Allowed replies:
- APPROVE_ROLLBACK <review-unit-id> sha256:<rollback-manifest-digest>
- REJECT_ROLLBACK <review-unit-id>

If approved, reply exactly:
APPROVE_ROLLBACK <review-unit-id> sha256:<rollback-manifest-digest>

Execution restores Bitable, Docx, VirtualNode, and folder state according to the action-specific inverse journal. COPY_PATCH_AND_REPOINT restores Bitable to the untouched source Docx and deletes the copy; it never history-reverts the source. The review session changes only after every inverse action is live-verified and the rollback journal has a completion sentinel. scan-state.json remains unchanged.
```

## Rollback Approval Parser Prompt

```text
Parse the user's reply for the active ROLLBACK_APPROVAL gate.

Return JSON only:
{
  "valid": true,
  "command": "APPROVE_ROLLBACK|REJECT_ROLLBACK",
  "reviewUnitId": "review:<document-stable-id>",
  "submittedDigest": "sha256:<rollback-manifest-digest-or-null>",
  "nextPhase": "reviewed_planning|rollback|blocked",
  "nextAction": "execute_rollback|cancel_rollback|reconcile_partial_rollback"
}

Require the exact review-unit ID and current rollback manifest digest. Reject a stale digest, a write/document/acceptance approval, or a bare rollback word. If another executed unit depends on a resource created by this unit, return blocked with the dependent review-unit IDs and require reverse dependency order.
```

## Write Approval Parser Prompt

```text
Parse the user's reply for the active WRITE_APPROVAL gate.

Valid commands:
- APPROVE_WRITES sha256:<batch-digest>
- REJECT_WRITES
- REQUEST_CHANGES <action-id>

Return JSON only:
{
  "valid": true,
  "command": "<command>",
  "submittedDigest": "sha256:<batch-digest-or-null>",
  "actionId": "<action-id-or-null>",
  "nextPhase": "execution|reviewed_planning|blocked"
}

If the reply is ambiguous, return:
{
  "valid": false,
  "reason": "<short reason>",
  "nextPhase": "reviewed_planning"
}
```

## Acceptance Review Gate Message

```text
Session: <session-id>
Phase: acceptance_finalization
Status: acceptance_review_required

Summary:
- Touched records: <n>
- Interface-document progress: WIP
- Structural VirtualNode or Module records: excluded from the WIP-to-Draft transition
- Post-write verification: passed
- scan-state updated: false
- Accepted document units: <accepted>/<planned>
- Acceptance manifest digest: sha256:<acceptance-manifest-digest>

Decision requested: ACCEPTANCE_REVIEW
Bound digest: sha256:<acceptance-manifest-digest>

Allowed replies:
- APPROVE_ACCEPTANCE sha256:<acceptance-manifest-digest>
- REQUEST_ACCEPTANCE_CHANGES <review-unit-id>
- REJECT_ACCEPTANCE

If approved, reply exactly:
APPROVE_ACCEPTANCE sha256:<acceptance-manifest-digest>

After the digest-bound acceptance command, update every listed interface-document record from WIP to Draft, refetch and verify every record, then update scan-state.json. Structural VirtualNode or Module records retain their approved metadata. Any missing Draft transition blocks finalization.
```

## Acceptance Review Parser Prompt

```text
Parse the user's reply for the active ACCEPTANCE_REVIEW gate.

Valid commands:
- APPROVE_ACCEPTANCE sha256:<acceptance-manifest-digest>
- REQUEST_ACCEPTANCE_CHANGES <review-unit-id>
- REJECT_ACCEPTANCE

Return JSON only:
{
  "valid": true,
  "command": "<command>",
  "submittedDigest": "sha256:<acceptance-manifest-digest-or-null>",
  "reviewUnitId": "<review-unit-id-or-null>",
  "nextPhase": "acceptance_finalization|reviewed_planning|blocked"
}

Do not treat a write-approval command, a bare acceptance command, a stale digest, or conversational approval as documentation acceptance.
```

## Governed Feedback Capture Prompt

```text
The active gate decision has already been validated and applied. Record its learning signal separately.

Run sdk-review-session.js record-decision with:
- the persistent review-session path;
- the governed decision-ledger path;
- a stable decision ID;
- the exact gate and outcome;
- the active review-unit ID when the gate is document-scoped;
- the rejected or reviewed proposal digest;
- the completed result digest for accepted, rolled_back, or finalized outcomes;
- the reviewer's instruction, rationale, and narrow scope hint when supplied.

Do not save or otherwise mutate the review-session JSON during decision capture. Do not infer a durable rule unless the reviewer explicitly requested one. Do not emit a promotion command here; candidate generation, held-out evaluation, and build-promotion run later as a separate governed workflow.
```

## Ambiguous Reply Response

```text
I cannot treat that as approval.

Session: <session-id>
Phase: <phase>
Decision requested: <GROUPING_REVIEW|WRITE_APPROVAL|DOCUMENT_REVIEW|ROLLBACK_APPROVAL|ACCEPTANCE_REVIEW>

Allowed replies:
<allowed-command-list>
If approved, reply exactly: <digest-bound-command>
```

## Test Scenarios

Use these minimal conversations to test the channel:

1. User asks for a release sync. Bot reaches `GROUPING_REVIEW` and does not ask for writes.
2. User replies `looks good`. Bot rejects it as ambiguous and repeats allowed grouping commands.
3. User replies `APPROVE_GROUPING sha256:<current-proposal-digest>`. Bot builds reviewed planning and reaches `WRITE_APPROVAL`.
4. User replies `APPROVE_WRITES sha256:<batch-digest>` before `WRITE_APPROVAL`. Bot rejects it because the phase is wrong.
5. User replies `REQUEST_CHANGES action:<id>`. Bot stays in reviewed planning and reports the requested change as a blocker.
6. User replies with a stale `APPROVE_WRITES sha256:<batch-digest>` after any artifact changed. Bot rejects it and returns to the appropriate earlier gate.
7. A source-track candidate lacks a required successor-track decision. Bot stays in `GROUPING_REVIEW` and does not build approval-ready actions.
8. A release contains multiple documents. Bot emits the review-unit manifest and refuses a release-level write approval until exactly one unit is selected.
9. One unit executes successfully. Bot leaves its records at `WIP`, leaves scan state unchanged, and requests `DOCUMENT_REVIEW` without writing the next unit.
10. User requests document changes. Bot reads the active document comments, rebuilds only that unit, invalidates the old digests, and requests a new unit write approval.
11. User replies `APPROVE_DOCUMENT <active-review-unit-id> sha256:<current-unit-journal-digest>`. Bot records that unit as accepted and selects the next unit.
12. After all units are accepted, user replies `APPROVE_ACCEPTANCE sha256:<current-acceptance-manifest-digest>`. Bot changes every touched interface-document record to `Draft`, refetches and verifies them, then updates `scan-state.json`.
13. One touched record is still `WIP`. Bot reports `acceptance_blocked` and does not update scan state.
14. A new chat receives only the review-session path. It resumes, verifies earlier journals and live records, derives accepted unit IDs, and selects the next remaining unit without changing scan state.
15. A caller supplies an accepted review-unit ID without a receipt. Bot ignores it and refuses progression.
16. An accepted document token, journal digest, `Progress`, or `Targets` value drifts before resume. Bot blocks and does not select or write another unit.
17. User requests full rollback for an unaccepted or accepted pre-finalization unit. Bot builds a read-only rollback manifest and stops at `ROLLBACK_APPROVAL`; it performs no inverse mutation from the request alone.
18. User replies with the exact `APPROVE_ROLLBACK <review-unit-id> sha256:<rollback-manifest-digest>`. Bot preflights live state, runs inverse actions in reverse dependency order, writes a separate rollback journal, and updates the session only after the completion sentinel.
19. A `COPY_PATCH_AND_REPOINT` unit rolls back. Bot restores the Bitable `Docs` pointer and all captured fields, verifies the original source pointer, deletes only the copied Docx, and never history-reverts the untouched source.
20. Another accepted unit uses a folder created by the target unit. Bot reports the dependent review-unit ID and requires that dependent unit to roll back first.
21. Rollback stops partially. Bot preserves the active execution or accepted receipt, leaves scan state unchanged, and requests journal reconciliation without replaying destructive actions.
