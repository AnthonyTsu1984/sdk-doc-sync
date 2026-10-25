#!/usr/bin/env bash
# deploy/gen-worker-deployment.sh — 一轨一 pod（2026-10-25 拓扑裁定）的部署清单生成器。
#
#   bash deploy/gen-worker-deployment.sh <language> <track> > deploy/out/<trackKey>.yaml
#   kubectl apply -f deploy/out/<trackKey>.yaml
#
# 例：pymilvus 两轨 = 两个 pod：
#   bash deploy/gen-worker-deployment.sh python v3.0.x > deploy/out/python-v3.yaml
#   bash deploy/gen-worker-deployment.sh python v2.6.x > deploy/out/python-v26.yaml
#
# 产物=两个对象：PVC workspace-<trackKey>（10Gi RWO）+ Deployment <trackKey>-worker
# （node:22-bookworm 单容器，TRACK 单轨 env；labels part-of=sdk-doc-sync +
# name=<trackKey>-worker，pod-approve --list 按前者枚举）。生成器只做模板替换，
# trackKey 经 deploy/lib.js track-env 从 release-tracks 注册表确定性推导
# （scanStateKey 覆写优先），绝不手敲。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LANGUAGE="${1:?usage: gen-worker-deployment.sh <language> <track>}"
TRACK="${2:?usage: gen-worker-deployment.sh <language> <track>}"
case "$TRACK" in
  *,*) echo "TRACK must be a single version track（一轨一 pod）: $TRACK" >&2; exit 64 ;;
esac

TRACK_KEY="$(node "$REPO_ROOT/deploy/lib.js" track-env --language "$LANGUAGE" --track "$TRACK" 2>&1 >/dev/null | sed -n 's/^trackKey=//p')"
[ -n "$TRACK_KEY" ] || { echo "trackKey derivation failed for $LANGUAGE/$TRACK（release-tracks 注册表缺该轨？）" >&2; exit 64; }
case "$TRACK_KEY" in
  *[!a-z0-9-]*) echo "trackKey 不是 dns-1035 安全名: $TRACK_KEY" >&2; exit 64 ;;
esac
POD_NAME="${TRACK_KEY}-worker"
PVC_NAME="workspace-${TRACK_KEY}"

cat <<EOF
# 由 deploy/gen-worker-deployment.sh 生成（$LANGUAGE · $TRACK · trackKey=${TRACK_KEY}）——
# 一轨一 pod：本 pod 只跑这条轨。手工改动请在生成器里改后重生成。
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: $PVC_NAME
  namespace: sdk-doc-sync
  labels:
    app.kubernetes.io/part-of: sdk-doc-sync
    app.kubernetes.io/track: $TRACK_KEY
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: $POD_NAME
  namespace: sdk-doc-sync
  labels:
    app.kubernetes.io/part-of: sdk-doc-sync
    app.kubernetes.io/name: $POD_NAME
    app.kubernetes.io/track: $TRACK_KEY
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: $POD_NAME
  template:
    metadata:
      labels:
        app.kubernetes.io/name: $POD_NAME
        app.kubernetes.io/part-of: sdk-doc-sync
        app.kubernetes.io/track: $TRACK_KEY
    spec:
      containers:
        - name: worker
          image: node:22-bookworm
          imagePullPolicy: IfNotPresent
          command: ["/bin/bash", "/opt/scripts/bootstrap.sh"]
          workingDir: /workspace
          env:
            - name: LANGUAGE
              value: "$LANGUAGE"
            # 停门等人批的宽限：人工门节奏是小时级——900s 会让战役每 ~17 分钟重派
            # 重推导并重发门铃（2026-10-24 首战 2 小时 22 条刷屏的根因）。6h 无人批才让出。
            - name: CAMPAIGN_GRACE_SECS
              value: "21600"
            - name: SDK_REPO
              value: "${SDK_REPO:?SDK_REPO env required (e.g. pymilvus)}"
            - name: TRACK
              value: "$TRACK"
            - name: OPENCODE_PROVIDER_KEY
              value: custom
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
          envFrom:
            - secretRef:
                name: sdk-env
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: "2"
              memory: 4Gi
          volumeMounts:
            - name: workspace
              mountPath: /workspace
            - name: scripts
              mountPath: /opt/scripts
              readOnly: true
            - name: backlog
              mountPath: /opt/backlog
              readOnly: true
      volumes:
        - name: workspace
          persistentVolumeClaim:
            claimName: $PVC_NAME
        - name: scripts
          configMap:
            name: sdk-scripts
            defaultMode: 0755
        - name: backlog
          configMap:
            name: sdk-backlog
EOF
