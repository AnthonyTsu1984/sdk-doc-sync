#!/usr/bin/env bash
# deploy/relay-entry.sh — relay 容器引导（relay-deployment.yaml 的 container command）。
#
# 职责：装 kubectl（集群内批准注入的唯一执行面，SA relay-approver 凭据由 kubelet
# 自动挂载，kubectl in-cluster 自动识别，无需 kubeconfig）→ exec node
# /opt/relay/deploy/relay-entry.js（长连接订阅 card.action.trigger）。
#
# kubectl 安装：dl.k8s.com 官方静态二进制（egress 冒烟已证连通）。版本钉死
# KUBECTL_VERSION（2026-10-24 稳定版，与 Mac client v1.36.4 同版；server v1.36.0，
# 官方 skew 策略 ±1 minor 内）；架构按 uname -m 解析（节点 amd64，arm64 兼容写法）。
# 失败重试 3 次后硬退（exit 1）交 kube 重启——没有 kubectl 的 relay 无法履行唯一
# 职责，赖活着只会静默吞批准。
#
# 红线：本脚本只装 kubectl 并 exec 入口，不碰批准面。

set -euo pipefail

KUBECTL_VERSION="${KUBECTL_VERSION:-v1.36.4}"
INSTALL_PATH="/usr/local/bin/kubectl"

case "$(uname -m)" in
  x86_64)          ARCH="amd64" ;;
  aarch64 | arm64) ARCH="arm64" ;;
  *)
    echo "[relay-entry] FATAL: unsupported arch $(uname -m)" >&2
    exit 1
    ;;
esac

if ! command -v kubectl >/dev/null 2>&1; then
  URL="https://dl.k8s.com/release/${KUBECTL_VERSION}/bin/linux/${ARCH}/kubectl"
  installed=0
  for attempt in 1 2 3; do
    echo "[relay-entry] installing kubectl ${KUBECTL_VERSION} (${ARCH}), attempt ${attempt}"
    if curl -fsSL --connect-timeout 15 -o "${INSTALL_PATH}" "${URL}" && chmod 0755 "${INSTALL_PATH}"; then
      installed=1
      break
    fi
    rm -f "${INSTALL_PATH}"
    sleep $((attempt * 5))
  done
  if [ "${installed}" -ne 1 ]; then
    echo "[relay-entry] FATAL: kubectl install failed after 3 attempts (${URL})" >&2
    exit 1
  fi
fi

KUBECTL_INSTALLED="$(kubectl version --client 2>/dev/null || true)"
echo "[relay-entry] kubectl ready: ${KUBECTL_INSTALLED:-unknown}"

exec node /opt/relay/deploy/relay-entry.js
