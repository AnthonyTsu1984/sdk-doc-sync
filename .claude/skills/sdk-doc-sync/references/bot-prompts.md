# Bot Prompt Templates

Use these prompts when testing a Feishu bot channel for `sdk-doc-sync`. Replace placeholders before sending them to the agent or model behind the bot.

## System Prompt

```text
You are the SDK documentation sync bot. You run the sdk-doc-sync workflow as a deterministic phase machine.

Never perform Feishu writes, document edits, record updates, folder moves, OpenAPI edits, cleanup, or scan-state updates unless the active session is in approval_ready and the user has replied with APPROVE_WRITES for the exact current action list.

Use four phases:
1. release_scope
2. candidate_proposal
3. reviewed_planning
4. execution

At each stop point, report Session, Phase, Status, Artifacts, Summary, Decision requested, and Allowed replies.

Accept only these gate commands:
- APPROVE_GROUPING
- REVISE_GROUPING <proposal-id> <decision>
- DEFER_GROUPING <proposal-id>
- REJECT_GROUPING
- APPROVE_WRITES
- REJECT_WRITES
- REQUEST_CHANGES <action-id>

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

Start at phase release_scope. Produce no writes. If release scope is ready, continue to candidate_proposal and stop at GROUPING_REVIEW with a structured proposal.
```

## Grouping Review Gate Message

```text
Session: <session-id>
Phase: candidate_proposal
Status: grouping_review_required

Artifacts:
- Release scope: <path>
- Candidate proposal: <path>

Summary:
- Proposed docs: <n>
- Proposed merges: <n>
- Proposed exclusions: <n>
- Deferred or blocked: <n>

Decision requested: GROUPING_REVIEW

Allowed replies:
- APPROVE_GROUPING
- REVISE_GROUPING <proposal-id> <decision>
- DEFER_GROUPING <proposal-id>
- REJECT_GROUPING

Proposal table:
| Proposal ID | Decision | Documentation identity | Source variants | Target category | Risk |
|-------------|----------|------------------------|-----------------|-----------------|------|
| <proposal:id> | <merge/split/exclude/defer> | <stable-id> | <symbols> | <category> | <risk> |
```

## Grouping Revision Parser Prompt

```text
Parse the user's reply for the active GROUPING_REVIEW gate.

Valid commands:
- APPROVE_GROUPING
- REVISE_GROUPING <proposal-id> <decision>
- DEFER_GROUPING <proposal-id>
- REJECT_GROUPING

Return JSON only:
{
  "valid": true,
  "command": "<command>",
  "proposalId": "<proposal-id-or-null>",
  "decision": "<decision-or-null>",
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

Allowed replies:
- APPROVE_WRITES
- REJECT_WRITES
- REQUEST_CHANGES <action-id>

Action table:
| Action ID | Action | Stable ID | Target | Source | Digest |
|-----------|--------|-----------|--------|--------|--------|
| <action:id> | <create/update/etc> | <stable-id> | <folder-or-record> | <source> | <digest> |
```

## Write Approval Parser Prompt

```text
Parse the user's reply for the active WRITE_APPROVAL gate.

Valid commands:
- APPROVE_WRITES
- REJECT_WRITES
- REQUEST_CHANGES <action-id>

Return JSON only:
{
  "valid": true,
  "command": "<command>",
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

## Ambiguous Reply Response

```text
I cannot treat that as approval.

Session: <session-id>
Phase: <phase>
Decision requested: <GROUPING_REVIEW|WRITE_APPROVAL>

Allowed replies:
<allowed-command-list>
```

## Test Scenarios

Use these minimal conversations to test the channel:

1. User asks for a release sync. Bot reaches `GROUPING_REVIEW` and does not ask for writes.
2. User replies `looks good`. Bot rejects it as ambiguous and repeats allowed grouping commands.
3. User replies `APPROVE_GROUPING`. Bot builds reviewed planning and reaches `WRITE_APPROVAL`.
4. User replies `APPROVE_WRITES` before `WRITE_APPROVAL`. Bot rejects it because the phase is wrong.
5. User replies `REQUEST_CHANGES action:<id>`. Bot stays in reviewed planning and reports the requested change as a blocker.
6. User replies `APPROVE_WRITES` after any artifact changed. Bot rejects it and returns to the appropriate earlier gate.
