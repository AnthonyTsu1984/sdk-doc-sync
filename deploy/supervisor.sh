#!/usr/bin/env bash
# deploy/supervisor.sh — S2 pod 主进程（bootstrap 末尾 exec 到这里）。
#
# 五件事（单进程轮询，无嵌套守护）：
#   ① 每 30 分钟跑 daily-scan --language $LANGUAGE（发现+账本自维护，只读哨兵）
#   ② 账本 pending>0 且 slot 空闲 → 起战役：buildTrackIntakeBrief 简报 +
#      `opencode run --format json`（四段提示词，slot=TRACKS 每轨一个）
#   ③ 门铃巡检：tmp/api-reference-sync/gate-presentation/ 新 index.json →
#      飞书卡片（BOT_* token + OPERATOR_EMAIL 求解 p2p open_id，缓存；slot/track
#      从工件路径确定性反解，message_id 落 runs/sent-cards.jsonl 入账）
#   ④ 批准队列：/workspace/inbound/approve-<slot>.queue 首行匹配
#      ^APPROVE_[A-Z]+( \S+)? sha256:[0-9a-f]{64}$ → `opencode run -s <ses>` 续跑
#   ⑤ 全部动作 append logs/supervisor.log + logs/events.jsonl 一行 JSON 事件
#
# 红线：本进程不推进 scan-state（只由 close-session/finalize 推进）、不代替操作员
# 批准（门后必停）、不重写账本 fold（pending 计数走 canonical daily-scan-core）。
# 会话续接用 `-s <ses_…>`（--format json 事件携带 sessionID，已实测）；`-c/--continue`
# 只续项目目录最后一个会话，双 slot 共用 cwd 会串会话，故不用。

set -uo pipefail

WORKSPACE="${WORKSPACE:-/workspace}"
REPO="${REPO:-$WORKSPACE/feishu-markdown-bridge}"
LANGUAGE="${LANGUAGE:?LANGUAGE env is required}"
SDK_REPO="${SDK_REPO:?SDK_REPO env is required}"
TRACKS="${TRACKS:?TRACKS env is required (e.g. 'v3.0.x,v2.6.x')}"
POD_NAME="${POD_NAME:-${HOSTNAME:-unknown}}"
SCAN_INTERVAL="${SCAN_INTERVAL:-1800}"
POLL_INTERVAL="${POLL_INTERVAL:-20}"
CAMPAIGN_GRACE_SECS="${CAMPAIGN_GRACE_SECS:-900}"   # 战役停门后无批准注入的宽限期，过即让出轨道
LIB="$REPO/deploy/lib.js"
SCAN_CLI=".claude/skills/api-reference-sync/scripts/daily-scan.js"
LEDGER="tmp/api-reference-sync/daily-scan/pr-findings.jsonl"
GATE_DIR="$REPO/tmp/api-reference-sync/gate-presentation"
INBOUND="$WORKSPACE/inbound"
RUNS="$WORKSPACE/runs"
LOGS="$WORKSPACE/logs"
SUPERVISOR_LOG="$LOGS/supervisor.log"
EVENTS_FILE="$LOGS/events.jsonl"

mkdir -p "$LOGS" "$RUNS" "$INBOUND"
exec >> >(tee -a "$SUPERVISOR_LOG") 2>&1

log() { printf '[supervisor %s] %s\n' "$(date -Is)" "$*"; }
die() { printf '[supervisor %s] FATAL: %s\n' "$(date -Is)" "$*" >&2; exit 1; }

event() { # event <name> [key=value ...]（JSON 转义在 lib.js 内做）
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
      detail=*) args+=(--detail "${kv#detail=}") ;;
      messageId=*) args+=(--message-id "${kv#messageId=}") ;;
    esac
  done
  node "$LIB" emit-event "${args[@]}" 2>>"$SUPERVISOR_LOG" || log "WARN: emit-event failed ($name)"
}

# ---------- slot 表：TRACKS 顺序即 slot 1..N ----------
IFS=',' read -r -a TRACK_LIST <<< "$TRACKS"
N_SLOTS=0
declare -A SLOT_PID=() SLOT_TRACK=() SLOT_RUN=() SLOT_TRACKKEY=() SLOT_DEFER_LOG=()
for track in "${TRACK_LIST[@]}"; do
  track="$(echo "$track" | tr -d '[:space:]')"
  [ -n "$track" ] || continue
  N_SLOTS=$((N_SLOTS + 1))
  SLOT_TRACK[$N_SLOTS]="$track"
done
[ "$N_SLOTS" -gt 0 ] || die "TRACKS parses to zero slots: '$TRACKS'"

track_key_of() { # <version> → registryTrackKey（scanStateKey 覆写优先），失败回退派生
  local err
  err="$(node "$LIB" track-env --language "$LANGUAGE" --track "$1" 2>&1 >/dev/null)" || true
  printf '%s\n' "$err" | sed -n 's/^trackKey=//p'
}

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

# ---------- ② 起战役（slot 空闲 + 轨道未占用 + pending>0） ----------
active_marker() { printf '%s/active-%s' "$RUNS" "$(track_key_of "$1")"; }

dispatch_slot() { # dispatch_slot <slot>
  local slot="$1" track="$2"
  # slot 忙（战役/resume 在跑）绝不重复派 —— 保护 SLOT_PID 不被覆盖。
  if [ -n "${SLOT_PID[$slot]:-}" ] && kill -0 "${SLOT_PID[$slot]}" 2>/dev/null; then
    return 0
  fi
  local marker; marker="$(active_marker "$track")"
  [ -e "$marker" ] && return 0
  # B 串行（操作员 2026-10-24 裁定）：同语言两轨一 pod 串行——任一其他轨道的
  # active marker 在，就不派新战役（一轨收完/让出后再放下一轨；两类共享检出/
  # 文档树的竞态由此整体避开，见会话评估）。marker=战役存活信号（派单写、
  # 宽限让出/终态释放删）。
  local om
  for om in "$RUNS"/active-*; do
    [ -e "$om" ] || continue
    [ "$om" = "$marker" ] && continue
    log "serialized: track ${track:-?} waits（active: $(basename "$om")）"
    return 0
  done
  local pending; pending="$(pending_count)"
  [ "$pending" -gt 0 ] || return 0

  local track_key; track_key="$(track_key_of "$track")"
  [ -n "$track_key" ] || { log "WARN: trackKey derivation failed for $track"; track_key="$LANGUAGE-unknown"; }

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
    event dispatch_failed "slot=$slot" "track=$track" "code=BRIEF_FAILED"
    log "FAIL: brief generation failed for $track_key — see node stderr above"
    rm -rf "$rundir"
    return 1
  fi

  # 来源三件套之一（呈门卡片 v2）：派单时从账本提取本轨 pending PR 清单落
  # rundir/source.json，呈门时经 gate-presentation --source 透传到卡片。
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
    printf '%s\n' "呈门产出（.claude/skills/api-reference-sync/scripts/gate-presentation.js）必须带 --source $rundir/source.json —— 卡片的来源三件套由它透传。"
    printf '%s\n' '---'
    cat "$rundir/brief.md"
  } > "$rundir/prompt.md"

  # BASE_TOKEN 必须是目标轨的 base（bootstrap 已导出 per-track env 文件）。
  local track_env="$RUNS/track-env/${track}.env"
  if [ ! -s "$track_env" ] || ! head -n1 "$track_env" | grep -Eq '^BASE_TOKEN=[A-Za-z0-9]+$'; then
    event dispatch_failed "slot=$slot" "track=$track" "code=BASE_TOKEN_UNAVAILABLE"
    log "FAIL: $track_env missing/invalid — bootstrap per-track export failed"
    return 1
  fi

  # 派出（后台）：session 落 --format json 事件流，reap 时提取 sessionID。
  log "dispatch slot=$slot track=$track_key run=$rundir (pending=$pending)"
  (
    cd "$REPO" || exit 127
    GH_TOKEN="${GITHUB_TOKEN:-}" BASE_TOKEN="$(sed -n 's/^BASE_TOKEN=//p' "$track_env")" \
      opencode run -m "${OPENCODE_PROVIDER_KEY:-custom}/${LLM_MODEL}" \
      --title "S2 ${track_key} ${ts}" --format json \
      "$(cat "$rundir/prompt.md")" > "$rundir/opencode.jsonl" 2> "$rundir/opencode.err"
  ) &
  SLOT_PID[$slot]=$!
  SLOT_RUN[$slot]="$rundir"
  SLOT_TRACKKEY[$slot]="$track_key"
  printf '%s\n' "$rundir" > "$marker"
  rm -f "$RUNS/parked-${track_key}"
  event campaign_started "slot=$slot" "track=$track_key" "count=$pending"
  return 0
}

# ---------- 回收：战役进程退出 → 提取 sessionID、记录、进入停门宽限 ----------
reap_slots() {
  local slot pid rundir ses rc
  for slot in $(seq 1 "$N_SLOTS"); do
    pid="${SLOT_PID[$slot]:-}"
    [ -n "$pid" ] || continue
    if kill -0 "$pid" 2>/dev/null; then continue; fi
    wait "$pid"; rc=$?
    rundir="${SLOT_RUN[$slot]}"
    ses=""
    if [ -s "$rundir/opencode.jsonl" ]; then
      ses="$(node -e '
          const { extractSessionId } = require(process.argv[1]);
          const fs = require("node:fs");
          process.stdout.write(extractSessionId(fs.readFileSync(process.argv[2], "utf8")) ?? "");
        ' "$LIB" "$rundir/opencode.jsonl")"
    fi
    if [ -n "$ses" ]; then
      printf '%s\n' "$ses" > "$RUNS/slot-$slot.session"
      log "slot=$slot campaign exit=$rc session=$ses（armed for approve resume）"
      # B 串行配套：resume 退出且期间没有新呈门（anchor 之后零 index.json）=
      # 战役终态（close-session 完成或死亡）——立即释放轨道给下一轨，不吃 6h
      # 宽限尾巴；若实为死亡，该轨 findings 未处置，会在下一轮空闲时重派（首次
      # 派单无门退出仍走宽限退避，无热循环）。
      case "$rundir" in
        *-resume-*)
          if [ -e "$RUNS/.resume-anchor-$slot" ]; then
            local ng; ng="$(find "$GATE_DIR" -name '*.index.json' ! -name 'latest-index.json' -newer "$RUNS/.resume-anchor-$slot" 2>/dev/null | wc -l)"
            rm -f "$RUNS/.resume-anchor-$slot"
            if [ "$ng" -eq 0 ]; then
              rm -f "$(active_marker "${SLOT_TRACK[$slot]}")" "$RUNS/parked-${SLOT_TRACKKEY[$slot]}" "$RUNS/slot-$slot.session"
              log "slot=$slot resume exit with no new gate — track ${SLOT_TRACKKEY[$slot]} released（terminal/serialized mode）"
              event slot_released_terminal "slot=$slot" "track=${SLOT_TRACKKEY[$slot]}"
              unset "SLOT_TRACKKEY[$slot]"
            fi
          fi
          ;;
      esac
    else
      log "slot=$slot campaign exit=$rc — sessionID NOT captured（approve resume 不可用，见 opencode.err）"
      event session_capture_failed "slot=$slot" "track=${SLOT_TRACKKEY[$slot]}" "exit=$rc"
    fi
    event campaign_exit "slot=$slot" "track=${SLOT_TRACKKEY[$slot]}" "exit=$rc"
    # 轨道宽限：宽限期内等批准注入；过点且无队列行则让出轨道。
    printf '%s\n' "$(( $(date +%s) ))" > "$RUNS/parked-${SLOT_TRACKKEY[$slot]}"
    unset "SLOT_PID[$slot]"
  done
}

# ---------- ②′ 宽限过点 → 让出轨道（允许再派；pending 仍>0 时新会话按盘上状态续办） ----------
expire_parked() {
  local track_key marker parked
  for slot in $(seq 1 "$N_SLOTS"); do
    # resume 进行中的 slot 不让出
    [ -n "${SLOT_PID[$slot]:-}" ] && continue
    track_key="${SLOT_TRACKKEY[$slot]:-}"
    [ -n "$track_key" ] || continue
    parked="$RUNS/parked-${track_key}"
    [ -f "$parked" ] || continue
    if [ -s "$INBOUND/approve-$slot.queue" ]; then continue; fi   # 有待注入批准，继续等
    local age=$(( $(date +%s) - "$(cat "$parked")" ))
    if [ "$age" -ge "$CAMPAIGN_GRACE_SECS" ]; then
      marker="$(active_marker "${SLOT_TRACK[$slot]}")"
      rm -f "$marker" "$parked" "$RUNS/slot-$slot.session"
      log "track=$track_key grace elapsed (${age}s) — slot=$slot released"
      event slot_released "slot=$slot" "track=$track_key"
      unset "SLOT_TRACKKEY[$slot]"
    fi
  done
}

# ---------- ③ 门铃巡检（新 index.json → 飞书卡片） ----------
#
# 归因（呈门 v2，规格 3）：从工件路径确定性反解，旧"检测瞬间恰在跑的 slot"
# 启发式（active==1）已删除——实测错配/unknown。反解逻辑单源在 deploy/lib.js
# deriveGateAttribution（纯函数，tests/skills/deploy-scaffold.test.js 直测反解
# 表）：工件路径含 gate-presentation/<sessionKey>/ 前缀（sessionKey 由
# sessionPath 经 sessionKeyOf 派生），长 trackKey 优先反查，查不到回退 TRACKS
# 顺序固定映射（slot1=v3.0.x、slot2=v2.6.x，与派单顺序一致），再落空=unknown。
gate_watch() {
  [ -d "$GATE_DIR" ] || return 0
  local seen="$RUNS/seen-gates.txt" f slot track_key index_id notify_out msg_id keys
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    grep -qxF "$f" "$seen" 2>/dev/null && continue
    printf '%s\n' "$f" >> "$seen"
    keys="$(for s in $(seq 1 "$N_SLOTS"); do printf '%s,' "${SLOT_TRACKKEY[$s]:-}"; done)"
    keys="${keys%,}"
    attribution="$(node "$LIB" gate-slot --artifact "$f" --tracks "$TRACKS" --track-keys "$keys" 2>>"$SUPERVISOR_LOG")" \
      || attribution="slot=unknown trackKey=unknown"
    slot="${attribution#slot=}"; slot="${slot%% *}"
    track_key="${attribution#*trackKey=}"
    index_id="${f#"$GATE_DIR"/}"
    log "gate presentation detected: $f（slot=$slot track=$track_key 归因=工件路径确定性反解）"
    if notify_out="$(node "$LIB" notify-gate --index-file "$f" --pod "$POD_NAME" --slot "$slot" \
        --track-key "$track_key" --language "$LANGUAGE" --open-id-cache "$RUNS/operator-openid" \
        --index-id "$index_id" --sent-cards "$RUNS/sent-cards.jsonl" 2>>"$SUPERVISOR_LOG")"; then
      msg_id="$(printf '%s\n' "$notify_out" | sed -n 's/^messageId=//p')"
      event gate_notified "slot=$slot" "track=$track_key" "detail=$f" "messageId=$msg_id"
    else
      event gate_notify_failed "slot=$slot" "track=$track_key" "detail=$f"
      log "WARN: feishu notify failed for $f（BOT_*/OPERATOR_EMAIL 或网络；卡片未发出，看板仍可见 latest-index.json）"
    fi
  done < <(find "$GATE_DIR" -name '*.index.json' ! -name 'latest-index.json' -type f | sort)
}

# ---------- ④ 批准队列（首行过正则 → opencode run -s 续跑该 slot） ----------
# 出队纪律：peek → 校验 → 决定后才 pop。slot 忙/无 armed session 时批准行
# 留在队列原地等待，绝不出队作废（操作员批复是人工动作，不可静默丢弃）。
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

handle_approve_queues() {
  local slot line verdict ses rundir busy
  for slot in $(seq 1 "$N_SLOTS"); do
    local queue="$INBOUND/approve-$slot.queue"
    [ -s "$queue" ] || continue
    line="$(queue_first_line peek "$queue")"
    [ -n "$line" ] || continue
    verdict="$(node "$LIB" validate-approve-line --line "$line" 2>/dev/null || true)"
    if [ -z "$verdict" ]; then
      queue_first_line pop "$queue" >/dev/null   # 正则不过 = 垃圾行，出队+typed 事件
      event approve_line_invalid "slot=$slot" "code=APPROVE_LINE_INVALID"
      log "WARN: queue line rejected by APPROVE regex, dropped: $(printf '%s' "$line" | head -c 80)"
      continue
    fi
    busy=0
    if [ -n "${SLOT_PID[$slot]:-}" ] && kill -0 "${SLOT_PID[$slot]}" 2>/dev/null; then
      busy=1
    fi
    if [ "$busy" -eq 1 ]; then
      event approve_deferred "slot=$slot"
      log "slot=$slot busy — approve stays queued (peek only)"
      continue
    fi
    ses="$(cat "$RUNS/slot-$slot.session" 2>/dev/null || true)"
    if [ -z "$ses" ]; then
      queue_first_line pop "$queue" >/dev/null
      event approve_no_session "slot=$slot" "code=SESSION_NOT_ARMED"
      log "WARN: approve for slot=$slot but no armed session（战役尚未派出或 sessionID 未捕获），line dropped"
      continue
    fi
    queue_first_line pop "$queue" >/dev/null
    rundir="$RUNS/$(date +%Y%m%d-%H%M%S)-resume-slot$slot"
    mkdir -p "$rundir"
    touch "$RUNS/.resume-anchor-$slot"
    local track_key="${SLOT_TRACKKEY[$slot]:-unknown}"
    log "approve resume slot=$slot session=$ses run=$rundir"
    event approve_injected "slot=$slot" "track=$track_key"
    (
      cd "$REPO" || exit 127
      GH_TOKEN="${GITHUB_TOKEN:-}" BASE_TOKEN="$(sed -n 's/^BASE_TOKEN=//p' "$RUNS/track-env/${SLOT_TRACK[$slot]}.env" 2>/dev/null)" \
        opencode run -s "$ses" -m "${OPENCODE_PROVIDER_KEY:-custom}/${LLM_MODEL}" \
        --title "approve slot$slot" --format json \
        "$line" > "$rundir/opencode.jsonl" 2> "$rundir/opencode.err"
    ) &
    SLOT_PID[$slot]=$!
    SLOT_RUN[$slot]="$rundir"
    rm -f "$RUNS/parked-${track_key}"   # 批准到了，宽限期取消，轨道保持占用
    log "approve resume dispatched slot=$slot pid=${SLOT_PID[$slot]}"
  done
}

# ---------- ⑤ 主循环 ----------
command -v flock >/dev/null 2>&1 || die "flock not found（util-linux）——批准队列的出队纪律依赖它"
log "supervisor start pod=$POD_NAME language=$LANGUAGE sdk=$SDK_REPO tracks=$TRACKS slots=$N_SLOTS"
# 启动清场：active-*/parked-*/slot-*.session 是 supervisor 进程生命周期状态——
# pod 重建后旧 opencode 子进程必已死，残留文件会让派单门（marker 在→不派）与
# 宽限检查（SLOT_TRACKKEY 空→不释放）双双卡死（2026-10-24 首战实测）。一律清除。
rm -f "$RUNS"/active-* "$RUNS"/parked-* "$RUNS"/slot-*.session
log "startup sweep: stale slot state cleared (active-*/parked-*/slot-*.session)"
event supervisor_started "count=$N_SLOTS"
LAST_SCAN=0
while true; do
  NOW="$(date +%s)"
  if [ "$((NOW - LAST_SCAN))" -ge "$SCAN_INTERVAL" ]; then
    run_scan
    LAST_SCAN="$(date +%s)"
  fi
  reap_slots
  expire_parked
  gate_watch
  handle_approve_queues
  for slot in $(seq 1 "$N_SLOTS"); do
    dispatch_slot "$slot" "${SLOT_TRACK[$slot]}" || true
  done
  sleep "$POLL_INTERVAL"
done
