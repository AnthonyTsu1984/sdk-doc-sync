# ZCode Hooks 确定化设计 — feishu-markdown-bridge skill 治理

日期：2026-10-03
状态：设计提案（待评审，未实施）
参考：<https://zcode.z.ai/cn/docs/hooks>

---

## 0. 一句话结论

本仓库的 skill 治理已经有很强的**进程内门禁（L1）**和**树级准入/CI（L2）**，但它们全部活在 canonical CLI 进程内部——模型只要换一条 shell 命令（直调 `feishu-doc.js patch`、裸 `--auto-approve`、手改证据文件）就能整层绕过，而这类规则目前只存在于 SKILL.md 散文里（L3）。ZCode hooks 恰好补上缺失的 **L0：shell/会话层执法**——它看得到模型的每一次工具调用，与哪个 skill 被加载无关。本设计把 16 条 prose-only 规则和 6 个旁路面逐条映射到 hook 事件，全部判定逻辑 require 仓库内 `doc-ops-core` 现有模块，不新造第二套真相。

---

## 1. Skill 地图（`.claude/skills/`，12 个目录）

### Canonical（5 个，有独立业务流程）

| Skill | 职责 | 会话初态 → 终态 | 操作员门 |
|---|---|---|---|
| `api-reference-sync` | SDK/CLI/REST 发布同步到 Feishu（旗舰；内部命名空间仍是 `src/sdk-doc-sync/`） | session `in_progress` → `finalized`；unit `in_progress → executed → finalized` | `APPROVE_GROUPING` / `APPROVE_WRITES` / `APPROVE_DOCUMENT` / `APPROVE_ROLLBACK` / `APPROVE_ACCEPTANCE`（legacy；两门制下 ACCEPTANCE 取消，`close-session` 机械无门） |
| `localized-doc-sync` | 源→本地化 wiki 配对同步 | `queue_ready` ⇄（每 unit：acceptance_pending → rescan_required）→ `finalized` | 精确 batch digest 写门（删除批、源侧批单列）+ `finalize` 前全库重扫 |
| `procedure-code-sync` | 流程文档多语言代码块移植 | `approval_ready → acceptance_pending → accepted` | 一条 `APPROVE_WRITES procedure-code-sync <batchDigest>` + 独立 `accept` |
| `verified-doc-authoring` | 混合参考起草/大改，claims 先验证 | `approval_ready → acceptance_pending → accepted` | `APPROVE_WRITES verified-doc-authoring <batchDigest>` + `accept` 绑 rollback manifest |
| `doc-code-verify` | 只读验证代码示例（parse/compile/run） | RUNTIME_MACHINE `ready → executing → completed` | live runtime 需 `--approve-runtime-digest`；remediation handoff 结构性无写权 |

### 内部/工具

- `doc-ops-core` — 共享治理层（**无 SKILL.md**，被 validate-skills 归类为 internal tool package）：session-store（锁+CAS+fsync）、session-state-machine、run-manifest（`productionInputFingerprint` 全树指纹）、WriterGovernance（bind 一次+变更门链）、GovernedPostActionBatch、ExecutionJournal、invariant-registry、write-entrypoint-registry、legacy-quarantine、precondition-verifier、result-contract。
- `patch-code-blocks` — 只读 dry-run 规划器；apply 模式硬拒绝（`bin/patch-code-blocks.js:24-26`）。
- `.claude/agent-team/` — doc-agent CI 管线（scan → dry-run → approval → live-write → verify，digest 即批准）。

### Alias（5 个，纯 SKILL.md 薄路由）

`sdk-doc-sync`→api-reference-sync、`localization-docs`→localized-doc-sync、`patch-feishu-code`→procedure-code-sync、`draft-verified-docs`→verified-doc-authoring、`feishu-code-verify`→doc-code-verify。契约：完全委派 + 输出 `compatibilityTelemetry`、不建独立遥测存储（纯 prose，无执法）。

### 已有 harness 集成

- `.zcode/commands/*.md` — 5 个 canonical skill 的薄路由命令（gitignored，本地生效）。
- `.zcode/workflows/java-v30-campaign.dwf.ts` — 动态工作流已把 admission 仪式编进脚本注释（`:43`「把 run-manifest-sha256-*.json 原子移入 tmp/run-manifest-archive/ 后重跑」）。
- `docs/superpowers/runbooks/` — production-admitted-fingerprint 等 3 份 runbook。
- CI：`skill-admission.yml`（PR 确定性段 + dispatch 模型评测 + PRODUCTION_ENV_BAN）、`doc-agent-scan/dry-run/live-write.yml`。

---

## 2. 统一业务生命周期（跨 skill 的公共骨架）

```
┌─ 准入 ──────────────────────────────────────────────────────────┐
│ 文件变更 → [仪式] 归档陈旧 run-manifest-*.json → 干净树          │
│   → npm run admit:skills -- --phase <label> --deterministic-only │
│   → ADMITTED 台账(tmp/skill-feedback-rollout/admitted-           │
│      fingerprints.jsonl) 追加全树指纹 → push → CI 重准入          │
├─ 会话 ──────────────────────────────────────────────────────────┐
│ scan/plan/dry-run（agent 只读）→ 会话文件（CAS+状态机，           │
│   caller 给 --session 路径）→ reviewUnitManifest（一文档一单元） │
├─ 门禁漏斗（api-reference-sync 为例）────────────────────────────┤
│ APPROVE_GROUPING(分组) → 逐 unit: 重dry-run →                    │
│   APPROVE_WRITES(batchDigest) → 执行(journal+manifest) →        │
│   refetch 验证 → APPROVE_DOCUMENT(journal digest) →              │
│   accept-document（两门制=终验收，finalizes unit）→              │
│   close-session（机械，推进 scan-state.json，唯一推进点）        │
├─ 写路径（每次变更）────────────────────────────────────────────┤
│ GovernedPostActionBatch.bind(approvedDigest) → WriterGovernance  │
│   bindApproval + bindRunManifest → 每调用 assertWriterMutation   │
│   (envelope→manifest→树重验→admitted指纹→逐target) →             │
│   ExecutionJournal(prepared/observed/treeDelta/complete) →       │
│   验收回执/acceptance receipt                                    │
└─ 恢复 ────────────────────────────────────────────────────────┘
  crash → classifyJournalEntries → resumable 自动恢复 /
  reconciliation-required = 操作员领地（严禁删 journal 重放）
```

关键不变量（已 runtime 强制）：

- 一次树变更 = manifestDigest 变化 → 固定路径证据文件 `RUN_MANIFEST_EVIDENCE_CONFLICT`（这即"归档仪式"的成因）。
- 批准 = 精确 batch digest 字节匹配；重新规划 = 旧 digest 作废，必须重新走门。
- 会话终态不可侵犯（`SESSION_TERMINAL`）；回滚仅限 finalized 之前（finalized 后=纠正性发布）。
- 写入后完成性 = refetch 比对，不是 mutation 成功返回。

---

## 3. 现有执法层盘点与缺口

### 四层模型

| 层 | 载体 | 强度 | 现状 |
|---|---|---|---|
| **L1 进程内 runtime 门** | doc-ops-core typed 错误（约 120+ 个码：`WRITER_*`、`RUN_MANIFEST_*`、`APPROVAL_*`、`JOURNAL_*`、`SESSION_*`、`INVARIANT_*`、`ENTRYPOINT_*`…） | fail-closed，最强 | 成熟 |
| **L2 树级准入/CI** | `run-skill-admission.js`（脏树/工具链/逐阶段漂移/全树指纹）+ `skill-admission.yml` | 树级 fail-closed | 成熟 |
| **L3 散文+注册表+模型评测** | SKILL.md Domain Invariants（registry 绑 statementDigest；26 条中 10 条 runtime-enforced、16 条 declared=纯 prose）+ capabilities.json evals | 软约束 | 混合 |
| **L0 shell/会话层** | —（空白） | — | **缺失，即 hook 的位置** |

### L0 旁路面清单（hook 的靶子）

1. **直调写路径**：`feishu-doc.js patch|push`、`docs +update` 绕过全部治理——`verified-doc-authoring/SKILL.md:30` 与 `references/workflow.md:292` 明令禁止，但纯 prose。`.claude/settings.local.json` 里 `lark-cli docs/drive/wiki/api *` 全在 allow 列表，裸写调用畅通。
2. **`--auto-approve` 滥用**：无 `--approve-batch-digest` 时非 TTY 下静默 no-op（或旧路径直接写）。合法形态=「有 digest + 无 TTY」的 agent 执行。
3. **环境变量逃逸**：`DOC_OPS_ALLOW_LEGACY_LIVE` 只有 CI 的 PRODUCTION_ENV_BAN 查；本地 shell 无禁。`DOC_OPS_REQUIRE_ADMITTED_FINGERPRINT=1` runbook 自己承认是"operator discipline, not hardware enforcement"（`docs/superpowers/runbooks/production-admitted-fingerprint.md:52-55`）。
4. **证据面手改**：`tmp/api-reference-sync/run-manifest-*.json`、execution journal `*.jsonl`、`admitted-fingerprints.jsonl`、`scan-state.json`、会话 JSON——CAS/排他创建只在 store 进程内部成立，shell `rm`/重定向直接破坏（历史事故：陈旧 run-manifest 污染对照实验；错误处置表明令「严禁删 journal 重放」）。
5. **跨命令仪式漂移**：admission 循环（归档→干净树→admit→push）、轮换协议（一个战役一个会话文件、~42% 上下文轮换、未落盘的批准不存活、`status` 的 `nextGate` 驱动续接）——散落在记忆、`.dwf.ts` 注释、SKILL.md，新会话全靠模型想起来。
6. **门禁格式纪律**：批准必须是 `APPROVE_* <id> sha256:<digest>` 精确行、门前必读 bot-integration/bot-prompts、stale digest 无效——纯 prose，靠模型自觉。

---

## 4. Hook 设计

### 4.0 平台约束（来自官方文档，决定打包方式）

- **项目级 hooks 配置整体被忽略**（日志记 `config_project_hooks_ignored`）→ 不能指望 settings.json 进仓库就生效。两条正路：
  1. **插件**：`.zcode-plugin/plugin.json` + `hooks/hooks.json`，标准位置自动发现，随插件启停 —— **推荐**，插件源码进仓库、评审可见；
  2. 用户级 `~/.zcode/cli/config.json`（必须 `hooks.enabled: true`）—— 兜底/个人微调。
- stdin 一行 JSON（含 camelCase+snake_case 别名）；**stdout 只有以 `{` 开头的合法 JSON 才按协议解析**，日志一律走 stderr；exit `2` = 阻断捷径。
- PreToolUse 聚合规则：deny > ask > allow；`updatedInput` 完整替换输入（重新过 schema 校验）。
- Stop 续跑 `decision: block` 最多连续 3 次——正好天然防死循环。
- **配置快照在 session 启动时生成**，改 hooks 必须新开 session（要写进开发文档，否则"我改了怎么没生效"）。
- matcher：`"Bash"` / `"Write|Edit"` 精确列表即可；缺省/`*` 匹配全部。

### 4.1 事件 × 执法矩阵

| 事件 | matcher | 动作 | 覆盖的旁路/规则 |
|---|---|---|---|
| **SessionStart** | — | 注入（只读、零风险）：① 当前树 `productionInputFingerprint` vs ADMITTED 台账最新记录 → "已准入/未准入"；② 扫 tmp 活跃会话文件 + `sdk-review-session.js status` 的 `nextGate`；③ 门禁回复格式速查（5 条 APPROVE_* 精确格式）+ admission 仪式四步 | 旁路 #5 轮换协议：新会话开机即得确定性上下文，`nextGate` 从 durable 状态推导（`bin/sdk-review-session.js:431-451` 已存在），不再依赖模型记忆 |
| **UserPromptSubmit** | — | 软校验：正则识别 `APPROVE_(GROUPING\|WRITES\|DOCUMENT\|ROLLBACK\|ACCEPTANCE)`，缺 ID 或 `sha256:<digest>` → `additionalContext` 指出格式无效（不阻断，digest 校验由 L1 兜底）；识别 "admit/准入" → 注入仪式（含归档一步） | 旁路 #6 门禁格式纪律 |
| **PreToolUse** | `Bash` | **硬门（核心）**，deny + reason，见 4.2 | 旁路 #1/#2/#3/#4 + 阶段 C 准入门 |
| **PreToolUse** | `Write\|Edit` | deny 直接写证据面：`scan-state.json`、tmp 下 session/journal/run-manifest/ledger 文件、`write-entrypoints.json`；deny+指引：`contracts/invariants.json`（须与 SKILL.md 同 diff，单调用无法跨文件校验，先 deny 并给出双文件流程） | 旁路 #4 |
| **PostToolUse** | `Bash` | 上下文追加：dry-run 完成 → "复制 digest，停在 APPROVE_WRITES"；execute 完成 → 校验 journal 存在 `complete` sentinel，缺 → 提示 reconciliation 流程；governed 命令后 → 提醒批量报告附链接表（裸 URL 规则） | 规则收尾；"完成=refetch 不是返回值" |
| **PostToolUseFailure** | `Bash` | 已知瞬态错误 → 重试/恢复指引：`99991400` 退避、`SESSION_LOCK_CONTENDED` 等持锁者、`RUN_MANIFEST_EVIDENCE_CONFLICT` → 归档仪式命令、`EXECUTION_RECONCILIATION_REQUIRED` → "核 sentinel 后 resume，禁止删 journal" | 踩坑经验固化 |
| **Stop** | — | 确定性便宜检查，命中才 `block`：本轮跑过 governed execute 但 journal 无 complete；会话 nextGate=APPROVE_* 但最后一条 assistant 消息无 digest 行（轮换前门禁工件未落盘） | 旁路 #5 轮换纪律 |
| PermissionRequest | — | **不配置**。全部执法放 PreToolUse，避免同一规则两处维护漂移 | — |

### 4.2 PreToolUse(Bash) 规则明细

解析 `tool_input.command`（字符串级判定，保守设计：宁可漏放行也不误伤 canonical 命令）：

| # | 规则 | 判定 | 动作 |
|---|---|---|---|
| R1 | 禁直调写 | 命令含 `feishu-doc.js` 且子命令 `patch\|push\|docs.*(\+update\|update)` 且无 `VERIFIED_DOC_PLAN=` env 前缀 | deny："直调写路径被治理禁止；走 canonical CLI + APPROVE_WRITES 门" |
| R2 | auto-approve 须绑 digest | 命令含 `--auto-approve` 且不含 `--approve-batch-digest\|--approve-runtime-digest\|--approve-plan-digest` | deny："裸 auto-approve 被禁止（静默 no-op/无治理写）" |
| R3 | 遗留逃逸 env | 命令含 `DOC_OPS_ALLOW_LEGACY_LIVE` | deny（本地版 PRODUCTION_ENV_BAN；wave3 后异常通道已删，该 env 只剩破坏性） |
| R4 | 证据面写保护 | `rm\|mv 目标不在白名单\|>\|>>\|tee\|sed -i` 触及 run-manifest*.json / *journal*.jsonl / admitted-fingerprints.jsonl / scan-state.json / review-session*.json / acceptance-*.json | deny；白名单=`mv … tmp/run-manifest-archive/`（仪式本身）与 canonical CLI 整体调用（hook 只见命令串，CLI 内部写文件不可见，天然不误伤） |
| R5 | 裸 Feishu 写调用 | `lark-cli api` 含 `POST\|PUT\|DELETE\|PATCH` 方法、`curl -X (POST\|PUT\|DELETE\|PATCH)` 指向 open.feishu.cn | deny："写调用必须经 governed writer"（读调用放行） |
| R6（阶段 C） | 准入门 | 命令命中 canonical 写入口（sdk-doc-sync / verified-doc-authoring execute / pr-polish-apply / sdk-review-session 写类子命令 / post-actions 三脚本）且**当前树指纹 ≠ 台账最新 ADMITTED 记录** | deny："先跑 admission 循环：<仪式四步>"。指纹计算 require `doc-ops-core/src/run-manifest.js` 复用同一实现（repos/ 被 gitignore 不进枚举，耗时可承受 60s timeout） |

**R6 即把 `DOC_OPS_REQUIRE_ADMITTED_FINGERPRINT` 从纪律变成硬件**，且与 L1 的 `RUN_NOT_ADMITTED` 用同一台账（`tmp/skill-feedback-rollout/admitted-fingerprints.jsonl`）、同一指纹函数——不新造真相。

进阶选项（默认不启）：PreToolUse `updatedInput` 把 `node …/sdk-doc-sync.js …` 自动改写为 `DOC_OPS_REQUIRE_ADMITTED_FINGERPRINT=1 node …`（文档允许完整替换输入）。透明度差于 deny+reason，仅当操作员明确要"自动携带"时启用。

### 4.3 打包与代码组织

```
zcode-hooks/                        # 仓库内插件源码（进 git）
  .zcode-plugin/plugin.json         # manifest（查找序 .zcode-plugin → .claude-plugin）
  hooks/hooks.json                  # 事件×matcher×命令 注册
  scripts/
    session-start.mjs               # 指纹比对 + 会话/nextGate 盘点 + 格式速查
    pre-tool-use-bash.mjs           # R1–R6 判定表（数据驱动，规则即数据）
    pre-tool-use-files.mjs          # Write|Edit 证据面保护
    post-tool-use.mjs               # journal sentinel 校验 + next-step 注入
    post-failure.mjs                # 错误→恢复指引表
    stop-check.mjs                  # 落盘一致性便宜检查
  test/                             # stdin JSON fixture → 断言 exit/stdout，并入 focused-tests
```

原则：

- 判定逻辑 **require 仓库 `doc-ops-core` 现有模块**（指纹、journal 分类、状态机），hook 只是把这些进程内门提到 shell 边界，不复制逻辑。
- 规则表 = 数据（规则号/正则/动作/reason 文案集中一处），便于评审与回归。
- 每条规则配 fixture 测试进 admission 的 focused-tests——hook 规则和 invariant 一样走 `check:invariants` 同款治理（改规则须同 diff 改测试）。
- 日志走 stderr；排查看 `~/.zcode/cli/log/zcode-<date>.jsonl` 的 `hook.run.failed`。

### 4.4 明确不用 hook 做的事

- **不复制 L1**：writer-governance/digest 校验的进程内门更强（hook 只见命令串与文件字节），hook 只守进程边界，不重复进程内部。
- **不做语义判断**：digest 数值比对可以；"这个 plan 内容合不合理"不行——那是 `APPROVE_*` 人工门的存在意义。
- **不替代 evals**：措辞/行为类规则（触发边界、lark-cli 排版细节）留在模型评测 + layoutRules 数据。

---

## 5. Prose-only 规则执法归属表（16 条 declared invariants + 6 条 runbook 教训 → 逐条裁定）

| 规则（现状出处） | 裁定归属 |
|---|---|
| 直调 `feishu-doc.js patch\|push` 禁止（authoring SKILL.md:30） | **hook R1 deny** |
| 裸 `--auto-approve`（sdk-doc-sync.js:94，prose 禁依赖） | **hook R2 deny** |
| `DOC_OPS_ALLOW_LEGACY_LIVE` 本地禁（CI-only） | **hook R3 deny** |
| 证据文件只经 canonical 命令写（错误处置表） | **hook R4 deny** |
| 生产 shell 须设 `DOC_OPS_REQUIRE_ADMITTED_FINGERPRINT=1`（runbook 承认是纪律） | **hook R6 deny**（硬件化） |
| 严禁删 journal 重放（workflow error recipe） | **hook R4 deny + PostToolUseFailure 指引** |
| 归档陈旧 run-manifest 仪式（.dwf.ts:43 注释） | **PostToolUseFailure 指引 + SessionStart 注入** |
| 轮换协议：未落盘批准不存活 / nextGate 续接（api SKILL.md:39） | **SessionStart 注入 + Stop block** |
| 门禁精确格式行、门前读 bot-*（api SKILL.md:47-59） | **UserPromptSubmit 软校验 + SessionStart 速查** |
| dry-run 先于 live（各 SKILL.md） | L1 已挡大部分（无 approval 无法写）；hook R2 补旁路；**剩余留给 evals** |
| alias `compatibilityTelemetry` 契约（5 个 alias SKILL.md:10） | **保持 evals**（写一个输出格式 fixture 可选） |
| verbatim-first / include 页禁 rebuild / surgical 优先（registry 已有部分 runtime） | 已 runtime 的留 L1；策略选择类**留 evals + workflow.md** |
| roundtrip-sim 先于 plan（scripts README:14） | **PostToolUse 提醒**（plan 命令后查 sim 记录；不强 deny，过渡期） |
| 用户手改后先 refetch 再 plan（README:116） | **PostToolUse 提醒**；L1 preflight drift 已兜底 |
| 每 execute 新 journal 文件（README:121） | L1 `DUPLICATE_COMPLETION_SENTINEL` 事后兜住；hook **SessionStart 提醒** |
| 手改 candidates 不自动晋升 / 不复活用户删除内容（workflow.md:332） | **留 evals**（learning 模式已覆盖） |

裁定原则：**能变成"看命令串/文件字节就能判"的 → hook；需要理解内容的 → 留 evals/人工门；已有 L1 的 → 不动。**

---

## 6. 落地阶段（每阶段独立可合并、可回归）

- **阶段 A（零风险，先做）**：插件骨架 + SessionStart / UserPromptSubmit / PostToolUseFailure 三个注入型 hook。无 deny、无行为改变，立即兑现轮换确定性。验收：新开 session 能打印准入状态+nextGate+格式速查。
- **阶段 B（第一道硬门）**：PreToolUse R1–R5 deny 表 + Write|Edit 证据保护。验收：fixture 测试表驱动；对照实验——修复前旁路命令必被 deny，canonical 命令全放行（同 PR #79 的 weaken-coverage 反向验证法）。
- **阶段 C（准入门）**：R6 指纹比对 + Stop 落盘检查。性能验证：指纹计算耗时 < timeout；误报观察期可先以 `additionalContext` 警告模式跑一周再切 deny。
- **阶段 D（收尾）**：16 条 declared invariants 逐条按第 5 节裁定迁移；hook 规则表纳入 `validate:skills`/`check:invariants` 治理；更新 runbook 与 CLAUDE.md（Golden Rules 增加"hook 在位，直调即拒"）。

风险与对策：hook 误伤 canonical 命令 → 规则表数据驱动+fixture 全量对照 canonical 命令清单（`write-entrypoints.json` 现成）；配置改后旧 session 不生效 → 文档显著位置标注；hook 进程本身故障 → 非零退出只是可恢复失败，L1 门仍在，纵深不塌。
