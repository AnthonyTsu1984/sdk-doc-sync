#!/usr/bin/env bash
# deploy/bootstrap.sh — S2 pod 引导（node:22-bookworm 单容器，跑在 milvus-cell vCluster）。
#
# 职责：装系统依赖（git/python3/ca-certificates/curl/jq）→ gh CLI（官方 tarball）
# → opencode（npm i -g opencode-ai）→ clone 本仓 + 同级 web-content + repos/<SDK>
# 到 PVC /workspace → npm ci → 渲染 opencode.json（LLM_* 用 {env:} 插值、models 键
# 写死）→ AGENTS.md 指针 → per-track BASE_TOKEN 导出 → 种账本 → exec supervisor。
#
# 幂等：/workspace/.bootstrap-done marker 短路重活；但 marker 命中时仍会
#   1) 确保工作目录齐全 2) 重渲染 opencode.json（env 可能随重启变化）
#   3) 重导 BASE_TOKEN（fail-loud）4) 重跑 seed-backlog（import-backlog 天然幂等）。
# 红线：本脚本只 clone/装环境/种账本，绝不推进 scan-state、绝不触 Feishu 写路径。

set -euo pipefail

WORKSPACE="${WORKSPACE:-/workspace}"
REPO="${REPO:-$WORKSPACE/feishu-markdown-bridge}"
REPO_URL="${REPO_URL:-https://github.com/AnthonyTsu1984/sdk-doc-sync.git}"
WEB_CONTENT_URL="${WEB_CONTENT_URL:-https://github.com/milvus-io/web-content.git}"
SDK_REPO="${SDK_REPO:?SDK_REPO env is required (e.g. pymilvus)}"
SDK_ORG="${SDK_ORG:-milvus-io}"
SDK_REPO_URL="${SDK_REPO_URL:-https://github.com/${SDK_ORG}/${SDK_REPO}.git}"
LANGUAGE="${LANGUAGE:?LANGUAGE env is required}"
MARKER="$WORKSPACE/.bootstrap-done"
LOG_FILE="$WORKSPACE/logs/bootstrap.log"
EVENTS_FILE="$WORKSPACE/logs/events.jsonl"

mkdir -p "$WORKSPACE/logs" "$WORKSPACE/runs" "$WORKSPACE/inbound"
exec >> >(tee -a "$LOG_FILE") 2>&1

log()  { printf '[bootstrap %s] %s\n' "$(date -Is)" "$*"; }
fail() { printf '[bootstrap %s] FAIL: %s\n' "$(date -Is)" "$*" >&2; exit 1; }

event() { # event <name> [key=value ...] —— JSON 事件走 lib.js（转义安全）
  local name="$1"; shift
  local args=(--file "$EVENTS_FILE" --event "$name")
  local kv
  for kv in "$@"; do
    case "$kv" in
      slot=*)  args+=(--slot "${kv#slot=}") ;;
      track=*) args+=(--track "${kv#track=}") ;;
      code=*)  args+=(--code "${kv#code=}") ;;
      exit=*)  args+=(--exit "${kv#exit=}") ;;
      count=*) args+=(--count "${kv#count=}") ;;
    esac
  done
  node "$REPO/deploy/lib.js" emit-event "${args[@]}" 2>/dev/null || true
}

log "bootstrap start (language=$LANGUAGE sdk=$SDK_REPO workspace=$WORKSPACE)"

# ---------- 0. 必需 env fail-loud（secret sdk-env 的最小子集） ----------
# openai-compatible 的 baseURL 必须带 /v1 尾缀（lib.js normalizeLlmBaseUrl 同款语义；
# 裸域名网关会让 /chat/completions 撞登录页/403——2026-10-24 首战实测）
case "$LLM_BASE_URL" in
  */v[0-9]) ;;
  *) export LLM_BASE_URL="${LLM_BASE_URL%/}/v1"; log "normalize LLM_BASE_URL -> $LLM_BASE_URL" ;;
esac
for var in LLM_BASE_URL LLM_API_KEY LLM_MODEL GITHUB_TOKEN; do
  [ -n "${!var:-}" ] || fail "$var is empty — secret sdk-env 缺键或 envFrom 未生效"
done

# ---------- 1. 系统依赖（marker 命中也查一遍，apt 幂等） ----------
if ! command -v git >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1 \
  || ! command -v curl >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
  log "apt-get install git python3 ca-certificates curl jq"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends git python3 ca-certificates curl jq
else
  log "apt dependencies present, skip install"
fi

# ---------- 2. gh CLI（官方 tarball；GH_TOKEN=GITHUB_TOKEN 免登录） ----------
if ! command -v gh >/dev/null 2>&1; then
  GH_TAG="$(curl -fsSL -o /dev/null -w '%{url_effective}' https://github.com/cli/cli/releases/latest | sed 's#.*/tag/##')"
  [ -n "$GH_TAG" ] || fail "cannot resolve gh latest release tag"
  case "$(uname -m)" in
    x86_64) GH_ARCH=amd64 ;;
    aarch64 | arm64) GH_ARCH=arm64 ;;
    *) fail "unsupported arch: $(uname -m)" ;;
  esac
  log "install gh ${GH_TAG} (${GH_ARCH}) from official tarball"
  curl -fsSL "https://github.com/cli/cli/releases/download/${GH_TAG}/gh_${GH_TAG#v}_linux_${GH_ARCH}.tar.gz" -o /tmp/gh.tgz
  mkdir -p /tmp/gh-extract && tar -xzf /tmp/gh.tgz -C /tmp/gh-extract --strip-components=1
  install -m 0755 /tmp/gh-extract/bin/gh /usr/local/bin/gh
  rm -rf /tmp/gh.tgz /tmp/gh-extract
else
  log "gh present: $(gh --version | head -n1)"
fi
export GH_TOKEN="$GITHUB_TOKEN"

# ---------- 3. opencode（npm 全局；装后 --version 打标） ----------
if ! command -v opencode >/dev/null 2>&1; then
  log "npm i -g opencode-ai"
  npm install -g --silent opencode-ai
fi
OPENCODE_VERSION="$(opencode --version)" || fail "opencode --version failed after install"
log "opencode $OPENCODE_VERSION ready"

# ---------- 4. clone 三仓（幂等：在库即跳过；SDK 用浅克隆省 PVC） ----------
clone_if_missing() { # clone_if_missing <url> <dir>
  local url="$1" dir="$2"
  if [ -d "$dir/.git" ]; then
    log "clone present: $dir"
  else
    log "git clone $url -> $dir"
    git clone --quiet "$url" "$dir" || fail "git clone failed: $url"
  fi
}
clone_if_missing "$REPO_URL" "$REPO"
clone_if_missing "$WEB_CONTENT_URL" "$WORKSPACE/web-content"   # profile shared.webContentDir = ../web-content（相对 repo 根）
clone_if_missing "$SDK_REPO_URL" "$REPO/repos/${SDK_REPO}"     # profile languages.<lang>.sdkDir = repos/<sdk>

# ---------- 5. npm ci（本仓依赖；marker 命中且 node_modules 在则跳过） ----------
if [ -f "$MARKER" ] && [ -d "$REPO/node_modules" ]; then
  log "npm ci skipped (marker + node_modules present)"
else
  log "npm ci in $REPO"
  (cd "$REPO" && npm ci --no-audit --no-fund) || fail "npm ci failed"
fi

# ---------- 6. 渲染 opencode.json（每次启动重渲染；models 键=当时 LLM_MODEL） ----------
log "render opencode.json (provider=custom, {env:} interpolation)"
node "$REPO/deploy/lib.js" render-opencode-json > "$REPO/opencode.json" \
  || fail "opencode.json render failed（LLM_MODEL 缺失?）"

# ---------- 7. AGENTS.md 指针（opencode 项目指令；已存在不覆盖人工内容） ----------
if [ ! -f "$REPO/AGENTS.md" ]; then
  cat > "$REPO/AGENTS.md" <<'AGENTS'
# AGENTS.md — S2 worker 会话入口指针（bootstrap 生成）

你是本仓（feishu-markdown-bridge / sdk-doc-sync）的治理 worker 会话。一切以盘上
durable 状态与 canonical CLI 输出为准，勿凭记忆续接。

- 完整技能书：`.claude/skills/api-reference-sync/SKILL.md`（§Domain Workflow 1–3
  与 §Required References 必读；其余按需考古）。
- 每次派出/续接都会带一份确定性简报（`buildTrackIntakeBrief` 产物）：简报就是你的
  初始任务上下文，按简报工作指令执行。
- 铁律（照抄仓库治理语汇，违者产物作废）：
  1. 执行中绝不删除 journal 重放；
  2. 写路径只走 canonical CLI；
  3. scan-state 只由 close-session/finalize 推进。
- 回合契约：一回合 = 派出/续接 → 干活 → 停在下一道门或终态。门后必停、绝不自批；
  批准只有落成回执才生效；回合产物（journal/manifest/回执）先落规范位再结束回合。
- 工作空间契约：治理工件进 `tmp/api-reference-sync/`，扫描与 intake 进
  `tmp/sdk-release-scout/`，战役 run 进 `tmp/sdk-doc-sync-runs/`。
AGENTS
  log "AGENTS.md written"
else
  log "AGENTS.md present, keep"
fi

# ---------- 8. per-track BASE_TOKEN 导出（fail-loud；BASE_TOKEN 教训） ----------
# 结论：release-tracks.json 机器可读、每轨带 bitable.baseToken，无需操作员补 env。
# 导出成 /workspace/runs/track-env/<version>.env（supervisor 按 slot eval）。
TRACKS="${TRACKS:?TRACKS env is required (e.g. 'v3.0.x,v2.6.x')}"
TRACK_ENV_DIR="$WORKSPACE/runs/track-env"
mkdir -p "$TRACK_ENV_DIR"
IFS=',' read -r -a TRACK_LIST <<< "$TRACKS"
for track in "${TRACK_LIST[@]}"; do
  track="$(echo "$track" | tr -d '[:space:]')"
  [ -n "$track" ] || continue
  err_file="$WORKSPACE/runs/track-env/${track}.err"
  if line="$(node "$REPO/deploy/lib.js" track-env --language "$LANGUAGE" --track "$track" 2>"$err_file")" \
    && case "$line" in BASE_TOKEN=[A-Za-z0-9]*) true ;; *) false ;; esac; then
    printf '%s\n' "$line" > "$TRACK_ENV_DIR/${track}.env"
    track_key="$(sed -n 's/^trackKey=//p' "$err_file")"
    log "BASE_TOKEN exported for $track (trackKey=${track_key:-unknown})"
  else
    # fail-loud：typed 占位文件 + 退出非零，绝不带着空 BASE_TOKEN 进 supervisor。
    printf '# BASE_TOKEN_UNAVAILABLE\n%s\n' "$(cat "$err_file" 2>/dev/null || echo 'track-env invocation failed')" > "$TRACK_ENV_DIR/${track}.env"
    event bootstrap_basetoken_failed "track=$track" "code=BASE_TOKEN_UNAVAILABLE"
    fail "BASE_TOKEN unavailable for $LANGUAGE/$track：release-tracks.json 不可读或该轨无 bitable.baseToken（见 $TRACK_ENV_DIR/${track}.env）"
  fi
done

# ---------- 9. 种账本（幂等）＋ marker ----------
if [ -x /opt/scripts/seed-backlog.sh ]; then
  /opt/scripts/seed-backlog.sh || fail "seed-backlog failed"
else
  fail "/opt/scripts/seed-backlog.sh missing — configmap-scripts 挂载不完整"
fi
touch "$MARKER"
event bootstrap_done "track=$TRACKS"
log "bootstrap done — exec supervisor"

# ---------- 10. 前台交棒 ----------
exec /opt/scripts/supervisor.sh
