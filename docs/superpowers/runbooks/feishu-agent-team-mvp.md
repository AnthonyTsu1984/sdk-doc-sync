# Feishu Agent Team MVP Runbook

## Required Secrets

GitHub Actions secrets:

- `DOC_AGENT_CONFIG_JSON`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_WIKI_SPACE_ID`
- `CODEX_CONFIG_TOML` when `agentRuntime.enabled` uses Codex in GitHub Actions
- `CODEX_OPENAI_API_KEY` for the Codex model provider configured by `CODEX_CONFIG_TOML`
- Translator-specific key only when the localization `translator` requires one, for example `ANTHROPIC_API_KEY` for `claude` or `DEEPL_API_KEY` for `deepl`

Local approval consumer environment:

- `GITHUB_TOKEN`

## Setup

1. Copy `.claude/agent-team/config.example.json`.
2. Fill real Feishu chat, approver, source/target base tokens, `sourceTableIds`, `targetTableIds`, root tokens, GitHub, and approval consumer values.
3. Keep SDK reference, REST reference, CLI reference, guide-doc, and verified-doc surfaces present but disabled until their owners are implemented.
4. Store the filled JSON as GitHub secret `DOC_AGENT_CONFIG_JSON`.
5. For Codex custom providers, store a minimal Codex config as GitHub secret `CODEX_CONFIG_TOML`, for example:

   ```toml
   model_provider = "custom"

   [model_providers.custom]
   name = "custom"
   wire_api = "responses"
   requires_openai_auth = true
   base_url = "https://YOUR_PROVIDER_BASE_URL/v1"
   ```

6. Store the provider key as GitHub secret `CODEX_OPENAI_API_KEY`; the workflow exposes it to Codex as `OPENAI_API_KEY`.
7. If `agentRuntime.enabled` is `true`, keep `agentRuntime.command` as `codex` in GitHub Actions. The workflows install the Codex CLI with `npm install -g @openai/codex`.
8. Keep localization `translator` set to `feishu` unless you explicitly want another translation backend. Codex is the owner-agent runtime in this MVP; it is not currently the document translation engine.
9. Put the same config file at `.claude/agent-team/config.json` on the machine that runs the local consumer.
10. Run `lark-cli auth login` if needed and verify `lark-cli event consume im.message.receive_v1 --as bot --max-events 1 --timeout 30s` can receive events.
11. Start `.claude/agent-team/bin/doc-agent-approval-consumer.js` under `launchd`, `systemd`, or another supervisor with `GITHUB_TOKEN` in its environment.
12. Run `Doc Agent Scan` manually from GitHub Actions.

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

## ztrans Lark Interface

The configured bot is called `ztrans` in the Lark approval chat.

Users can still reply with raw commands from the cards, but the preferred form is:

- `@ztrans dry run <task-id> <source-run-id>`
- `@ztrans patch <task-id> <source-run-id>`
- `@ztrans approve <task-id> <source-run-id>`
- `@ztrans reject <task-id> <source-run-id>`
- `@ztrans changes <task-id> <source-run-id>: <instruction>`
- `@ztrans help`

Cards list affected document titles grouped by action type. Long groups are capped in the card; use the workflow artifact `summary.md` for the full list.
