# deploy/ — S2 战役 pod 部署脚手架（一轨一 pod）

跑在 **milvus-cell vCluster**（kubeconfig `~/.milvus-cell/kubeconfig`；运维收口
`deploy/milvus-cell-ops.sh`——战役期休眠策略/RWO 安全重启/退役盘点）。**拓扑裁定
（2026-10-25）：一个 pod 只跑一条版本轨**——pymilvus 的 v3.0.x 与 v2.6.x = 两个
pod（`python-v3-worker` / `python-v26-worker`）。同语言两轨的 SDK 检出钉不同
commit、文档树并发写两类竞态由 pod 边界整体隔离，无 slot、无跨轨串行守卫。
部署清单不手写：`deploy/gen-worker-deployment.sh <language> <track>` 生成
（PVC `workspace-<trackKey>` + Deployment `<trackKey>-worker` 一体）。

```
                     ┌─────────── sdk-doc-sync namespace ────────────┐
 Mac（操作员）        │  python-v3-worker   python-v26-worker   …    │
 ┌─────────────┐     │  ┌───────────────┐  ┌───────────────┐        │
 │ milvus-cell │     │  │ supervisor    │  │ supervisor    │  每轨：│
 │  -ops.sh    │     │  │ ①30min scan   │  │ （同构，       │        │
 │ pod-approve │────▶│  │ ②简报+opencode│  │  v2.6.x 轨）  │        │
 │  --list     │queue│  │ ③战役常驻卡   │  │               │        │
 └─────────────┘     │  │ ④批准队列→-s  │  │               │        │
 飞书（操作员）◀──────────│ ⑤logs/…      │  │               │        │
                     │  └──────┬────────┘  └──────┬────────┘        │
                     │  PVC workspace-<trackKey>（10Gi RWO/轨）      │
                     └──────────────────────────────────────────────┘
```

配额提示：vCluster 每用户 16 CPU / 64 GiB；worker 限 2CPU/4Gi ⇒ 十二个 pod 内
安全（六语言×双轨全开也在界内）。

目录内文件：`namespace-pvc.yaml`（仅 Namespace——PVC 随各轨 deployment 生成）、
`gen-worker-deployment.sh`（一轨一 pod 清单生成器）、
`milvus-cell-ops.sh`（宿主平台运维收口）、`secret-template.yaml.example`
（形态示例，真值永不入库）、`configmap-scripts.yaml`
（bootstrap/supervisor/seed-backlog 部署镜像）、`configmap-backlog.yaml`
（python 6 条 / java 8 条 pending backlog 快照）、`lib.js`（双端共享内核，
tests/skills/deploy-scaffold.test.js 直测）。控制面云化（2026-10-24 裁定）新增：
`relay-entry.js`/`relay-entry.sh`（回调常驻入口）、`relay-kubectl-fetch.sh`
（initContainer 从 pkgs.k8s.io 官方包仓库取 kubectl：gpg 验 InRelease → SHA256
钉 Packages → SHA256 钉 deb——dl.k8s.com egress 不通、apt flat 仓索引在该容器
静默不加载的三轮实测修正）、`relay-rbac.yaml`（SA relay-approver 最小 exec 面）、
`relay-deployment.yaml`（relay pod）、`configmap-relay.yaml`（六文件部署镜像，
副本一致性测试钉死）。

---

## 0. 前提

- Mac 侧：`kubectl`（client ≥1.36）、`node ≥20`；`KUBECONFIG` 指向
  `~/.milvus-cell/kubeconfig`（或每条命令前缀 `KUBECONFIG=~/.milvus-cell/kubeconfig`）。
- 仓库根有 `.env`（git-ignored），至少含：`LLM_BASE_URL` `LLM_API_KEY`
  `LLM_MODEL` `GITHUB_TOKEN` `BOT_APP_ID` `BOT_APP_SECRET` `FEISHU_HOST`
  `OPERATOR_EMAIL`（战役 worker 走 Bitable/Drive 写入还需 `DOC_APP_ID`
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

# 4) 生成并 apply 各轨 deployment（一轨一 pod：要几轨生成几个；
#    例=pymilvus 双轨。SDK_REPO env 指该语言的 SDK 仓库名）
SDK_REPO=pymilvus bash deploy/gen-worker-deployment.sh python v3.0.x  > deploy/out/python-v3.yaml
SDK_REPO=pymilvus bash deploy/gen-worker-deployment.sh python v2.6.x  > deploy/out/python-v26.yaml
kubectl apply -f deploy/out/python-v3.yaml -f deploy/out/python-v26.yaml

# 5) 战役期宿主设置：关定时休眠（默认每日 23:00 睡=战役中途全灭）+ 确认唤醒
bash deploy/milvus-cell-ops.sh sleep-off
bash deploy/milvus-cell-ops.sh ensure-awake

# 6) 盯首次引导（apt/gh/opencode 安装 + clone + npm ci，约 3–6 分钟）
kubectl -n sdk-doc-sync logs -f deploy/python-v3-worker
kubectl -n sdk-doc-sync get pods -w
```

bootstrap 幂等（PVC 上 marker `/workspace/.bootstrap-done` 短路重装），pod 重启只
补差异；marker 命中路径仍会：重渲染 `opencode.json`、重导 BASE_TOKEN（fail-loud）、
重种 backlog（import-backlog 天然幂等）。

**BASE_TOKEN 结论**：`.claude/skills/api-reference-sync/config/release-tracks.json`
机器可读、每轨带 `bitable.baseToken`，bootstrap 按 `TRACK`（本 pod 唯一轨）导出
`/workspace/runs/track-env/<version>.env`——一轨一 pod 后 BASE_TOKEN 恒为本轨，
**操作员无需补任何 env**。若注册表不可读或该轨缺 baseToken，bootstrap 以 typed
错误退出（`BASE_TOKEN_UNAVAILABLE`），绝不带空 BASE_TOKEN 起战役。

## 2. 日常运维

### 看日志 / 看门 / 看账本

```bash
K="kubectl -n sdk-doc-sync"
$K logs --tail 100 deploy/python-v3-worker     # supervisor 运行日志（亦持久化在 PVC）
node scripts/dashboard/pod-approve.js --list   # 全部 worker pod events.jsonl 尾 20 行（按 part-of 标签枚举）

# 账本/水位/呈门产物都在 PVC 的 repo 主树里，可直接 exec 看：
$K exec deploy/python-v3-worker -- sh -c 'tail -5 /workspace/feishu-markdown-bridge/tmp/api-reference-sync/daily-scan/pr-findings.jsonl'
$K exec deploy/python-v3-worker -- sh -c 'ls /workspace/feishu-markdown-bridge/tmp/api-reference-sync/gate-presentation/'
$K exec deploy/python-v3-worker -- sh -c 'cat /workspace/feishu-markdown-bridge/tmp/api-reference-sync/gate-presentation/latest-index.json'
```

### 战役常驻卡与批准注入（一场战役一张卡）

战役 worker 停在 APPROVE_* 门 → supervisor 检出新
`gate-presentation/<sessionKey>/*-<gate>.index.json` → **PATCH 本轨的战役常驻卡**
（`deploy/lib.js campaign-card`；卡状态 `/workspace/runs/card-<trackKey>.json` 持有
messageId——首发后所有事件都 PATCH 同一张卡，不再每门单发新卡）。卡面（自上而下）：

- **header**：`【战役批准 · 等待批准】python · python-v3`（橙）/【进行中】（蓝）/
  【已完成】（绿）——当前门非空时按钮长在卡上，批准/清门即消失（UX 裁定）。
- **战役概况（持久区块）**：首次呈门从 gate index（`gate-presentation --source`
  透传）捕获，此后整场战役常驻——来源（`来源 PR intake：[#1184](…) [#1188](…)`，
  >5 条尾部"等 N 条"；仓库扫描形态 `来源 仓库扫描：<baseline> → <target>`）、
  文档面（`文档 N 篇 · CREATE x · UPDATE y` + 清单 ≤10 条；工件没有分类数据时如实
  显示"待 dry-run 细化"，绝不编数）、pod 归属（`pod: <trackKey>-worker · 轨道 ·
  语言`——一轨一 pod，pod 名即归属，无 slot）。
- **时间轴**：`▶️ 派单 / ⚑ 战役批准呈报 / ✅ 战役批准已批准（注入，续跑中）/
  ⏱️ 宽限过期，轨道让出 / ✔ 战役终态`（最近 10 条，更早合并计数）。新战役
  `--new-campaign` 同卡续写（状态/时间轴/概况清零，messageId 复用）。
- **当前门**（未批准时）：门名 + 会话短名 + digest 短版 + 完整批准行；每条精确
  回现行一个 primary「批准」按钮，回传 `card.action.trigger` 由 relay pod 的
  `scripts/dashboard/card-approve.js` 接住：操作员身份比对 → 形状校验 → 5 分钟
  去重窗（键=pod:indexId:line）→ spawn `pod-approve.js --json` 注入。尾注保留
  "打回请回复本消息：打回 <原因>"。

**归因**：一轨一 pod——本 pod 检出里的一切呈门工件都属本轨（TRACK_KEY），无歧义；
旧 slot 反解/启发式归因随 slot 模型删除。

无按钮环境（卡片发送失败降级为纯文本，或复制回信）：操作员从卡片（或
latest-index.json 的 `replyLines`）**逐字复制**回现行，Mac 上：

```bash
node scripts/dashboard/pod-approve.js --pod python-v3-worker \
  --line 'APPROVE_CAMPAIGN sha256:<campaign-plan-digest>'
node scripts/dashboard/pod-approve.js --pod java-v26-worker \
  --line 'APPROVE_ROLLBACK <review-unit-id> sha256:<rollback-manifest-digest>'
```

- 行先过本地正则 `^APPROVE_[A-Z]+( \S+)? sha256:[0-9a-f]{64}$`（与 pod 内消费端
  同源，`deploy/lib.js` 单源），再 argv 数组 spawn `kubectl exec`，pod 内以位置参数
  **二次过同一正则**后追加进 `/workspace/inbound/approve.queue`（一轨一 pod：单队列）。
- supervisor ≤20s 轮询出队，`opencode run -s <ses_…>` 续跑本轨原会话
  （sessionID 在派出时从 `--format json` 事件流捕获，存
  `/workspace/runs/campaign.session`）。
- 战役忙时批准行**留在队列原地**（不出队不作废）；无在役会话时该行出队并记
  typed 事件 `approve_no_session`。
- 战役停门后若 `CAMPAIGN_GRACE_SECS`（默认 6h，人工门节奏）无批准注入，supervisor
  让出轨道（typed 事件 `track_released`）；pending 仍在时该轨可被重新派出——新
  会话按盘上 durable 状态续办，绝不凭记忆。

### 宿主平台运维（milvus-cell 收口）

战役期的宿主操作全部走 `bash deploy/milvus-cell-ops.sh <cmd>`（`status /
ensure-awake / sleep-off / sleep-on / refresh-kubeconfig / restart-pod <pod> /
teardown-check`）。三条实测纪律（详见 skill milvus-cell §Unattended worker
fleets）：**全天跑批前 sleep-off**（默认每日 23:00 休眠=战役中途全灭）；**改
ConfigMap/代码后重启 worker 用 `restart-pod`**（RWO PVC 下 rollout restart 新旧
pod 互等死锁，delete pod 才是安全原语）；**退役时 teardown-check 先盘点**（PVC
随 namespace 删、COS bucket 不随 milvus-cell delete 删）。

### 呈门回调常驻 relay（控制面云化裁定，2026-10-24）

`card.action.trigger` 的**唯一订阅者**是集群内 relay pod（namespace sdk-doc-sync），
飞书事件订阅走长连接（`WSClient`，免公网回调地址）；批准注入走**集群内**
`kubectl exec`（SA `relay-approver`：pods get/list + pods/exec create，RoleBinding
见 `relay-rbac.yaml`）。Mac 侧 `server.js` 默认不再订阅同一事件（仅
`CARD_APPROVE_SUBSCRIBE=local` 才启用，本机调试用）——Mac 退场为可选观察端，
Mac 上 `pod-approve.js --pod … --line …` 仍可手工注入。与 Mac relay 的差异
（day one 收紧）：操作员身份（`OPERATOR_EMAIL` → batch_get_id）解析不出来=只记
日志拒批（fail-closed），绝不降级为仅形状校验；每次批准/拒绝回发一条 p2p 文本
回执（pod/行前 60 字符/失败原因）；去重窗持久化 emptyDir
`/relay-work/dedupe.json`（重启丢窗口可接受，5 分钟窗）。

```bash
export KUBECONFIG=~/.milvus-cell/kubeconfig
# 三张卡按序 apply（configmap 已由 repo 文件生成，副本一致性 tests 钉死）：
kubectl apply -f deploy/configmap-relay.yaml -f deploy/relay-rbac.yaml \
  -f deploy/relay-deployment.yaml
kubectl logs -n sdk-doc-sync -l app.kubernetes.io/name=relay -f   # ws connected / card-action 事件
```

代码改动流程：改 repo 源文件（`deploy/relay-entry.js`、`scripts/dashboard/
card-approve.js`、`scripts/dashboard/pod-approve.js`、`deploy/lib.js`）→ 按
`configmap-relay.yaml` 头注释的生成命令重生成 → apply configmap →
`kubectl rollout restart deployment/relay -n sdk-doc-sync`。改动任何五文件之一而
不重生成 configmap 会被 deploy-scaffold 测试拦下（内嵌块 vs repo 逐字节比对）。

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
bash deploy/milvus-cell-ops.sh teardown-check   # 先盘点：PVC/pods/COS 各会失去什么
export KUBECONFIG=~/.milvus-cell/kubeconfig
kubectl delete namespace sdk-doc-sync   # 连带全部 per-track PVC/ConfigMap/Secret
bash deploy/milvus-cell-ops.sh sleep-on  # 战役毕复原定时休眠
# 注意：PVC 删除即停止 CBS 计费（≈¥0.35/GB/月）；workspace 内未收官的战役
# run/journal 会随之消失——teardown 前先把要留证的 tmp 产物拷回主树归档。
# milvus-cell delete --confirm 不删 COS bucket——退役时用 milvus-cell storage rm
# 单独清，或留生命周期 14 天自然过期。
```

## 5. 故障排查

| 症状 | 看处 | 处置 |
| --- | --- | --- |
| pod CrashLoop，日志 `FAIL: <VAR> is empty` | secret 键 | `kubectl create secret … --from-env-file=.env` 后 `rollout restart` |
| 日志 `BASE_TOKEN unavailable … BASE_TOKEN_UNAVAILABLE` | `runs/track-env/<track>.err` | release-tracks.json 未随 clone 到位或该轨缺 baseToken；修注册表后重启 pod |
| 日志 `sessionID NOT captured` | `runs/<ts>-<track>/opencode.err` | opencode/LLM 侧失败；修复 env 后批准注入会报 `SESSION_NOT_ARMED`，需等下一次派出 |
| 门铃无飞书消息，`gate_notify_failed` | `BOT_*`/`OPERATOR_EMAIL`/网络 | 卡片未发出时看板镜像仍在：`gate-presentation/latest-index.json`；修复后重启 pod，已 seen 的门不会重发，人工看 index 补批 |
| `kubectl exec` 注入报 exit 3 | 行形态 | pod 内二次校验没过：回现行不是逐字复制（或旧 digest 已作废） |
| 改代码/ConfigMap 后 worker 不生效 | 更新面 | ConfigMap 就地更新对运行中 pod 安全但旧进程持旧字节；用 `milvus-cell-ops.sh restart-pod <pod>` 重启（**勿 rollout restart**——RWO PVC 新旧互等死锁） |
| kubectl 连接拒绝/EOF | 宿主相位 | vCluster Sleeping/Pending——`milvus-cell-ops.sh status` 先看相位，Sleeping 则 `ensure-awake`；TLS 报错则是 kubeconfig 陈旧，`refresh-kubeconfig` |

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
