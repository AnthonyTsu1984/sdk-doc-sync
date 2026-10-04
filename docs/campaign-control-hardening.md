# 战役控制力补强设计：三类巡检 + 写时门 + 语义动作

日期：2026-10-03
状态：设计提案（待评审，未实施）
输入：2026-10-03 两份战役复盘（机制模型 V1/V2 + J1–J7 五缺口；巡检模型"三类巡检缺失"）、既有补强清单 ①–⑨（本文取代，对账见 §9）、代码实况核查、外部实践调研。
本文取代 backlog 中的补强清单 ①–⑨，作为唯一路线图。

## 0. 一句话结论

写入门禁（批准 + digest + journal）挡住了"未批准的写"，挡不住"批准了但内容/树本身就是错的"。本设计补四层控制，全部确定性可编码：**巡检层**（语料全库 sweep、拓扑例行审计、跨轨核对——发现存量债与漂移）、**写时门层**（拓扑写前断言、内容五条预检、镜像源白名单——拦新增）、**语义层**（REBUILD 一等动作、fallback 决策表）、**编排层**（状态解释/会话读取/参数集契约）。授权模型不动：每次 live 写仍需人工 digest 批准，人工注意力只花在"新类型"的缺陷上。

六批落地，优先级沿用复盘裁定：批1 语料 sweep（先扫 v3.0 还债）→ 批2 拓扑（决策表+审计+写前断言）→ 批3 镜像白名单+workflow intake v2 → 批4 小件收口 → 批5 REBUILD → 批6 编排契约。

## 1. 设计公理（外部实践佐证）

Anthropic《Equipping agents for the real world with Agent Skills》（2025-10-16 工程博文）给出的做法，与本仓已有实践完全同构，四条公理都有出处：

1. **散文是资料，控制流住代码。** 博文原话："certain operations are better suited to traditional code execution"——需要 deterministic reliability 的工作交给捆绑脚本，脚本运行时不进上下文。本仓 Phase 5 五步管道（bullet→registry→fixture→enforcer→bypass 收口）已是该公理的实现。本设计做一次**边界移动**：已被用户裁定过的措辞性质（首句注册式、Notes 形态、RETURNS 深度）从 eval/polish 域划入 invariant 域——`layout-conformance.js:3-8` 头注"wording quality stays with the polish prompt and model evals"的边界就此收窄为"开放式措辞优化"。
2. **计划-批准-对账。** 每个携带变更的动作：对 live 态计算期望终态 → 批准绑定该计划 → apply 后读回验证，不符即 fail-closed。writer governance 已在"内容写"上实现该模型（digest+journal+post-verify）；批2 把它推广到"拓扑写"。
3. **打回即铸 fixture。** 博文："Learn from failures——capture both successful approaches and mistakes as reusable context/code"。成文为 PR 清偿条件：人工评审每拦下一类新缺陷，当 PR 必须新增反例 fixture（+规则或 runbook），否则不算清偿。人类眼睛不该对同类型缺陷看第二眼。
4. **基线活在数据里，不活在人脑里。** describeReplicas 样板只活在评审者脑子里、grantPrivilege 的正确形态被误判成错位——都是"模型只在人脑"的代价。决策表、白名单、sweep 规则集，本质都是**裁定落盘**。

## 2. 路线图总览

| 批 | 主题 | 核心交付 | 拦截的失误 | 依赖 |
|---|---|---|---|---|
| 1 | 语料巡检 + Intake 预检 | 五条内容规则 + sweep 扩展 + v3.0/v2.6 首扫还债 + intake 内容/结构预检脚本（§3.6） | V2、J3、跨轨镜像染病（配合批3）、A 类五轮诊断链、B 类三条 | 无 |
| 2 | 拓扑 | fallback 决策表 + 例行审计 + 写前断言四件套 | V1、J1、J2、J7、grantPrivilege 误判 | 无 |
| 3 | 镜像纪律 + 呈门可用性 | 镜像源白名单 + saved workflow intake v2 + 呈门链接转换三件套 | "已接受≠正确"、跨轨传播、门卡片链接不可点 | 批1、批2 产物 |
| 4 | 小件收口 | 跨轨核对内置 / 会话卫生 / 多集单一真相 | J4、僵尸会话、临时起意核对 | 无（一次 PR） |
| 5 | REBUILD | 一等重建动作 + 自动路由 | J6 | 无 |
| 6 | 编排契约 | 状态解释共享 / typed session reader / 参数表 | J5 一束 | 无（渐进） |

批1/批2/批4 互相独立可并行；批3 消费前两者的产物；批5/批6 随后。

## 3. 批1：语料巡检——规则引擎五条 + 全库 sweep

### 3.1 五条规则（字节可判，码表）

| 码 | 判定 | 适用 | 反例 fixture 来源 |
|---|---|---|---|
| `CONTENT_CJK_MIXING` | 页面正文含 CJK 码点（英文 SDK 文档轨） | **全局** | 本轮中文 summary 页 |
| `FIRST_SENTENCE_REGISTER` | Description 首句须匹配注册式（默认 `This operation …`；pattern 按语言声明进 profile 数据） | **全局** | 动词开头首句页 |
| `RETURNS_MIN_DEPTH` | 非 void 页 RETURNS 段必须含响应字段列表（≥1 字段 bullet，describeReplicas 两段式形态）；现有 `LAYOUT_RETURNS_MISSING/_PROSE_MISSING/_TYPE_ROW` 家族（layout-conformance.js:156-183）的自然延伸 | **全局（强式裁定）** | v3.0 compact 单句 RETURNS 页 |
| `PARAM_DESC_REQUIRED` | PARAMETERS 每个 bullet 描述非空（各语言参数段形状不同，检测式按 profile 声明） | **全局** | maxWaitSeconds 无描述页 |
| `INTERNAL_NOTE_LEAK` | 治理形态（📘 Notes callout）之外的 Notes 行/内部脚手架残留 | **全局** | 内部 Notes 外露页 |

**适用性裁定（2026-10-03，用户原话裁决）**：五条全部全局生效（第 3 条明确裁强式）。附带政策裁定，与五条同等效力：
1. **web-content 二分**：其带来的**参数、方法等内容项一个不能少**（完整性保真——执法面=semantic-content-map 有序包含语义门的既有机制）；**语言方面的修订以我方基线为准**（首句句式、通顺度、RETURNS 形态、notes、中文残留——执法面=五条机器门+polish 轮）。
2. **web-content 内容=参考不是模板**：从 web-content 同步到飞书的内容一律仍走一轮 polish；polish 处置=内部 notes 移除、首句不合规改写、语言不通顺改写、RETURNS 不合规修写。
3. **verbatim 认证页不豁免内容规则**：pr-verbatim 保护语义内容不被篡改，不保护不合规文风/注记；修订走治理 polish 管线（pr-polish-governed），语义门（第 1 条）同时看住"不能少"。
4. **"语言不通顺→改写"归 polish 域**（模型/eval），五条机器门归 invariant 域——边界移动后的准确分界线。
5. **存量修订授权**：java v3.0.x 与 v2.6.x 既有文档全局扫描后重启一轮修订（§3.4）。
6. **2026-10-04 四条补充裁定**：①getter 首句="This operation returns xx"（与其它 Function 页同结构，不豁免）；②类页首句=**"A xxx instance is xxx"**（同日修订——语料既有类页形态即正字；注册式为声明集合：operation/getter 页 "This operation…"、class/type 页 "A Xxx instance is…"，进 profile 数据 `firstSentencePatterns`）；③Go 全 error 返回在强式 RETURNS 下按 error 字段列示（现实现即为此形态，裁定确认）；④**修订战役范围收窄为仅 v3.0.x**，且 v3.0.x 与其它版本共享的页面在修订战役中 **update-in-place**（与共享档模型一致，不 copy-fork）——sweep 实测 v3.0.x findings 中 token 级共享页为 0，规则入档备用。

正例锚点：describeReplicas 样板页（两段式 RT/RETURNS + 响应字段 PARAMETERS bullets，2026-10-01 格式基线裁定）。

升级变体（P1）：RETURNS 字段数与克隆仓源码对得上——需源码上下文，sweep 报告差集即可，先不进写前门。

### 3.2 落点与边界政策

- 检查逻辑语言无关进 `src/sdk-doc-sync/layout-conformance.js`；语言差异进 `src/renderers/sdk-layout-profiles.js` 数据（`allowedScripts`、`firstSentence.pattern`、`returnSections.minResponseFields`、`paramDesc.required`）——沿 Phase 4 "语言差异=数据"定式。
- **逐语言启用=声明式，沿仓库既有教义**：`sdk-layout-profiles.js:6-8` 明文 "Rules a language does not declare do not apply to that language — absence is a reviewed decision in this data file, not a blind spot"。2026-10-03 全局裁定后，五条进 `GLOBAL_LAYOUT_RULES` 基座（五轨同声明；首句 pattern 与参数段检测式按语言声明，默认继承 java 注册式），原 return-section 族"其它轨 adopt when repolish batches land"的等待状态就此解除——本裁定即该文件所要求的 reviewed decision，落地时在 profile 注释记"2026-10-03 全局裁定"。逐语言生效矩阵：

| 语言 | 声明 | 生效方式 |
|---|---|---|
| java | GLOBAL + returnSections + 五条 | 即刻——sweep 首战 + 修订战役（已授权，§3.4） |
| cpp | GLOBAL + builder 裸签名 + 五条 | 写时门即刻；存量债 sweep 报告，修订随各自战役 |
| python / node / go | GLOBAL + 五条 | 写时门即刻；存量债 sweep 报告，修订随各自战役 |
- **registry 手续**：`contracts/invariants.json` 升版 `api.sdk-page-layout`（v2→v3）或新增 `api.page-content-quality`，statementDigest 绑新 bullet，SKILL.md `## Domain Invariants` 加带 `[id]` 标记条目，conformance fixtures 补正反例——否则 `scripts/check-invariant-coverage.js` 与 `invariant-coverage-report.js --strict` 拒收。这是"边界移动"必须走的治理路径。

### 3.3 双挂载（规则一次编码，两处生效）

1. **写前**：`content-reconciliation.js reconcilePageLayout` 已调用 `checkLayoutConformance`——五条规则进入即自动覆盖写路径；scoped dry-run 产物同检（compact 那次 live 写入+自动回滚本可死在离线）。
2. **全库**：`scripts/reconcile-content.js` 就是现成的全库只读巡检（逐轨枚举 Bitable+去重 Drive walk，`--strict` 非-zero 退出，schemaVersion 2）——扩到 schemaVersion 3 带五规则结果列，即语料 sweep CLI，**不新造轮子**。

### 3.4 首战执行（2026-10-04 裁定收窄：修订战役仅 v3.0.x）

sweep 覆盖 java 全语料（499 页实测），**修订战役范围按 2026-10-04 裁定收窄为仅 java v3.0.x**（v2.6.x 及更老树的存量债留各自战役；worklist 按 v3.0.x 切片）。处置按 §3.1 附带裁定——移除内部 notes、改写首句（operation/getter="This operation returns…"、类页="A Xxx instance is…"）、修写 RETURNS（强式形态），参数/方法等内容项一个不能少（语义门看住）；走既有治理管线分批 APPROVE；**共享页 update-in-place**（token 级共享实测为 0，规则备用）。这一步把"语料的账"从黑变白。其余语言轨：写时门即刻生效，存量债由各自下一场战役的修订轮清偿（sweep 报告先行）。

### 3.5 打回即铸 fixture（成文规则）

人工评审打下的每一类缺陷 → 当 PR 内反例 fixture + 规则/runbook，PR 才算清偿。写入 SKILL.md 评审节 + 本仓评审检查单。

### 3.6 Intake 内容/结构预检脚本（批1 交付物之二，2026-10-03 报告三并入）

开跑前对每条上下文条目 + 每个 action 跑确定性预检（脚本独立存在可先行交付，批3 再接成 saved workflow intake 硬步）：
- 条目结构：16 键齐全；
- action 带 pr；verbatimContent 非空、纯英文（复用 CJK 门）、无内部 notes（复用注记门）；
- request 类符号 params 齐；
- 非 void 返回有响应字段列表（复用 RETURNS 强式门）；首句 `This operation …`（复用注册门）；
- planningContext 完整；UPDATE 带继承证据；target 带 folderAncestry。

执法面=报告三 A 类五轮诊断链与 B 类三条缺陷全部死在开跑前——上下文文件即输入规格说明书，由机器逐字段逆向，不再"用实弹探库"（五轮诊断 ≈ 6M token，本该是开跑前一小时的读物）。

### 3.7 呈门物预检与批次齐平（第三挂载点 + 两条铁律，2026-10-03 报告三并入）

- **第三挂载点**：写门呈报物（`writeApprovalPresentation` 的 markdownPreview = 页面逐字内容）呈门前强制跑五条——不过不呈门。"预览即真相"成文（close 三缺陷全部在预览里肉眼/机器可判，却从未被呈门前检查过）。
- **铁律一（打回即铸的强化形态）**：**操作员拒绝了一条机器可查的规则，就是流程事故**——当轮强制铸造 fixture 进写前离线校验，PR 不带不算清偿（并入 §3.5 执行）。
- **铁律二（批次齐平）**：呈门前对全批所有单元跑同一套检查；任何单元不过 → **整批退回修齐再呈门，禁止把"先写后补"当作选项呈给操作员**（delete/getAsync/hybridSearchAsync 明知缺响应字段还呈批、随后评审门三连拒的教训——queryAsync/searchAsync 与另外三者的不一致根本不该作为一个决策上呈）。

## 4. 批2：拓扑——决策表进数据 + 例行审计 + 写前断言四件套

**挂点警示（实况核查结论）**：api 轨的拓扑门在 `sync-executor.js` 步进机器（`TREE_DELTA_TARGET_OUTSIDE_VERSION_ROOT`、`VIRTUAL_NODE_*`），**不在** doc-ops-core 的 `precondition-verifier.js`（那是 action-batch 侧，localized/procedure/authoring 用）。新断言挂前者，勿挂错。

### 4.1 fallback 链决策表进数据

- 新增 config 层模型：java 五树 fallbackSource 链 + 动作语义决策表——文档住本树=in-place；fallback 源+发生变化=copy-patch-and-repoint+新建目录+section 重指；本树无父目录=建目录+重指向；**记录指向记录在案的 fallback 源=正确形态非错位**（grantPrivilege 判例入表，下次不再"正确答案被标成高风险选项"）。
- 消费方：拓扑审计（下条）、planner 的 `COPY_PATCH_AND_REPOINT`（sync-planner.js:667-679）、saved workflow intake 段（批3）。

### 4.2 拓扑例行审计（intake 前置 + 例行巡检）

- 扩展 `scripts/build-current-placement-audit.js`（已具备全量分页 Bitable 枚举 + Drive ancestry + inheritanceEvidence）：对照决策表逐 section 核对——section folder 要么在本树、要么是记录在案的 fallback 源；页面要么住所属 section、要么在显式豁免清单。`--strict` 输出 worklist。
- **intake 前置**：任何 java 战役开跑前必跑，worklist 清零或显式豁免后才进规划。
- **首跑 worklist 即还债清单**：Client section 归位（folder 还挂在 v2.5 根）、close/delete 根下页面归属显式决定、同一棵树三种归属模式统一——全部变成显式决定而非遗留半成品。

### 4.3 写前断言四件套

| # | 门 | 内容 | 拦截 |
|---|---|---|---|
| T1 | 同名门**全路径化** | `_executeCreateFolder`（sync-executor.js:539-550）已有兄弟名碰撞检查+post-verify——缺口是绕开该路径的裸调用（如 `markdown-to-feishu.js createFolder:1458` 无检查）。收口=folder create 一律走治理路径，WriterGovernance capability 层加同名校验兜底 | J2、J7 |
| T2 | 结构镜像断言 | `COPY_PATCH_AND_REPOINT` 计划期对源子树 `deriveFolderAncestry` live walk，断言目标计划子树（深度、逐层节点名多重集、记录数）与源一致；写后读回再断言一次 | V1（子目录平铺） |
| T3 | placement live 绑定 | placement 决策输入必须是本 session 绑定的 live audit walk 产物（walk digest 记入 session）；用旧快照推导 → `PLACEMENT_SOURCE_STALE` 拒。创建侧补 audit 侧同款"target=兄弟页实测 folder"机器校验 | J1（真目录其实在 walk 输出里） |
| T4 | 读后验证+对账式重试 | 每个 topology mutation 携带期望 post-state，apply 后读回比对（folder create 564-578 与 repoint 已有 post-verify，推广到 copy 结构）；**响应解析失败 → 先按名对账（check-then-retry），禁止盲重试**——HTTP 层现无 parse-retry（唯一重试是 `_getRecordWithRetry` 501-514），重试策略上收治理层统一实现 | J7（重复空目录 BS86f3Ee） |

四条全部确定性，均需 registry/fixture/enforcer 三件套手续（同 §3.2）。

## 5. 批3：镜像纪律——白名单 + saved workflow intake v2

- **镜像源白名单**（config registry）：镜像取材仅限用户钦定样板页（describeReplicas 等）；非白名单的"已接受页"作镜像源 → 拒，退人工加白。**"已接受≠正确模板"成文**——v3.0 compact 的病正是顺着镜像内部传播到 v2.6 的。角色二分（2026-10-03 裁定）：**web-content=语义参考源**（内容项不能少，语言修订以我方为准），**钦定样板页=文风模板源**——白名单管的是后者，语义完整性由 §3.1 附带裁定第 1 条的语义门看住。
- 镜像产物过与首写同一套预检（批1 五条自动覆盖，无需新码）。
- **saved workflow v2 intake 段**：现有 v26 intake（`.zcode/workflows/java-v26-sync-campaign.dwf.ts:374` 起）已有 session 探针/dry-run/轨道继承核对员/分组门；v2 增补：拓扑审计硬步（批2 产物）、决策表引用、镜像白名单校验、跨轨核对固定步（批4a）。同时补 changes-requested 重建段（批5 联动，清偿 java-v26 遗留）。
- **呈门链接转换三件套（2026-10-03 用户新增）**：AskUserQuestion 卡片字段按纯文本渲染——markdown 链接与裸 URL 均不可点击，而呈门材料（`writeApprovalPresentation` 预览=页面逐字内容）恰是批准决定必看的东西。转换在 workflow 呈门序列**确定性实现**（脚本层做，不依赖执达员自觉）：
  1. **呈门自动开页**：gate ask 前对本批预览链接执行 `open <url>`（darwin；单元多时只开本地索引页，不开 N 个标签页）。
  2. **本地门呈报索引**：每次呈门生成/覆盖 `tmp/api-reference-sync/gate-presentation/latest.html`——本次门全部材料的编号链接表（各单元预览 docx、记录页、会话文件、worklist、journal），一条 `open tmp/.../latest.html` 命令全达；门卡片内只放 digest + 单元清单 + 索引路径。
  3. **剪贴板兜底**：主预览链接 `pbcopy` 入剪贴板，卡内注明"已复制，⌘V 可开"。
  约定：卡片字段内**彻底不放 live 链接**（裸 URL 也不放；正文消息的裸 URL 形态维持不变）；执达员 system prompt 同步此约定；批量完成报告同款处理（本地索引 HTML + 自动 open）。

## 6. 批4：小件收口（一次 PR）

- **a. 跨轨核对内置**：intake 检查单固定步"改动符号在相邻轨的状态"（复用现有轨道继承核对员只读 agent 模式）；规矩成文：修一张页若内容源自另一轨，**源轨同查同报**（v3.0 compact 的病本可在修 v2.6 时同步发现）。
- **b. 会话卫生**：`session-start.cjs` 看板加僵尸会话检测（in_progress 但所属战役已收官 → 标红；判据可用 session 绑定 track 的 scan-state 是否已推进过该 session 的 lastScannedTag）。收口检查单加一条："全部会话终态化 + scan-state 已推进——收口=账清"。当前挂账：v30-twogate 0/1、v2.6 两会话 close-session 待操作员。
- **c. 多集单一真相**：修 `build-current-placement-audit.js:193`（`[...new Set(...)]` 去重即 J4 全部病因，multiset 契约本写在 `inheritance-evidence.js:68-71,126-142`）；多集语义收敛为单一共享函数，collector / executor（`_verifyTreeDeltaReferences`）/ reviewed-context builder 三处共用；跨库同 ID fixture + **往返不变量测试**（收集器产出 → `token-reference-reader` 重查 → 逐条相等）进 focused-tests admission 门。

## 7. 批5：REBUILD 一等动作

- **语义**：目标=本战役已建记录（复用 recordId），全量内容替换，走与 CREATE 相同的内容门（批1）+ 单次 `APPROVE_WRITES` 门；回执绑前一回执 digest，lineage 不断。
- **路由**：changes-requested → 默认 REBUILD（UNIT_MACHINE 的 `recordDocumentChangesRequested` executed→in_progress 已支持重执行，缺的是 executor 侧一等动作——现 `WRITE_ACTIONS={CREATE,UPDATE,BACKFILL}`，sync-planner.js:22-26）；CREATE 撞 `CREATE_RECORD_ALREADY_EXISTS`（planner:495-509）且记录属本战役 scope → 自动改路由 REBUILD；非本战役记录 → fail-closed 转人工。拦 J6（撞门卡死全 scope 规划）。
- 回滚保留给结构性损伤；REBUILD 是内容级推翻重来的唯一路径。

## 8. 批6：编排层契约

- **状态解释收敛**：v30/v26 workflow 已把 PARTIAL 当失败（`EXECUTE_PARTIAL`，java-v30-campaign.dwf.ts:237-242）——但这是逐 workflow 手写的。提炼共享解释 helper + 回归 fixture，防第三处再犯（J5-a 类缺陷的根治形态）。
- **session 读取统一**：typed reader `loadReviewSession`（review-session-store.js:1162）已存在，但 bins/workflow 共 8+ 处裸 `JSON.parse(readFileSync)`（bin/sdk-review-session.js:258-261,620,654-661；bin/sdk-doc-sync.js:331,986,1056,1081,1094）。统一迁移；workflow 的 `parseJsonLoose` 只留截断兜底。
- **CLI 参数表驱动**：accept-document 族 15+ 参数（bin/sdk-review-session.js:30-77）改为数据表（名/必填/转换），builder+校验同源生成——漏 `--base-token` 类缺陷在构造期报错（J5-d）。
- **AmendWorkflow canary**：脚本首行 args 完整性断言，fail-fast 大声失败（平台丢 args 坑；常量回退已做）。
- **收割步评审门**：收割前强制查评审状态字段，缺失=停（J5-c）。
- **digest 规程（2026-10-03 报告三并入）**：批准/回执 digest **只从会话/store 程序化全量读取**；任何显示截断值不得进命令或回执（"digest 严禁截断拼凑"前车之鉴成文——报告三 D 类实锤重犯）。
- **战役脚本 launch 预检（2026-10-03 报告三并入）**：新战役脚本上线前过预检清单——EXECUTE 拒 PARTIAL、VERIFY 读对会话字段、有收割门、回执带 `--base-token`、args 有硬编码回退、canary 在位；且新脚本**从认证模板复制，不从兄弟战役脚本过户**（v30 模板的 PARTIAL 潜伏缺陷过户到 v26 的教训）。

## 9. 对账：既有清单与两份复盘模型

| 旧清单项（backlog ①–⑨ / 复盘） | 去向 |
|---|---|
| ① 语料 sweep（v3.0 薄 RETURNS 债） | 批1（§3.4 首战） |
| ② intake 预检脚本化 | 批2 §4.2 intake 前置 + 批3 workflow 接线 |
| ③ 预览预检门 + 打回即铸 fixture | 批1 §3.3 写前挂载 + §3.5 成文 |
| ④ 同批次齐平 | 批1（全单元同一确定性规则集，天然齐平） |
| ⑤ 跨轨核对内置 | 批4a |
| ⑥ 镜像源白名单 | 批3 |
| ⑦ 会话卫生 | 批4b |
| ⑧ 多集单一真相 | 批4c |
| ⑨ fallback 决策表+脚本预检 | 批2 §4.1（决策表=审计与 planner 共用数据） |
| 五缺口①拓扑写前断言 | 批2 §4.3 |
| 五缺口②内容质量门 | 批1 |
| 五缺口③证据一致性 | 批4c |
| 五缺口④编排类型安全 | 批6 |
| 五缺口⑤REBUILD | 批5 |
| 三类巡检（语料/拓扑/跨轨） | 批1 / 批2 §4.2 / 批4a |

**2026-10-03 报告三对账**（执行者自评，旧 backlog 的原始来源，六项清单）：清单 1（intake 预检脚本化）→ §3.6 本次补入批1；清单 2（渲染预检门）→ §3.7 第三挂载点+铁律一；清单 3（两模型入库）→ 五条规则 fixture（批1）+ fallback 决策表（批2 §4.1），原已覆盖；清单 4（战役脚本预检）→ §8 launch 预检本次补入；清单 5（批次齐平铁律）→ §3.7 铁律二；清单 6（digest 规程）→ §8 本次补入。报告三的根因三句（控制流进了 workflow 质量规格还在临场发挥/预览即真相没人看/范例在库标准未萃取成检查）即本设计 §1 公理 1/2/4 的实战表述。

## 10. 失误 → 门 追溯矩阵

| 失误 | 拦它的门 |
|---|---|
| V1 copy 丢子目录层级 | T2 结构镜像断言 |
| V2 compact 单句 RETURNS | `RETURNS_MIN_DEPTH`（写前+sweep） |
| J1 陈旧快照 placement | T3 live 绑定 |
| J2 重复同名 Vector 目录 | T1 同名门全路径化 |
| J3 五类内容缺陷只被人眼拦 | 五条规则写前+成稿（§3.3） |
| J4 多集去重假漂移 | 批4c 单一函数+往返测试 |
| J5 编排缺陷束 | 批6（解释收敛/typed reader/参数表/canary/收割门） |
| J6 重建撞 RECORD_ALREADY_EXISTS | 批5 自动路由 REBUILD |
| J7 解析失败盲重试重复目录 | T1 + T4 对账式重试 |
| 跨轨镜像染病（v3.0→v2.6 compact） | 批3 白名单 + 批4a 源轨同查同报 |
| grantPrivilege 正确形态被误判 | 批2 §4.1 决策表（判例入表） |
| Client/close-delete 遗留半成品 | 批2 §4.2 首跑 worklist |
| 僵尸会话 | 批4b 看板检测 |
| A 类：五轮诊断链用实弹探库（6M token） | §3.6 intake 预检（五道门开跑前秒杀） |
| C 类：批次不齐平（三页无响应字段仍呈批） | §3.7 铁律二（整批退回修齐，禁止"先写后补"上呈） |
| D 类：截断显示值拼 digest 回执 | §8 digest 规程（只从 store 全量程序化读取） |
| D 类：v30 模板潜伏缺陷过户 v26 | §8 战役脚本 launch 预检 + 认证模板复制 |

## 11. 落地与验收

- 每批一个 PR，走标准治理：admission 全绿（js-syntax / focused-tests / invariant-coverage --strict）、评审轮、CI ADMITTED。
- 每批验收必含：**反例 fixture 引用本轮真实失误**（§10 矩阵即验收清单一一对应——每行至少一条"该门能在 fixture 上拦住该失误"的证明）。
- 批1 验收额外含 v3.0 sweep 执行：worklist 产出后修复批走操作员批准（本设计只到 worklist 为止，修复仍是治理管线常规流程）。
- 批2 验收额外含首跑 worklist（Client/close-delete 处置清单），处置决定本身留操作员。
- 排期建议：批1 与批2 可并行开工（不同文件域），批4 体量小可穿插；批3 在批1/批2 合并后接线；批5/批6 随后。

## 附录 A：外部实践引用

- Anthropic Engineering, *Equipping agents for the real world with Agent Skills*（2025-10-16）：技能=指令+脚本+资源的三层渐进披露包；确定性工作交脚本（"certain operations are better suited to traditional code execution"）；从失败中学习并把失误固化为可复用代码/上下文；以 eval 发现缺口为起点增量构建。→ 公理 1/3 的出处，亦即本仓五步管道的同构物。
- Agent Skills 作者实践共识（多篇指南综合）：脚本验证优于散文指令验证（"a script that validates is more reliable than natural-language instructions asking the agent to validate"）；结构约定+路由质量决定技能是否被正确触发；用 checklist 审阅技能本身。→ 公理 1/4 的旁证。
- Terraform plan/apply 模型（业界惯例参照）：对 live 态预计算 diff、批准绑定计划、apply 后对账——公理 2 在基础设施界的标准形态，本仓 writer governance 是其在文档写路径上的实现，批2 把它推广到拓扑写路径。
