# 任务看板（Task Dashboard）

日期：2026-10-05
状态：批 1 已实施（只读看板）；批 2–4 见文末路线
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

## 4. 与 hooks 的关系（批 2 预留）

批 1 不新增任何 hook。批 2 将在现有用户级注册（`~/.zcode/cli/config.json`，与已在跑的 session-start/user-prompt-submit/post-tool-use-failure 三件同款）追加 PostToolUse 事件水龙头：append-only 事件 JSONL 落 `tmp/dashboard-events/`，看板时间线消费。cron 自动化会话天然被同一 hook 覆盖——哨兵卡的运行时间线自动进界面，零额外接线。

## 5. 路线

- **批 1（本 PR）**：聚合层 + 只读 server + 页面 + 测试。验收 = `npm run dashboard` 打开看到全部战役卡/哨兵卡/准入态；改 tmp 下任一 session 文件卡片在秒级刷新。
- **批 2**：事件流 hook（用户级注册）+ 时间线 UI + 卡片"有人干活/遇门"状态。
- **批 3**：会话生命周期——attach 命令、界面"派会话"按钮（`zcode -p --json --cwd` / agent-hub）、语言×轨道并行视图。
- **批 4**：界面写操作——批准按钮仅转发 canonical CLI（APPROVE_* 精确行），UI 无独立写路径；server 自身受 R4 同款证据面保护审视。

## 6. 测试

`tests/skills/dashboard-ledger.test.js`（fixture 在 `os.tmpdir()`，绝不落在仓库扫描根内）：双根发现与噪音过滤、awaiting-close/zombie/finalized 判定与排序、scanStateKey 优先级、哨兵 mtime→lastRun/墙钟→nextRun/stale/never-run、准入台账尾条与呈门在位。
