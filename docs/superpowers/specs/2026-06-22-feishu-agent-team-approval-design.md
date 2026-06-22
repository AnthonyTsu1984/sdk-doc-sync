# Feishu Agent Team Approval Design

## Goal

Build an automated documentation agent team that runs from GitHub Actions, reports progress through Feishu messages, and asks for human approval through Feishu message cards before live writes or other risky actions.

## Context

The local `.claude` skills already cover the core documentation work:

- `sdk-doc-sync`: scan SDK/API repositories, diff symbols, create or update Feishu reference docs and bitable records.
- `draft-verified-docs`: draft source-verified Milvus/Zilliz docs from references.
- `patch-feishu-code`: fill missing SDK language examples in existing Feishu docs.
- `feishu-code-verify`: verify documentation code snippets.
- `localization-docs`: align English and localized Feishu wiki/bitable content.

The AWS `sample-codex-agent-team` repository contributes the team operating model: a coordinator, scoped worker roles, durable spec/task/review artifacts, parallel file-disjoint work, and independent PASS/FAIL review gates. It is not a production control plane, so GitHub Actions should provide scheduling, execution, artifact storage, retries, and audit history.

## Architecture

```text
GitHub Actions schedule/manual dispatch
  -> coordinator job scans repos and source docs
  -> worker jobs produce dry-run plans and reports
  -> review job consolidates PASS/FAIL and risk level
  -> notification job sends Feishu progress message or approval card

Feishu approval card button
  -> approval gateway receives Feishu callback
  -> gateway verifies callback, user, and task state
  -> gateway records decision
  -> gateway triggers GitHub repository_dispatch/workflow_dispatch

Approved GitHub Actions workflow
  -> executes live writes or PR creation
  -> verifies results
  -> posts final Feishu status
```

## Components

### GitHub Actions Workflows

`doc-agent-scan.yml`

- Runs on schedule and `workflow_dispatch`.
- Checks out this repository and configured source repositories under `repos/`.
- Reads scan state before scanning.
- Fetches tags and source-doc metadata.
- Builds a change manifest.
- Starts scoped worker jobs.
- Sends Feishu progress messages.

`doc-agent-dry-run.yml`

- Runs worker jobs for detected changes.
- Produces Markdown drafts, patch plans, localization plans, verification reports, and risk summaries.
- Uploads artifacts.
- Does not write Feishu content or mutate source repositories.

`doc-agent-approval-result.yml`

- Runs after the approval gateway receives a Feishu card decision.
- Executes the approved operation, rejects it, or records a change request.
- Posts status back to the same Feishu thread/card.

`doc-agent-live-write.yml`

- Runs only after an approval record is valid.
- Performs Feishu writes, GitHub PR creation, bitable updates, or state updates according to the approved action.
- Refetches changed docs/records and runs verification.
- Posts final result and links to artifacts.

### Approval Gateway

The approval gateway is the always-on "doorbell" for Feishu card button clicks.

Responsibilities:

- Expose an HTTPS endpoint for Feishu interactive card callbacks.
- Verify Feishu callback signature, timestamp, and challenge events.
- Verify the clicker is an authorized approver.
- Verify the task id, action id, nonce, and current decision state.
- Persist the decision.
- Trigger GitHub `repository_dispatch` or `workflow_dispatch`.
- Return an immediate acknowledgement to Feishu.

Recommended implementation: Cloudflare Worker with a small durable store. Vercel, AWS Lambda, or an internal service are acceptable alternatives if they can expose a stable HTTPS endpoint and keep secrets safely.

### Feishu Messages And Cards

Progress messages are normal Feishu messages in a dedicated chat, for example `Doc Agent Team`.

Approval messages are interactive cards with:

- task title
- required decision
- affected repository, source doc, Feishu doc, bitable, or localization target
- risk level
- proposed operation
- dry-run summary
- artifact links
- expiry time
- buttons: `Approve`, `Reject`, `Request Changes`, `Open Details`

Cards should be updated after a decision so stale cards show their final state.

### State Store

The system needs persistent state for:

- task id
- source run id
- action type
- target resources
- risk level
- artifact URLs
- decision status
- approver identity
- approval timestamp
- live workflow run id
- final result

MVP storage can be a JSON file artifact plus gateway KV/Durable Object state. Longer term, use a small database table if querying history becomes important.

## Agent Roles

`doc-coordinator`

- Owns manifests, task state, approval requests, and final consolidation.
- Splits work by safe boundaries: SDK, source repo, doc table, language, or localization table pair.

`sdk-sync-agent`

- Runs SDK/API tag checks and symbol diffs.
- Produces reference-doc create/update/deprecate plans.

`verified-draft-agent`

- Reads source references and implementation code.
- Drafts verified docs and lists unresolved claims.

`code-patch-agent`

- Reads Feishu procedure docs.
- Ports missing SDK examples only when real SDK support is verified.
- Produces patch plans and verification reports.

`localization-agent`

- Diffs source and target Feishu bitables by stable slug.
- Produces new/update/meta-only/orphan plans.
- Preserves embeds and media rules.

`verify-agent`

- Runs code verification, post-action doc checks, link checks, and Feishu refetch checks.
- Produces PASS/FAIL verdicts.

`notify-agent`

- Sends progress messages and approval cards.
- Updates cards after decisions and completion.

## Decision Gates

The first version should require approval for:

- any live Feishu doc patch
- any Feishu bitable create/update/delete
- any localized doc create/update
- any GitHub PR creation
- any live runtime verification that uses external service credentials
- any retry that broadens permissions or target scope
- any bulk action above a configured threshold

The system may send informational messages without approval for:

- scheduled scan start/end
- no-change results
- dry-run artifacts created
- verification-only PASS/FAIL summaries

## Task Lifecycle

```text
detected
dry_run_started
dry_run_ready
review_passed | review_failed
approval_requested
approved | rejected | changes_requested | expired
live_write_started
verification_started
completed | failed
```

Rules:

- Live writes require `review_passed` and `approved`.
- Expired approvals cannot be reused.
- A card button click must be idempotent.
- `Request Changes` should create a new GitHub issue comment or workflow artifact containing the human message, then stop the task.
- `Reject` should stop the task and preserve artifacts.

## Security

Secrets required in GitHub Actions:

- Feishu app id and app secret for bot messages and doc APIs.
- GitHub token or GitHub App credentials for dispatching workflows and creating PRs.
- Optional translator/API credentials for localization.
- Optional live verification credentials.

Secrets required in the approval gateway:

- Feishu callback verification secret.
- GitHub dispatch credential.
- Gateway signing secret for task payloads.

Guardrails:

- Do not include secrets in Feishu cards, artifacts, logs, or generated docs.
- Use least-privilege Feishu scopes.
- Limit approvers by Feishu open id or user id allowlist.
- Include task nonce and expiry in every card action.
- Verify repository, workflow, ref, task id, and approval status before dispatching live work.
- Treat unknown targets as production-like and require approval.

## MVP Scope

The first implementation should support one safe end-to-end loop:

1. Scheduled or manual SDK/source scan.
2. Dry-run worker output for one task type, preferably SDK doc sync or localization diff.
3. Feishu progress message.
4. Feishu approval card.
5. Approval gateway callback.
6. GitHub workflow dispatch after approval.
7. Live write or PR creation for the approved task.
8. Verification and final Feishu status.

Recommended MVP task type: localization diff dry-run plus manual approval for live localized doc creation/update. It exercises Feishu table/doc reads, card approval, controlled Feishu writes, and result verification without needing live SDK runtime environments.

## Out Of Scope For MVP

- Fully autonomous live writes without approval.
- Multi-tenant approval policies.
- Web dashboard.
- Long-running local agent processes.
- Automatic remediation after verifier failures.
- Deleting Feishu docs or bitable records.
- Production live runtime tests without explicit per-run approval.

## Open Questions

1. Which Feishu chat should receive progress messages and cards?
2. Which Feishu users are authorized approvers?
3. Should approved work write directly to Feishu, open a GitHub PR first, or support both by action type?
4. Which task type should be the MVP: SDK doc sync, localization diff, code patching, or verified draft docs?
5. Should the approval gateway be Cloudflare Worker, Vercel, AWS Lambda, or an existing internal service?

