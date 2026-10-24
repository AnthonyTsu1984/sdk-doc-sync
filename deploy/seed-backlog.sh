#!/usr/bin/env bash
# deploy/seed-backlog.sh — 从 ConfigMap 挂载点 /opt/backlog 种 findings 账本（幂等）。
#
# 走 canonical 入口：daily-scan.js --import-backlog（batch 17 §5 窗口导入动词）。
# import-backlog 对已在账的 prNumber 只做 languages 并集（merged），天然幂等，
# bootstrap 每次启动重跑亦安全。绝不触碰 scan-state / Feishu / dry-run。

set -euo pipefail

WORKSPACE="${WORKSPACE:-/workspace}"
REPO="${REPO:-$WORKSPACE/feishu-markdown-bridge}"
LANGUAGE="${LANGUAGE:?LANGUAGE env is required}"
BACKLOG_DIR="${BACKLOG_DIR:-/opt/backlog}"
BACKLOG_FILE="$BACKLOG_DIR/${LANGUAGE}.jsonl"

if [ ! -f "$BACKLOG_FILE" ]; then
  printf '[seed-backlog] SKIP: no backlog file for %s at %s\n' "$LANGUAGE" "$BACKLOG_FILE"
  exit 0
fi

cd "$REPO"
printf '[seed-backlog] importing %s -> %s\n' "$BACKLOG_FILE" "tmp/api-reference-sync/daily-scan/pr-findings.jsonl"
node .claude/skills/api-reference-sync/scripts/daily-scan.js --import-backlog --file "$BACKLOG_FILE"
printf '[seed-backlog] done (idempotent merge)\n'
