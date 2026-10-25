#!/usr/bin/env bash
# deploy/milvus-cell-ops.sh — S2 战役 pod 舰队的 milvus-cell 运维收口（Mac 侧）。
#
# 2026-10-24 影子战役（双 pod 试运行）实测教训的确定性落地（skill
# milvus-cell §Unattended worker fleets 同源）：
#   * 全天跑批前必须关定时休眠（默认每日 23:00 睡=战役中途全灭）；
#   * RWO PVC pod 的重启原语=kubectl delete pod（rollout restart 新旧互等死锁）；
#   * kubectl EOF/拒连=大概率 Sleeping/Pending，先查 status 再动 kubeconfig；
#   * delete --confirm 不删 COS bucket，退役要单独 storage rm。
#
# 用法（都在仓库根，KUBECONFIG 自动指 ~/.milvus-cell/kubeconfig）：
#   bash deploy/milvus-cell-ops.sh status          # vCluster 相位 + worker pod 总览
#   bash deploy/milvus-cell-ops.sh ensure-awake    # Sleeping 则 wake（幂等）
#   bash deploy/milvus-cell-ops.sh sleep-off       # 关定时休眠（战役期）
#   bash deploy/milvus-cell-ops.sh sleep-on        # 复原定时休眠（战役毕）
#   bash deploy/milvus-cell-ops.sh refresh-kubeconfig
#   bash deploy/milvus-cell-ops.sh restart-pod <pod-name>   # RWO 安全重启原语
#   bash deploy/milvus-cell-ops.sh teardown-check  # 只读盘点：删 namespace 会失去什么
#
# 红线：本脚本不做任何破坏性动作（delete/storage rm 一律留给操作员手敲）。
set -euo pipefail

export KUBECONFIG="${KUBECONFIG:-$HOME/.milvus-cell/kubeconfig}"
NS=sdk-doc-sync

phase() { milvus-cell status --json 2>/dev/null | sed -n 's/.*"phase"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1; }

cmd_status() {
  local ph; ph="$(phase)"
  echo "vCluster phase: ${ph:-unknown}"
  case "$ph" in
    Running)
      kubectl -n "$NS" get pods -l app.kubernetes.io/part-of=sdk-doc-sync \
        -o custom-columns=NAME:.metadata.name,READY:.status.containerStatuses[0].ready,RESTARTS:.status.containerStatuses[0].restartCount --no-headers 2>/dev/null \
        || echo "(namespace $NS 空——尚无 worker)"
      ;;
    *) echo "kubectl 不可用（Sleeping/Pending/NotFound 时控制面不可达）——ensure-awake 后再查" ;;
  esac
}

cmd_ensure_awake() {
  local ph; ph="$(phase)"
  case "$ph" in
    Running) echo "already Running — nothing to do" ;;
    Sleeping|Pending) echo "phase=$ph → milvus-cell wake …"; milvus-cell wake ;;
    *) echo "phase=${ph:-unknown}——NotFound 时先 milvus-cell create（见 deploy/README §1）" >&2; exit 1 ;;
  esac
}

cmd_sleep_off() { milvus-cell config set-sleep-policy --schedule=false && echo "定时休眠已关（战役期；收尾记得 sleep-on 复原）"; }
cmd_sleep_on()  { milvus-cell config set-sleep-policy --schedule=true  && echo "定时休眠已复原"; }
cmd_refresh_kubeconfig() { milvus-cell kubeconfig > "$KUBECONFIG" && echo "kubeconfig refreshed → $KUBECONFIG"; }

cmd_restart_pod() {
  local pod="${1:?usage: restart-pod <pod-name>}"
  # RWO PVC 教训：rollout restart 会"新 pod 等卷、旧 pod 等 Ready"双双死锁；
  # delete pod 先终持有者，Deployment 重建即干净重启。改动 ConfigMap 后用这里生效。
  echo "重启 $pod（RWO 安全原语：delete pod，非 rollout restart）…"
  kubectl -n "$NS" delete pod "$pod"
  kubectl -n "$NS" get pods -l app.kubernetes.io/part-of=sdk-doc-sync -w 2>/dev/null | head -5 || true
}

cmd_teardown_check() {
  echo "== namespace $NS 内将被删除的对象（PVC 数据随删，CBS 停止计费）=="
  kubectl -n "$NS" get pvc 2>/dev/null || echo "(no pvc)"
  echo "== worker pods =="
  kubectl -n "$NS" get pods -l app.kubernetes.io/part-of=sdk-doc-sync 2>/dev/null || echo "(no pods)"
  echo "== COS bucket（milvus-cell delete 不删它——需单独 storage rm / 等生命周期过期）=="
  milvus-cell storage list 2>/dev/null | head -10 || true
  echo "确认后手敲：kubectl delete namespace $NS && milvus-cell delete --confirm（本脚本绝不代删）"
}

case "${1:-help}" in
  status)           cmd_status ;;
  ensure-awake)     cmd_ensure_awake ;;
  sleep-off)        cmd_sleep_off ;;
  sleep-on)         cmd_sleep_on ;;
  refresh-kubeconfig) cmd_refresh_kubeconfig ;;
  restart-pod)      shift; cmd_restart_pod "$@" ;;
  teardown-check)   cmd_teardown_check ;;
  help|*) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
