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
  -> coordinator job performs lightweight repo/source-doc discovery
  -> coordinator posts daily Feishu scan report with policy choices
  -> human chooses a policy or types custom instructions
  -> coordinator breaks the decision into runnable tasks
  -> domain owner agents execute end-to-end task slices
  -> review job consolidates PASS/FAIL and risk level
  -> notification job sends Feishu progress messages or approval cards

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
- Checks out this repository.
- Reads scan state before scanning.
- Performs lightweight discovery for configured SDK/source repositories and Feishu source docs.
- Builds a daily scan report with affected surfaces, estimated effort, risk, and possible dealing policies.
- Sends a Feishu report card instead of starting live work directly.

`doc-agent-dry-run.yml`

- Runs after the human selects a policy from the daily scan report or supplies custom instructions.
- Converts the chosen policy into runnable tasks.
- Dispatches task slices to domain owner agents.
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

The daily scan report card is a higher-level decision card. It should summarize all detected findings and offer policies such as:

- `Ignore for now`
- `Create dry-run plans only`
- `Open GitHub PRs`
- `Patch Feishu after per-task approval`
- `Patch low-risk docs automatically, ask for risky ones`
- `Custom instruction`

If the user chooses `Custom instruction`, the coordinator should preserve the typed instruction as part of the task record and use it to guide decomposition.

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

Agents should be organized by durable ownership of a documentation surface, not by pipeline stage. Pipeline capabilities such as scanning, drafting, patching, localizing, and verifying are shared tools that each owner uses inside their scope.

`doc-coordinator`

- Owns daily scan reports, task state, approval requests, policy interpretation, task decomposition, and final consolidation.
- Does not own SDK-specific content quality.
- Splits approved policy decisions into runnable work owned by domain agents.

`java-sdk-doc-owner`

- Owns Java SDK reference docs end to end.
- Reads Java source changes, drafts or patches Java docs, updates Feishu/bitable plans, and runs Java-relevant verification.

`python-sdk-doc-owner`

- Owns PyMilvus reference docs end to end.
- Handles Python SDK scans, doc updates, examples, and verification.

`go-sdk-doc-owner`

- Owns Milvus Go SDK reference docs end to end.
- Handles Go SDK scans, doc updates, examples, and verification.

`node-sdk-doc-owner`

- Owns Milvus Node.js SDK reference docs end to end.
- Handles Node.js SDK scans, doc updates, examples, and verification.

`cpp-sdk-doc-owner`

- Owns Milvus C++ SDK reference docs end to end.
- Handles C++ SDK scans, doc updates, examples, and verification.

`rest-api-doc-owner`

- Owns Milvus and Zilliz Cloud REST API docs end to end.
- Verifies route/spec/source behavior before proposing doc changes.

`cli-doc-owner`

- Owns Zilliz CLI docs end to end.
- Verifies CLI command definitions, flags, examples, and release changes.

`localization-owner`

- Owns localization parity end to end across configured Feishu wiki roots and bitables.
- Diffs source and target tables, proposes create/update/meta-only/orphan actions, and preserves media/embed handling rules.

`verified-doc-owner`

- Owns source-verified long-form documentation tasks that cut across SDK/API surfaces.
- Builds claim inventories, verifies implementation evidence, drafts docs, and lists unresolved claims.

`review-agent`

- Reviews owner output independently.
- Produces scoped PASS/FAIL findings for correctness, regressions, security, missing verification, localization risk, and Feishu write safety.

`notify-agent`

- Sends progress messages and approval cards.
- Updates cards after decisions and completion.

## Lightweight Repository Access

Agents should not clone or pull every target repository for every run. The system should use a staged access model.

### Stage 1: Metadata Discovery

The daily scan should first use lightweight metadata:

- GitHub Releases API or tags API for latest release/tag checks.
- GitHub compare API for changed file names between the last scanned tag and the latest tag.
- Feishu bitable/doc metadata for source-doc modification checks.
- Existing `scan-state.json` as the local baseline.

This stage produces the daily report and usually does not need a full source checkout.

### Stage 2: Targeted Fetch

Only after a policy is selected should owner agents fetch code needed for their task.

Preferred fetch strategy:

- Use one repository cache per target repo.
- Use shallow or partial fetches where possible.
- Fetch only the relevant tags or commits.
- Use sparse checkout for known source paths when the repo is large.
- Avoid recursive submodules unless a task explicitly needs them.

For GitHub Actions, the implementation can combine:

- `actions/cache` for bare repo mirrors or working directories.
- `git fetch --depth=1 origin <tag-or-sha>` for release snapshots.
- `git fetch origin <old-tag> <new-tag>` for tag diffs.
- `git sparse-checkout` for large repos such as Milvus or Zilliz Cloud.

### Stage 3: Full Checkout Only On Demand

Full checkouts are reserved for tasks that require broad source tracing, live builds, or cross-module behavior verification. The owner agent must record why a full checkout was required.

### Repo State Rules

- The coordinator owns `scan-state.json` updates after successful scan/report cycles.
- Owner agents must not advance scan state merely because they started work.
- A failed or rejected task preserves the old baseline unless the human explicitly chooses to mark it handled.
- Daily reports should distinguish "new source change detected" from "previously detected but not handled."
- If remote metadata is enough to prove there is no change, skip fetching source code entirely.

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

1. Scheduled daily scan.
2. Feishu scan report with findings and policy choices.
3. Human policy choice or custom instruction through Feishu.
4. Coordinator decomposes the decision into runnable owner tasks.
5. One domain owner produces dry-run output for one task type, preferably localization diff or Java SDK doc sync.
6. Feishu approval card for live write or PR creation.
7. Approval gateway callback.
8. GitHub workflow dispatch after approval.
9. Live write or PR creation for the approved task.
10. Independent review, verification, and final Feishu status.

Recommended MVP task type: localization diff dry-run plus manual approval for live localized doc creation/update, owned end to end by `localization-owner`. It exercises Feishu table/doc reads, card approval, controlled Feishu writes, and result verification without needing live SDK runtime environments.

## Out Of Scope For MVP

- Fully autonomous live writes without approval.
- Multi-tenant approval policies.
- Web dashboard.
- Long-running local agent processes.
- Automatic remediation after verifier failures.
- Deleting Feishu docs or bitable records.
- Production live runtime tests without explicit per-run approval.
- Full checkout of every target repository on every scheduled scan.

## Open Questions

1. Which Feishu chat should receive progress messages and cards?
2. Which Feishu users are authorized approvers?
3. Should approved work write directly to Feishu, open a GitHub PR first, or support both by action type?
4. Which task type should be the MVP: SDK doc sync, localization diff, code patching, or verified draft docs?
5. Should the approval gateway be Cloudflare Worker, Vercel, AWS Lambda, or an existing internal service?
6. Which target repositories can rely on GitHub metadata first, and which require source checkout even for daily discovery?
