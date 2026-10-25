#!/usr/bin/env bash
# deploy/supervisor.sh — S2 pod 主进程（bootstrap 末尾 exec 到这里）。
#
# 一轨一 pod（2026-10-25 拓扑裁定）：本 pod 只跑 TRACK 指定的一条版本轨
# （如 python 的 v3.0.x 与 v2.6.x = 两个 pod）。无 slot、无跨轨串行守卫——
# 轨道竞态（SDK 检出钉不同 commit / 同语言文档树并发写）由 pod 边界隔离。
#
# 五件事（单进程轮询，无嵌套守护）：
#   ① 每 30 分钟跑 daily-scan --language $LANGUAGE（发现+账本自维护，只读哨兵）
#   ② 账本 pending>0 且本轨空闲 → 起战役：buildTrackIntakeBrief 简报 +
#      `opencode run --format json`（四段提示词）
#   ③ 战役常驻卡（本轨一张飞书交互卡，supervisor 是卡的所有者）：派单/呈门/
#      批准/让出/终态各钩子经 deploy/lib.js campaign-card 追加时间轴并 PATCH 同
#      一张卡（状态 /workspace/runs/card-<trackKey>.json 持有 messageId；战役概况
#      三件套首呈门捕获后持久在卡面；当前门按钮长在卡上，清门即消失）。
#   ④ 批准队列：/workspace/inbound/approve.queue 首行匹配
#      ^APPROVE_[A-Z]+( \S+)? sha256:[0-9a-f]{64}$ → `opencode run -s <ses>` 续跑
#   ⑤ 全部动作 append logs/supervisor.log + logs/events.jsonl 一行 JSON 事件
#
# 红线：本进程不推进 scan-state（只由 close-session/finalize 推进）、不代替操作员
# 批准（门后必停）、不重写账本 fold（pending 计数走 canonical daily-scan-core）。
# 会话续接用 `-s <ses_…>`（--format json 事件携带 sessionID，已实测）。

set -uo pipefail

WORKSPACE="${WORKSPACE:-/workspace}"
REPO="${REPO:-$WORKSPACE/feishu-markdown-bridge}"
LANGUAGE="${LANGUAGE:?LANGUAGE env is required}"
SDK_REPO="${SDK_REPO:?SDK_REPO env is required}"
TRACK="${TRACK:?TRACK env is required (single version track, e.g. 'v3.0.x')}"
POD_NAME="${POD_NAME:-${HOSTNAME:-unknown}}"
SCAN_INTERVAL="${SCAN_INTERVAL:-1800}"
POLL_INTERVAL="${POLL_INTERVAL:-20}"
CAMPAIGN_GRACE_SECS="${CAMPAIGN_GRACE_SECS:-21600}"   # 战役停门后无批准注入的宽限期（人工门节奏=小时级），过即让出轨道
LIB="$REPO/deploy/lib.js"
SCAN_CLI=".claude/skills/api-reference-sync/scripts/daily-scan.js"
LEDGER="tmp/api-reference-sync/daily-scan/pr-findings.jsonl"
GATE_DIR="$REPO/tmp/api-reference-sync/gate-presentation"
INBOUND="$WORKSPACE/inbound"
RUNS="$WORKSPACE/runs"
LOGS="$WORKSPACE/logs"
SUPERVISOR_LOG="$LOGS/supervisor.log"
EVENTS_FILE="$LOGS/events.jsonl"
QUEUE="$INBOUND/approve.queue"
SESSION_FILE="$RUNS/campaign.session"
RESUME_ANCHOR="$RUNS/.resume-anchor"
PARKED="$RUNS/parked"

mkdir -p "$LOGS" "$RUNS" "$INBOUND"
exec >> >(tee -a "$SUPERVISOR_LOG") 2>&1

log() { printf '[supervisor %s] %s\n' "$(date -Is)" "$*"; }
die() { printf '[supervisor %s] FATAL: %s\n' "$(date -Is)" "$*" >&2; exit 1; }

# 一轨一 pod（2026-10-25 拓扑裁定）：多轨 = 多 pod，绝不在一个 pod 里塞两条轨。
case "$TRACK" in
  *,*) die "TRACK must be a single version track（一轨一 pod）——多轨请各起一个 pod: $TRACK" ;;
esac

event() { # event <name> [key=value ...]（JSON 转义在 lib.js 内做）
  local name="$1"; shift
  local args=(--file "$EVENTS_FILE" --event "$name")
  local kv
  for kv in "$@"; do
    case "$kv" in
      track=*)  args+=(--track "${kv#track=}") ;;
      code=*)   args+=(--code "${kv#code=}") ;;
      exit=*)   args+=(--exit "${kv#exit=}") ;;
      count=*)  args+=(--count "${kv#count=}") ;;
      detail=*) args+=(--detail "${kv#detail=}") ;;
      messageId=*) args+=(--message-id "${kv#messageId=}") ;;
    esac
  done
  node "$LIB" emit-event "${args[@]}" 2>>"$SUPERVISOR_LOG" || log "WARN: emit-event failed ($name)"
}

# ---------- 战役常驻卡（卡操作唯一收口=campaign-card；bash 保持薄） ----------
gate_label() { # gate_label <GATE_NAME> → 中文门名（GATE_LABELS_ZH 单源在 lib.js，
  local label  # 防 bash case 双真相；查询失败回退英文名原样，绝不空门名进卡）
  label="$(node "$LIB" gate-label --gate "$1" 2>>"$SUPERVISOR_LOG")" \
    && printf '%s' "$label" || printf '%s' "$1"
}

campaign_card() { # campaign_card [campaign-card 其余参数...]（状态 card-<trackKey>.json）
  node "$LIB" campaign-card \
    --state "$RUNS/card-${TRACK_KEY}.json" --repo-root "$REPO" \
    --pod "$POD_NAME" --track-key "$TRACK_KEY" --language "$LANGUAGE" \
    --open-id-cache "$RUNS/operator-openid" "$@" 2>>"$SUPERVISOR_LOG"
}

# ---------- 本轨身份：TRACK → trackKey（registryTrackKey，scanStateKey 覆写优先） ----------
TRACK_KEY=""
TRACK_KEY="$(node "$LIB" track-env --language "$LANGUAGE" --track "$TRACK" 2>&1 >/dev/null | sed -n 's/^trackKey=//p')"
[ -n "$TRACK_KEY" ] || die "trackKey derivation failed for $LANGUAGE/$TRACK（release-tracks 注册表缺该轨？）"
TRACK_ENV_FILE="$RUNS/track-env/${TRACK}.env"

# 本轨唯一战役的进程态（pod 重启即失效——启动清场兜底）
CAMPAIGN_PID=""
CAMPAIGN_RUN=""
CAMPAIGN_TRACKKEY=""   # 派出后填（reap/宽限释放用；与 TRACK_KEY 恒等，保留以防派生失败回退）

pending_count() { # canonical fold（daily-scan-core）；账本缺失自愈重种后重试一次
  local ledger="$REPO/$LEDGER"
  if [ ! -f "$ledger" ]; then
    log "ledger missing — re-run seed-backlog (self-heal)"
    /opt/scripts/seed-backlog.sh >>"$SUPERVISOR_LOG" 2>&1 || true
  fi
  [ -f "$ledger" ] || { echo 0; return 0; }
  node "$LIB" pending-count --ledger "$ledger" --language "$LANGUAGE" 2>/dev/null || echo 0
}

# ---------- ① 每日扫描（30 分钟节流；只读哨兵，水位/账本自维护） ----------
run_scan() {
  log "daily-scan start (language=$LANGUAGE)"
  local out="$RUNS/last-scan.out" err="$RUNS/last-scan.err" rc
  if (cd "$REPO" && GH_TOKEN="${GITHUB_TOKEN:-}" node "$SCAN_CLI" --language "$LANGUAGE" --json >"$out" 2>"$err"); then
    rc=0
  else
    rc=$?
  fi
  local pending
  pending="$(pending_count)"
  log "daily-scan exit=$rc pending=$pending（detail: $out / $err）"
  event scan_done "exit=$rc" "count=$pending"
}

# ---------- ② 起战役（本轨空闲 + pending>0） ----------
dispatch_campaign() {
  # 战役/resume 在跑绝不重复派——保护 CAMPAIGN_PID 不被覆盖。
  if [ -n "$CAMPAIGN_PID" ] && kill -0 "$CAMPAIGN_PID" 2>/dev/null; then
    return 0
  fi
  # 宽限等待中（停门等批）不重派；批准注入会清 PARKED 恢复推进。
  [ -e "$PARKED" ] && return 0

  local pending; pending="$(pending_count)"
  [ "$pending" -gt 0 ] || return 0

  local track_key="$TRACK_KEY"
  CAMPAIGN_TRACKKEY="$track_key"

  local ts rundir
  ts="$(date +%Y%m%d-%H%M%S)"
  rundir="$RUNS/${ts}-${track_key}"
  mkdir -p "$rundir"

  # 简报：buildTrackIntakeBrief（仓库看板同源）；失败 fail-loud 不派。
  if ! node -e '
      const { buildTrackIntakeBrief } = require(process.argv[1]);
      const r = buildTrackIntakeBrief({ repoRoot: process.argv[2], language: process.argv[3], trackKey: process.argv[4] });
      if (!r.ok) { process.stderr.write(r.error + "\n"); process.exit(1); }
      process.stdout.write(r.text);
    ' "$REPO/scripts/dashboard/intake-brief.js" "$REPO" "$LANGUAGE" "$track_key" > "$rundir/brief.md"; then
    event dispatch_failed "track=$TRACK" "code=BRIEF_FAILED"
    log "FAIL: brief generation failed for $track_key — see node stderr above"
    rm -rf "$rundir"
    return 1
  fi

  # 来源三件套之一（战役概况）：派单时从账本提取本轨 pending PR 清单落
  # rundir/source.json，呈门时经 gate-presentation --source 透传进常驻卡概况。
  # repo-scan 形态占位（daily-scan 只有 PR 账本）：接入仓库扫描来源时在此分叉，
  # 写 {origin:"repo-scan",baselineTag:<tag>,targetTag:<tag>}。
  if ! node -e '
      const fs = require("node:fs");
      const { extractBacklogEntries } = require(process.argv[1]);
      const lines = fs.readFileSync(process.argv[2], "utf8").split("\n").filter((line) => line.trim());
      const events = lines.map((line) => JSON.parse(line));
      const prs = extractBacklogEntries(events, process.argv[3])
        .map((entry) => ({ number: entry.prNumber, url: entry.url, title: entry.title }));
      fs.writeFileSync(process.argv[4], `${JSON.stringify({ origin: "pr-intake", prs })}\n`);
    ' "$LIB" "$REPO/$LEDGER" "$LANGUAGE" "$rundir/source.json" 2>>"$SUPERVISOR_LOG"; then
    printf '%s\n' '{"origin":"pr-intake","prs":[]}' > "$rundir/source.json"
    log "WARN: source.json extraction failed — wrote empty pr-intake snapshot for $track_key"
  fi

  # 四段提示词（镜像 scripts/dashboard/server.js buildHeadlessPrompt）：
  # 执行会话声明 / 只读侦察可做+APPROVE_* 门必停 / --- / 简报正文。
  {
    printf '%s\n' '你是本战役的新执行会话（由 S2 pod supervisor 一键派出）。下面是确定性生成的战役简报——它是你的初始任务上下文；一切以盘上 durable 状态与 canonical CLI 输出为准，勿凭记忆续接。'
    printf '%s\n' '按简报中的续接规则开始工作：只读侦察可立即进行；遇到 APPROVE_* 门禁必须停下，等待操作员以简报给出的精确 digest 行批准后再继续。'
    printf '%s\n' "呈门产出（.claude/skills/api-reference-sync/scripts/gate-presentation.js）必须带 --source $rundir/source.json —— 战役常驻卡的概况三件套由它透传。"
    printf '%s\n' '---'
    cat "$rundir/brief.md"
  } > "$rundir/prompt.md"

  # BASE_TOKEN 必须是本轨的 base（bootstrap 已导出 track-env/<version>.env）。
  if [ ! -s "$TRACK_ENV_FILE" ] || ! head -n1 "$TRACK_ENV_FILE" | grep -Eq '^BASE_TOKEN=[A-Za-z0-9]+$'; then
    event dispatch_failed "track=$TRACK" "code=BASE_TOKEN_UNAVAILABLE"
    log "FAIL: $TRACK_ENV_FILE missing/invalid — bootstrap per-track export failed"
    return 1
  fi

  # 派出（后台）：session 落 --format json 事件流，reap 时提取 sessionID。
  log "dispatch track=$track_key run=$rundir (pending=$pending)"
  (
    cd "$REPO" || exit 127
    GH_TOKEN="${GITHUB_TOKEN:-}" BASE_TOKEN="$(sed -n 's/^BASE_TOKEN=//p' "$TRACK_ENV_FILE")" \
      opencode run -m "${OPENCODE_PROVIDER_KEY:-custom}/${LLM_MODEL}" \
      --title "S2 ${track_key} ${ts}" --format json \
      "$(cat "$rundir/prompt.md")" > "$rundir/opencode.jsonl" 2> "$rundir/opencode.err"
  ) &
  CAMPAIGN_PID=$!
  CAMPAIGN_RUN="$rundir"
  event campaign_started "track=$track_key" "count=$pending"
  # 常驻卡首事件（无 card state → 发新卡并记 messageId；已有 → PATCH 追加时间轴）。
  # 来源描述与 rundir/source.json 的 origin 同口径（pr-intake 带条数，repo-scan 占位）。
  local card_origin card_note
  card_origin="$(sed -n 's/.*"origin":"\([^"]*\)".*/\1/p' "$rundir/source.json" 2>/dev/null)"
  if [ "$card_origin" = "repo-scan" ]; then
    card_note="▶️ 派单 ${track_key}（repo-scan）"
  else
    card_note="▶️ 派单 ${track_key}（PR intake $pending 条）"
  fi
  if campaign_card --new-campaign --event "$card_note"; then
    log "campaign card updated for $track_key（dispatch timeline）"
  else
    log "WARN: campaign-card dispatch event failed for $track_key（BOT_*/网络；不影响战役本体）"
  fi
  return 0
}

# ---------- 回收：战役进程退出 → 提取 sessionID、记录、进入停门宽限 ----------
reap_campaign() {
  local pid rc rundir ses
  [ -n "$CAMPAIGN_PID" ] || return 0
  kill -0 "$CAMPAIGN_PID" 2>/dev/null && return 0
  wait "$CAMPAIGN_PID"; rc=$?
  rundir="${CAMPAIGN_RUN:-}"
  ses=""
  if [ -s "$rundir/opencode.jsonl" ]; then
    ses="$(node -e '
        const { extractSessionId } = require(process.argv[1]);
        const fs = require("node:fs");
        process.stdout.write(extractSessionId(fs.readFileSync(process.argv[2], "utf8")) ?? "");
      ' "$LIB" "$rundir/opencode.jsonl")"
  fi
  if [ -n "$ses" ]; then
    printf '%s\n' "$ses" > "$SESSION_FILE"
    log "campaign exit=$rc session=$ses（armed for approve resume）"
    # resume 退出且期间没有新呈门（anchor 之后零 index.json）= 战役终态
    # （close-session 完成或死亡）——立即结束宽限；若实为死亡，该轨 findings
    # 未处置，会在下一轮空闲时重派（首次派单无门退出仍走宽限退避，无热循环）。
    case "$rundir" in
      *-resume-*)
        if [ -e "$RESUME_ANCHOR" ]; then
          local ng; ng="$(find "$GATE_DIR" -name '*.index.json' ! -name 'latest-index.json' -newer "$RESUME_ANCHOR" 2>/dev/null | wc -l)"
          rm -f "$RESUME_ANCHOR"
          if [ "$ng" -eq 0 ]; then
            # 终态路径：常驻卡记 ✔ + 清门（按钮消失、header 转【已完成】）。
            campaign_card --terminal --cleared-gate \
              --event "✔ 战役终态，轨道释放" \
              || log "WARN: campaign-card terminal event failed for ${CAMPAIGN_TRACKKEY}"
            rm -f "$PARKED" "$SESSION_FILE"
            log "resume exit with no new gate — track ${CAMPAIGN_TRACKKEY} terminal"
            event campaign_terminal "track=${CAMPAIGN_TRACKKEY}"
          fi
        fi
        ;;
    esac
  else
    log "campaign exit=$rc — sessionID NOT captured（approve resume 不可用，见 opencode.err）"
    event session_capture_failed "track=${CAMPAIGN_TRACKKEY}" "exit=$rc"
  fi
  event campaign_exit "track=${CAMPAIGN_TRACKKEY}" "exit=$rc"
  # 轨道宽限：宽限期内等批准注入；过点且无队列行则让出（允许重派）。
  printf '%s\n' "$(( $(date +%s) ))" > "$PARKED"
  CAMPAIGN_PID=""
}

# ---------- ②′ 宽限过点 → 让出轨道（允许再派；pending 仍>0 时新会话按盘上状态续办） ----------
expire_parked() {
  # resume 进行中不让出
  [ -n "$CAMPAIGN_PID" ] && kill -0 "$CAMPAIGN_PID" 2>/dev/null && return 0
  [ -f "$PARKED" ] || return 0
  [ -s "$QUEUE" ] && return 0   # 有待注入批准，继续等
  local age=$(( $(date +%s) - "$(cat "$PARKED")" ))
  if [ "$age" -ge "$CAMPAIGN_GRACE_SECS" ]; then
    # 让出路径：常驻卡记 ⏱️ + 清门（宽限过期，当前门不再等待批准）。
    campaign_card --cleared-gate --event "⏱️ 宽限过期，轨道让出" \
      || log "WARN: campaign-card release event failed for $TRACK_KEY"
    rm -f "$PARKED" "$SESSION_FILE"
    log "track=$TRACK_KEY grace elapsed (${age}s) — released"
    event track_released "track=$TRACK_KEY"
  fi
}

# ---------- ③ 门铃巡检（新 index.json → 战役常驻卡「当前门」区块 + 按钮） ----------
# 一轨一 pod：本 pod 检出里的一切呈门工件都属本轨（TRACK_KEY）——无归因歧义，
# 旧 slot 反解/启发式归因已随 slot 模型删除。呈报路径=常驻卡 PATCH（时间轴加 ⚑ +
# currentGate 换新门 + 按钮重挂；概况三件套首次呈门时捕获、此后常驻）。
gate_watch() {
  [ -d "$GATE_DIR" ] || return 0
  local seen="$RUNS/seen-gates.txt" f index_id gate_name gate_zh card_out msg_id
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    grep -qxF "$f" "$seen" 2>/dev/null && continue
    printf '%s\n' "$f" >> "$seen"
    index_id="${f#"$GATE_DIR"/}"
    log "gate presentation detected: $f（track=$TRACK_KEY 归因=一轨一 pod）"
    gate_name="$(node -e 'try { process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).gate ?? "")); } catch {}' "$f")"
    gate_zh="$(gate_label "$gate_name")"
    if card_out="$(campaign_card --presentation "$f" --index-id "$index_id" \
        --event "⚑ ${gate_zh}呈报")"; then
      msg_id="$(printf '%s\n' "$card_out" | sed -n 's/^messageId=//p')"
      event gate_presented "track=$TRACK_KEY" "detail=$f" "messageId=$msg_id"
    else
      event gate_present_failed "track=$TRACK_KEY" "detail=$f"
      log "WARN: campaign-card gate update failed for $f（BOT_*/OPERATOR_EMAIL 或网络；看板仍可见 latest-index.json）"
    fi
  done < <(find "$GATE_DIR" -name '*.index.json' ! -name 'latest-index.json' -type f | sort)
}

# ---------- ④ 批准队列（首行过正则 → opencode run -s 续跑本轨会话） ----------
# 出队纪律：peek → 校验 → 决定后才 pop。战役忙/无 armed session 时批准行留在队列
# 原地等待，绝不出队作废（操作员批复是人工动作，不可静默丢弃）。
queue_first_line() { # queue_first_line <pop|peek> <file>
  local mode="$1" file="$2" line
  exec 9>>"${file}.lock"
  flock 9
  line="$(head -n 1 "$file" 2>/dev/null || true)"
  if [ "$mode" = "pop" ] && [ -n "$line" ]; then
    # 原子换文件：tmp 只装剩余行（首行由此真正出队）。
    if ! sed '1d' "$file" > "${file}.tmp"; then
      printf '' > "${file}.tmp"
    fi
    mv "${file}.tmp" "$file"
  fi
  exec 9>&-
  printf '%s' "$line"
}

handle_approve_queue() {
  local line verdict ses rundir
  [ -s "$QUEUE" ] || return 0
  line="$(queue_first_line peek "$QUEUE")"
  [ -n "$line" ] || return 0
  verdict="$(node "$LIB" validate-approve-line --line "$line" 2>/dev/null || true)"
  if [ -z "$verdict" ]; then
    queue_first_line pop "$QUEUE" >/dev/null   # 正则不过 = 垃圾行，出队+typed 事件
    event approve_line_invalid "code=APPROVE_LINE_INVALID"
    log "WARN: queue line rejected by APPROVE regex, dropped: $(printf '%s' "$line" | head -c 80)"
    return 0
  fi
  if [ -n "$CAMPAIGN_PID" ] && kill -0 "$CAMPAIGN_PID" 2>/dev/null; then
    event approve_deferred
    log "campaign busy — approve stays queued (peek only)"
    return 0
  fi
  ses="$(cat "$SESSION_FILE" 2>/dev/null || true)"
  if [ -z "$ses" ]; then
    queue_first_line pop "$QUEUE" >/dev/null
    event approve_no_session "code=SESSION_NOT_ARMED"
    log "WARN: approve arrived but no armed session（战役尚未派出或 sessionID 未捕获），line dropped"
    return 0
  fi
  queue_first_line pop "$QUEUE" >/dev/null
  rundir="$RUNS/$(date +%Y%m%d-%H%M%S)-resume"
  mkdir -p "$rundir"
  touch "$RESUME_ANCHOR"
  log "approve resume session=$ses run=$rundir"
  event approve_injected "track=$TRACK_KEY"
  (
    cd "$REPO" || exit 127
    GH_TOKEN="${GITHUB_TOKEN:-}" BASE_TOKEN="$(sed -n 's/^BASE_TOKEN=//p' "$TRACK_ENV_FILE" 2>/dev/null)" \
      opencode run -s "$ses" -m "${OPENCODE_PROVIDER_KEY:-custom}/${LLM_MODEL}" \
      --title "approve resume" --format json \
      "$line" > "$rundir/opencode.jsonl" 2> "$rundir/opencode.err"
  ) &
  CAMPAIGN_PID=$!
  CAMPAIGN_RUN="$rundir"
  rm -f "$PARKED"   # 批准到了，宽限期取消，轨道保持占用
  log "approve resume dispatched pid=$CAMPAIGN_PID"
  # 常驻卡：批准注入成功 → ✅ 时间轴 + 清门（按钮消失，header 回【进行中】）。
  local approve_label; approve_label="$(gate_label "${line%% *}")"
  if campaign_card --approved --event "✅ ${approve_label}已批准（注入，续跑中）"; then
    log "campaign card updated for $TRACK_KEY（gate cleared after approve）"
  else
    log "WARN: campaign-card approve event failed（批准本体不受影响；卡面按钮待下个事件收敛）"
  fi
}

# ---------- ⑤ 主循环 ----------
command -v flock >/dev/null 2>&1 || die "flock not found（util-linux）——批准队列的出队纪律依赖它"
log "supervisor start pod=$POD_NAME language=$LANGUAGE sdk=$SDK_REPO track=$TRACK trackKey=$TRACK_KEY"
# 启动清场：parked/campaign.session/.resume-anchor 是 supervisor 进程生命周期状态
# ——pod 重建后旧 opencode 子进程必已死，残留文件会让派单门（parked 在→不派）与
# 宽限检查双双卡死（2026-10-24 首战实测）。一律清除（常驻卡 state 不清：已完成
# 的卡留档，新战役首事件会 PATCH 同一张卡续写时间轴）。
rm -f "$PARKED" "$SESSION_FILE" "$RESUME_ANCHOR"
log "startup sweep: stale campaign state cleared (parked/campaign.session/.resume-anchor)"
event supervisor_started
LAST_SCAN=0
while true; do
  NOW="$(date +%s)"
  if [ "$((NOW - LAST_SCAN))" -ge "$SCAN_INTERVAL" ]; then
    run_scan
    LAST_SCAN="$(date +%s)"
  fi
  reap_campaign
  expire_parked
  gate_watch
  handle_approve_queue
  dispatch_campaign || true
  sleep "$POLL_INTERVAL"
done
