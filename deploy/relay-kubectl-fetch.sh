#!/usr/bin/env bash
# deploy/relay-kubectl-fetch.sh — relay initContainer：从 pkgs.k8s.io 官方包仓库
# 取 kubectl 二进制到共享 emptyDir /opt/kubectl-bin（relay-deployment.yaml 的
# kubectl-installer 调用；主容器 PATH 前置该目录，relay-entry.sh 的 curl 装法
# 退居 fallback）。
#
# 路线修正（2026-10-24 实测，三轮）：本 vCluster egress 对 dl.k8s.com（官方 curl
# 装法）不通；registry.k8s.io/kubectl 镜像可拉但是无 shell 的 distroless，拷不出
# 自身二进制；pkgs.k8s.io 通且 InRelease 验签通过，但 flat 仓的 Packages 索引被
# apt 取回后静默不加载（apt-cache policy 恒空，debug pod 干净态复现两轮）。落点：
# 手工走 apt 的同一条信任链——gpg 验 InRelease → SHA256 钉 Packages → 解析
# amd64 kubectl 的 Filename/SHA256 → SHA256 钉 deb——全部用实测可达的工具
# （curl/gpg/awk/sha256sum/dpkg），信任强度与 apt 等价。
#
# 版本钉法：仓库按 minor 钉死（core:/stable:/<K8S_MINOR>，默认 v1.36——server
# v1.36.0 在官方 skew ±1 minor 内），补丁版取该仓 amd64 最新（sort -V）；
# KUBECTL_DEB_VERSION 可显式钉全版本（形如 1.36.4-<obs-build>，查 Packages 索引）。
# 任一校验失败硬退（exit 1）交 kube 重启——没有 kubectl 的 relay 无法履行唯一
# 职责，验签不过的二进制更不能用。
#
# 红线：本脚本只下载并放置 kubectl，不碰批准面。

set -euo pipefail

K8S_MINOR="${K8S_MINOR:-v1.36}"
REPO_URL="https://pkgs.k8s.io/core:/stable:/${K8S_MINOR}/deb"
OUT_DIR="/opt/kubectl-bin"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
chmod 0755 "${TMP}"
export GNUPGHOME="${TMP}/gnupghome"
mkdir -m 0700 -p "${GNUPGHOME}"

log() { printf '[kubectl-fetch] %s\n' "$*"; }

log "fetching Release.key from ${REPO_URL}"
curl -fsSL --connect-timeout 15 "${REPO_URL}/Release.key" | gpg --dearmor -o "${TMP}/keyring.gpg"

# 信任链第 1 环：InRelease（Release + 分离签名）过 gpg，签名不过即硬退。
curl -fsSL --connect-timeout 15 "${REPO_URL}/InRelease" -o "${TMP}/InRelease"
gpg --no-default-keyring --keyring "${TMP}/keyring.gpg" --verify "${TMP}/InRelease"
log "InRelease signature verified"

# 信任链第 2 环：Packages 对 InRelease SHA256 段里自己的条目（其余 MD5Sum/SHA1/
# SHA512 段的同名条目不认）。
curl -fsSL --connect-timeout 15 "${REPO_URL}/Packages" -o "${TMP}/Packages"
PKGS_WANT="$(awk '/^[A-Za-z0-9]+:$/ { in_sha256 = ($0 == "SHA256:"); next } in_sha256 && $NF == "Packages" { print $1 }' "${TMP}/InRelease")"
PKGS_GOT="$(sha256sum "${TMP}/Packages" | awk '{ print $1 }')"
if [ -z "${PKGS_WANT}" ] || [ "${PKGS_WANT}" != "${PKGS_GOT}" ]; then
  log "FATAL: Packages SHA256 mismatch (want ${PKGS_WANT:-<none>} got ${PKGS_GOT})"
  exit 1
fi
log "Packages index checksum verified"

# 信任链第 3 环：从（已验签的）Packages 索引按段落解析 amd64 kubectl 的
# Filename/SHA256；版本取索引内最高（sort -V），或 KUBECTL_DEB_VERSION 显式钉死。
STANZA="$(awk -v want_version="${KUBECTL_DEB_VERSION:-}" '
  BEGIN { RS = ""; FS = "\n" }
  {
    pkg = ""; ver = ""; arch = ""; file = ""; sha = ""
    for (i = 1; i <= NF; i++) {
      line = $i
      if (line == "Package: kubectl") pkg = "kubectl"
      else if (line ~ /^Version: /) ver = substr(line, 10)
      else if (line ~ /^Architecture: /) arch = substr(line, 15)
      else if (line ~ /^Filename: /) file = substr(line, 11)
      else if (line ~ /^SHA256: /) sha = substr(line, 9)
    }
    if (pkg == "kubectl" && arch == "amd64" && (want_version == "" || ver == want_version)) {
      print ver "\t" file "\t" sha
    }
  }
' "${TMP}/Packages" | sort -t "$(printf '\t')" -k1,1V | tail -1)"
if [ -z "${STANZA}" ]; then
  log "FATAL: no kubectl amd64 stanza in Packages (version filter: ${KUBECTL_DEB_VERSION:-latest})"
  exit 1
fi
REL_PATH="$(printf '%s\n' "${STANZA}" | cut -f2)"
DEB_SHA="$(printf '%s\n' "${STANZA}" | cut -f3)"

curl -fsSL --connect-timeout 15 "${REPO_URL}/${REL_PATH}" -o "${TMP}/kubectl.deb"
DEB_GOT="$(sha256sum "${TMP}/kubectl.deb" | awk '{ print $1 }')"
if [ "${DEB_SHA}" != "${DEB_GOT}" ]; then
  log "FATAL: kubectl.deb SHA256 mismatch (want ${DEB_SHA} got ${DEB_GOT})"
  exit 1
fi
log "kubectl.deb checksum verified (${REL_PATH})"

dpkg -x "${TMP}/kubectl.deb" "${TMP}/root"
BIN=""
while IFS= read -r found; do
  BIN="${found}"
  break
done < <(find "${TMP}/root" -type f -name kubectl)
if [ -z "${BIN}" ]; then
  log "FATAL: kubectl binary not found inside deb"
  exit 1
fi

mkdir -p "${OUT_DIR}"
install -m 0755 "${BIN}" "${OUT_DIR}/kubectl"
log "installed: $(${OUT_DIR}/kubectl version --client 2>/dev/null || echo unknown)"
