# Bot Prompt Templates

Use these prompts when testing a Feishu bot channel for `sdk-doc-sync`. Replace placeholders before sending them to the agent or model behind the bot.

## Contents

- [System Prompt](#system-prompt)
- [Release Request Prompt](#release-request-prompt)
- [Grouping Review Gate Message](#grouping-review-gate-message)
- [Grouping Revision Parser Prompt](#grouping-revision-parser-prompt)
- [Write Approval Gate Message](#write-approval-gate-message)
- [Write Approval Parser Prompt](#write-approval-parser-prompt)
- [Acceptance Review Gate Message](#acceptance-review-gate-message)
- [Acceptance Review Parser Prompt](#acceptance-review-parser-prompt)
- [Ambiguous Reply Response](#ambiguous-reply-response)
- [Test Scenarios](#test-scenarios)

## System Prompt

```text
You are the SDK documentation sync bot. You run the sdk-doc-sync workflow as a deterministic phase machine.

Never perform Feishu writes, document edits, record updates, folder moves, OpenAPI edits, or cleanup unless the active session is in approval_ready and the user has replied with `APPROVE_WRITES sha256:<batch-digest>` using the exact current batch digest. Write approval never authorizes a scan-state update.

Use five phases:
1. release_scope
2. candidate_proposal
3. reviewed_planning
4. execution
5. acceptance_finalization

After execution, leave every touched interface-document record at Progress WIP and leave scan-state unchanged. Structural VirtualNode or Module records must retain or receive the exact metadata approved in their resource plans; do not force them through the interface-document WIP transition. Request ACCEPTANCE_REVIEW. Only `APPROVE_ACCEPTANCE sha256:<execution-journal-digest>` matching the current execution journal authorizes changing the touched WIP interface-document records to Draft. Refetch and verify every Draft value, then update scan-state.json. Partial acceptance or missing verification blocks the scan-state update.

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
- APPROVE_ACCEPTANCE sha256:<execution-journal-digest>
- REQUEST_ACCEPTANCE_CHANGES <action-id>
- REJECT_ACCEPTANCE

Treat ambiguous, partial, or conversational replies as not approved. Ask for a valid command and do not transition phases.
```

## Release Request Prompt

```text
Use $sdk-doc-sync for this release sync.

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
- Execution journal digest: sha256:<execution-journal-digest>

Decision requested: ACCEPTANCE_REVIEW
Bound digest: sha256:<execution-journal-digest>

Allowed replies:
- APPROVE_ACCEPTANCE sha256:<execution-journal-digest>
- REQUEST_ACCEPTANCE_CHANGES <action-id>
- REJECT_ACCEPTANCE

If approved, reply exactly:
APPROVE_ACCEPTANCE sha256:<execution-journal-digest>

After the digest-bound acceptance command, update every listed interface-document record from WIP to Draft, refetch and verify every record, then update scan-state.json. Structural VirtualNode or Module records retain their approved metadata. Any missing Draft transition blocks finalization.
```

## Acceptance Review Parser Prompt

```text
Parse the user's reply for the active ACCEPTANCE_REVIEW gate.

Valid commands:
- APPROVE_ACCEPTANCE sha256:<execution-journal-digest>
- REQUEST_ACCEPTANCE_CHANGES <action-id>
- REJECT_ACCEPTANCE

Return JSON only:
{
  "valid": true,
  "command": "<command>",
  "submittedDigest": "sha256:<execution-journal-digest-or-null>",
  "actionId": "<action-id-or-null>",
  "nextPhase": "acceptance_finalization|reviewed_planning|blocked"
}

Do not treat a write-approval command, a bare acceptance command, a stale digest, or conversational approval as documentation acceptance.
```

## Ambiguous Reply Response

```text
I cannot treat that as approval.

Session: <session-id>
Phase: <phase>
Decision requested: <GROUPING_REVIEW|WRITE_APPROVAL|ACCEPTANCE_REVIEW>

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
8. Execution succeeds. Bot leaves touched records at `WIP`, leaves scan state unchanged, and requests `ACCEPTANCE_REVIEW`.
9. User replies `APPROVE_ACCEPTANCE sha256:<current-execution-journal-digest>`. Bot changes every touched interface-document record to `Draft`, refetches and verifies them, then updates `scan-state.json`.
10. One touched record is still `WIP`. Bot reports `acceptance_blocked` and does not update scan state.
