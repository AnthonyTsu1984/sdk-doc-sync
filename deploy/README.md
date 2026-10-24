# deploy/ — S2 双 pod 试运行部署脚手架（python + java worker）

跑在已建好的 **milvus-cell vCluster**（kubeconfig `~/.milvus-cell/kubeconfig`，
node v1.36 Ready，egress 已冒烟：github / api.github.com / open.feishu.cn /
open.bigmodel.cn / api.z.ai / npmjs 全连通）。每个 pod = `node:22-bookworm` 单容器，
bootstrap 装环境 + clone 三仓到 PVC，然后 exec supervisor 常驻：

```
                        ┌──────────── sdk-doc-sync namespace ────────────┐
 Mac（操作员）           │  python-worker                  java-worker    │
 ┌──────────────┐       │  ┌──────────────────────┐   ┌──────────────────────┐
 │ pod-approve  │ exec  │  │ supervisor           │   │ supervisor           │
 │ --list       │──────▶│  │ ①30min daily-scan    │   │ （同构，java 轨）    │
 │ 注入 APPROVE │ queue │  │ ②简报+opencode 战役  │   │                      │
 └──────────────┘       │  │ ③门铃→飞书卡片       │   │                      │
 飞书（操作员）◀────────────│ ④批准队列→-s 续跑    │   │                      │
                        │  │ ⑤logs/{supervisor.log│   │                      │
                        │  │   events.jsonl}      │   │                      │
                        │  └──────┬───────────────┘   └──────────┬───────────┘
                        │   PVC workspace-python        PVC workspace-java │
                        │   （10Gi，默认 cbs ≈¥0.35/GB/月）                │
                        └─────────────────────────────────────────────────┘
```

目录内文件：`namespace-pvc.yaml`、`secret-template.yaml.example`（形态示例，真值
永不入库）、`configmap-scripts.yaml`（bootstrap/supervisor/seed-backlog 部署镜像）、
`configmap-backlog.yaml`（python 6 条 / java 8 条 pending backlog 快照）、
`deployment-python.yaml`、`deployment-java.yaml`、`lib.js`（双端共享内核，
tests/skills/deploy-scaffold.test.js 直测）。

---

## 0. 前提

- Mac 侧：`kubectl`（client ≥1.36）、`node ≥20`；`KUBECONFIG` 指向
  `~/.milvus-cell/kubeconfig`（或每条命令前缀 `KUBECONFIG=~/.milvus-cell/kubeconfig`）。
- 仓库根有 `.env`（git-ignored），至少含：`LLM_BASE_URL` `LLM_API_KEY`
  `LLM_MODEL` `GITHUB_TOKEN` `BOT_APP_ID` `BOT_APP_SECRET` `FEISHU_HOST`
  `OPERATOR_EMAIL`（战役 worker 走 Bitable/Drive 写门还需 `DOC_APP_ID`
  `DOC_APP_SECRET`）。键名全集见 `secret-template.yaml.example`。
- 本任务产物只做文件 + 本地校验；**apply 由操作员执行**。

## 1. 一次创建（顺序执行，都在仓库根）

```bash
export KUBECONFIG=~/.milvus-cell/kubeconfig

# 1) namespace + 两块 PVC（storageClass 省略用默认 cbs）
kubectl apply -f deploy/namespace-pvc.yaml

# 2) secret：.env → sdk-env（真值不入 git；更新 secret 后要滚动重启）
kubectl create secret generic sdk-env --from-env-file=.env -n sdk-doc-sync

# 3) 脚本 + backlog 两张 ConfigMap
kubectl apply -f deploy/configmap-scripts.yaml -f deploy/configmap-backlog.yaml

# 4) 两个 deployment（bootstrap 前台跑完 exec supervisor）
kubectl apply -f deploy/deployment-python.yaml -f deploy/deployment-java.yaml

# 5) 盯首次引导（apt/gh/opencode 安装 + clone + npm ci，约 3–6 分钟）
kubectl -n sdk-doc-sync logs -f deploy/python-worker
kubectl -n sdk-doc-sync get pods -w
```

bootstrap 幂等（PVC 上 marker `/workspace/.bootstrap-done` 短路重装），pod 重启只
补差异；marker 命中路径仍会：重渲染 `opencode.json`、重导 BASE_TOKEN（fail-loud）、
重种 backlog（import-backlog 天然幂等）。

**BASE_TOKEN 结论**：`.claude/skills/api-reference-sync/config/release-tracks.json`
机器可读、每轨带 `bitable.baseToken`，bootstrap 自动导出 per-track env 到
`/workspace/runs/track-env/<version>.env`（slot 1 = v3.0.x → python-v3 / java-v30，
slot 2 = v2.6.x → python / java-v26），**操作员无需补任何 env**。若注册表不可读或
某轨缺 baseToken，bootstrap 以 typed 错误退出（`BASE_TOKEN_UNAVAILABLE`），绝不带
空 BASE_TOKEN 起战役。

## 2. 日常运维

### 看日志 / 看门 / 看账本

```bash
K="kubectl -n sdk-doc-sync"
$K logs --tail 100 deploy/python-worker        # supervisor 运行日志（亦持久化在 PVC）
node scripts/dashboard/pod-approve.js --list   # 两 pod events.jsonl 尾 20 行（每动作一行 JSON）

# 账本/水位/呈门产物都在 PVC 的 repo 主树里，可直接 exec 看：
$K exec deploy/python-worker -- sh -c 'tail -5 /workspace/feishu-markdown-bridge/tmp/api-reference-sync/daily-scan/pr-findings.jsonl'
$K exec deploy/python-worker -- sh -c 'ls /workspace/feishu-markdown-bridge/tmp/api-reference-sync/gate-presentation/'
$K exec deploy/python-worker -- sh -c 'cat /workspace/feishu-markdown-bridge/tmp/api-reference-sync/gate-presentation/latest-index.json'
```

### 门铃与批准注入（Mac 侧）

战役 worker 停在 APPROVE_* 门 → supervisor 检出新
`gate-presentation/<sessionKey>/*-<gate>.index.json` → 用 `BOT_*` 走飞书 IM 发卡片
给 `OPERATOR_EMAIL` 求解出的 p2p open_id（`/workspace/runs/operator-openid` 缓存），
卡片含 pod 名 / slot / 轨道 / 会话路径 / digest / **精确回现行**，尾注
"回信批准由 Mac 侧注入，或看板处理"。

操作员从卡片（或 latest-index.json 的 `replyLines`）**逐字复制**回现行，Mac 上：

```bash
node scripts/dashboard/pod-approve.js --pod python-worker --slot 1 \
  --line 'APPROVE_GROUPING sha256:<digest>'
node scripts/dashboard/pod-approve.js --pod java-worker --slot 2 \
  --line 'APPROVE_WRITES sha256:<batch-digest>'
```

- 行先过本地正则 `^APPROVE_[A-Z]+( \S+)? sha256:[0-9a-f]{64}$`（与 pod 内消费端
  同源，`deploy/lib.js` 单源），再 argv 数组 spawn `kubectl exec`，pod 内以位置参数
  **二次过同一正则**后追加进 `/workspace/inbound/approve-<slot>.queue`。
- supervisor ≤20s 轮询出队，`opencode run -s <ses_…>` 续跑该 slot 的原会话
  （sessionID 在派出时从 `--format json` 事件流捕获，存 `/workspace/runs/slot-<n>.session`）。
- slot 忙时批准行**留在队列原地**（不出队不作废）；slot 无在役会话时该行出队并记
  typed 事件 `approve_no_session`。
- 战役停门后若 15 分钟（`CAMPAIGN_GRACE_SECS`，可调）无批准注入，supervisor 让出
  轨道（typed 事件 `slot_released`）；pending 仍在时该轨可被重新派出——新会话按盘上
  durable 状态续办，绝不凭记忆。

### 处置回执（账本水位唯一推进路径）

发现条目的处置由 **worker 战役会话收官时**走 canonical CLI 回写，绝不由 supervisor
或 Mac 侧脚本代写：

```bash
# pod 内（worker 会话里或人工 exec）：
node .claude/skills/api-reference-sync/scripts/daily-scan.js --language python \
  --mark-disposed --pr 1184 --note "consumed by <sessionKey>"
```

`--mark-ignored --reason-code FEISHU_ROUNDTRIP|OPERATOR_RULING` 同理。scan-state 不走
这里——见红线第 3 条。

## 3. 红线（照抄仓库治理语汇）

1. **执行中绝不删除 journal 重放；写路径只走 canonical CLI；scan-state 只由
   close-session/finalize 推进。**（intake-brief IRON_RULES 原文）
2. **门后必停、绝不自批；批准只有落成回执才生效；任何重规划/重扫使 digest 作废、
   必须重新走门。**（回合契约原文）pod 侧只认队列里过正则的行，Mac 侧只负责把
   操作员复制的一行送进队列——两端都不解释 digest。
3. **发现/扫描是只读哨兵**：daily-scan 永不推进 scan-state、不写 Feishu/Bitable、
   不跑 dry-run/sync；水位只由 mark 动词（人工处置门）推进。
4. **真值永不入库**：`.env`、token、open_id 缓存只在 Pod PVC / 本地，git 面只有
   占位模板。

## 4. teardown

```bash
export KUBECONFIG=~/.milvus-cell/kubeconfig
kubectl -n sdk-doc-sync delete deploy/python-worker deploy/java-worker
kubectl delete namespace sdk-doc-sync   # 连带 PVC/ConfigMap/Secret 一起删
# 注意：PVC 删除即停止 CBS 计费（≈¥0.35/GB/月）；workspace 内未收官的战役
# run/journal 会随之消失——teardown 前先把要留证的 tmp 产物拷回主树归档。
```

## 5. 故障排查

| 症状 | 看处 | 处置 |
| --- | --- | --- |
| pod CrashLoop，日志 `FAIL: <VAR> is empty` | secret 键 | `kubectl create secret … --from-env-file=.env` 后 `rollout restart` |
| 日志 `BASE_TOKEN unavailable … BASE_TOKEN_UNAVAILABLE` | `runs/track-env/<track>.err` | release-tracks.json 未随 clone 到位或该轨缺 baseToken；修注册表后重启 pod |
| 日志 `sessionID NOT captured` | `runs/<ts>-<track>/opencode.err` | opencode/LLM 侧失败；修复 env 后该 slot 批准注入会报 `SESSION_NOT_ARMED`，需等下一次派出 |
| 门铃无飞书消息，`gate_notify_failed` | `BOT_*`/`OPERATOR_EMAIL`/网络 | 卡片未发出时看板镜像仍在：`gate-presentation/latest-index.json`；修复后重启 pod，已 seen 的门不会重发，人工看 index 补批 |
| `kubectl exec` 注入报 exit 3 | 行形态 | pod 内二次校验没过：回现行不是逐字复制（或旧 digest 已作废） |

## 6. 求证结论（本脚手架依赖的外部事实，2026-10-24 实测）

- **opencode 1.18.30 headless**：`opencode run [message..]`；`-m provider/model`；
  `--format json` 产 NDJSON 事件、每行带顶层 `"sessionID":"ses_…"`；
  **`-s, --session <id>` 续指定会话**（实测续会话能回忆上一轮）——supervisor 用
  `-s` 精确续跑；**`-c, --continue` 只续项目目录最后一个会话**，双 slot 共用 cwd
  会串会话，故弃用。
- **飞书 API 取点**：token 走 `POST /open-apis/auth/v3/tenant_access_token/internal/`
  （`BOT_*`，larkTokenFetcher.js 同款）；email→open_id 走
  `POST /open-apis/contact/v3/users/batch_get_id?user_id_type=open_id`
  （任务书所称 "users/lookup" 的实际端点）；发消息
  `POST /open-apis/im/v1/messages?receive_id_type=open_id`，首选 interactive 卡片、
  失败降级纯文本。
- **BASE_TOKEN 可读性**：见 §1 结论——注册表在库、机器可读，无需操作员补 env。
