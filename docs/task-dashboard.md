# 任务看板（Task Dashboard）

日期：2026-10-05
状态：批 1–4 已合并（#92–#95）、批 5（信息架构重排，PR #96）；批 6（live 飞书统计 + 发现呈门）本 PR；批 7（token 消耗）见 §5 路线
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
- **哨兵卡**（cron 自动化 = 定时触发的会话）：下次运行由固定墙钟时刻推导（不解析 cron、不读宿主内部状态）；上次运行取游标文件 mtime（与 CronList 的 lastRunAt 秒级吻合）；>25h 未动游标 → `stale`。**就绪徽章（2026-10-08）**：每卡附确定性前提检查——游标已跑过 / SDK 克隆在位 / identity 地图齐 / scan-state 基线播种；全绿 = `已就绪`，能力齐而基线缺 = `已就绪 · 待首战`（首战 close-session 后自动翻绿），有缺 = `前提缺失` 并点名缺件（例：go 缺 go-v30 地图=在途真相）。新增自动化 = `ledger.js` 的 `SENTINELS` 表加一行（现登记：C++ 09:00 / Go 09:15（automation-758e7bed，2026-10-05 加入）/ Java 09:30 / Python 09:45（pymilvus，2026-10-08 加入）/ Rust 10:00（milvus-sdk-rust，2026-10-08 加入）/ Node.js 10:15（milvus-sdk-node，2026-10-10 加入，v3.0.x 轨用裸 `node` scan-state 键））。
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
- **派会话（真·一键）**：`POST /api/spawn-session {target}` **默认关闭**（`npm run dashboard -- --allow-spawn` 开启）——服务端用目标战役的确定性简报作 prompt，detached 派 `zcode --cwd <repo> --surface desktop --prompt <简报>`：**无终端，会话直接出现在 ZCode 桌面端**，简报即上下文、hooks 照常生效、首轮按简报工作并在 APPROVE_* 门禁停下等操作员。前提=CLI 已配模型 provider（本机已配 `provider.bigmodel` 指向 coding plan，见记忆 `zcode-cli-desktop-auth-model`）。argv 向量派生无 shell，target 先经战役解析 fail-closed。卡片按钮：复制 `/attach <键>`（恒在）+ 派会话（开启时，携带精确会话路径）。

## 4c. 界面批准转发（批 4，已实施）

**红线不变**：UI 无独立写路径、不造第二真相——"批准"只是把操作员确认过的 `APPROVE_* [id] sha256:<digest>` **精确行原文注入看板派出的 worker 会话**（`zcode --resume <sessId> --prompt <行> --surface desktop`），语义与 digest 绑定仍由 canonical CLI 的 L1 门禁执法，UserPromptSubmit 钩子照常软校验格式。

- **worker 注册表**（server 内存运行态，非 durable 真相）：派会话时以 `--json` 运行并在进程退出时捕获 `sessionId` → `card.workers [{sessionId, spawnedAt, status}]`；`idle`（进程已退、会话持久化）才允许注入，运行中 409 拒绝。
- **`POST /api/approve {target, sessionId, line}`**：`--allow-approve` 显式开启（默认关，与 `--allow-spawn` 相互独立）；行格式服务端硬校验（`^APPROVE_(GROUPING|WRITES|DOCUMENT|ROLLBACK|ACCEPTANCE)( \S+)? sha256:[a-f0-9]{64}$`）；sessionId 必须属于该战役的看板 worker（fail-closed，操作员手开的会话不接受界面注入）；argv 向量派发无 shell。
- **UI 批准表单**（卡片 ⛩ 批准按钮 → 抽屉）：门类型按 nextGate 预填、review-unit-id 预填、**APPROVE_DOCUMENT 的 journal digest 从 `pendingExecutions[].executionJournalDigest` 原样预填**（ledger 只透传不推导），其余门从呈门材料粘贴；实时行预览 + 前端正则与确认弹窗。
- 已知边界：仅看板派出的 headless worker 可注入（防并发写同一会话）；操作员在桌面端手开的会话走原流程（手打批准行）。

## 4d. 信息架构重排（批 5，本 PR）

操作员反馈驱动：哨兵卡"PR 游标"双语言同值引误解（实为共享的 web-content 全仓水位，Java 扫描器首跑从 C++ 播种）、并行矩阵同轨多会话堆叠不合用、按钮语义不明、其它四技能无看板。重排遵循四条 UX 实践：渐进披露（总览→技能→语种→版本→战役六级下钻，技术细节收折叠）、signal-first（"待你决定"置顶，主按钮=下一个决定）、位置面包屑 + hash 路由（`#/…`，返回不丢上下文）、清单表格化（状态筛选 + finalized 折叠，战役再多只是行数涨）。

- **导航**：五技能入口（API 参考 / 本地化对齐 / 示例补齐 / 代码验证 / 验证式起草）；其余四技能为占位页（技能说明 + SKILL.md 指引 + "数据源待逐个讨论"），按操作员节奏逐个深化。
- **哨兵卡改版**：主信息=今日报告结论原文（`readDailyReport` 只透传 `**结论：…**` 行，数字仅当结论自带才提取，绝不数 bullet）+ 日报链接；水位降为 footnote 并注明"两扫描器共用同一上游水位，同值属正常"。
- **语种卡片**（`buildSkillTracks`，registry 驱动）：release-tracks.json 列语种×版本轨道（新版本需登记才受治，live 内容统计批 6 接入）；卡片显示战役计数 + 版本下拉入口 → 轨道页（scan-state 基线 + 该轨战役清单）。未登记轨道的战役在页脚如实列出，不静默丢弃。
- **战役清单**：表格 + 状态筛选（finalized 默认折叠），行内快捷"复制挂载命令"；点击进战役详情页。并行矩阵区块删除（被本层级取代）。
- **战役详情页**（`campaign-detail.js` + `GET /api/campaign?path=`，替代抽屉）：工作流 stepper（发现→分组→写入·验收→收口）、规模行（单元/动作/PR 文件/SDK 源码变更/版本区间）、**文件表**（文件名主显+全路径悬停，join 键 = release-scope `actions[].stableId` ≡ 单元 `documentStableId`；BACKFILL 无 PR 文件如实标注"源码证据"；未入组 PR 文件尾列"未入组"）、回执折叠、工件/journal 折叠。
- **一键批准**：当前门的人话摘要 + 「批准并继续」——前端用批 4 已有的预填链（nextGate + `pendingExecutions[].executionJournalDigest` 原样透传）自动组装精确 APPROVE 行，digest 收"技术详情"折叠；digest 不能自动预填的门引导去高级表单（批 4 手组表单保留为兜底）。服务端 `/api/approve` 语法硬校验与 worker 注册表约束不变。
- **按钮改名**：「复制挂载命令」（原"复制 /attach"）、「一键派出执行会话」（原"派会话"），均带 tooltip；总览页常驻"看板怎么用"折叠说明。
- **红线不变**：新增端点全部 GET 只读；`/api/campaign` 对不可发现路径 fail-closed（须在扫描根内、且为 durable 会话契约）。

## 4e. live 飞书统计与发现呈门（批 6，本 PR）

**红线修订（操作员已确认）**："哨兵只发现不处置"修订为——发现物呈门后可**一键派出只读 intake 会话**（仍属人工动作），**分组门=开工门**：worker 停在 APPROVE_GROUPING，操作员批准分组后才进入写作；写路径仍全走 canonical CLI + digest 门禁。

- **live 统计**（`live-stats.js` + `GET /api/live-stats`）：registry 驱动逐轨拉取——Bitable 记录总数（tables 解析 + `page_size=1` 读 `data.total`，一页即得）+ Drive release 根 BFS 计 docx 文档数/目录数（cap 2000 节点防失控）。TTL 10min 后台刷新、单飞（single-flight）、逐轨隔离失败（一轨坏不沉全船）、无凭证/无网降级为"live 拉取失败（registry 静态）"chip——降级是载荷不是错误码。认证复用技能侧 `larkTokenFetcher`（node-fetch/dotenv，仓内依赖；token/fetch 可注入故测试零网络）。语种卡片显示聚合 chip，轨道页显示该轨明细行。
- **每日发现**（`scout-findings.js` + `GET /api/scout?language=`）：只认**当日**精确日更工件 `daily/<date>-<lang>-v<N>.json`（带额外后缀的战役制品如 `-grantpriv`/`-reviewed` 一律不算；扫描器对未处理发现每日重发、处理完成后次日不再产出——昨日工件=已处理历史，呈门会误导，故当日无工件即无待办，哨兵卡当日结论为权威）；`actions[]` 人话字段（symbol/type/reason/证据定位）原样透传，绝不重推导。语种卡片黄牌"今日发现 N 项待处理"→ 语种页发现表（方法/类型/原因/证据/轨道）。
- **一键开始处理**（`intake-brief.js` + `POST /api/spawn-intake`，需 `--allow-spawn`）：以发现工件为种生成确定性处理简报（发现清单原文 + 工作指令：只读 intake→停在分组门 + 门禁格式/铁律），`scout:<工件路径>` 登记 worker；工件路径 fail-closed（必须是该语种当日允许集内成员）。UI 按钮文案"开始处理"并注明"先分组审批"。
- **轨道页常驻「启动该轨道工作」**（批 9，`buildTrackIntakeBrief`，`mode: "track"`）：不依赖当日工件——侦察由会话现场完成（tag 对照/web-content PR/源码变更），有发现建评审会话停分组门、无发现明确报告不建会话；registry fail-closed（未登记轨道拒绝）；检出可选（多检出时下拉，默认主检出），worker 以该检出为 --cwd，登记键 `track:<检出>:<轨道键>`。这补上了"页面启动工作但永远显示无战役"的缺口：入口常在，会话建立后卡片自然出现。

## 4f. token 消耗（批 7，本 PR）

数据源=宿主 CLI 逐回合转录 `~/.zcode/cli/rollout/model-io-<sessionId>.jsonl`（usage 嵌于 `response.providerMetadata.*`，snake/camelCase 双形兼容解析）。宿主会清理这些文件，故看板每 2 分钟增量采集进 `tmp/dashboard-events/dashboard.db`（**node:sqlite，零依赖**；store 是派生遥测——删库无损治理，只丢历史数字）。采集三路归因：dashboard 事件（sessionId+sessionRef→战役）、worker 注册表（spawn/派单 exit 捕获 sessionId）、**approve 回合边界**（`/api/approve` 派发前快照 turns/totals，worker exit 后收割并差分→归到被批准单元=逐篇消耗）。

- `GET /api/usage?path=<战役>`：总计（输入/输出/缓存读/缓存写/合计）+ 分会话表（归因来源/回合/最近活动）+ 逐篇表（看板批准回合）。
- 战役详情页"token 消耗"面板如实标注边界：采集自看板批 7 上线起（历史战役无数据）；人工会话回合计入战役级、无法精确到单篇；不做估算。
- 转录文件名形如 `model-io-sess_<id>`（下划线），正则捕获完整 sessionId 保证与事件归因键一致；文件回缩（宿主轮转）时行集重建不残留幽灵行。

## 4g. 多检出感知（批 8，本 PR）

操作员报告：活动流里会话事件一直在跑、目录都是进行中的战役，但 API 页各 SDK 显示无进行中战役。根因=两个作用域不一致——事件钩子用户级注册、所有会话（含兄弟 worktree 里干活的）事件都汇入主检出事件流；而战役发现只扫主检出 tmp/。兄弟 worktree 是本仓常态工作方式（go-v30 入库已在 worktree 干跑、java-v30 修订管线在另一 worktree），不扩展则 worktree 战役永远不可见。

- **多检出战役发现**：server 经 `git worktree list --porcelain` 维护检出注册表（main=主检出；兄弟按目录名命名；10 分钟刷新）；ledger 逐检出走同一发现契约（各自 tmp/ 扫描根 + 各自 scan-state 做僵尸判定），卡片带 `checkout/checkoutLabel`，身份键升级为 `<checkoutId>::<relative>`（同相对路径跨检出永不碰撞）。skillTracks 计数天然跨检出——语种卡片"战役进行中"如实覆盖 worktree 战役。
- **正在运行的会话面板**（总览）：从事件流按 sessionId 聚合近 30 分钟活跃会话——每会话显示在哪个检出（由摘要中的绝对路径最长根匹配推断，主检出根是兄弟路径前缀的陷阱已修）、工具分布、归因战役。未建评审会话的管线工作（如 pr-polish 修订、入库 dry-run）不再只能从原始事件流里猜。
- **动作跨检出**：`/api/campaign`、spawn、approve、`/api/usage`、usage 归因全部接受检出限定键；spawn/approve 以卡片所属检出为 `--cwd`；`/api/file` 白名单扩展到已知检出的同款 tmp/ 前缀（仍逐检出 fail-closed）。
- 兼容：裸路径按主检出解析（老链接不断）；`main::` 前缀仅出现在新键。

## 4h. 修订战役卡与交接（批 10，本 PR）

修订战役（sweep 后修订轮）不走评审会话状态机——durable 状态=工作单（发现清单/裁定）+ 分组门 manifest + 每页一份 apply-review run-manifest。此前这类战役在看板上不可见，会话一结束就消失，交接只能翻记忆。

- **修订卡**（`buildRevisionCards`，载荷 `revisions[]`）：逐检出扫 `tmp/api-reference-sync/*worklist*.json`；范围口径优先取分组门所链**活体 revision-scope**（新于工作单）；进度=apply-review run-manifest 逐页对账（revision / pr-polish 两流）；分组门 digest 展示；**同 stem 跨检出去重**——活的（进度更深/带门）胜出，主检出筹备期残留副本出局。API 参考页与语种页新增"修订战役"区，语种卡计数并入。
- **交接=/attach 第三类目标**：`/attach <工作单 stem>`（如 `java-revision-worklist`，`rev:` 前缀/全键均可）→ 确定性简报=工作树指引（一切以该检出为准）+ 裁定原文 + 分组门 digest（提示确认已批）+ 已写页面逐条对账 + 待写页数 + 续接规则（governed writer 逐页 manifest/共享页 in-place/需决策即停）+ 铁律。`buildBrief` 在战役解析失败后自动尝试修订目标；CLI 与 spawn 派单同一入口（修订 worker 以工作树为 --cwd）。

## 4i. 门铃通知（批 14，本 PR）

解决"操作员盯板"（自动化路线 S1 的注意力回路）：worker 停门、哨兵停摆、待关账等可行动项主动推送到操作员飞书**点对点会话**（绝不发群），把"人盯板"翻转为"板找人"。

- **事件派生**（`gate-watch.js`，纯函数，载荷零第二真相）：战役门（nextGate 停在 APPROVE_*/RESOLVE_ROLLBACK）、僵尸会话、待关账（awaiting-close）、回执未落（staleReceipts）、**未批分组门**（intakes 卡 approved=false——含会话建立前的首门，dwell 用真实 presentedAt）、哨兵停摆（stale）与具备条件却从未运行（never-run 且 capabilityReady）、失联 worker（派单台账有 dispatch 无 exit，2–24h 窗口）。
- **发送决策**（同一模块）：追加式 `tmp/dashboard-events/notify-ledger.jsonl`（send/resolve 两类记录，最新记录定夺）——未发过才发、同事件**2h 升级重提醒**、事件消失记 resolve（再出现视为新）、**静默窗 22:00–07:59 只记账不发送**（攒到早窗合并成一条）；发送记录只在消息真发出后落账，失败的下扫重试。
- **消息形态**：纯文本、合并单条（一次扫一条消息列全部待决项）、按事件真实时间戳算 dwell（"已等待 48.0 小时"）、**无链接无 digest**（卡片链接不可点与 digest 仅展示两条既有裁定），处理入口指向看板。
- **发送器**（`notify-feishu.js`）：复用 skill 的 larkTokenFetcher（.env APP_ID/APP_SECRET）；收件人=OPERATOR_OPEN_ID 直用或 OPERATOR_EMAIL 经 contact batch_get_id 反查（需只读 scope contact:user.id:readonly，open_id 进程内缓存）；fetch/token 全可注入，测试零网络。CLI 冒烟：`node scripts/dashboard/notify-feishu.js --text "..."`。
- **接线**（server.js）：`--notify` 显式 opt-in（与 --allow-spawn/--allow-approve 同款模式——发 IM 是遥测不是写路径，governed 状态仍零接触）；5 分钟周期扫 + worker 退场后 60s 加扫 + 启动 90s 首扫（等 nextGate 刷新落定）；一切失败打日志降级，看板本体不受影响。

### 14b. 消息指令回路（回复即批准）

`--notify-relay`（隐含 --notify）在同一私聊里接收操作员指令：**长连接**事件订阅（`@larksuiteoapi/node-sdk` WSClient，无公网端点，拨出式）。语法确定性（bot-integration 契约，绝不自由解释）：

- **回复（引用）某条通知消息 + 「批准」** → 批准该通知的分组门。信任链：回复 root_id → 发件台账（`notify-outbox.jsonl`，发送通知时落 message_id→事件绑定）→ 唯一分组门事件 → **digest 执行时从工件重读**（绝不取自消息文本；工件变了=STALE_DIGEST 拒批并失效旧通知键等重发新通知）→ 组装精确 `APPROVE_GROUPING sha256:<digest>` 行 → 与 /api/approve 同一条 resume 注入链（`dispatchResumeTurn` 共用核：注册回合+usage 边界归因+退场重响门铃）。worker 会话从派单台账 dispatch/exit 对（trackKey 精确 join 优先、歧义即拒）；重复回复幂等；非操作员/群聊消息整体忽略。
- **「状态」** → 当前全部待决事件快照（同门铃派生）。
- **「帮助」/未知指令** → 语法说明。
- **v1 边界（诚实声明）**：消息通道只受理**分组门**——digest 是 gate manifest 的一手字段（读工件≠造第二真相）；写门/文档门/回滚/验收的 digest 由 canonical CLI 派生呈报，看板重派即第二真相，一律回复指路看板。
- 应用侧前置（一次性）：后台「事件与回调→事件配置」切**长连接**、订阅 `im.message.receive_v1`、事件详情勾上单聊权限（`im:message.p2p_msg:readonly`）、**发版生效**；未配置时长连接失败自动降级为纯门铃。


## 5. 路线

- **批 1（PR #92）**：聚合层 + 只读 server + 页面 + 测试。
- **批 2（PR #93）**：事件流钩子 + 活动流 UI + 卡片最近活动 + `/api/file` 目录列表。
- **批 3（PR #94）**：attach 命令 + nextGate 富集 + 并行矩阵 + 一键派会话（headless → desktop surface，官方 CLI）。
- **批 4（PR #95）**：界面批准转发（§4c）。
- **批 5（本 PR）**：信息架构重排（§4d）。
- **批 6**：live 飞书统计（registry 驱动逐轨 Bitable 记录总数 + Drive 文档数，TTL 缓存失败降级）+ 每日发现呈门（scout 工件解析成人话清单，「开始处理」一键派只读 intake worker，**分组门=开工门**：worker 停在 APPROVE_GROUPING 等操作员批准后才进入写作——"哨兵只发现不处置"修订为"呈门后的一键派单仍属人工动作，两道人工确认不变"）。
- **批 7**：token 消耗（harvest 宿主 `~/.zcode/cli/rollout/model-io-sess_*.jsonl` 逐回合 usage → `node:sqlite` 派生遥测库，approve 回合边界差分归因到单篇；战役详情加消耗面板：总计+分会话小计+分篇明细+采集覆盖率注记；历史无数据如实标注）。
- **批 14**：门铃通知（§4i）——飞书 p2p 直达操作员，`--notify` opt-in；自动化路线 S1 注意力回路的第一段。

## 6. 测试

- `tests/skills/dashboard-ledger.test.js`（批 1，fixture 在 `os.tmpdir()`）：双根发现与噪音过滤、awaiting-close/zombie/finalized 判定与排序、scanStateKey 优先级、哨兵 mtime→lastRun/墙钟→nextRun/stale/never-run、准入台账尾条与呈门在位。
- `tests/skills/dashboard-events.test.js`（批 2）：钩子子进程端到端（fixture 根重定向；exit 0/空 stdout/事件落盘带 sessionRef 与 summary）、仓外 no-op、坏 stdin 容错、跨日文件合并/坏行跳过/绝对路径归因/卡片活动盖章、normalizeSessionRef。
- `tests/skills/dashboard-detail.test.js`（批 5）：详情 join（单元↔release-scope 文件表：accepted/pending/queued/BACKFILL 无 PR 文件/未入组行、规模计数、回执 repo 相对化）、路径 fail-closed（越界/非扫描根/非 durable 会话）、哨兵今日报告结论透传（无变化/发现 N 项/缺报告）、registry 轨道聚合（计数归属、未登记战役不泄漏、缺 registry 容错）、trackScanStateKey 推导。
- `tests/skills/dashboard-live.test.js`（批 6）：live-stats（注入 token/fetch 零网络——bitable 一页读 total、Drive BFS 计数与回边不死循环、collector ok/partial 逐轨降级/TTL 缓存不重拉/过期强刷/缺 registry 优雅失败）、scout-findings（精确日更模式识别、后缀制品排除、回看窗、字段透传）、intake-brief（确定性文本、战役后缀工件 fail-closed、目录外路径拒绝）。
- `tests/skills/dashboard-checkouts.test.js`（批 8）：worktree 清单解析（bare 跳过/主检出标签）、跨检出发现与键防碰撞（同相对路径双检出+各自 scan-state 僵尸判定）、绝对 sessionRef 只归因本检出、运行会话推导（窗口/最长根匹配检出推断/战役滚动归因）、resolveSessionTarget 键解析。
- `tests/skills/dashboard-revision.test.js`（批 10）：修订卡发现（活体 scope 优先/apply-review 逐页对账/无关 run-manifest 不计）、跨检出去重（进度深者活）、目标解析三种形态与简报确定性。
- `tests/skills/dashboard-usage.test.js`（批 7）：解析（嵌套 snake/camelCase、无 usage 行不算回合、坏行容忍）、增量采集（追加快路径/书签跳过/轮转重建无幽灵行）、事件归因（绝对路径归一化 join）、approve 边界差分（resume 回合归到单元）、空态诚实呈现。
- `tests/skills/dashboard-notify.test.js`（批 14/14b）：事件派生（战役门/僵尸/待关账/回执未落四类一卡一事件、僵尸不重复报门、未批分组门与已批静默、哨兵 stale/never-ready/never-unready 三态、失联 worker 只在 2–24h 窗）、发送决策（首发、2h 内去重、升级重提醒、resolve 后再现视为新、静默窗记账不发送、force 越窗）、dwell 从事件真实时间戳起算、消息纯文本无链接无 digest、发送器（邮箱反查+请求形状、OPERATOR_OPEN_ID 优先且反查缓存、缺目标/无用户/scope 拒绝三类 typed 错误、线程内回复+无 id 回退平发）；relay（指令语法确定性、事件解码拒非文本/无发送者、worker 解析 trackKey join 优先/歧义拒/无 exit 跳过、planApprove 快乐路径拼精确行/STALE 拒且失效键/已批/多事件/工件不可读/无 worker 五类拒绝、handleIncoming 非操作员与群聊整体忽略/无引用与外来说明/幂等重批/状态与帮助）。
