# Rust 试点：SDK 参考文档 overlay 模式施工蓝图

日期：2026-10-08
状态：设计定稿，待立项（未实施）
决策来源：2026-10-08 对话裁定——**master 跟着写权走**。milvus 口径的 SDK 参考文档（base）归研发，在 web-content 里维护；飞书降级为 Zilliz 专属文档库；本仓继续做控制平面，并新增承载 overlay（Zilliz 增量清单）。
关联文档：`docs/workflow-automation-plan.md`（S1 事件驱动 / S3 信封执行）、`.claude/skills/api-reference-sync/sdk-pr-sync.md`（PR intake，derive 与它同级的工件生产者）、`docs/campaign-control-hardening.md`。

---

## 0. 三句话讲清楚这个模式

1. 研发已经在 web-content 里用他们自己的工具（`update-milvus-sdk-docs` skill）直接写 SDK 参考文档。这部分叫 **base**，milvus 口径，归研发——我们不复制、不修改、不对账。
2. Zilliz 与开源版的差异（云专属功能整页、共享页里的云专属参数/说明、链接与措辞），由我们记在一份**增量清单（overlay）**里，放在本仓 `overlay/` 目录。就三种东西：**整页、补丁、批量规则**。
3. 一台**编译器（derive）**拿"base 的某个精确版本（40 位 SHA）+ 我们的清单"，机器合成出 Zilliz 版页面，作为标准工件送进现有管线，过两门后写进飞书。**飞书树从此只存编译结果，人在上面只评审、不写字。**

```
今天：  研发改 web-content → 哨兵发现 → 人工 intake/逐页对账/规划 → 三门 → 飞书(master，手工态)
试点后： 研发改 web-content → 哨兵发现 → 编译器自动合成 base+overlay → diff 评审/门 → 飞书(只存编译结果)
                                            ▲
                              overlay/ 增量清单（我们维护，平时不动）
```

一句话：以前做的是"手工合并两个真相"，以后做的是"维护一张差异清单 + 看编译 diff"。

## 1. 为什么拿 Rust 试点

- **零历史包袱**：飞书 Rust 树（容器 `PeN4ftfCglBs4AdS8CTcjtdOnPJ`，v2.6.x / v3.0.x 双轨子树 + Bitable 已建）是空树——没有手工 `<include target>` 语料要迁移，没有存量页要冻结。python / cpp 将来迁移各多一步"语料种子化 + 存量冻结"，rust 不用。
- **上游已就绪**：web-content 本地库已有 `API_Reference/milvus-sdk-rust/{v2.6.x, v3.0.x}/`（v2.6.x pin crate 2.6.1，v3.0.x pin 3.0.2，v3.0.x 共 147 页），分类法与 cpp 同款，页面解剖 = go 式（Request Syntax builder + REQUEST FIELDS bullets + RETURNS；枚举页 = VARIANTS bullets）。
- **爆炸半径小**：新语种、无下游依赖，整轨推倒重建的成本就是再跑一次编译。

## 2. 交付物：四样

| 交付物 | 位置 | 说明 |
|---|---|---|
| A. overlay 数据目录 | `overlay/rust/{v2.6.x,v3.0.x}/` | 纯数据（markdown + yaml），受 admission 治理；不放代码 |
| B. derive 编译器 | `src/sdk-doc-sync/derive/` + `bin/sdk-derive.js` | 钉 SHA 读 base，应用规则和补丁，产出标准 release-scope 工件 |
| C. Rust 轨能力 | 原接入计划批 0–2 照用，批 3 降级 | 注册表、扫描器、identity、PR intake、哨兵全保留，角色注记变化 |
| D. targets 登记表 | `overlay/rust/<track>/targets.json` | "这个参数/功能是共用还是云专属"的问答记录；新东西出现时门上问一次，永久生效 |

overlay 目录三种文件各一例（最简版）：

```yaml
# overlay/rust/v3.0.x/rules.yaml —— 批量规则：一类差异一行吃掉
urlRewrites:
  - from: "https://milvus.io/docs/"
    to:   "https://docs.zilliz.com/docs/"
```

```yaml
# overlay/rust/v3.0.x/patches/MilvusClient-create-collection.yaml
# 补丁：锚点 + 动作。锚点词汇与扫描器/规划器同源。
page: rust/v3.0.x/Client/create-collection
entries:
  - id: cc-cloud-note-1
    anchor: { kind: parameter, key: resource_group }
    action: insert-after
    content: |
      - **cloudQuotaType** (Zilliz Cloud only) — …描述一句…
```

```markdown
<!-- overlay/rust/v3.0.x/pages/volume/create-volume.md -->
<!-- 整页：base 里没有的云专属功能，全文就是我们写，格式遵守全局规则 -->
```

编译产物落进飞书的样子：base 原有内容 + 补丁插入的条目（缩进按 layoutRules 自动对齐）+ 改写后的链接——一份完整成稿，和你今天看到的页面形态无区别。

### 2.1 Rust 页面类型普查（2026-10-08 实测，web-content 本地库）

v3.0.x 全 147 页，v2.6.x 116 页同构。六种页面类型：

| pageKind | 数量(v3.0.x) | 解剖 |
|---|---|---|
| method | 121 | `# Method()` → 一句话 → rust 签名 fence → `## Request Syntax`（builder 链 fence）→ `**REQUEST FIELDS:**`（平铺 bullets：`- \`field: Type\`` + 4 空格缩进描述）→ `**RETURNS:**`（斜体类型 + 行文）→ `## Example`（rust fence） |
| struct | ~15 | `# Type` → 行文 → `pub struct` fence → `**PARAMETERS:**` bullets（同上语法）→ 可选 `**METHODS:**`（紧凑单行 `- \`m(...)\` - 描述`）→ `## Example` |
| enum | 7 | `# Enum` → 行文 → `pub enum` fence → `**VARIANTS:**` bullets → `## Example`（DataType / IndexType / MetricType / AggregationMetricValue / ConsistencyLevel / FilterTemplateValue / SearchVectors） |
| container | 2 | MilvusClientV2 / MilvusClientV2Session：行文 + prelude → `## Constructor` → `## Runtime configuration`（签名 bullets）→ `## Method index`（分类链接清单） |
| module | 1 | DataImport/BulkImport：struct + `## Constructor`（PARAMETERS/RETURNS）+ 嵌套 struct 段（`## BulkImportConfig`） |
| overview | 1 | About.md：Installation / Quick Start / Compatibility / Contributing / License |

实测四条硬事实（直接影响 schema 设计）：

- **REQUEST FIELDS 全树平铺、零嵌套**（v3.0.x 无任何 6+ 空格子弹）——锚点语法可按"标识符 bullet"一级封闭，不需要多级寻址；
- **页面无 `<!-- category/action/addedSince -->` 脚注**（sdk-pr-sync.md 所述维护者 skill 标记在 rust 两轨 0 命中）——derive 的变更识别只能靠 pin SHA 之间的 git diff（pr-scan 同款纪律），不能依赖页脚元数据；
- **相对 `.md` 链接 37 处**（`ConnectConfig.md`、`../Database/UseDatabase.md` 形态）——rules 的改写必须覆盖同目录相对链接（cpp 时代 resolveRelativeLinks 盲区的前科）；
- **v3.0.x 新增 DataImport / FileResources / Snapshots 三个分类**（v2.6 无）——是否云相关属 targets 登记表问题，不在类型系统里解决。

### 2.2 overlay Schema v1（封闭词汇表，不能随写随扩）

`overlay/schema/overlay.schema.json`（JSON Schema，版本化）。patch 条目字段全集：

| 字段 | 约束 |
|---|---|
| `id` | 稳定标识，报错与测试引用（如 `cc-cloud-note-1`） |
| `page` | canonical identity 键（与 identity map 同源） |
| `expect` | 期望 pageKind——base 页换型即 `OVERLAY_PAGE_KIND_DRIFT` fail-closed |
| `anchor.kind` | 封闭枚举：`requestField \| parameter \| variant \| method \| section \| prose` |
| `anchor.key` / `anchor.match` | 标识符键（bullet 名），或 prose 子串（LCS 锚） |
| `action` | 封闭枚举：`insert-after \| insert-before \| replace \| remove \| wrap-note` |
| `content` | markdown 片段，形状必须匹配锚点位置语法（§2.3 校验） |
| `targets` / `note` | 终值（默认 `[zilliz]`）与依据来源 |
| `upstream-candidate` | 可选 bool；true = 共享事实的临时补齐（如 RETURNS 形状），base 覆盖后由审计清理（§2.5） |

anchor × pageKind 合法矩阵（schema 强制，矩阵外组合 = 非法）：

| pageKind ＼ anchor | requestField | parameter | variant | method | section | prose |
|---|---|---|---|---|---|---|
| method | ✓ | | | | ✓ | ✓ |
| struct | | ✓ | | ✓ | ✓ | ✓ |
| enum | | | ✓ | | ✓ | ✓ |
| container | | | | | ✓ | ✓ |
| module | | ✓ | | ✓ | ✓ | ✓ |
| overview | | | | | ✓ | ✓ |

`section` 键同为封闭枚举（实测标题词汇表）：`request-syntax | request-fields | returns | example | parameters | methods | variants | constructor | runtime-configuration | method-index`。

`rules.yaml` 同样封闭：`urlRewrites[]`（from/to 前缀）、`terminology[]`（from/to + scope）。`targets.json` 条目：`{ symbol, page, kind: param|page|variant, targets: shared|zilliz-only|milvus-only, evidence, decidedAt }`。

> **实现注记（2026-10-08 落地时裁定）**：overlay 数据文件落成 **JSON**（`rules.json` / `patches/*.json` / `targets.json` / `manifest.json`）而非 yaml——本仓零 yaml 依赖，不为此新增依赖；JSON 解析更严格，符合封闭词汇表精神。schema 不变。

### 2.3 写作 harness：schema 即门禁

1. `src/sdk-doc-sync/derive/overlay-schema.js`：纯脚本校验器，加载即验；未知字段、非法 anchor×pageKind 组合 → `OVERLAY_SCHEMA_VIOLATION` fail-closed，绝不静默忽略；
2. content 形状校验（纯 regex/结构，零模型）：如 insert 到 requestField 之后必须匹配 `- \`name: Type\`` + 4 空格缩进描述；不合 → `OVERLAY_CONTENT_SHAPE_MISMATCH`；
3. fixtures：`overlay/schema/fixtures/` 每 pageKind × anchor × action 各一组合法/非法样例，登记 `tests/script-paths.test.js`，进 deterministic admission；
4. 扩 schema 的唯一路径 = PR 改 schema + fixtures（必要时 `contracts/invariants.json` 注记），沿用 Phase 4/5 "经验→harness" 五步管道——写作侧不存在"先写起来后面补"的口子。

### 2.4 飞书目录（摆位）治理，及与 web-content 不一致的自由度

- **摆位数据源 = identity map + registry，不是 web-content 目录**。release-tracks 的 releaseRoot（explicit-child → 两棵子树 token）锚定轨根；identity map 每个 canonical page 记 category → folderAncestry；规划器按 map 落位。derive 工件只带 page id，**不碰摆位**。
- 写时兜底与今天完全同机：folderAncestry 门禁、placement audit（fallback-topology 的 rust 配置）、同目录同名不变式、孤儿检测；首建时 manifest 页清单与 placement walk 对账（PR #122 的 plan-time target chain reconciliation）。
- **飞书目录与 web-content 不一致：可行，且机制上免费**——分歧记成数据（identity map 里飞书 category ≠ web-content category 即可），不产生对账负担。三条注意：
  1. 两套分类词汇显式分开：web-content 分类 = 上游事实（扫描器覆盖表 / 审计用），飞书分类 = 摆位用，映射落在 identity map；
  2. base 相对 `.md` 链接的改写走 identity 解析（path → page id → 目标），不受飞书侧重排影响；
  3. 试点建议 1:1（rust 上游分类本与 cpp 同款，少一个变量）；要分歧，首建后作为数据变更走 PR，placement audit 兜底。

### 2.5 RETURNS 形状补齐政策

实测：121 个方法页 RETURNS 段**全部存在但全是行文**（斜体类型 + 一句 accessor 描述，如 `SearchResponse` exposes `results()`…），复杂返回的**字段形状在 base 里基本没有**（部分类型在同轨 types/ 页有定义，如 CollectionDesc）。**形状格式以 `docs/sdk-doc-style-rubric.md` v1 为准**（2026-10-08 从五个跨语言样页提炼：RETURN TYPE / RETURNS + fence 形状 / PARAMETERS 响应字段 / METHODS-ERROR 段；rust 按 go 变体落地——`*Result<T>*` + Rust fence struct + PARAMETERS + accessor METHODS）。补法按归属分三种：

| 情形 | 补法 | 维护属性 |
|---|---|---|
| base 的 types/ 页已有定义，方法页没链 | patch `section: returns` + insert 加 "See [Type](...)" 链接 | 机械，零维护 |
| 形状哪里都没有、属**共享事实** | 正解 = 扫描审计出卡，推研发补 base；zilliz 急需时 overlay 临时补，条目标 `upstream-candidate: true` | base 补上后删条目；长期不删 = 永久语义陈旧风险（编译器不知道 return type 变了） |
| **云专属**返回差异（共享方法返回里的云字段） | overlay 永久补（`section: returns` + insert-after，content 允许 bullets/表） | 这正是 overlay 的本职 |

配套 deterministic 审计规则：方法页 RETURNS 引用的类型在两轨 types/ 均无文档 → 出卡（推 base）；`upstream-candidate` 条目在 base 覆盖后由审计点名清理。

### 2.6 Polish（工程句式 → user-oriented）：编译期受治理层

**铁律：polish 必须是编译期阶段，不能是飞书事后润色**——飞书页是编译产物，写后再润会被下次重编译冲掉，破坏单 master 可重建。

- **层序**：base → rules（确定性）→ polish（模型提案 + 确定性门）→ patches（确定性）→ 产物。patches 只用标识符/section 锚（§2.2），不受行文改写影响；polish diff 与 prose 锚条目的重叠做确定性检查，重叠 → 卡。
- **polish store**（`polish/<sdk>/<track>/`，git 管）：条目 = 区域锚 + 该区域 base 文本 digest + 润色后文本。编译逐区域查 digest：命中 → 润色版；上游改了该段 → 回落 base 原文 + "待重新润色"卡。维护量 = churn ∩ 已润色区域。
- **引擎复用 api.pr-polish-governed 全套**：受影响区域提案、protected regions（fence/表/锚点行/URL 集合有序不变）、语义门（参数项+描述语义保持）、三摘要链、终态逐行复验。S3 信封首选类别（五条规则绿 + 语义门过 → 自动签发）。
- **style rubric 已成文**：`docs/sdk-doc-style-rubric.md` v1（2026-10-08）——首句规则、冠词句式、版本号禁令、RETURNS 形状模板及五语言变体、五样页 golden fixtures。同一份标准两个消费端：polish 引擎 prompt + 研发生成器 prompt（契约谈判项，与 RETURNS 形状同批）。
- 确定性不变式：URL 集合有序不变；代码 fence 逐字节不动；bullet 标识符行 `- \`name: Type\`` 不动（只改 4 空格描述行文与页级行文）；layout 标记不动。
- **节奏**：试点首建 polish 阶段 passthrough（base 原文直落，保真优先）；首建后一次全量 polish 战役填 store（信封自动签发为主，首过人审）；稳态只补变更区域。天花板诚实：语义门保"不丢内容"，"是否更 user-oriented"归 eval 与抽查（workflow-automation-plan §5）。

### 2.7 存量 harness 规则挪用清单（2026-10-08 盘点）

| 存量规则 | 现位置 | 挪向 |
|---|---|---|
| GLOBAL_LAYOUT_RULES v4：五条内容规则（cjkForbidden / 首句双式 / **returnsResponseFieldsRequired** / paramDescRequired / bareNotesSectionForbidden）+ 结构三规则（requestH3 multi-only / Request$ 标题 / Example 裸代码块）+ deprecation 双行 callout + descriptionTypeLinksRequired 与 denylist（2026-10-07） | `src/renderers/sdk-layout-profiles.js` | **rust profile 直接继承**（批 4 第 16 条） |
| cpp `builderSignature.prefixForbidden`（builder 方法裸签名） | 同上 | rust 声明同槽位，regex 基线从真实页定 |
| java `returnSections split + returnsProseRequired`（2026-10-01 两段式 RT/RETURNS） | 同上 | rust 采纳——源码注释预言的"其它 track repolish 时采纳"第一例 |
| pr-polish 保护域（fence/表/标题/include 行/footer/REQUEST METHODS 标记）+ URL 集合有序不变 | `pr-polish.js` / `sdk-pr-sync.md` | polish 引擎不变式（§2.6 已引） |
| literal-include-preserved（INCLUDE_REBUILD_FORBIDDEN） | `contracts/invariants.json` | 迁移期用（存量 include 语料种子提取阶段）；rust 编译产物本身无 include 标记 |
| pr-verbatim-content | 同上 | base 首建直落的保真门 |
| absolute-link-urls / markdown-block-fidelity / record-description-scope | 同上 | 写路径照用（canonical writer 已带） |
| one-document-per-interface / stateful-class-identity / same-name-sibling-placement / versioned-tree-delta / sparse-version-delta-model / placement-live-binding | 同上 | identity / 摆位层照用（§2.4） |
| style-mirror-allowlist | `config/style-mirror-allowlist.json` | 批 4 已列 `rust: []` |
| Targets 终值 `[Milvus,Zilliz]` + executor 永不写 Targets | SKILL.md | 流程规则照用（finalize 后操作员统一） |
| 引用句双目标 include（2026-09-22 裁定） | 全库惯例 | 被 rules/targets 取代；各语言迁移时做种子提取 |
| REQUEST METHODS 裸签名（f34950a） | cpp 战役 | 已并入 builderSignature 规则族 |

关键含义：**"RETURNS 形状缺失"不是新立的验收标准**——`returnsResponseFieldsRequired` 自 2026-10-03 起就是全局确定性规则，rust 147 页现状全数不过这条；与研发的契约谈判直接引用现行规则即可，`docs/sdk-doc-style-rubric.md` 是其人读镜像与附件。不挪的：verbatim rebuild 的 patchStrategy 族（被 derive 取代）、两门流程类（照用而非挪动）。

## 3. 分批施工（单 feature 分支，按批评审，单个 PR）

批 0–2 与《Rust SDK 轨道接入》原计划**逐条相同**（此处保留要点，角色注记有变化的已标出）；批 3 是本蓝图新增；批 4/5 对应原批 3/4，有降级。

### 批 0 — 前置侦察（不变）
1. 克隆 `repos/milvus-sdk-rust`；核实 tag 命名（推断 v2.6.1 / v3.0.2 系列）、crate 结构（`src/`、`lib.rs`、`v2` 模块布局），记入 `sdk-rust.md`。
2. lark-cli 枚举 `PeN4ftfCglBs4AdS8CTcjtdOnPJ` children，拿 v2.6.x / v3.0.x releaseRoot token 与 Bitable baseToken/tableId（沙箱拦 lark-cli 则实现阶段做；拿不到向操作员索要）。
3. **（新）** 记录 web-content 两轨的 pin（40 位 SHA）进 `sdk-rust.md` —— derive 的 base 锚点，对应 crate 2.6.1 / 3.0.2。

### 批 1 — 注册表层（不变）
4. `config/release-tracks.json` 新增 `languages.rust`（sdkName `milvus-sdk-rust`，两轨；scan-state 派生键 `rust-v26` / `rust-v30`，不动 override 清单；releaseRoot = `explicit-child` 指批 0 token，带 `verified:` 注记）。
5. `scan-state.json` 不手工 seed（红线：只由 close-session 推进）；首战前哨兵如实报"待首战"。
6. `scripts/dashboard/ledger.js` SENTINELS 加 `rust-daily-scan` 10:00（python 09:45 后第一个空位）+ `docs/task-dashboard.md` 同步。**角色注记：哨兵卡 = derive 触发器**，不是人工战役工单。

### 批 2 — 扫描能力（不变，角色转变）
7. 新建 `src/sdk-doc-sync/scanners/rust-scanner.js`（BaseScanner 子类）：解析 `pub struct/enum/trait`、`impl` 块、`pub (async) fn`，impl 绑定 parentClass 使 publicIdentity 生效；METHOD_CATEGORIES 覆盖表对齐 web-content 分类法；未覆盖方法出 `COVERAGE_UNTRACKED_METHODS` 诊断。参考 `zilliz-cli-scanner.js`（Rust 解析先例）+ go-scanner 覆盖表模式。
   **overlay 模式下扫描器的三个用途**：① 审计上游（web-content 页面 vs SDK 源码导出，缺页漏参 → 卡片，推研发补 base）；② 锚点词汇表（补丁 `anchor.key` 与扫描器参数键同源）；③ targets 问答的证据源（代码信号生成候选）。
8. 注册：`release-scout.js` `scannerFor`（L58-66）+ `defaultIdentityMapPath`（L565-597 加 rust-v26/rust-v30 两 case）；`bin/sdk-release-scout.js` `defaultsFor`（sdkDir=`repos/milvus-sdk-rust`，publicRoots=`['src/']`，tagPrefix 空）。
9. `references/identity/rust-v26.json` + `rust-v30.json`：`identity-reconcile.js --emit-draft` 起草。**顺手修 wart**：`identity-reconciliation.js:114` 硬编码 `cpp:` stableId 前缀 → 改从 map.language 取。
10. PR intake 转正：`pr-scan.js:16-22` SDK_LANGUAGES 加 `'milvus-sdk-rust': 'rust'`；`sdk-pr-sync.md` rust 移出 track-less 名单；`tests/pr-scan.test.js:122-125` 断言翻转。
11. 哨兵件 `tmp/sdk-release-scout/rust-daily-scan.py`（gitignored，仿 python-daily-scan.py；`TRACKS={'v2.6.x':'rust-v26','v3.0.x':'rust-v30'}`，web-content PR 前缀 `API_Reference/milvus-sdk-rust/`，只发现不处置）+ 宿主侧 CronCreate 每日 10:00。

### 批 3 —（新）overlay schema + 冷启动 + derive 编译器 + targets
12. **schema 先行**（§2.2/§2.3）：`overlay/schema/overlay.schema.json` + fixtures 落盘，校验器接线——先有封闭词汇表，再写第一条 overlay。
13. `overlay/rust/{v2.6.x,v3.0.x}/` 冷启动：`manifest.yaml`（页清单 + expect pageKind，精确清点在此落地）、`rules.yaml`（URL 映射先行）、`patches/` 放**一条演练条目**（锚真实共享参数，验收演示三用）、`pages/` 空（暂无 rust 云专属功能）、`targets.json` 空表。注意：新增 `overlay/` 会换 admission 指纹，走正常 admission 循环。
14. `src/sdk-doc-sync/derive/` 六个模块：
    - `overlay-schema`：加载即校验（§2.3），`OVERLAY_SCHEMA_VIOLATION` / `OVERLAY_CONTENT_SHAPE_MISMATCH` fail-closed；
    - `base-loader`：`git show <sha>:<path>` 钉 SHA 读 web-content（绝不读工作树）；**变更识别 = pin SHA 间 git diff**（rust 页无 category 脚注，实测见 §2.1）；
    - `rules-applier`：URL / 术语批量改写（必须覆盖同目录相对 `.md` 链接）；
    - `overlay-applier`：锚点补丁应用，锚点引擎复用 smart-patch 的 LCS 匹配；失配 → `OVERLAY_ANCHOR_MISS`（带 entry id / anchor / base sha）进异常队列；base 页换型 → `OVERLAY_PAGE_KIND_DRIFT`；
    - `targets-gate`：编译发现新导出符号/新参数且 targets.json 无记录 → 工件标"必答项"，写门呈报时强制问；
    - `diff-producer`：编译产物 vs 飞书当前态的逐页 diff（写门评审材料）。
15. `bin/sdk-derive.js`：`--language rust --track v3.0.x --base-sha <sha> --dry-run / --emit-artifact`。**derive 只读只产工件，不写飞书**——写路径仍只走 canonical CLI（铁律不变）。
16. 工件形态 = **release-scope 工件**（与 PR intake 同级的生产者）：下游 candidate → 分组门 → 规划 → 写门管线原样复用，零改动。成稿转换走现成 `markdown-to-feishu.js`（不走 IR 渲染）。

### 批 4 — 成稿能力（原批 3，降级）
16. **必做**：`sdk-layout-profiles.js` 加 `rust` profile（version 1）——**GLOBAL_LAYOUT_RULES v4 全量继承**（五条内容规则 + 结构三规则 + descriptionTypeLinksRequired 及 denylist），外加两条语言声明：`builderSignature.prefixForbidden`（仿 cpp 裸签名槽位，regex 基线从真实 rust 页定）与 `returnSections: {split: true}` + `returnsProseRequired`（采纳 java 2026-10-01 两段式规则——源码注释预言的"其它 track repolish 时采纳"第一例）。编译产物的 layout 校验是语言感知的，没有 profile 编译页过不了门。
17. **必做**：`schema.js` LANGUAGES 加 `'rust'`；`validate.js` SDK_LANGUAGES + `MEMBER_KIND_BY_LANGUAGE['rust'] = ['option','member']`；`config/style-mirror-allowlist.json` 加 `rust: []`；`config/fallback-topology.json` 加 `rust: {audit:true, pageExemptions:[], sameNameExemptions:[]}`。
18. **按需**：`adapters/rust.js` + `renderers/languages/rust.js` 只服务两场景——overlay 整页署名成稿、base 缺页补齐。首战若用不到可缓建，golden 基线出来再定。
19. `sdk-rust.md` 新建（版本/Bitable/Drive 根 token 表 + **pin SHA 表** + tag 约定 + 格式基线）；`SKILL.md` L33（移出 NO_FEISHU_TRACK）+ L138（阅读清单）；`build-reviewed-release-context.js:17-26`；`sdk-alignment/alignment-report.js` 路径 map + `report-generator.js` LANG_HEADERS。

### 批 5 — 测试、admission、验收（原批 4）
20. 测试翻转/新增：`release-track-registry.test.js`（未注册断言 → 正向；override 清单不动）、`placement-audit.test.js`、`pr-scan.test.js`、`dashboard-ledger.test.js` 等哨兵枚举；新测试文件登记 `tests/script-paths.test.js`；renderer golden fixtures（从 web-content 真实 rust 页定基线）。
21. **derive 专属测试**（对应验收三演示）：确定性（同输入两次编译 digest 相同）；上游推进隔离（base 改 1 页 → 其余 146 页 digest 不变）；锚点失配（演练条目 + base 参数改名 → `OVERLAY_ANCHOR_MISS` 恰好一张卡）；schema 非法样例（矩阵外组合、未知字段、形状不合 content）全部被校验器 fail-closed 拒绝。
22. 验证链：本地全套测试 → admission 循环（归档陈旧 run-manifest → 干净树 → `npm run admit:skills -- --phase <label> -- --deterministic-only` → push）→ scoped dry-run（`--language rust --sdk-version v3.0.x --dry-run --base-sha <v3.0.2 pin>`）。
23. PR 提交（按批切分）；SKILL.md prose 变更触发 invariant coverage 门则同步 `contracts/invariants.json`。

## 4. 试点验收 = 三个演示（过了，overlay 模式就立住）

| 演示 | 做法 | 证明什么 |
|---|---|---|
| 一、确定性 | `base@pin + overlay` 编两次，digest 相同；147 页 dry-run 全配对、semantic-content-map、layout 全绿 | 编译器是机器不是魔法，可重放 |
| 二、上游推进 | 模拟 web-content PR 改 1 页 → 重编译 → diff 恰好那 1 页，其余 146 页 digest 不动 | 研发改动 ∩ 我们增量之外，成本为零——这就是"可持续的数学" |
| 三、锚点失配 | 演练补丁锚的参数在 base 改名 → 编译大声失败，队列表恰好一张卡（entry id + 锚点）；改一行 key 恢复 | 失败响亮而局部，绝不静默错位 |

## 5. 试点后你的日常（操作员视角）

| 场景 | 试点前 | 试点后 |
|---|---|---|
| 研发改了 rust 文档 | 哨兵发现 → 人工 intake → 逐页对账规划 → 三门 | 哨兵发现 → 自动编译 → 信封类自动过，或批一张"diff 待批"卡 |
| Zilliz 出云专属功能 | 在飞书写页 | 在 `overlay/pages/` 写页（普通 markdown），两门照走 |
| 研发改了锚点附近的参数 | 可能静默错位，靠人盯 | `OVERLAY_ANCHOR_MISS` 一张卡，改一行 key |
| 新参数不知是否云专属 | 没人问，靠猜 | 门上必答一次，入 `targets.json`，永久生效 |

## 6. 边界与红线

- **不变**：首战另起会话 + 操作员在 APPROVE_* 门上（试点首战 = 147 页首建的写阶段，评审对象是编译 diff）；哨兵只发现不处置；scan-state 只由 close-session 推进；飞书拉取 PR 一律忽略；manifest 归档仪式。
- **derive 不写飞书**：只产工件；写路径只走 canonical CLI。
- **新认的税**：上游页面解剖变化 → 编译器/profile 维护 → 异常队列（演示二会量化其频率，预期很低）。
- **冲突预警**：`feat/go-v30-intake`（未合并）同改 `release-tracks.json`——rust 落 master 后该分支回主树小冲突可解。

## 6½. 评审遗留（PR #126 r1 request-changes，2026-10-09 修复与立账）

r1 两项 P0 已修并实证闭环：P0-1 补丁页身份失配 → `OVERLAY_PAGE_MISS` fail-closed（+测试）；P0-2 rust intake 8 页误报 → 枚举 `params=values` 约定、私有 builder 字段回退索引、`REQUEST_FIELD_UNIONS`（HybridSearch↔SubSearchRequest）与 `TYPE_FIELD_UNIONS`（BulkImport 模块页平铺 BulkImportRequest + 构造器参数；BulkImportConfig 段是 PARAMETERS 不在校验面，不进联合表）——**真 pin 全树 146/146 零失败**；P1-1 `upstream-candidate` 键名修正。

合并前必办（首战 blocker）：

- **P1-2 相对 `.md` 链接改写**：rules-applier 目前只有绝对 URL 前缀改写；base 37 处同目录相对链接需走 identity 解析（path → page id → 目标），否则首战编译产物带死链。
- **P1-3 manifest 精确清点**：未打补丁页的 pageKind 期望不在 manifest，换型不触发 DRIFT——首战前生成全页 manifest（pageKind census）。
- **P1-4 `overlay/schema/fixtures/` 目录**：pageKind×anchor×action 合法/非法样例落盘（derive-overlay.test.js 内联样例为过渡替代）。

立账不阻断：P2 批（localeCompare→码点序、section 歧义检查、prose 多行软换行截断、插入 bullet 空行风格、嵌套泛型上界、isAsync 窗口、schema.json↔js 交叉断言、targetByCategoryName 首写胜断言）随首战 polish 批处理；go 哨兵"前提缺失（缺 go-v30 地图）"为故意诚实展示。

## 7. 完成后

- 记忆更新：rust 轨接入档案 + overlay 模式试点结论 + 每日扫描时刻表 10:00。
- python / cpp 迁移 = 本蓝图复用 + 各加一步"include 语料种子化（机械提取进 patches/rules）+ 存量飞书页冻结为 pipeline-owned"，另立计划。
