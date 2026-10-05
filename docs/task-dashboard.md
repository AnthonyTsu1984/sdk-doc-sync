# 任务看板（Task Dashboard）

日期：2026-10-05
状态：批 1（只读看板，PR #92）+ 批 2（事件流）已实施；批 3–4 见文末路线
关联设计：`docs/zcode-hooks-determinization.md`（L0 hooks）、`docs/campaign-control-hardening.md` §5（呈门三件套）

---

## 0. 一句话

把"任务的首尾"从会话上下文里解耦出来：任务的进度、状态、门禁、回执本来就全部落在盘上（review 会话 JSON、scan-state、准入台账、journal、每日扫描游标），看板只做**派生渲染**——会话变成可抛弃的工作者，上下文满了换会话，工单不变。

## 1. 架构（批 1 形态）

```
浏览器 localhost:8765（scripts/dashboard/public/index.html）
   ▲ SSE 实时推送（文件变了 → 卡片变了）+ 30s 轮询兜底
本地只读 server（scripts/dashboard/server.js，零依赖 Node）
   fs.watch 监听扫描根 + 30s 轮询 → 重新聚合 → 指纹比对后推送
   GET /            静态页
   GET /api/cards   聚合 JSON（战役卡 + 哨兵卡 + 准入 + 呈门在位）
   GET /api/events  SSE
   GET /api/file    白名单文件查看器（session/journal/呈门材料，只读）
   GET /api/healthz
聚合层（scripts/dashboard/ledger.js，纯函数）
   同一棵树进 → 同一份台账出；无写入、无网络
```

启动：`npm run dashboard`（`--port`、`--no-open` 可选）。

## 2. 红线（不可退让的设计约束）

1. **不造第二真相**：卡片每个字段都派生自治理 CLI 已写下的 durable 文件；看板删掉，治理毫发无损。
2. **无写路径**：server 只有 GET；不碰 writer 管线、不推进 scan-state、不代写任何门禁决定。
3. **文件查看白名单**：`/api/file` 仅放行 `tmp/sdk-release-scout/`、`tmp/sdk-doc-sync-runs/`、`tmp/api-reference-sync/`、`tmp/skill-feedback-rollout/` 与 `scan-state.json` 精确一条；越界一律 403。
4. **准入指纹复用同一实现**：`productionInputFingerprint` 直接 require `doc-ops-core/src/run-manifest.js`，后台 TTL（5 分钟）缓存，绝不重算一套。
5. **哨兵卡只发现不处置**：每日自动扫描的发现物只展示与链接；"建战役"永远是人工动作。

## 3. 卡片语义

- **战役卡**（两个扫描根：`tmp/sdk-release-scout`、`tmp/sdk-doc-sync-runs/<track>/`；发现契约与 `.zcode/hooks/session-start.cjs` 一致：`schemaVersion` + 字符串 `status`，跳过 archive/dryrun/superseded）：
  - 健康档位：`active`（进行中）/ `awaiting-close`（◐ 全单元已接受、无挂起，只差 close-session）/ `zombie`（⚠ scan-state 已越过会话目标 tag，收官未终态化，勿续跑）/ `finalized`（已收官，排后）。
  - 字段：language/track/flow、sessionId、单元进度、挂起执行、活动执行/回滚、scan-state 对照（key/lastScannedTag/targetTag/advancedPast）、工件与 journal（repo 相对路径）、已接受单元的文档/记录链接（飞书真实链接，可点）。
- **哨兵卡**（cron 自动化 = 定时触发的会话）：下次运行由固定墙钟时刻推导（不解析 cron、不读宿主内部状态）；上次运行取游标文件 mtime（与 CronList 的 lastRunAt 秒级吻合）；>25h 未动游标 → `stale`。新增自动化 = `ledger.js` 的 `SENTINELS` 表加一行。
- **准入 chip**：台账最新记录 vs 当前树指纹（后台计算），ADMITTED / 未匹配 / 计算中三态；**呈门 chip**：`gate-presentation/latest.html` 在位即黄牌可点。

## 4. 事件流（批 2，已实施）

**写侧（hooks，本机用户级注册）**：
- `.zcode/hooks/post-tool-use.cjs` — PostToolUse 事件水龙头（matcher `Bash|Write|Edit|Agent|Task`，动作类工具，Read/Grep 噪音不进流）。每次成功工具调用追加一条压缩事件：`{v, ts, kind:'tool', sessionId, tool, summary, sessionRef}`；`sessionRef` = 从 tool_input 中提取的战役会话文件路径（归因键）。空 stdout、恒 exit 0、单次 append 亚毫秒。
- `.zcode/hooks/session-start.cjs` — 原注入钩子顺手追加 `kind:'session-start'` 打卡事件（best-effort，不影响注入契约）。
- 两者共用 `.zcode/hooks/dashboard-event-lib.cjs`（落盘 `tmp/dashboard-events/events-<YYYY-MM-DD>.jsonl`，append-only；`DASHBOARD_HOOK_ROOT` 环境变量仅供测试重定向）。
- 注册于 `~/.zcode/cli/config.json`（与既有三钩子同款 process 形态）。**注意 .zcode/ 被 gitignore：钩子源码是本机态，不入库**——插件化（源码进 git）留待 hooks 确定化战役合流。**hooks 配置在会话启动时快照：注册后新开的会话才生效**。

**读侧（ledger + UI）**：`readRecentEvents` 读今天+昨天两份 JSONL（坏行跳过）；`attachActivity` 以 sessionRef 归因到战役卡（绝对路径归一化成 repo 相对路径精确匹配），卡片获得 `lastActivityAt`/`activityCount`；页面新增"活动流"面板（最近 50 条，Start/Bash/Write/Edit/Agent 着色，归因卡片标注）。cron 自动化会话天然被同一钩子覆盖——哨兵运行时间线自动进流，零额外接线。

## 4b. 会话生命周期（批 3，已实施）

- **`/attach` 命令**（`.zcode/commands/attach.md` 薄路由，本机态）→ 引擎 `scripts/dashboard/attach-brief.js`（入库、CI 测试）：按 scan-state 键（`java-v30`）或会话路径定位战役（多活跃会话时消歧报错），从 durable 状态确定性生成简报——进度/当前门（调权威 `sdk-review-session status` 的 nextGate，绝不自行推导）/scan-state 对照/准入/最近归因活动/续接规则（门禁格式+铁律）。新会话粘贴 `/attach <键>` 即完成挂载，零聊天历史依赖。
- **卡片当前门**：server 后台（60s 周期、TTL 3min、仅非 finalized、≤8 个）调 status CLI 富集 `nextGate`，UI 卡片与矩阵显示 `⛩ 门 <GATE>` 紫色 chip。
- **并行矩阵**：语种×轨道 chip 矩阵（⛩=有门 ●=近期活动，健康档着色，点击直达卡片）。
- **派会话**：`POST /api/spawn-session` **默认关闭**，须 `npm run dashboard -- --allow-spawn` 显式开启；实现为 `open -a Terminal <repo>`（LaunchServices 开交互式终端窗口、cwd=仓库根；Apple Events 的 osascript 方案在无 Terminal 自动化授权时超时，弃用；请求输入永不进 shell）。操作员敲 `zcode`、粘贴已复制的 `/attach <键>`。刻意**不提供 headless 自治执行**——战役门禁必须有人；自动并行执行属批 4 之后的独立讨论。卡片按钮：复制 `/attach <键>`（恒在）+ 派会话（开启时）。

## 5. 路线

- **批 1（PR #92）**：聚合层 + 只读 server + 页面 + 测试。
- **批 2（PR #93）**：事件流钩子 + 活动流 UI + 卡片最近活动 + `/api/file` 目录列表。
- **批 3（本 PR）**：attach 命令 + nextGate 富集 + 并行矩阵 + 选择性派会话（交互式、默认关）。
- **批 4**：界面写操作——批准按钮仅转发 canonical CLI（APPROVE_* 精确行），UI 无独立写路径；server 自身受 R4 同款证据面保护审视。

## 6. 测试

- `tests/skills/dashboard-ledger.test.js`（批 1，fixture 在 `os.tmpdir()`）：双根发现与噪音过滤、awaiting-close/zombie/finalized 判定与排序、scanStateKey 优先级、哨兵 mtime→lastRun/墙钟→nextRun/stale/never-run、准入台账尾条与呈门在位。
- `tests/skills/dashboard-events.test.js`（批 2）：钩子子进程端到端（fixture 根重定向；exit 0/空 stdout/事件落盘带 sessionRef 与 summary）、仓外 no-op、坏 stdin 容错、跨日文件合并/坏行跳过/绝对路径归因/卡片活动盖章、normalizeSessionRef。
