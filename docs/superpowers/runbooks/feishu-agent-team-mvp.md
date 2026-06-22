# Feishu Agent Team MVP Runbook

## Required Secrets

GitHub Actions secrets:

- `DOC_AGENT_CONFIG_JSON`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_WIKI_SPACE_ID`
- `ANTHROPIC_API_KEY` when translator is `claude`

Local approval consumer environment:

- `GITHUB_TOKEN`

## Setup

1. Copy `.claude/agent-team/config.example.json`.
2. Fill real Feishu chat, approver, source/target base tokens, `sourceTableIds`, `targetTableIds`, root tokens, GitHub, and approval consumer values.
3. Keep SDK reference, REST reference, CLI reference, guide-doc, and verified-doc surfaces present but disabled until their owners are implemented.
4. Store the filled JSON as GitHub secret `DOC_AGENT_CONFIG_JSON`.
5. Put the same config file at `.claude/agent-team/config.json` on the machine that runs the local consumer.
6. Run `lark-cli auth login` if needed and verify `lark-cli event consume im.message.receive_v1 --as bot --max-events 1 --timeout 30s` can receive events.
7. Start `.claude/agent-team/bin/doc-agent-approval-consumer.js` under `launchd`, `systemd`, or another supervisor with `GITHUB_TOKEN` in its environment.
8. Run `Doc Agent Scan` manually from GitHub Actions.

## Expected MVP Flow

1. `Doc Agent Scan` posts a Feishu daily report card.
2. Approver replies in the configured Feishu chat with `dry-run <task-id> <source-run-id>` or `patch <task-id> <source-run-id>`.
3. Local approval consumer receives the Feishu event and dispatches the dry-run workflow.
4. Dry-run workflow uploads artifacts and sends a concrete live-write approval card when there are actionable records.
5. Approver replies `approve <task-id> <source-run-id>`.
6. Local approval consumer dispatches the live-write workflow.
7. Live-write workflow updates approved Feishu docs/records and verifies the result.

## Safety Rules

- Do not use live-write workflow without a reviewed dry-run artifact.
- Do not approve `ORPHAN` deletion; MVP never deletes or archives target docs.
- Duplicate approval replies must not cause duplicate writes.
- If verification fails, preserve artifacts and do not advance the handled baseline.
- Broken `mention_doc` references and normal links are reported during scan and verification; fixes still require explicit approval.
